# GVG-Style 1v1 Mobile Combat Prototype

This repo now targets a **mobile-first, Gundam-vs.-Gundam-inspired 1v1 format** with lock-on camera, boost economy, aerial movement, and high-speed cancel-oriented combat.

## Stack
- **Client:** Phaser 3 with touch gestures and lock-on pseudo-3D rendering.
- **Server:** Node.js + Express + Socket.io.
- **Shared Logic:** boost / step / overheat / tracking-cut / interpolation in `shared/`.
- **State Sync:** server snapshot loop (`33ms` / ~30Hz) with interpolation smoothing.
- **Deploy:** Render free-tier web services (client static + server web).

## Core Gameplay Systems
- Fixed 1v1 lock-on perspective with camera centered on both units.
- 3D combat box (`x`, `z`, and altitude `y`) with hover / rise / descent.
- Shared boost gauge powering dash, step, and vertical thrust.
- Overheat loop forcing landing-recovery vulnerability.
- Projectile tracking that can be cut by boost-step invulnerability windows.
- Melee magnetism that closes distance automatically when in engage range.
- Cancel windows between core actions for high-speed chaining.

## Mobile Controls
- **Left thumb joystick:** 360° movement.
- **Double tap + move:** boost dash.
- **Right action cluster:** Shoot, Melee, Step, Rise, Drop.

## Local development
```bash
npm install
npm run dev
```
- Client: http://localhost:5173
- Server: http://localhost:3001

## Render deploy notes
`render.yaml` includes:
- `gvg-server` (`type: web`, free tier)
- `gvg-client` (`type: static`, free tier)

Push to your connected branch in GitHub, then trigger Render deploy (or enable auto deploy in Render dashboard).
