# ARENA OF GLORY — Character model asset contract

This folder contains the source recipes and, after the character-generation workflow succeeds, the production VOLT and VEX assets.

## Source recipes

- `characters/volt.json` — deterministic Ara 3D Gen recipe for VOLT.
- `characters/vex.json` — deterministic Ara 3D Gen recipe for VEX.

The recipes use the published Ara character schema and are the editable source of truth. The GitHub Actions workflow pins Ara CLI to `0.14.0`, exports high-detail rigged GLBs with locomotion, shooter and combat animation groups, and uploads them as a workflow artifact. A separate trusted workflow validates and commits the generated binaries as `volt.glb` and `vex.glb`.

## Required runtime files

- `volt.glb` — VOLT, complete skinned character.
- `vex.glb` — VEX, complete skinned character.

Do not add placeholder GLBs or rename unrelated marketplace models to these filenames. The game must keep its current procedural fighters until both generated assets have passed validation and runtime integration.

## Export requirements

- Format: binary glTF 2.0 (`.glb`), embedded textures.
- Ara game rig: 65 Mixamo-named bones, consistent between both characters.
- High-detail body and clothing; keep mobile texture and draw-call budgets in mind.
- Y-up, metres, feet at local origin; character faces local +Z.
- Animation clips are in-place; movement and authoritative position remain controlled by the game/network code.
- The game maps Ara's exported clip names to its own idle, locomotion, aim, shoot, reload and hit states.

## Character art direction

### VOLT
Athletic masculine street fighter; dark tousled hair; black/charcoal street jacket with vivid orange accents and a lightning insignia; light shirt; gloves; dark cargo trousers; chunky black/orange sneakers. Confident, fast, urban silhouette.

### VEX
Athletic feminine street fighter; vivid pink high ponytail; cropped black jacket with purple/pink accents; tactical belt; gloves; dark trousers; black/pink sneakers. Aggressive, agile silhouette.

The initial recipes establish the body, clothing, colours and rig. Small signature details that the generator cannot express exactly (such as VOLT's lightning insignia) will be finished as model/texture details after the first generated preview is inspected.

## Runtime integration contract

The game owns movement, hit detection, health, weapon state, and network synchronization. A character GLB supplies only the visible skinned body and animation clips. Weapon attachment remains a separate runtime object attached to the right-hand bone. Keep gameplay hit volumes separate from render geometry so model replacement cannot change PvP hit validation.

Until both approved files exist, the current procedural characters remain the safe fallback.
