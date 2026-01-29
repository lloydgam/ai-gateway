import { prisma } from "./prisma.js";

export async function logRequest({
  apiKeyId,
  requestedModel,
  provider,
  providerModel,
  promptTokens,
  completionTokens,
  totalTokens,
  costUsd,
  userPrompt,
  llmResponse
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
      costUsd,
      userPrompt,
      llmResponse
    }
  });
}
