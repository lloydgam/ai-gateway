import Anthropic from "@anthropic-ai/sdk";
import { resolveModel } from "../lib/models.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function toAnthropic(messages) {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n").trim() || undefined;
  const anthroMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role, content: m.content }));
  return { system, anthroMessages };
}

export async function callAnthropic({ requestedModel, messages, temperature, max_tokens }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error("ANTHROPIC_API_KEY is not set");
    err.statusCode = 500;
    throw err;
  }

  const providerModel = resolveModel(requestedModel);
  const { system, anthroMessages } = toAnthropic(messages);

  const resp = await client.messages.create({
    model: providerModel,
    system,
    messages: anthroMessages,
    max_tokens: max_tokens || 1024,
    temperature: temperature ?? 0.2
  });

  let text = "";
  for (const block of resp.content || []) {
    if (block.type === "text") text += block.text;
  }

  const inputTokens = resp.usage?.input_tokens ?? 0;
  const outputTokens = resp.usage?.output_tokens ?? 0;

  return {
    provider: "anthropic",
    providerModel,
    text,
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens
    }
  };
}
