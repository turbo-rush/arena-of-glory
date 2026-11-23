# ARENA OF GLORY

A stylized third-person rooftop duel prototype built with React, TypeScript, Three.js and Vite.

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Controls

- **W / A / S / D** — move around your rooftop.
- **Space** — reserved for the dodge mechanic (coming next).
- **R** — reload.
- **Aim** — toggle precision mode.
- **Fire** — shoot the rival on the opposite rooftop.
- Touch controls are available on mobile screens.

## Deploy to Vercel

Import this repository into Vercel. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.

## Prototype scope

This first build establishes the 3D rooftop scene, third-person camera, two stylized fighters, basic movement, firing, health and duel result states. Combat and opponent behavior are placeholder prototype logic; online multiplayer, production animations, weapon inventory and Telegram integration are planned for later iterations.
