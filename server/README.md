# ARENA OF GLORY — Duel server

Cloudflare Worker + Durable Objects room service. The Vite game remains deployed on Vercel.

## Deploy

1. From this directory run `npm install`.
2. Authenticate with Cloudflare: `npx wrangler login`.
3. Deploy: `npm run deploy`.
4. Add the deployed Worker origin to the Vercel project's `VITE_DUEL_SERVER_URL` environment variable (for example, `https://arena-of-glory-duel.<account>.workers.dev`) and redeploy the frontend.

## API

- `POST /api/rooms` — creates a six-character private room code and returns `roomCode` and `websocketUrl`.
- `GET /api/rooms/:code/ws` — upgrades to WebSocket and joins that room.

Players connect, exchange `set_ready`, and the server emits `match_started` when both are ready. During a match, validated-size input/fire/reload/weapon messages are relayed to the other connected player.

## Current scope

This is the first room-server milestone: room creation, two-player capacity, readiness, connection lifecycle, ping/pong and event relay. It does **not** yet implement authoritative movement, hit validation, damage, anti-cheat, reconnection, matchmaking or Telegram identity. Do not advertise a match as live until the frontend is configured with the deployed Worker URL.
