import { prisma } from "./prisma.js";

function monthKey(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export async function enforceMonthlyBudgetOrThrow(apiKey) {
  const enforce = (process.env.ENFORCE_BUDGETS || "true").toLowerCase() === "true";
  if (!enforce) return;

  // Determine limit: per-key override else default
  const defaultLimit = Number(process.env.DEFAULT_MONTHLY_LIMIT_USD || "200");
  const keyLimit = Number(apiKey.monthlyLimitUsd);
  const limit = keyLimit > 0 ? keyLimit : defaultLimit;

  // Sum costs for this month for this key
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));

  const agg = await prisma.request.aggregate({
    where: {
      apiKeyId: apiKey.id,
      createdAt: { gte: start, lt: end }
    },
    _sum: { costUsd: true }
  });

  const spent = Number(agg._sum.costUsd || 0);

  if (spent >= limit) {
    const err = new Error(`Monthly budget exceeded (${spent.toFixed(2)} / ${limit.toFixed(2)} USD)`);
    err.statusCode = 429;
    throw err;
  }
}
