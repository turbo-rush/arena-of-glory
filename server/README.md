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

Players connect, exchange `set_ready`, and the server emits `match_started` when both are ready. During a match, movement updates are checked for valid rooftop bounds, finite view angles, and strictly increasing input sequence numbers before being relayed with server timestamps. Remote movement is smoothly interpolated on the client. Fire requests are checked by the server for valid weapon/aim values, unique increasing shot IDs, and per-weapon cooldowns. The server uses the latest validated player positions and aim direction to perform a simple rooftop hit test, applies weapon damage and persists target health, then sends `shot_result` to the shooter and `health_update` to the target. It also owns each player's active weapon, magazine and reserve ammunition. Accepted shots consume one server-side round; reload requests transfer reserve ammunition while a server-side reload lock blocks firing; weapon switches are accepted and confirmed by the server with `loadout_update`. This is an initial server-side hit model; it does not yet perform full 3D collision or cover/line-of-sight checks. When a round ends, the room enters `round_break`; combat input and fire requests are blocked until both players send `continue_round`. The server then resets round state and broadcasts `round_started` to both clients. Rejected shots are refunded locally.

## Current scope

This is the first room-server milestone: room creation, two-player capacity, readiness, connection lifecycle, ping/pong and event relay. It does **not** yet implement authoritative movement simulation, full 3D hit validation, cover/line-of-sight collision, authoritative ammunition/reloading, full anti-cheat, reconnection, matchmaking or Telegram identity. Round wins and best-of-five match completion are tracked by the room server. Do not advertise a match as live until the frontend is configured with the deployed Worker URL.
