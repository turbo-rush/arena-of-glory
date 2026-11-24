# ARENA OF GLORY — Character model asset contract

This folder is reserved for the production VOLT and VEX character assets.

## Required files

- `volt.glb` — VOLT, complete skinned character.
- `vex.glb` — VEX, complete skinned character.

Do not add placeholder GLBs or rename unrelated marketplace models to these filenames. The game must keep its current procedural fighters until both approved character assets are available.

## Export requirements

- Format: binary glTF 2.0 (`.glb`), embedded textures.
- One skinned humanoid mesh per character (multiple material slots are fine).
- Y-up, meters, feet at local origin; character faces local +Z.
- Approximate standing height: 2.0–2.2 m before game scaling.
- Apply object transforms; keep the armature and mesh in the same root.
- PBR textures: base color, normal, metallic/roughness; target 2K or lower for mobile.
- Keep draw calls and material count low; avoid 4K textures and excessive polygon density.
- Include a humanoid skeleton with consistent bone names between both characters. Mixamo-compatible naming is preferred.
- Include animation clips named: `idle`, `run`, `aim`, `shoot`, `reload`, `hit`, `victory`, `defeat`.
- Animation clips must be in-place; movement and authoritative position remain controlled by the game/network code.

## Character art direction

### VOLT
Athletic masculine street fighter; dark tousled hair; black/charcoal street jacket with vivid orange accents and a lightning insignia; light shirt; gloves; dark cargo trousers; chunky black/orange sneakers. Confident, fast, urban silhouette.

### VEX
Athletic feminine street fighter; vivid pink high ponytail; cropped black jacket with purple/pink accents; tactical belt; gloves; dark trousers; black/pink sneakers. Aggressive, agile silhouette.

## Runtime integration contract

The game owns movement, hit detection, health, weapon state, and network synchronization. A character GLB supplies only the visible skinned body and animation clips. Weapon attachment remains a separate runtime object attached to the right-hand bone. Keep gameplay hit volumes separate from render geometry so model replacement cannot change PvP hit validation.

Until both approved files exist, the current procedural characters remain the safe fallback.
