# EXVS-Style 3D Mecha Prototype (Three.js + cannon-es)

Rebuilt for a mobile-first EXVS loop: lock-on camera, boost dash cancel flow, red/green lock projectile behavior, and fixed-step 3D physics.

## Systems included
- True 3D rendering with Three.js.
- Cannon fixed-step physics with static plane at `y=0` + collision-safe movement.
- Hard-lock third-person camera behind player, keeping both units on the same combat vector.
- Red Lock / Green Lock projectile behavior:
  - Red lock (in range): curved homing shots.
  - Green lock (out of range): straight shots.
- Boost gauge and 1.5s overheat hard-landing penalty.
- Boost Dash + Step cancel pacing.
- Bulky modular mech silhouette with active thruster plumes.

## Mobile UX
- Touch joystick (360 movement) + translucent action buttons.
- `touch-action: none` and `user-scalable=no` viewport protection against unintended zoom.
- Thin boost bar (bottom-center) and health bar (top-left).

## Dev
```bash
npm install
npm run dev
npm test
```
