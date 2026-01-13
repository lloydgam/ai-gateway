import { prisma } from "./prisma.js";

export async function logRequest({
  apiKeyId,
  requestedModel,
  provider,
  providerModel,
  promptTokens,
  completionTokens,
  totalTokens,
  costUsd
}) {
  return prisma.request.create({
    data: {
      apiKeyId,
      requestedModel,
      provider,
      providerModel,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd
    }
  });
}
