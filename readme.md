# The Fraud (server scaffold)

This repo currently contains a minimal **Node.js + Express + Socket.IO** authoritative server implementing the **post-voting → fraud-guess → round-results** flow described in your system prompt.

## Run

```bash
npm install
npm run dev
```

- **Health**: `GET /health`
- **Category meta**: `GET /api/meta`

## Smoke test (optional)

```bash
node server/src/index.js &
node scripts/smoke.js
```
