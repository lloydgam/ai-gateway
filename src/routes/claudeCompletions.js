import express from 'express';
import { requireApiKey } from '../lib/auth.js';
import { enforceMonthlyBudgetOrThrow } from '../lib/budget.js';
import { callAnthropic } from '../providers/anthropic.js';

const router = express.Router();

// Claude v1/messages compatible completion endpoint
router.post('/messages', async (req, res) => {
  try {
    console.log('DEBUG: debug 000000');
    const auth = await requireApiKey(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: { message: auth.error, type: 'auth_error' } });
    }
    const apiKey = auth.apiKey;

    console.log('DEBUG: debug 1');

    // Enforce budget/token limits
    const budgetResult = await enforceMonthlyBudgetOrThrow(apiKey);
    if (budgetResult && budgetResult.ok === false) {
      return res.status(budgetResult.statusCode || 429).json(budgetResult);
    }
    console.log('DEBUG: debug 2');
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
