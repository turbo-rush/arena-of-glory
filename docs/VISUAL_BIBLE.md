# ARENA OF GLORY — NEON INK: URBAN PULSE
## Visual Bible v1.0

### Creative direction
An original hybrid of premium stylized 3D action, graphic-novel illustration, and vivid urban street-art energy. The world must feel dimensional and cinematic, while shapes, materials, and effects retain a deliberate illustrated identity. Do not imitate a specific existing game or studio.

### Core pillars
1. **Bold silhouettes:** fighters and weapons remain readable at mobile screen size.
2. **Illustrated 3D:** controlled cel-style value grouping, hand-authored-looking surface breakup, selective ink accents; avoid flat 2D sprites.
3. **Color with purpose:** saturated focal accents against structured, darker environments.
4. **Cinematic readability:** strong key/rim lighting, clear separation between fighter and background, restrained bloom.
5. **Combat clarity:** VFX communicate direction and impact without obscuring opponents or aiming.

### Palette
| Token | Hex | Use |
|---|---|---|
| Combat Orange | #FF6B35 | hero accents, team/player emphasis |
| Electric Gold | #FFD447 | wins, highlights, premium details |
| Pulse Cyan | #19D6CE | interface, cool rim light, enemy/tech accents |
| Violet Ink | #A45CFF | rare graphic accents, arena signage |
| Impact Pink | #F04475 | hit feedback and selective neon |
| Deep Asphalt | #171B2B | UI foundations, deep shadows |
| Concrete | #343B46 | architecture and neutral surfaces |
| Warm Light | #FFE0B1 | sunset key light |

Use a 70/20/10 balance: 70% environment/base neutrals, 20% arena-specific color, 10% high-energy accents. Never paint every surface neon.

### Character design standard
- Athletic, stylized proportions with readable head/torso/limb shapes; avoid extreme caricature.
- Layered urban combat clothing: jacket/hoodie, reinforced trousers, gloves, utility details, distinctive footwear.
- Each fighter gets one primary accent color, one secondary accent, and a neutral foundation.
- Face, hair/headwear, silhouette, and weapon profile must distinguish fighters at a glance.
- Materials: matte cloth, controlled leather sheen, brushed metal, rubber; avoid uniform plastic gloss.
- Animation priorities: idle, locomotion, aim, fire/recoil, reload, hit reaction, victory/defeat.

### Arena art direction
- **SKYLINE // GOLDEN HOUR:** warm amber sunlight, long shadows, concrete and glass, orange/gold accents.
- **IRONWORKS // DUSK:** steel, soot, warm industrial practicals, muted rust with cyan separation.
- **NEON DISTRICT // NIGHT:** deep blue-violet atmosphere, cyan/magenta signs, wet-surface highlights used selectively.
- Each arena keeps the same character readability and UI contrast rules.

### Lighting and rendering
- Use a clear key light plus colored rim/fill; preserve readable faces and weapon silhouettes.
- Prefer baked/simple lighting and selective real-time shadows for mobile performance.
- Use fog and bloom sparingly; avoid full-screen blur and excessive post-processing.
- Maintain stable frame pacing on mid-range iOS and Android devices; quality tiers should reduce effects before reducing input responsiveness.

### Combat VFX
- Muzzle flashes: brief, directional, weapon-specific.
- Tracers: thin and short-lived; never persistent laser beams.
- Impacts: compact sparks/dust with distinct material response.
- Hit feedback: high-contrast but brief; headshot and body hit must be distinguishable.
- Screen effects must not cover the reticle, opponent silhouette, or essential HUD.

### UI language
- Dark asphalt panels, bold condensed display typography, compact labels.
- Orange/gold for player and victory emphasis; cyan for technical/neutral information; pink only for impact alerts.
- Use graphic slashes, subtle halftone/grain, and angled separators sparingly.
- Mobile-first: large touch targets, safe-area spacing, legible HUD at phone width.

### Implementation rules
- Preserve the existing Three.js scene, combat logic, online protocol, and mobile controls while replacing visual assets and presentation incrementally.
- Do not add heavy shaders, large texture atlases, or expensive transparent layers without profiling on mobile.
- Prefer reusable materials, shared geometry, instancing for repeated props, compressed textures, and low draw-call counts.
- Keep gameplay state and networking independent from cosmetic changes.
- Never add explosive barrels or destructible explosive props.

### First vertical slice
1. Establish a single hero fighter as the style benchmark.
2. Apply the palette/material/lighting treatment to the existing SKYLINE arena.
3. Update one weapon model and its muzzle/tracer/impact effects.
4. Update the HUD to the same visual language.
5. Profile on a phone, then propagate the proven treatment to IRONWORKS and NEON DISTRICT.

### Acceptance checklist
- Recognizable at phone size and in motion.
- Player and opponent remain visually distinct from backgrounds.
- No loss of aim/readability from VFX.
- Stable mobile performance and responsive touch controls.
- Existing PvP behavior remains unchanged.
