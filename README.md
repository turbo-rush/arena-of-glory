# ARENA OF GLORY

Mobile-first 3D rooftop combat game built with React, Three.js and Vite. Visual direction: docs/VISUAL_BIBLE.md.

## Current game systems
- VOLT and VEX selectable fighter identities with rigged GLB desktop/mobile assets.
- Three selectable combat zones: SKYLINE // GOLDEN HOUR, IRONWORKS // DUSK and NEON DISTRICT // NIGHT.
- Third-person rooftop combat, cover, aiming, crouch/peek, weapon switching, reloads, hit feedback and best-of-five training rounds.
- Mobile touch controls and desktop keyboard controls.
- Private two-player room protocol using a Cloudflare Worker and Durable Objects, with room codes, Telegram deep links, ready-up, replicated input, server-side shot/damage/ammo handling and short-window reconnect.
- Telegram Mini App launch and invite sharing.

## Frontend
Run npm install and npm run build. Deploy the repository root to Vercel. Configure VITE_TELEGRAM_BOT_USERNAME and VITE_DUEL_SERVER_URL (deployed Cloudflare Worker origin).

## Duel server
See server/README.md. The Worker is separate from Vercel. Add GitHub Actions secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to enable automatic Worker deployments.

## Remaining production milestones
This is the current playable foundation, not a claim that every planned live-service feature is complete. The simplified hit model still needs full 3D cover/line-of-sight validation and authoritative movement; matchmaking, persistent player accounts, ranked seasons, progression/economy, anti-cheat and verified Telegram identity are not shipped. Online rooms require a deployed Worker and VITE_DUEL_SERVER_URL in Vercel.
