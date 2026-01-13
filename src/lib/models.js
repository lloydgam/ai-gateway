export function resolveModel(requestedModel) {
  const map = {
    // Trial-friendly defaults (override via env vars if your Anthropic account has access to other models)
    "claude-fast": process.env.CLAUDE_FAST_MODEL || "claude-3-haiku-20240307",
    "claude-quality": process.env.CLAUDE_QUALITY_MODEL || "claude-3-sonnet-20240229",
    "claude-premium": process.env.CLAUDE_PREMIUM_MODEL || "claude-3-sonnet-20240229"
  };
  return map[requestedModel] || requestedModel;
}

// Best-effort pricing table (USD per 1M tokens). You should update with your contracted rates.
// If a model isn't found, cost is returned as 0.
const PRICES_PER_1M = {
  // Example placeholders; update these to your real numbers.
  "claude-3-haiku-20240307": { input: 0, output: 0 },
  "claude-3-sonnet-20240229": { input: 0, output: 0 },
  "claude-3-opus-20240229": { input: 0, output: 0 }
};

export function estimateCostUsd(providerModel, inputTokens, outputTokens) {
  const p = PRICES_PER_1M[providerModel];
  if (!p) return 0;
  const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return Number.isFinite(cost) ? cost : 0;
}
