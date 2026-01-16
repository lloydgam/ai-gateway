import express from "express";
import { requireApiKey } from "../lib/auth.js";
import { enforceMonthlyBudgetOrThrow } from "../lib/budget.js";
import { callAnthropic } from "../providers/anthropic.js";
import { logRequest } from "../lib/logging.js";
import { estimateCostUsd } from "../lib/models.js";

const router = express.Router();

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function normalizeText(out) {
  if (Array.isArray(out?.content)) {
    // find first text block if present
    const t = out.content.find((c) => c?.type === "text" && typeof c?.text === "string");
    if (t) return t.text;
  }
  if (typeof out?.text === "string") return out.text;
  if (out?.content != null && !Array.isArray(out?.content)) return String(out.content);
  return "";
}

function normalizeContent(out) {
  if (Array.isArray(out?.content)) return out.content;
  const text = normalizeText(out);
  return [{ type: "text", text }];
}

/**
 * Claude v1/messages compatible endpoint
 */
router.post("/messages", async (req, res) => {
  console.log('DEBUG: Received /responses/messages request with body:', req.body);
  try {
    // --- Auth ---
    const auth = await requireApiKey(req);
    if (!auth.ok) {
      return res
        .status(auth.status)
        .json({ error: { message: auth.error, type: "auth_error" } });
    }

    const apiKey = auth.apiKey;
    if (!apiKey.isActive) {
      return res
        .status(403)
        .json({ error: { message: "API key is not active", type: "auth_error" } });
    }

    // --- Budget enforcement ---
    const budgetResult = await enforceMonthlyBudgetOrThrow(apiKey);
    if (budgetResult && budgetResult.ok === false) {
      return res.status(budgetResult.statusCode || 429).json(budgetResult);
    }

    // --- Validate payload ---
    const { model, messages, stream, ...rest } = req.body || {};
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: { message: "Missing model or messages", type: "invalid_request_error" },
      });
    }

    const wantsStream = !!stream;

    // Helper: log usage best-effort (works for both stream+nonstream)
    const logUsage = (out) => {
      const promptTokens = out?.usage?.prompt_tokens ?? out?.usage?.input_tokens ?? 0;
      const completionTokens =
        out?.usage?.completion_tokens ?? out?.usage?.output_tokens ?? 0;

      const logPayload = {
        apiKeyId: apiKey.id,
        requestedModel: model,
        provider: out?.provider,
        providerModel: out?.providerModel,
        promptTokens,
        completionTokens,
        totalTokens: out?.usage?.total_tokens ?? promptTokens + completionTokens,
        costUsd: estimateCostUsd(out?.providerModel, promptTokens, completionTokens),
      };

      logRequest(logPayload).catch(() => {});
      return { promptTokens, completionTokens };
    };

    // --- STREAMING PATH ---
    if (wantsStream) {
      // Ask upstream for stream
      const out = await callAnthropic({
        requestedModel: model,
        messages,
        stream: true,
        ...rest,
      });

      // Prepare SSE headers for Anthropic streaming
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("x-accel-buffering", "no"); // nginx
      res.setHeader("anthropic-version", "2023-06-01");
      res.flushHeaders?.();

      // If upstream REALLY streams Anthropic SSE, just pipe it through:
      if (out?.stream) {
        out.stream.on("error", (err) => {
          try {
            sseWrite(res, "error", {
              type: "error",
              error: err?.message || "stream error",
            });
          } catch {}
          res.end();
        });

        out.stream.pipe(res);
        return;
      }

      // Otherwise: emulate Anthropic SSE with a non-stream response
      const out2 = await callAnthropic({
        requestedModel: model,
        messages,
        stream: false,
        ...rest,
      });

      const { promptTokens, completionTokens } = logUsage(out2);

      const id = out2?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const text = normalizeText(out2);

      // Minimal Anthropic event sequence that Claude Code understands
      sseWrite(res, "message_start", {
        type: "message_start",
        message: {
          id,
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: promptTokens,
            output_tokens: 0,
          },
        },
      });

      sseWrite(res, "content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });

      // Send the whole text as one delta (you can chunk it if you want)
      sseWrite(res, "content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      });

      sseWrite(res, "content_block_stop", {
        type: "content_block_stop",
        index: 0,
      });

      sseWrite(res, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: out2?.stop_reason || "end_turn", stop_sequence: null },
        usage: { output_tokens: completionTokens },
      });

      sseWrite(res, "message_stop", { type: "message_stop" });
      res.end();
      return;
    }

    // --- NON-STREAM PATH ---
    const out = await callAnthropic({
      requestedModel: model,
      messages,
      stream: false,
      ...rest,
    });

    const { promptTokens, completionTokens } = logUsage(out);

    const response = {
      id: out?.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: "message",
      role: "assistant",
      content: normalizeContent(out),
      model,
      stop_reason: out?.stop_reason || "end_turn",
      usage: {
        input_tokens: promptTokens,
        output_tokens: completionTokens,
      },
    };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("anthropic-version", "2023-06-01");
    return res.status(200).json(response);
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      error: {
        message: e?.message || "Internal server error",
        type: "server_error",
      },
    });
  }
});

export default router;