# Company AI Gateway (Node.js + Postgres) — Anthropic-first, OpenAI-compatible

This is a deployable MVP **AI Gateway** that exposes an **OpenAI-compatible** endpoint:

- `POST /v1/chat/completions`
- `GET /health`

It authenticates requests using **gateway API keys** stored in Postgres (hashed), logs usage, and routes calls to **Anthropic (Claude)**.
It’s designed so you can add OpenAI later without changing client configs.

## 1) Quick start (local)

### Requirements
- Docker + Docker Compose
- Node.js 18+

### Start Postgres + Gateway
```bash
cp env.example .env
# edit .env and set ANTHROPIC_API_KEY

docker compose up --build
```

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
- Usage logging per request
- Simple monthly budget enforcement per key (optional, defaults to enabled with a generous limit)

## 5) Next upgrades (common)
- Streaming (SSE)
- SSO / JWT auth instead of static keys
- Team attribution + RBAC
- Prompt redaction / DLP
- Multi-provider routing (OpenAI, local models)
