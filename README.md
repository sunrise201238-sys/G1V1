# GVG-like 1v1 Neon Fighter (Client-Server)

This repo ships a **low-latency-ready** architecture for a browser-based 1v1 fighter, focused on **VS Bot** first while keeping interfaces ready for **VS Online**.

## Stack
- **Client:** Phaser 3 + Matter physics, local prediction-style input handling for dash/attacks.
- **Server:** Node.js + Express + Socket.io.
- **State Sync:** server snapshot broadcast loop (`33ms` / ~30Hz by default).
- **Shared Logic:** attack resolution, dash, fighter tick in `shared/`.
- **CI/CD:** GitHub Actions runs tests and can trigger Render deploy hook on `main`.

## Gameplay flow
1. Enter site
2. Select 1 of 2 characters (expandable roster)
3. Fight starts
4. Match ends on KO
5. Winner screen with rematch or return to character select

## Controls
- Move: `A` / `D`
- Boost Dash: `SPACE`
- Attack: `J` (main), `K` (sub), `L` (SP)
- Melee: `U` (main), `I` (sub), `O` (SP)

## Local development
```bash
npm install
npm run dev
```
- Client: http://localhost:5173
- Server: http://localhost:3001

## Notes for online mode
- `FightScene` includes Socket.io integration entry points (`setupSocket`, `input:action`, snapshot buffer).
- Client interpolation buffer is scaffolded for smoothing snapshots.
- Bot mode currently runs entirely local for responsiveness.
