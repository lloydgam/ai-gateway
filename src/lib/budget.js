import { prisma } from "./prisma.js";

function monthKey(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export async function enforceMonthlyBudgetOrThrow(apiKey) {
  const enforce = (process.env.ENFORCE_BUDGETS || "true").toLowerCase() === "true";
  if (!enforce) return;

  // Determine token limit: per-key override else default
  const defaultTokenLimit = Number(process.env.DEFAULT_MONTHLY_TOKEN_LIMIT || "0"); // 0 = unlimited
  const keyTokenLimit = Number(apiKey.limitToken);
  const tokenLimit = keyTokenLimit > 0 ? keyTokenLimit : defaultTokenLimit;

  // Sum tokens for this month for this key
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

  const agg = await prisma.request.aggregate({
    where: {
      apiKeyId: apiKey.id,
      createdAt: { gte: start, lt: end }
    },
    _sum: { totalTokens: true }
  });

  const tokensUsed = Number(agg._sum.totalTokens || 0);

  if (tokenLimit > 0 && tokensUsed >= tokenLimit) {
    const err = new Error(`Monthly token limit exceeded (${tokensUsed} / ${tokenLimit} tokens)`);
    err.statusCode = 429;
    console.error('Token limit enforcement error:', err);
    throw err;
  }
}
