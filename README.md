# Aegis Brawler -> 3D Follow-Cam Mobile 1v1 Prototype

This prototype now targets a **third-person over-the-shoulder combat camera** with lock-on tethering for high-speed 1v1 mobile action.

## Camera + POV
- Third-person follow-cam behind player.
- Hard lock-on framing anchored to player-opponent line.
- Dynamic focal scaling (close FOV near melee, wider FOV at range).
- Dash adds temporary FOV expansion for speed sensation.
- Vertical rise/drop changes camera pitch to preserve opponent + ground readability.

## Combat Feel Layer
- Hit-stop pulses on successful hits.
- Heavy impacts and hard landings trigger screen shake.
- Boost step triggers screen-space distortion flash + trail pulse.
- KO hit triggers 2s cinematic orbit before result scene.

## Mobile UX
- Transparent dead-zone joystick + translucent action buttons.
- Diegetic in-world HP/boost bars floating near units.
- Touch input buffer for rapid cancels.

## Simulation
- Shared pseudo-3D simulation (x/y/z), boost economy, step tracking-cut, homing projectiles, cancel windows, and melee magnetism.
- 25ms tick loop with fighter + projectile interpolation for smoother online playback.

## Dev
```bash
npm install
npm run dev
npm test
```
