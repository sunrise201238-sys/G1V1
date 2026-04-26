# Aegis Brawler -> GVG-style Mobile 1v1 Refactor

This project is now a **mobile-first, pseudo-3D 1v1 action prototype** emphasizing boost movement, lock-on camera behavior, and kinetic combat feedback.

## What changed
- Fixed lock-on camera centered between fighters with dynamic zoom by engagement distance.
- Pseudo-3D combat box (`x` + `z` + altitude `y`) with rise/drop aerial control.
- Neon-minimal wireframe units + dark digital void arena for high contrast.
- Shared boost architecture for dash / step / rise-drop, with hard **1.5s overheat immobilize** when gauge is drained.
- Projectile induction (homing) that can be cut by boost step.
- Cancel routes through input buffering and short action cancel windows.
- Melee magnetism to auto-close gaps in engage range.
- Ghost trails and camera shake for dash and heavy impact feedback.
- Faster sync loop (`25ms`) with interpolation over fighter and projectile state.

## Mobile controls
- **Left:** virtual joystick (360 movement).
- **Right:** large translucent buttons for Boost, Shoot, Melee, Step, Rise, Drop.

## Dev
```bash
npm install
npm run dev
npm test
```
