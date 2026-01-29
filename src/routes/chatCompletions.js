import crypto from "crypto";
import { ChatCompletionsRequestSchema } from "../lib/openaiSchemas.js";
import { requireApiKey } from "../lib/auth.js";
import { enforceMonthlyBudgetOrThrow } from "../lib/budget.js";
import { callAnthropic } from "../providers/anthropic.js";
import { estimateCostUsd } from "../lib/models.js";
import { logRequest } from "../lib/logging.js";


function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function makeId() {
  return "chatcmpl_" + crypto.randomBytes(12).toString("hex");
}

export async function chatCompletionsHandler(req, res) {

  // Only log req.body.messages to avoid circular structure error
  // console.log('DEBUG: body.messages:', JSON.stringify(req.body?.messages, null, 2));
  // Helper to flatten OpenAI-style content arrays (with type/text)
  function flattenContent(content) {
    if (Array.isArray(content)) {
      return content.map(part => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      }).join('\n');
    }
    if (typeof content === 'string') return content;
    return String(content);
  }
  // Helper to flatten nested message arrays
  function flattenMessages(messages) {
    return messages.reduce((acc, m) => {
      if (Array.isArray(m)) {
        return acc.concat(flattenMessages(m));
      }
      acc.push(m);
      return acc;
    }, []);
  }
  try {
    const auth = await requireApiKey(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: { message: auth.error, type: "auth_error" } });
    }
    const apiKey = auth.apiKey;

    // Flatten message content to string before schema validation
    // flattenContent is now declared above, do not redeclare here
    let reqBody = req.body;
    if (Array.isArray(reqBody.messages)) {
      // Filter out 'tool' role before schema validation
      reqBody = {
        ...reqBody,
        messages: reqBody.messages
          .filter(m => m && typeof m === 'object' && ['system', 'user', 'assistant'].includes(m.role))
          .map(m => ({
            ...m,
            content: flattenContent(m.content)
          }))
      };
    }
    // Debug logging: log incoming messages from parsed body after validation
    const parsed = ChatCompletionsRequestSchema.safeParse(reqBody);
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: "Invalid request", type: "invalid_request_error", details: parsed.error.flatten() }
      });
    }

    const body = parsed.data;
    // Set defaults if missing
    if (!body.model) {
      body.model = "claude-fast";
    }
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      body.messages = [
        { role: "user", content: "Hello, AI Gateway!" }
      ];
    }
    // Provider limitation: Only 'system', 'user', 'assistant' roles are accepted. 'tool' role is ignored for provider compatibility.
    // All message content is flattened to string for provider compatibility.
    const allowedProviderRoles = ['system', 'user', 'assistant'];
    const flatMessages = flattenMessages(body.messages || []);
    const sanitizedMessages = flatMessages
      .filter(m =>
        m &&
        typeof m === 'object' &&
        allowedProviderRoles.includes(m.role) &&
        m.content != null
      )
      .map(m => ({
        ...m,
        content: flattenContent(m.content)
      }));

    // Streaming support: OpenAI-compatible SSE format
    if (body.stream) {
      console.log('DEBUG: stream=true received, sending OpenAI-compatible SSE stream.');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // check if UserApikey is not active
      if (!apiKey.isActive) {
        return res.status(403).json({ error: { message: "API key is not active", type: "auth_error" } });
      }

      await enforceMonthlyBudgetOrThrow(apiKey);
      
      const out = await callAnthropic({
        requestedModel: body.model,
        messages: sanitizedMessages,
        temperature: body.temperature,
        max_tokens: body.max_tokens
      });

      const promptTokens = out.usage?.prompt_tokens || out.usage?.input_tokens || 0;
      const completionTokens = out.usage?.completion_tokens || out.usage?.output_tokens || 0;
      const totalTokens = out.usage?.total_tokens || (promptTokens + completionTokens);

      console.log('DEBUG: Streaming response from out:', JSON.stringify(out, null, 2));
      console.log('DEBUG: Streaming response from apiKey:', JSON.stringify(apiKey, null, 2));
      // Log usage (best-effort)
      const logPayload = {
        apiKeyId: apiKey.id,
        requestedModel: body.model,
        provider: out.provider,
        providerModel: out.providerModel,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: estimateCostUsd(out.providerModel, promptTokens, completionTokens),
        userPrompt: JSON.stringify(sanitizedMessages),
        llmResponse: out.text || null
      };
      console.log('DEBUG: logRequest payload (stream):', logPayload);
      logRequest(logPayload)
        .then(result => {
          console.log('DEBUG: logRequest created (stream):', result ? 'success' : 'failed', result);
        })
        .catch(err => {
          console.log('DEBUG: logRequest error (stream):', err);
        });

      // Simulate streaming by sending the full text as a single chunk, then a finish chunk, then [DONE]
      const streamId = makeId();
      const now = nowUnix();
      let sent = false;
      if (out && out.text) {
        // Send the main content chunk
        const chunk = {
          id: streamId,
          object: "chat.completion.chunk",
          created: now,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: { content: out.text },
              finish_reason: null
            }
          ]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        sent = true;
      }
      // Send the finish chunk
      const finishChunk = {
        id: streamId,
        object: "chat.completion.chunk",
        created: now,
        model: body.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop"
          }
        ]
      };
      res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
      // Send the [DONE] message
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Debug logging
    // console.log('DEBUG: body.messages:', JSON.stringify(body.messages, null, 2));

    function flattenMessages(messages) {
      return messages.reduce((acc, m) => {
        if (Array.isArray(m)) {
          return acc.concat(flattenMessages(m));
        }
        acc.push(m);
        return acc;
      }, []);
    }

    // Provider limitation: Only 'system', 'user', 'assistant' roles are accepted. 'tool' role is ignored for provider compatibility.
    // All message content is flattened to string for provider compatibility.
    // console.log('DEBUG: flatMessages:', JSON.stringify(flatMessages, null, 2));
    
    if (!sanitizedMessages.length) {
      return res.status(400).json({
        error: {
          message: "No valid messages after sanitization. At least one valid message is required.",
          type: "invalid_request_error",
          code: "no_valid_messages"
        }
      });
    }
    // Provider routing (Anthropic-first)
    const out = await callAnthropic({
      requestedModel: body.model,
      messages: sanitizedMessages,
      temperature: body.temperature,
      max_tokens: body.max_tokens
    });
    // Debug: log the provider call result
    console.log('DEBUG: provider call result:', JSON.stringify(out, null, 2));

    // Handle empty or invalid provider response (OpenAI-style fallback, always 200)
    if (!out || typeof out !== 'object' || (!out.text && !out.usage)) {
      const errorFallback = {
        id: "chatcmpl_error",
        object: "chat.completion",
        created: nowUnix(),
        model: body.model || "unknown",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Error: Empty or invalid provider response." },
            finish_reason: "error"
          }
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      console.log('DEBUG: error fallback response:', JSON.stringify(errorFallback, null, 2));
      return res.status(200).json(errorFallback);
    }

    // Log usage (best-effort)
    logRequest({
      apiKeyId: apiKey.id,
      requestedModel: body.model,
      provider: out.provider,
      providerModel: out.providerModel,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      userPrompt: JSON.stringify(sanitizedMessages),
      llmResponse: out.text || null
    }).catch(() => {});

    // If this is a user API key, log to UserRequest as well
    if (auth.type === 'user') {
      // Import PrismaClient here to avoid circular import
      const { PrismaClient } = await import('@prisma/client');
      const prisma = new PrismaClient();
      prisma.userRequest.create({
        data: {
          userApiKeyId: apiKey.id,
          endpoint: '/v1/chat/completions',
          status: out.text ? 'success' : 'error',
          costUsd: costUsd || 0
        }
      }).catch(() => {});
    }

    // OpenAI-compatible response shape
    return res.json({
      id: makeId(),
      object: "chat.completion",
      created: nowUnix(),
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: out.text || "" },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens
      }
    });
  } catch (e) {
    const status = e?.statusCode || 500;
    return res.status(status).json({
      error: { message: e?.message || "Internal server error", type: "server_error" }
    });
  }
}