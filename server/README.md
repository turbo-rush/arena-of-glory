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

The room server supports short-window reconnection: each player receives a rotating resume token, unexpected disconnects reserve the player's slot and server-side state for up to 60 seconds, and the client retries with exponential backoff. A successful resume restores the same player identity, health, weapon and ammunition, then re-sends the current room phase and the opponent's last known position. Explicitly leaving a room releases the slot immediately. This does **not** yet implement reconnect across a full page reload, authoritative movement simulation, full 3D hit validation, cover/line-of-sight collision, full anti-cheat, matchmaking or Telegram identity. Round wins and best-of-five match completion are tracked by the room server. Do not advertise a match as live until the frontend is configured with the deployed Worker URL.


## Telegram Mini App setup

1. Open [@BotFather](https://t.me/BotFather) in Telegram and run `/newbot`. Choose a display name and a unique bot username; keep the bot token private.
2. In BotFather, open **Bot Settings → Configure Mini App** (or **Menu Button**) and configure the Mini App URL as `https://arena-of-glory.vercel.app`. Set the domain to `arena-of-glory.vercel.app` if BotFather requests it.
3. In the Vercel project, add the environment variable `VITE_TELEGRAM_BOT_USERNAME` with the bot username without the leading `@`, then redeploy the frontend.
4. Once the Main Mini App is configured, links shared by the game use Telegram deep links in the form `https://t.me/<bot>?startapp=room_<CODE>`. The app reads the Telegram `start_param` and automatically joins that private duel.

The current integration handles Mini App launch, Telegram profile-name prefill, and duel deep links. Server-side verification of Telegram `initData` is a separate security step and must be enabled before treating Telegram profile data as authenticated identity. Never commit the bot token to the repository or expose it as a `VITE_*` variable.


## Automatic deployment from GitHub
A workflow deploys this Worker when files under server/ change. Add repository Actions secrets CLOUDFLARE_API_TOKEN (Workers deployment permissions) and CLOUDFLARE_ACCOUNT_ID. Deployment is skipped if either secret is missing. After deployment, set VITE_DUEL_SERVER_URL in Vercel to the Worker origin and redeploy the frontend. Vercel and Cloudflare are separate deployments.
