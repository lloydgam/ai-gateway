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
## User API Key Management



The gateway provides endpoints to create, delete, and regenerate user-specific API keys. User API keys are hashed before storage (never stored in plaintext) and the plaintext key is only returned once on creation or regeneration. Store it securely!


### Endpoints

- `POST /v1/user-api-keys` — Create a new user API key
  - Body: `{ "email": "...", "firstname": "...", "lastname": "..." }`
  - Response: `{ id, email, firstname, lastname, apiKey, createdAt, updatedAt }` (apiKey is plaintext, shown only once)

- `DELETE /v1/user-api-keys/:id` — Delete a user API key
  - Response: `{ success: true }`

- `POST /v1/user-api-keys/:id/regenerate` — Regenerate a user's API key
  - Optional body: `{ "reason": "string describing why the key is regenerated" }`
  - Response: `{ id, email, firstname, lastname, apiKey, createdAt, updatedAt }` (new apiKey is plaintext, shown only once)

- `GET /v1/user-api-keys` — List all user API keys (for admin/debug; does not return plaintext keys)

- `GET /v1/user-api-keys/usage` — List all user API keys with usage and limits (placeholders for now)
  - Response: `[ { id, email, firstname, lastname, createdAt, updatedAt, usage, limit } ]`

- `GET /v1/user-api-keys/:id/usage-history` — Get usage history for a specific user (currently returns an empty array)
  - Response: `{ userId, history: [] }`


**Security Note:**
- The plaintext API key is only returned once. Store it securely after creation/regeneration.
- User API keys are hashed before storage and cannot be recovered if lost.


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
- OpenAI-compatible `chat/completions` (non-streaming)
- API key auth (hashed tokens in DB)
- **User API key management endpoints (hashed storage)**
- Usage logging per request
- Simple monthly budget enforcement per key (optional, defaults to enabled with a generous limit)

## 5) Next upgrades (common)
- Streaming (SSE)
- SSO / JWT auth instead of static keys
- Team attribution + RBAC
- Prompt redaction / DLP
- Multi-provider routing (OpenAI, local models)
