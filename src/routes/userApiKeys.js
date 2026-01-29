import express from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { requireApiKey } from '../lib/auth.js';
import { hashKey } from '../lib/auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Helper to generate a random API key
function generateApiKey() {
  return crypto.randomBytes(32).toString('hex');
}



// Create a new API key for a user (store hash, return plaintext once)
router.post('/', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { email, firstname, lastname, limitToken, claudecodeUserKey, aigatewayUserKey } = req.body;

  if (!email || !firstname || !lastname || !limitToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const apiKey = generateApiKey();
  const apiKeyHash = hashKey(apiKey);
  try {
    const userApiKey = await prisma.userApiKey.create({
      data: { email, firstname, lastname, apiKeyHash, limitToken, claudecodeUserKey: apiKeyHash, aigatewayUserKey: apiKey  },
    });
    // Log creation in UserRequest
    await prisma.userRequest.create({
      data: {
        userApiKeyId: userApiKey.id,
        endpoint: '/v1/user-api-keys',
        status: 'created',
        costUsd: 0
      }
    });
    res.json({
      id: userApiKey.id,
      email: userApiKey.email,
      firstname: userApiKey.firstname,
      lastname: userApiKey.lastname,
      apiKey, // Return plaintext key once
      limitToken: userApiKey.limitToken,
      createdAt: userApiKey.createdAt,
      updatedAt: userApiKey.updatedAt,
      claudecodeUserKey: userApiKey.claudecodeUserKey,
      aigatewayUserKey: userApiKey.aigatewayUserKey,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a user's API key
router.delete('/:id', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  try {
    const updated = await prisma.userApiKey.update({
      where: { id },
      data: { isActive: false },
    });
    // Log deletion in UserRequest
    await prisma.userRequest.create({
      data: {
        userApiKeyId: id,
        endpoint: '/v1/user-api-keys/' + id,
        status: 'deleted',
        costUsd: 0
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(404).json({ error: 'API key not found' });
  }
});

// Update firstname and lastname for a user by id
router.put('/:id', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  const { firstname, lastname } = req.body;
  if (!firstname || !lastname) {
    return res.status(400).json({ error: 'Missing firstname or lastname' });
  }
  try {
    const updated = await prisma.userApiKey.update({
      where: { id },
      data: { firstname, lastname }
    });
    res.json({ id: updated.id, firstname: updated.firstname, lastname: updated.lastname });
  } catch (err) {
    res.status(404).json({ error: 'User API key not found' + err.message  });
  }
});

// Regenerate a user's API key (store hash, return plaintext once)
router.post('/:id/regenerate', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  const { reason } = req.body;
  const newApiKey = generateApiKey();
  const newApiKeyHash = hashKey(newApiKey);
  try {
    const updated = await prisma.userApiKey.update({
      where: { id },
      data: { apiKeyHash: newApiKeyHash, isActive: true, aigatewayUserKey: newApiKey },
    });
    // Log regeneration in UserRequest, including reason if provided
    await prisma.userRequest.create({
      data: {
        userApiKeyId: updated.id,
        endpoint: '/v1/user-api-keys/' + id + '/regenerate',
        status: 'regenerated',
        costUsd: 0,
        ...(reason ? { status: `regenerated: ${reason}` } : {})
      }
    });
    res.json({
      id: updated.id,
      isActive: updated.isActive,
      email: updated.email,
      firstname: updated.firstname,
      lastname: updated.lastname,
      newApiKey,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      limitTokens: updated.limitTokens,
    });
  } catch (err) {
    res.status(404).json({ error: 'API key not found' });
  }
});

// (Optional) List all user API keys with pagination
router.get('/', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  let { page = 1, pageSize = 50 } = req.query;
  page = Math.max(1, parseInt(page));
  pageSize = Math.min(100, Math.max(1, parseInt(pageSize)));
  const skip = (page - 1) * pageSize;
  const [total, keys] = await Promise.all([
    prisma.userApiKey.count(),
    prisma.userApiKey.findMany({ skip, take: pageSize })
  ]);
  const result = keys.map(user => ({
    id: user.id,
    isActive: user.isActive,
    email: user.email,
    firstname: user.firstname,
    lastname: user.lastname,
    apiKeyHash: user.apiKeyHash,
    limitUsd: user.limitUsd,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    limitToken: user.limitToken,
  }));
  res.json({
    total,
    page,
    pageSize,
    data: result
  });
});

// List all user API keys with usage and limits, paginated
router.get('/usage', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  let { page = 1, pageSize = 50 } = req.query;
  page = Math.max(1, parseInt(page));
  pageSize = Math.min(100, Math.max(1, parseInt(pageSize)));
  const skip = (page - 1) * pageSize;
  const [total, users] = await Promise.all([
    prisma.userApiKey.count(),
    prisma.userApiKey.findMany({ skip, take: pageSize })
  ]);
  const result = await Promise.all(users.map(async user => {
    // Aggregate from UserRequest (per-user custom events)
    const userAgg = await prisma.userRequest.aggregate({
      _count: { id: true },
      _sum: { costUsd: true },
      where: { userApiKeyId: user.id }
    });
    // Aggregate from Request (API usage, if apiKeyId matches user.id)
    const reqAgg = await prisma.request.aggregate({
      _count: { id: true },
      _sum: { totalTokens: true, costUsd: true },
      where: { apiKeyId: user.id }
    });
    return {
      id: user.id,
      isActive: user.isActive,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      totalTokens: reqAgg._sum.totalTokens || 0,
      requestCount: reqAgg._count.id,
      totalCostUsd: reqAgg._sum.costUsd || 0,
      limitUsd: user.limitUsd,
      limitToken: user.limitToken,
      overLimit: reqAgg._sum.costUsd && user.limitUsd && reqAgg._sum.costUsd > user.limitUsd ? true : false
    };
  }));
  res.json({
    total,
    page,
    pageSize,
    data: result
  });
});

// Get usage history for a specific user, paginated
router.get('/:id/usage-history', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  let { page = 1, pageSize = 50 } = req.query;
  page = Math.max(1, parseInt(page));
  pageSize = Math.min(100, Math.max(1, parseInt(pageSize)));
  const skip = (page - 1) * pageSize;
  const [total, history] = await Promise.all([
    prisma.userRequest.count({ where: { userApiKeyId: id } }),
    prisma.userRequest.findMany({
      where: { userApiKeyId: id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    })
  ]);
  res.json({
    userId: id,
    total,
    page,
    pageSize,
    data: history
  });
});

// Increase token limit for a user API key
router.post('/:id/increase-token-limit', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  const { increment } = req.body;
  if (!increment || typeof increment !== 'number' || increment <= 0) {
    return res.status(400).json({ error: 'Missing or invalid increment value' });
  }
  try {
    const user = await prisma.userApiKey.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User API key not found' });
    const newLimit = Number(user.limitToken || 0) + increment;
    const updated = await prisma.userApiKey.update({
      where: { id },
      data: { limitToken: newLimit }
    });
    // Log the increase in UserRequest
    await prisma.userRequest.create({
      data: {
        userApiKeyId: id,
        endpoint: `/v1/user-api-keys/${id}/increase-token-limit`,
        status: `token limit increased by ${increment}`,
        costUsd: 0
      }
    });
    res.json({ id: updated.id, newLimit: updated.limitToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update ClaudeCode API key for a user by userApiKey id
router.post('/:id/update-claudecode-key', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  const { claudecodeUserKey } = req.body;
  if (!claudecodeUserKey) {
    return res.status(400).json({ error: 'Missing claudecodeUserKey' });
  }
  try {
    const updated = await prisma.userApiKey.update({
      where: { id },
      data: { claudecodeUserKey },
    });
    // Log the update in UserRequest
    await prisma.userRequest.create({
      data: {
        userApiKeyId: id,
        endpoint: `/v1/user-api-keys/${id}/update-claudecode-key`,
        status: `claudecodeUserKey updated`,
        costUsd: 0
      }
    });
    res.json({ id: updated.id, claudecodeUserKey: updated.claudecodeUserKey });
  } catch (err) {
    res.status(404).json({ error: 'User API key not found' });
  }
});

// Usage report endpoint: filter by month/year range and optional providerModel, paginated for users
router.get('/reports-usage', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }

  let { startMonth, startYear, endMonth, endYear, providerModel, email, global, page = 1, pageSize = 50 } = req.query;
  if (!startMonth || !startYear || !endMonth || !endYear) {
    return res.status(400).json({ error: 'Missing required date range parameters' });
  }
  page = Math.max(1, parseInt(page));
  pageSize = Math.min(100, Math.max(1, parseInt(pageSize)));
  const skip = (page - 1) * pageSize;
  const startM = Number(startMonth);
  const startY = Number(startYear);
  const endM = Number(endMonth);
  const endY = Number(endYear);
  // Helper to get all months in range
  function getMonthYearRange(startM, startY, endM, endY) {
    const months = [];
    let y = startY, m = startM;
    while (y < endY || (y === endY && m <= endM)) {
      months.push({ month: m, year: y });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return months;
  }
  const monthsRange = getMonthYearRange(startM, startY, endM, endY);
  if (global === 'true') {
    // Aggregate for all users as a whole
    const monthsData = await Promise.all(monthsRange.map(async ({ month, year }) => {
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
      const where = {
        createdAt: {
          gte: monthStart,
          lte: monthEnd
        }
      };
      if (providerModel) {
        where.providerModel = providerModel;
      }
      if (email) {
        // Find user(s) with this email
        const users = await prisma.userApiKey.findMany({ where: { email } });
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
          where.apiKeyId = { in: userIds };
        } else {
          // No users with this email, so skip
          return {
            month,
            year,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalRequestCount: 0
          };
        }
      }
      const agg = await prisma.request.aggregate({
        _sum: { promptTokens: true, completionTokens: true },
        _count: { id: true },
        where
      });
      return {
        month,
        year,
        totalPromptTokens: agg._sum.promptTokens || 0,
        totalCompletionTokens: agg._sum.completionTokens || 0,
        totalRequestCount: agg._count.id || 0
      };
    }));
    return res.json({ months: monthsData });
  } else {
    // Get all users, optionally filter by email, paginated
    const userWhere = email ? { where: { email } } : {};
    const [total, users] = await Promise.all([
      prisma.userApiKey.count(userWhere),
      prisma.userApiKey.findMany({ ...userWhere, skip, take: pageSize })
    ]);
    // For each user, aggregate usage from Request table by month
    const result = await Promise.all(users.map(async user => {
      const monthsData = await Promise.all(monthsRange.map(async ({ month, year }) => {
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
        const where = {
          apiKeyId: user.id,
          createdAt: {
            gte: monthStart,
            lte: monthEnd
          }
        };
        if (providerModel) {
          where.providerModel = providerModel;
        }
        const agg = await prisma.request.aggregate({
          _sum: { promptTokens: true, completionTokens: true },
          _count: { id: true },
          where
        });
        return {
          month,
          year,
          totalPromptTokens: agg._sum.promptTokens || 0,
          totalCompletionTokens: agg._sum.completionTokens || 0,
          totalRequestCount: agg._count.id || 0
        };
      }));
      return {
        id: user.id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
        months: monthsData
      };
    }));
    res.json({
      total,
      page,
      pageSize,
      data: result
    });
  }
});

// Fetch userPrompt and llmResponse by user email or apiKeyId, filter by last N days (default 1)
// Fetch userPrompt and llmResponse by user email or apiKeyId, or show all latest if neither is provided
router.get('/prompts-responses', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { email, apiKeyId, days, limit } = req.query;
  let requests = [];
  if (email || apiKeyId) {
    const numDays = Math.max(1, parseInt(days) || 30); // default is the last 30 days
    const since = new Date();
    since.setDate(since.getDate() - numDays); // include today if days=1
    let keyId = apiKeyId;
    if (!keyId && email) {
      // Find userApiKey by email
      const user = await prisma.userApiKey.findUnique({ where: { email } });
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      keyId = user.id;
    }
    // Find all requests for this user/apiKeyId in the last N days
    requests = await prisma.request.findMany({
      where: {
        apiKeyId: keyId,
        createdAt: { gte: since },
        NOT: [
          { userPrompt: null },
          { llmResponse: null }
        ]
      },
      select: {
        id: true,
        apiKeyId: true,
        createdAt: true,
        userPrompt: true,
        llmResponse: true
      },
      orderBy: { createdAt: 'desc' }
    });
    console.log(`Fetched ${requests.length} requests for apiKeyId ${keyId} in last ${numDays} days`);
    return res.json({ apiKeyId: keyId, email: email, days: numDays, results: requests });
  } else {
    // No filter: show latest N prompts/responses
    const maxLimit = 500;
    const n = Math.min(parseInt(limit) || 100, maxLimit);
    requests = await prisma.request.findMany({
      where: {
        NOT: [
          { userPrompt: null },
          { llmResponse: null }
        ]
      },
      select: {
        id: true,
        apiKeyId: true,
        createdAt: true,
        userPrompt: true,
        llmResponse: true
      },
      orderBy: { createdAt: 'desc' },
      take: n
    });
    return res.json({ results: requests, limit: n });
  }
});

export default router;
