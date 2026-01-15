# Company AI Gateway (Node.js + Postgres) — Anthropic-first, OpenAI-compatible


This is a deployable MVP **AI Gateway** that exposes:

- `POST /v1/chat/completions` (OpenAI-compatible)
- `GET /health`
- **User API Key Management Endpoints** (see below)

It authenticates requests using **gateway API keys** stored in Postgres (hashed), logs usage, and routes calls to **Anthropic (Claude)**.
It’s designed so you can add OpenAI later without changing client configs.

## 1) Quick start (local)

### Requirements
- Docker + Docker Compose
- Node.js 18+

docker compose up --build

### Start Postgres + Gateway
```bash
cp env.example .env
# edit .env and set ANTHROPIC_API_KEY


docker compose up --build
```

## User API Key Management & ClaudeCode Key Mapping

This gateway supports integration with ClaudeCode, which requires a mapping between the API key assigned by ClaudeCode (selected during your first login to ClaudeCode) and the gateway's own API key. This is necessary because ClaudeCode will always use the same assigned API key token for authentication, and it must be mapped to a valid gateway API key for requests to succeed.

**How it works:**
- When a new user is created, you must provide the free version ClaudeCode account's API key (the one shown in ClaudeCode settings). This will be stored as `claudecodeUserKey` and mapped to a generated `aigatewayUserKey`.
- When authenticating, if a request comes in with a `claudecodeUserKey`, the gateway will automatically map it to the correct `aigatewayUserKey` for downstream processing.
- On key regeneration, both keys are updated and the mapping is maintained.

**This means:**
- Every new user must provide their ClaudeCode API key token at creation time.
- The mapping is stored in the database and used for all future requests from that user.

**Security Note:** The plaintext API key is only returned once. Store it securely after creation/regeneration. User API keys are hashed before storage and cannot be recovered if lost.

### Usage Limits

- **Token-based monthly limits**: Each user API key can have a `limitToken` (monthly token limit). If not set, a default can be configured via `DEFAULT_MONTHLY_TOKEN_LIMIT` env var. When the limit is reached, requests are rejected with a clear error message.
- **Cost-based monthly limits**: (For gateway keys) Each API key can have a `monthlyLimitUsd` (default via `DEFAULT_MONTHLY_LIMIT_USD`).
- Usage is aggregated per month and per key.

### Error Handling

- If a user or gateway key exceeds its monthly limit, the API returns a 429 error with a structured error message, including the current usage and the limit.
- Example error response:
  ```json
  {
    "error": "Monthly token limit exceeded (100000 / 100000 tokens)",
    "tokensUsed": 100000,
    "tokenLimit": 100000
  }
  ```

### Schema Notes

- The `Request` model no longer has a relation to `ApiKey` (just a string `apiKeyId`).
- The `UserRequest` model can be extended to include a `tokensUsed` field if you want to track per-request token usage for user keys.



### Endpoints


- `POST /v1/user-api-keys` — Create a new user API key
  - Body: `{ "email": "...", "firstname": "...", "lastname": "...", "claudecodeUserKey": "<claudecode_api_key>" }`
  - Response: `{ id, email, firstname, lastname, apiKey, claudecodeUserKey, aigatewayUserKey, createdAt, updatedAt }` (apiKey and both mapping keys are plaintext, shown only once)

- `DELETE /v1/user-api-keys/:id` — Delete a user API key
  - Response: `{ success: true }`

- `POST /v1/user-api-keys/:id/regenerate` — Regenerate a user's API key
  - Optional body: `{ "reason": "string describing why the key is regenerated" }`
  - Response: `{ id, email, firstname, lastname, newApiKey, claudecodeUserKey, aigatewayUserKey, createdAt, updatedAt }` (new keys are plaintext, shown only once)

- `POST /v1/user-api-keys/:id/increase-token-limit` — Increase the token limit for a user API key
  - Body: `{ "increment": <number> }`
  - Response: `{ id, newLimit }`

- `GET /v1/user-api-keys` — List all user API keys (for admin/debug; does not return plaintext keys)

- `GET /v1/user-api-keys/usage` — List all user API keys with usage and limits
  - Response: `[ { id, email, firstname, lastname, createdAt, updatedAt, totalTokens, requestCount, totalCostUsd, limitUsd, overLimit } ]`

- `GET /v1/user-api-keys/:id/usage-history` — Get usage history for a specific user
  - Response: `{ userId, history: [ ... ] }`


**Security Note:**
- The plaintext API key is only returned once. Store it securely after creation/regeneration.
- User API keys are hashed before storage and cannot be recovered if lost.

## Environment Variables

- `DEFAULT_MONTHLY_LIMIT_USD` — Default monthly cost limit for gateway keys (USD)
- `DEFAULT_MONTHLY_TOKEN_LIMIT` — Default monthly token limit for user keys
- `ENFORCE_BUDGETS` — Set to `true` to enable budget enforcement (default: true)


In a second terminal:
```bash
# Generate Prisma client & apply schema (container does it on boot, but you can also run locally)
npm install
npm run db:generate
npm run db:push

# Seed a first API key (prints the plaintext key once)
npm run db:seed
```

### Test
```bash
export GATEWAY_KEY="paste_seeded_key_here"

curl http://localhost:8000/health

curl --location 'http://localhost:8000/v1/chat/completions' \
--header 'Content-Type: application/json' \
--header 'Authorization: ••••••' \
--data '{
  "model": "claude-fast",
  "stream": true,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "You are Cursor AI..." }
      ]
    }
  ]
}'
```

## 2) Configure IDEs

Point any IDE/tool that supports a custom OpenAI endpoint to:

- **Base URL**: `http://<your-host>:8000/v1`
- **API key**: the gateway key you issued

Models supported by default aliases:
- `claude-fast`
- `claude-quality`
- `claude-premium`

(These map to provider models via env vars.)


### CursorAI Setup

To use this gateway with CursorAI, you must:

1. **Create custom model names in CursorAI:**
  - `claude-fast`
  - `claude-quality`
  - `claude-premium`

2. **Configure your API key and endpoint:**
  - In CursorAI, set the Token Key to the API key you generated from the AI Gateway.
  - Set the Base URL to your gateway endpoint (e.g. `https://your-gateway-host/v1`).

This ensures CursorAI will route requests to the correct Claude models and authenticate with your gateway.

---

## 3) Deploy (server)

Recommended:
- Run with Docker on your server
- Put it behind a reverse proxy (NGINX/Caddy) with TLS
- Set `NODE_ENV=production`

### Minimal deploy
```bash
docker compose up -d --build
```


## 4) What’s included (MVP)
- OpenAI-compatible `chat/completions` (streaming and non-streaming)
- API key auth (hashed tokens in DB)
- **User API key management endpoints (hashed storage)**
- Usage logging per request
- Simple monthly budget and/or token enforcement per key (configurable)

## 5) Next upgrades (common)
- Streaming (SSE)
- SSO / JWT auth instead of static keys
- Team attribution + RBAC
- Prompt redaction / DLP
- Multi-provider routing (OpenAI, local models)

## Claude v1/messages Endpoint

- `POST /v1/messages` — Claude-compatible completions endpoint
  - Body:
    ```json
    {
      "model": "claude-3-opus-20240229",
      "messages": [
        { "role": "user", "content": "Hello, Claude!" }
      ],
      "max_tokens": 1024,
      "temperature": 0.7
    }
    ```
  - Response:
    ```json
    {
      "id": "msg_...",
      "type": "message",
      "role": "assistant",
      "content": "Hello! How can I help you today?",
      "model": "claude-3-opus-20240229",
      "stop_reason": "end_turn",
      "usage": {
        "input_tokens": 10,
        "output_tokens": 20
      }
    }
    ```
  - Auth: Requires a valid API key in the `Authorization` header.
  - This endpoint is compatible with Claude's v1/messages API format for easy integration with Claude-compatible clients.
