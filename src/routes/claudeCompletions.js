import express from 'express';
import { requireApiKey } from '../lib/auth.js';
import { enforceMonthlyBudgetOrThrow } from '../lib/budget.js';

import { callAnthropic } from '../providers/anthropic.js';
import { logRequest } from '../lib/logging.js';
import { estimateCostUsd } from '../lib/models.js';

const router = express.Router();

// Claude v1/messages compatible completion endpoint
router.post('/messages', async (req, res) => {
  try {
    const auth = await requireApiKey(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: { message: auth.error, type: 'auth_error' } });
    }
    const apiKey = auth.apiKey;

    // check if UserApikey is not active
    if (!apiKey.isActive) {
      return res.status(403).json({ error: { message: "API key is not active", type: "auth_error" } });
    }

    // Enforce budget/token limits
    const budgetResult = await enforceMonthlyBudgetOrThrow(apiKey);
    if (budgetResult && budgetResult.ok === false) {
      return res.status(budgetResult.statusCode || 429).json(budgetResult);
    }
    
    // Claude v1/messages expects: { model, messages, ... }
    const { model, messages, ...rest } = req.body;
    if (!model || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'Missing model or messages', type: 'invalid_request_error' } });
    }
    // Call Anthropic provider (Claude)
    const out = await callAnthropic({
      requestedModel: model,
      messages,
      ...rest
    });

    const promptTokens = out.usage?.prompt_tokens || out.usage?.input_tokens || 0;
    const completionTokens = out.usage?.completion_tokens || out.usage?.output_tokens || 0;
    const totalTokens = out.usage?.total_tokens || (promptTokens + completionTokens);
    
    // Log usage (best-effort)
    const logPayload = {
      apiKeyId: apiKey.id,
      requestedModel: model,
      provider: out.provider,
      providerModel: out.providerModel,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd: estimateCostUsd(out.providerModel, promptTokens, completionTokens) 
    };

    logRequest(logPayload)
      .then(result => {
        console.log('DEBUG: logRequest created (stream):', result ? 'success' : 'failed', result);
      })
      .catch(err => {
        console.log('DEBUG: logRequest error (stream):', err);
      });

    // Claude v1/messages response format
    // { id, type, role, content, model, stop_reason, usage }
    const response = {
      id: out.id || 'claude_msg_' + Math.random().toString(36).slice(2),
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'text', text: out.text || '' }
      ],
      model: model,
      stop_reason: out.stop_reason || 'stop',
      usage: out.usage || {}
    };

    res.json(response);
  } catch (e) {
    const status = e?.statusCode || 500;
    res.status(status).json({ error: { message: e?.message || 'Internal server error', type: 'server_error' } });
  }
});

export default router;
