# GVG Mecha Rebuild (Three.js + Cannon)

This client has been reset to a **mobile-first, true 3D third-person mecha prototype** using **Three.js** for rendering and **cannon-es** for 3D physics.

## Core architecture
- Engine: Three.js (`WebGLRenderer`, perspective camera).
- Physics: cannon-es rigid bodies for 3D movement/collision.
- Camera: permanent third-person follow-cam behind the player with lock-on midpoint framing and dynamic FOV.
- Controls: touch joystick + action buttons (Boost / Step / Shoot / Melee / Rise / Drop).

## Combat loop
- Boost gauge drains on dash/rise/step.
- Overheat locks movement for 1.5s.
- Step / dash can interrupt actions (step-cancel pacing).

## Visual style
- Modular bulky mechs (head/core/arms/legs).
- Industrial toon/metal palette.
- Thruster plumes activate during boost actions.

## Dev
```bash
npm install
npm run dev
npm test
```
