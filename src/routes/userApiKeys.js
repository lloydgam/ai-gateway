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
  const { email, firstname, lastname, limitToken } = req.body;
  if (!email || !firstname || !lastname || !limitToken) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const apiKey = generateApiKey();
  const apiKeyHash = hashKey(apiKey);
  try {
    const userApiKey = await prisma.userApiKey.create({
      data: { email, firstname, lastname, apiKeyHash, limitToken },
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
      data: { apiKeyHash: newApiKeyHash, isActive: true },
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

// (Optional) List all user API keys
router.get('/', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const keys = await prisma.userApiKey.findMany();
   // Return all fields except apiKeyHash, and add a masked apiKey field
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
  res.json(result);
});

// List all user API keys with usage and limits
router.get('/usage', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  // Get all users
  const users = await prisma.userApiKey.findMany();
  // For each user, aggregate request count and total cost from UserRequest and Request
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
      // Sum tokens and cost from Request table
      totalTokens: reqAgg._sum.totalTokens || 0,
      requestCount: reqAgg._count.id,
      totalCostUsd: reqAgg._sum.costUsd || 0,
      // Optionally, you can also include userAgg if you want to show custom events
      limitUsd: user.limitUsd,
      limitToken: user.limitToken,
      overLimit: reqAgg._sum.costUsd && user.limitUsd && reqAgg._sum.costUsd > user.limitUsd ? true : false
    };
  }));
  res.json(result);
});

// Get usage history for a specific user
router.get('/:id/usage-history', async (req, res) => {
  const auth = await requireApiKey(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
  }
  const { id } = req.params;
  // Fetch real usage history from UserRequest table
  const history = await prisma.userRequest.findMany({
    where: { userApiKeyId: id },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ userId: id, history });
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


export default router;
