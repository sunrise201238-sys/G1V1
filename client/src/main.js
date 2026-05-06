import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import './style.css';

const app = document.getElementById('app');

const UNIT_DATA = {
  unit1: {
    name: 'Unit 1 / Machine Gun',
    lockRange: 56,
    projectileSpeed: 45,
    fireCooldownMs: 140,
    spreadCount: 1,
    spreadAngle: 0.02,
    damage: 4,
    magCapacity: 30,
    reloadMs: 2000,
    autoReload: false
  },
  unit2: {
    name: 'Unit 2 / Shotgun',
    lockRange: 43,
    projectileSpeed: 45,
    fireCooldownMs: 700,
    spreadCount: 8,
    spreadAngle: THREE.MathUtils.degToRad(16),
    damage: 4,
    magCapacity: 7,
    reloadMs: 2000,
    autoReload: true
  },
  unit3: {
    name: 'Unit 3 / Sniper Rifle',
    lockRange: 120,
    projectileSpeed: 85,
    fireCooldownMs: 1000,
    spreadCount: 1,
    spreadAngle: 0.02,
    damage: 35,
    magCapacity: 5,
    reloadMs: 2500,
    autoReload: false,
    sniperCharge: true,
    chargeMs: 500
  }
};

const MAP_DATA = {
  arena1: { name: 'Plain Field' },
  arena2: { name: 'Streets' },
  factory: { name: 'Factory' },
  square: { name: 'Square' },
  lobby: { name: 'Lobby' }
};

const state = {
  phase: 'select',
  playerUnitKey: 'unit1',
  enemyUnitKey: 'unit2',
  mapKey: 'arena1',
  player: null,
  enemy: null,
  projectiles: [],
  hud: null,
  reticle: null,
  speedLines: null,
  vfx: [],
  reticlePulseUntil: 0,
  reticleWasRed: false,
  running: false,
  matchStartAt: 0
};
state.dummyMode = false;
state.playerStuckSince = 0;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);
scene.fog = new THREE.Fog(0x0b0f17, 28, 160);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 5, 15);
camera.lookAt(0, 0, 0);
const ambient = new THREE.AmbientLight(0x8cb2ff, 0.7);
scene.add(ambient);
const key = new THREE.DirectionalLight(0xe5eeff, 1.15);
key.position.set(18, 34, 12);
scene.add(key);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -80.19, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(140, 0.25, 140)) });
groundBody.position.set(0, -0.25, 0);
world.addBody(groundBody);
const raycastResult = new CANNON.RaycastResult();

const gridCanvas = document.createElement('canvas');
gridCanvas.width = 512;
gridCanvas.height = 512;
const ctx = gridCanvas.getContext('2d');
ctx.fillStyle = '#141b27';
ctx.fillRect(0, 0, 512, 512);
ctx.strokeStyle = '#4f6387';
ctx.lineWidth = 2.5;
for (let i = 0; i < 32; i += 1) {
  const p = i * 16;
  ctx.beginPath();
  ctx.moveTo(p, 0);
  ctx.lineTo(p, 512);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, p);
  ctx.lineTo(512, p);
  ctx.stroke();
}
ctx.strokeStyle = '#8ca0ca';
ctx.lineWidth = 3.5;
for (let i = 0; i < 9; i += 1) {
  const p = i * 64;
  ctx.beginPath();
  ctx.moveTo(p, 0);
  ctx.lineTo(p, 512);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, p);
  ctx.lineTo(512, p);
  ctx.stroke();
}
const gridTex = new THREE.CanvasTexture(gridCanvas);
gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
gridTex.repeat.set(8, 8);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), new THREE.MeshStandardMaterial({
  map: gridTex,
  color: 0x8ea8de,
  metalness: 0.5,
  roughness: 0.58
}));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const gridHelper = new THREE.GridHelper(200, 50, 0xff0000, 0x444444);
scene.add(gridHelper);
const arenaDecor = [];
const arenaObstacles = [];
createArenaWalls();

const MOMENTUM_STANDARD = 100;
const BOOST_MOVE_SPEED = 11.76;
const MAX_HP = 150;
const GROUND_BASE_Y = 2.45;
const HOMING_MAX_DEG_PER_FRAME = 10;
const HOMING_CLOSE_RANGE_CUTOFF = 2.6;
const HOMING_SOFTEN_RANGE = 20;
const HOMING_SOFTEN_DEG_PER_FRAME = 1.5;
const BOOST_CAP = 125;
const STEP_DISTANCE = 9.2;
const STEP_DURATION_MS = 125;
const STEP_COOLDOWN_MS = 1000;
const STEP_BOOST_COST = 48;
const JUMP_BOOST_COST = STEP_BOOST_COST;
const STEP_HOMING_CUT_MS = 260;

const input = {
  x: 0,
  y: 0,
  boost: false,
  boostHeld: false,
  sprintLocked: false,
  jump: false,
  stepTap: false,
  shootTap: false,
  shootHold: false
};

let touchSteeringActive = false;

const keyState = {
  up: false,
  down: false,
  left: false,
  right: false
};

function createMech(color, unitData) {
  const root = new THREE.Group();
  const armor = new THREE.MeshToonMaterial({ color });
  const steel = new THREE.MeshToonMaterial({ color: 0x3b4658 });
  const make = (g, m, x, y, z) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };

  const torso = make(new THREE.BoxGeometry(1.85, 2.55, 1.05), armor, 0, 0, 0);
  make(new THREE.BoxGeometry(0.95, 0.82, 0.9), steel, 0, 1.85, 0);
  const armL = make(new THREE.BoxGeometry(0.52, 2.5, 0.5), steel, -1.15, 0.28, 0);
  const armR = make(new THREE.BoxGeometry(0.52, 2.5, 0.5), steel, 1.15, 0.28, 0);
  make(new THREE.BoxGeometry(0.58, 2.05, 0.62), steel, -0.38, -2.2, 0);
  make(new THREE.BoxGeometry(0.58, 2.05, 0.62), steel, 0.38, -2.2, 0);

  const plumeLight = new THREE.PointLight(0x7efbff, 0, 7, 2);
  plumeLight.position.set(0, -2.2, -0.7);
  root.add(plumeLight);

  scene.add(root);

  const body = new CANNON.Body({ mass: 3, shape: new CANNON.Box(new CANNON.Vec3(0.95, 1.8, 0.8)), linearDamping: 0.24 });
  body.position.set(0, 2.45, 0);
  body.type = CANNON.Body.KINEMATIC;
  body.allowSleep = false;
  body.updateMassProperties();
  body.linearFactor.set(1, 0, 1);
  world.addBody(body);

  return {
    root,
    body,
    unit: unitData,
    thrusters: [],
    plumeLight,
    trail: [],
    torso,
    modelYOffset: 2.35,
    legLength: 2.35,
    grounded: false,
    arms: { left: armL, right: armR },
    glintMesh: null,
    state: {
      action: 'idle',
      boost: BOOST_CAP,
      hp: MAX_HP,
      redLock: false,
      overheatedUntil: 0,
      hitStunUntil: 0,
      hoverUntil: 0,
      meleeAnimUntil: 0,
      meleeLungeUntil: 0,
      staggerUntil: 0,
      evadeHomingUntil: 0,
      evadeCooldownUntil: 0,
      dashRecoverUntil: 0,
      antiMeleeUntil: 0,
      meleeCooldownUntil: 0,
      meleeStrikeUntil: 0,
      meleeHitApplied: false,
      meleeLungeVX: 0,
      meleeLungeVZ: 0,
      momentumVX: 0,
      momentumVZ: 0,
      momentumDecay: 0.84,
      emptyRecoverUntil: 0,
      refillPausedUntil: 0,
      stepStartAt: 0,
      stepUntil: 0,
      stepCooldownUntil: 0,
      stepFromX: 0,
      stepFromZ: 0,
      stepToX: 0,
      stepToZ: 0,
      queuedMomentumVX: 0,
      queuedMomentumVZ: 0,
      machineBurstRemaining: 0,
      nextFireAt: 0,
      strafeSign: 1,
      vulnerabilityMove: false,
      stackUntil: 0,
      jumpCooldownUntil: 0,
      airborne: false,
      jumpVelocity: 0,
      lastFireAt: 0,
      ammo: unitData.magCapacity ?? Infinity,
      reloadingUntil: 0,
      reloadTickStartAt: 0,
      sniperChargeUntil: 0,
      sniperChargeTarget: null
    }
  };
}

function tickAmmo(mech, now) {
  const u = mech.unit;
  if (u.magCapacity == null) return;
  const s = mech.state;
  if (s.ammo >= u.magCapacity) {
    s.reloadingUntil = 0;
    s.reloadTickStartAt = 0;
    return;
  }
  if (u.autoReload) {
    if (!s.reloadTickStartAt) s.reloadTickStartAt = now;
    while (now - s.reloadTickStartAt >= u.reloadMs && s.ammo < u.magCapacity) {
      s.ammo += 1;
      s.reloadTickStartAt += u.reloadMs;
    }
    if (s.ammo >= u.magCapacity) s.reloadTickStartAt = 0;
  } else if (s.ammo === 0) {
    if (!s.reloadingUntil) s.reloadingUntil = now + u.reloadMs;
    if (now >= s.reloadingUntil) {
      s.ammo = u.magCapacity;
      s.reloadingUntil = 0;
    }
  }
}

function makeReticleSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  // Draw with white so the SpriteMaterial color tint produces a clean red/green.
  x.strokeStyle = '#ffffff';
  x.lineWidth = 9;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  const m = 14;        // margin from canvas edge
  const arm = 32;      // length of each L-arm
  const e = 128 - m;   // far edge
  // Top-left bracket
  x.beginPath();
  x.moveTo(m, m + arm); x.lineTo(m, m); x.lineTo(m + arm, m);
  x.stroke();
  // Top-right bracket
  x.beginPath();
  x.moveTo(e - arm, m); x.lineTo(e, m); x.lineTo(e, m + arm);
  x.stroke();
  // Bottom-left bracket
  x.beginPath();
  x.moveTo(m, e - arm); x.lineTo(m, e); x.lineTo(m + arm, e);
  x.stroke();
  // Bottom-right bracket
  x.beginPath();
  x.moveTo(e - arm, e); x.lineTo(e, e); x.lineTo(e, e - arm);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  s.scale.set(5.4, 5.4, 1);
  s.renderOrder = 9999;
  scene.add(s);
  return s;
}

function setupHUD() {
  if (state.hud) state.hud.remove();
  const hud = document.createElement('div');
  hud.className = 'touch-hud';
  hud.innerHTML = `
    <div class="health"><div id="health-fill"></div></div>
    <div class="enemy-health"><div id="enemy-health-fill"></div></div>
    <div class="boost"><div id="boost-fill"></div></div>
    <div class="joy" id="joy"><div class="stick"></div></div>
    <div class="buttons" id="buttons"></div>
    <div class="speed-lines" id="speed-lines"></div>
    <button id="pause-btn" class="pause-btn">PAUSE</button>
  `;
  app.appendChild(hud);

  ['boost', 'shoot', 'step', 'jump'].forEach((action) => {
    const b = document.createElement('button');
    b.dataset.k = action;
    b.className = `btn-${action}`;
    if (action === 'shoot') {
      b.innerHTML = '<svg class="reload-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/></svg><span class="ammo-count"></span>';
    } else {
      b.textContent = action === 'boost' ? 'SPRINT' : (action === 'step' ? 'DODGE' : action.toUpperCase());
    }
    hud.querySelector('#buttons').appendChild(b);
  });

  const joy = hud.querySelector('#joy');
  const stick = joy.querySelector('.stick');
  let pointerId = null;
  let lastTapAt = 0;
  let lastSprintTapAt = 0;

  const applyStick = (x, y) => {
    const r = joy.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const maxR = r.width * 0.33;
    const len = Math.min(maxR, Math.hypot(dx, dy));
    const ang = Math.atan2(dy, dx);
    stick.style.transform = `translate(${Math.cos(ang) * len}px, ${Math.sin(ang) * len}px)`;
    input.x = Math.cos(ang) * (len / maxR);
    input.y = Math.sin(ang) * (len / maxR);
  };

  joy.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    if (now - lastTapAt < 240) input.boost = true;
    lastTapAt = now;
    pointerId = e.pointerId;
    touchSteeringActive = true;
    applyStick(e.clientX, e.clientY);
  });

  window.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId) return;
    applyStick(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', (e) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    touchSteeringActive = false;
    input.x = 0;
    input.y = 0;
    input.sprintLocked = false;
    input.boost = false;
    input.boostHeld = false;
    stick.style.transform = 'translate(0px,0px)';
  });

  hud.querySelectorAll('button').forEach((btn) => {
    if (btn.id === 'pause-btn') return;
    const k = btn.dataset.k;
    btn.addEventListener('pointerdown', () => {
      if (k === 'shoot') {
        input.shootTap = true;
        input.shootHold = true;
      }
      else if (k === 'step') input.stepTap = true;
      else if (k === 'boost') {
        const now = performance.now();
        const hasDir = Math.hypot(input.x, input.y) > 0.15;
        if (now - lastSprintTapAt < 260 && hasDir) input.sprintLocked = true;
        lastSprintTapAt = now;
        input.boostHeld = true;
        input.boost = true;
      } else input[k] = true;
    });
    btn.addEventListener('pointerup', () => {
      if (k === 'shoot') input.shootHold = false;
      else if (k === 'boost') {
        input.boostHeld = false;
        if (!input.sprintLocked) input.boost = false;
      } else input[k] = false;
    });
  });

  hud.querySelector('#pause-btn').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    showPauseMenu();
  });

  state.hud = hud;
  state.speedLines = hud.querySelector('#speed-lines');
  return {
    hp: hud.querySelector('#health-fill'),
    enemyHp: hud.querySelector('#enemy-health-fill'),
    boost: hud.querySelector('#boost-fill'),
    shootBtn: hud.querySelector('.btn-shoot'),
    ammoCount: hud.querySelector('.btn-shoot .ammo-count'),
    reloadRing: hud.querySelector('.btn-shoot .reload-ring circle')
  };
}

let hudRefs = null;

function spawnProjectiles(owner, target) {
  const now = performance.now();
  if (owner.unit.magCapacity != null && owner.state.ammo <= 0) return;
  if (now - owner.state.lastFireAt < owner.unit.fireCooldownMs) return;
  owner.state.lastFireAt = now;
  if (owner.unit.magCapacity != null) owner.state.ammo -= 1;

  const baseDir = new THREE.Vector3().subVectors(target.root.position, owner.root.position).normalize();
  const isShotgun = owner.unit.spreadCount > 1;
  const centerIndex = isShotgun ? Math.floor(Math.random() * owner.unit.spreadCount) : 0;
  const shotgunOffsets = [];
  if (isShotgun) {
    const clusterRadius = 3.8;
    for (let i = 0; i < owner.unit.spreadCount; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * clusterRadius;
      shotgunOffsets.push(new THREE.Vector3(Math.cos(angle) * radius, (Math.random() - 0.5) * radius * 0.7, Math.sin(angle) * radius));
    }
  }
  let centerPellet = null;

  for (let i = 0; i < owner.unit.spreadCount; i += 1) {
    const isCenterPellet = isShotgun && i === centerIndex;
    const spreadScale = isShotgun ? (isCenterPellet ? 0.08 : 0.14) : 1;
    const yaw = (Math.random() - 0.5) * owner.unit.spreadAngle * spreadScale;
    const pitch = (Math.random() - 0.5) * owner.unit.spreadAngle * 0.35 * spreadScale;
    const dir = baseDir.clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: owner.state.redLock ? 0xff4f66 : 0x6df9ff }));
    mesh.position.copy(owner.root.position).add(new THREE.Vector3(0, 0.8, 0));
    scene.add(mesh);

    const homing = owner.state.redLock && (!isShotgun || isCenterPellet);
    const projectile = {
      owner,
      target,
      mesh,
      vel: dir.multiplyScalar(owner.unit.projectileSpeed),
      homing,
      homingLost: false,
      isCenterPellet,
      centerPellet: null,
      clusterOffset: isShotgun ? shotgunOffsets[i] : null,
      ttl: 2.2,
      damage: owner.unit.damage,
      hitStunMs: 200
    };
    if (isCenterPellet) centerPellet = projectile;
    state.projectiles.push(projectile);
  }
  if (isShotgun && centerPellet) {
    for (let i = state.projectiles.length - owner.unit.spreadCount; i < state.projectiles.length; i += 1) {
      const pellet = state.projectiles[i];
      if (!pellet.isCenterPellet) pellet.centerPellet = centerPellet;
    }
  }
}


function createGlintForMech(mech) {
  if (mech.glintMesh) return;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 255, 235, 1)');
  grad.addColorStop(0.45, 'rgba(255, 220, 110, 0.85)');
  grad.addColorStop(1, 'rgba(255, 200, 60, 0)');
  x.fillStyle = grad;
  x.beginPath();
  x.arc(32, 32, 32, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false
  }));
  sprite.scale.set(0.55, 0.55, 1);
  sprite.position.set(0.55, 0.55, 0.55);
  sprite.renderOrder = 9999;
  mech.root.add(sprite);
  mech.glintMesh = sprite;
}

function removeGlintFromMech(mech) {
  if (!mech.glintMesh) return;
  mech.root.remove(mech.glintMesh);
  if (mech.glintMesh.material) {
    if (mech.glintMesh.material.map) mech.glintMesh.material.map.dispose();
    mech.glintMesh.material.dispose();
  }
  mech.glintMesh = null;
}

function updateGlintScale(mech) {
  if (!mech.glintMesh) return;
  const dist = camera.position.distanceTo(mech.root.position);
  // Grow with distance so the glint stays readable on long-range maps (Streets/Square).
  const s = THREE.MathUtils.clamp(0.55 + dist * 0.05, 0.55, 6.5);
  mech.glintMesh.scale.set(s, s, 1);
}

function attemptFire(owner, target, now) {
  const u = owner.unit;
  if (u.sniperCharge) {
    if (owner.state.airborne) return false;
    if (owner.state.sniperChargeTarget) return false;
    if (u.magCapacity != null && owner.state.ammo <= 0) return false;
    if (now - owner.state.lastFireAt < u.fireCooldownMs) return false;
    const chargeMs = u.chargeMs ?? 500;
    owner.state.sniperChargeUntil = now + chargeMs;
    owner.state.sniperChargeTarget = target;
    owner.body.velocity.x = 0;
    owner.body.velocity.z = 0;
    owner.state.momentumVX = 0;
    owner.state.momentumVZ = 0;
    createGlintForMech(owner);
    return true;
  }
  const before = owner.state.lastFireAt;
  spawnProjectiles(owner, target);
  return owner.state.lastFireAt !== before;
}

function tickSniperCharge(mech, now) {
  const target = mech.state.sniperChargeTarget;
  if (!target) return;
  if (now < mech.state.sniperChargeUntil) {
    mech.body.velocity.x = 0;
    mech.body.velocity.z = 0;
    mech.state.momentumVX = 0;
    mech.state.momentumVZ = 0;
    return;
  }
  mech.state.sniperChargeTarget = null;
  mech.state.sniperChargeUntil = 0;
  removeGlintFromMech(mech);
  if (mech.state.hp <= 0) return;
  spawnProjectiles(mech, target);
}

function getProjectileDamage(projectile) {
  if (state.dummyMode && projectile.owner === state.enemy) return 0;
  return projectile.damage;
}

function segmentHitsObstacle(p0, p1, o) {
  // Slab method — does the segment p0→p1 (t in [0,1]) intersect the AABB o?
  // Catches projectiles tunneling through obstacles between frames.
  let tMin = 0;
  let tMax = 1;
  const axes = [
    [p0.x, p1.x - p0.x, o.minX, o.maxX],
    [p0.y, p1.y - p0.y, o.minY, o.maxY],
    [p0.z, p1.z - p0.z, o.minZ, o.maxZ]
  ];
  for (const [start, delta, lo, hi] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (start < lo || start > hi) return false;
    } else {
      const t1 = (lo - start) / delta;
      const t2 = (hi - start) / delta;
      const tNear = t1 < t2 ? t1 : t2;
      const tFar = t1 < t2 ? t2 : t1;
      if (tNear > tMin) tMin = tNear;
      if (tFar < tMax) tMax = tFar;
      if (tMin > tMax) return false;
    }
  }
  return true;
}

function projectileHitsSurface(prevPos, nextPos) {
  const samples = 8;
  let prevDelta = null;
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = THREE.MathUtils.lerp(prevPos.x, nextPos.x, t);
    const y = THREE.MathUtils.lerp(prevPos.y, nextPos.y, t);
    const z = THREE.MathUtils.lerp(prevPos.z, nextPos.z, t);
    const h = surfaceHeightAtXZ(x, z);
    if (h === -Infinity) continue;
    const delta = y - h;
    if (Math.abs(delta) < 0.04) return true;
    if (prevDelta !== null && ((prevDelta > 0 && delta < 0) || (prevDelta < 0 && delta > 0))) return true;
    prevDelta = delta;
  }
  return false;
}

function updateProjectileSystem(dt) {
  const now = performance.now();
  for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
    const p = state.projectiles[i];
    p.ttl -= dt;
    if (p.ttl <= 0) {
      scene.remove(p.mesh);
      state.projectiles.splice(i, 1);
      continue;
    }

    if (p.centerPellet && p.centerPellet !== p) {
      if (p.centerPellet.ttl <= 0 || !state.projectiles.includes(p.centerPellet)) {
        p.centerPellet = null;
      } else {
        p.vel.copy(p.centerPellet.vel);
        p.mesh.position.copy(p.centerPellet.mesh.position).add(p.clusterOffset);
      }
    }
    const toTarget = new THREE.Vector3().subVectors(p.target.root.position, p.mesh.position);
    if (toTarget.length() <= HOMING_CLOSE_RANGE_CUTOFF) {
      p.homing = false;
      p.homingLost = true;
    }
    if (!p.homingLost && p.vel.dot(toTarget) < 0) {
      p.homingLost = true;
      p.homing = false;
    }

    if (p.homing && !p.homingLost && now >= p.target.state.evadeHomingUntil) {
      const desiredAngle = Math.atan2(toTarget.z, toTarget.x);
      const currentAngle = Math.atan2(p.vel.z, p.vel.x);
      const distToTarget = toTarget.length();
      const turnDeg = distToTarget <= HOMING_SOFTEN_RANGE ? HOMING_SOFTEN_DEG_PER_FRAME : HOMING_MAX_DEG_PER_FRAME;
      const maxTurn = THREE.MathUtils.degToRad(turnDeg);
      const wrapped = wrapAngle(desiredAngle - currentAngle);
      const turn = THREE.MathUtils.clamp(wrapped, -maxTurn, maxTurn);
      const speed = p.vel.length();
      const next = currentAngle + turn;
      p.vel.x = Math.cos(next) * speed;
      p.vel.z = Math.sin(next) * speed;
    }

    const prevPos = p.mesh.position.clone();
    p.mesh.position.addScaledVector(p.vel, dt);
    // Swept test: catches fast/homing projectiles that would otherwise tunnel through
    // an obstacle between frames. Obstacles flagged `noProjectile` (e.g. invisible
    // unit-only fences) are skipped so bullets fly through them.
    for (const obstacle of arenaObstacles) {
      if (obstacle.noProjectile) continue;
      if (!segmentHitsObstacle(prevPos, p.mesh.position, obstacle)) continue;
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      state.projectiles.splice(i, 1);
      p.ttl = 0;
      break;
    }
    if (p.ttl <= 0) continue;
    if (projectileHitsSurface(prevPos, p.mesh.position)) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      state.projectiles.splice(i, 1);
      p.ttl = 0;
    }
    if (p.ttl <= 0) continue;
    const hitRadius = p.target.state.vulnerabilityMove ? 2.25 : 1.6;
    const path = new THREE.Line3(prevPos, p.mesh.position.clone());
    const nearest = new THREE.Vector3();
    path.closestPointToPoint(p.target.root.position, true, nearest);
    if (nearest.distanceTo(p.target.root.position) < hitRadius) {
      const mitigation = p.target.state.vulnerabilityMove ? 1.35 : 1;
      const finalDamage = getProjectileDamage(p) * mitigation;
      p.target.state.hp = Math.max(0, p.target.state.hp - finalDamage);
      if (performance.now() >= p.target.state.hitStunUntil) p.target.state.hitStunUntil = performance.now() + p.hitStunMs;
      p.target.state.momentumVX = 0;
      p.target.state.momentumVZ = 0;
      spawnHitEffect(p.target.root.position, p.target === state.player ? 0x67f2ff : 0xff73d2);
      p.target.body.velocity.set(0, 0, 0);
      scene.remove(p.mesh);
      state.projectiles.splice(i, 1);
    }
  }
}

function applyRepulsion(now) {
  const p = state.player.root.position;
  const e = state.enemy.root.position;
  const diff = new THREE.Vector3().subVectors(p, e);
  const dist = diff.length();
  if (dist >= 3) return;

  diff.normalize();
  const force = (3 - dist) * 16;
  state.player.body.velocity.x += diff.x * force * 0.04;
  state.player.body.velocity.z += diff.z * force * 0.04;
  state.enemy.body.velocity.x -= diff.x * force * 0.04;
  state.enemy.body.velocity.z -= diff.z * force * 0.04;
  state.player.state.stackUntil = now + 220;
  state.enemy.state.stackUntil = now + 220;
}

function updateBoost(mech, now, action) {
  const s = mech.state;
  const groundY = getGroundLevelY(mech) + 0.1;
  const grounded = mech.grounded || mech.body.position.y <= groundY;

  if (now < s.overheatedUntil) {
    s.action = 'hard-landing';
    mech.body.velocity.x = 0;
    mech.body.velocity.z = 0;
    mech.thrusters.forEach((t) => (t.material.opacity = 0.05));
    mech.plumeLight.intensity = 0;
    return;
  }

  s.action = action;
  const consume = ['dash'].includes(action);
  if (consume) {
    s.boost = Math.max(0, s.boost - 1.1);
    s.refillPausedUntil = now + 500;
  } else if (grounded && now >= s.refillPausedUntil) s.boost = Math.min(BOOST_CAP, s.boost + 4.59);

  if (s.boost <= 0) {
    if (s.emptyRecoverUntil <= now) s.emptyRecoverUntil = now + 100;
    s.overheatedUntil = now;
    s.action = 'idle';
  }

  mech.thrusters.forEach((t) => {
    t.material.opacity = consume ? 0.9 : 0.12;
    t.scale.y = consume ? 1.6 : 1;
  });
  mech.plumeLight.intensity = consume ? 2.1 : 0;
}

function updatePlayer(now) {
  if (state.player.state.sniperChargeTarget) {
    state.player.body.velocity.x = 0;
    state.player.body.velocity.z = 0;
    state.player.state.momentumVX = 0;
    state.player.state.momentumVZ = 0;
    state.player.state.action = 'shoot';
    updateBoost(state.player, now, 'shoot');
    return;
  }
  const p = state.player.root.position;
  const e = state.enemy.root.position;
  const stepState = state.player.state;
  const inStep = now <= stepState.stepUntil;
  const hasDirInput = Math.hypot(input.x, input.y) > 0.15;
  if (!hasDirInput || input.jump || input.stepTap || state.player.state.boost <= 0) input.sprintLocked = false;
  input.boost = input.boostHeld || input.sprintLocked;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const move = forward.clone().multiplyScalar(-input.y).add(right.multiplyScalar(input.x));
  const moveMag = Math.hypot(input.x, input.y);

  const recoveringFromDash = now < state.player.state.dashRecoverUntil;
  const hasBoost = state.player.state.boost > 0;
  const emptyPenaltyActive = now < state.player.state.emptyRecoverUntil;
  const canDash = hasBoost && !emptyPenaltyActive;
  const useSprint = input.boost && canDash;
  const baseSpeed = useSprint ? BOOST_MOVE_SPEED : (recoveringFromDash ? 4.55 : 16);
  const speed = (!hasBoost || emptyPenaltyActive) ? Math.min(baseSpeed, 7.5) : baseSpeed;
  const hitStunned = now < state.player.state.hitStunUntil;
  const hitStunScale = hitStunned ? 0.25 : 1;
  const canInputMove = !emptyPenaltyActive;
  if (!inStep) {
    state.player.body.velocity.x = canInputMove ? move.x * speed * hitStunScale : 0;
    state.player.body.velocity.z = canInputMove ? move.z * speed * hitStunScale : 0;
  }
  state.player.state.vulnerabilityMove = !input.boost && Math.hypot(input.x, input.y) > 0.2;

  let action = 'idle';
  if (inStep) {
    const span = Math.max(1, stepState.stepUntil - stepState.stepStartAt);
    const progress = THREE.MathUtils.clamp((now - stepState.stepStartAt) / span, 0, 1);
    const targetX = THREE.MathUtils.lerp(stepState.stepFromX, stepState.stepToX, progress);
    const targetZ = THREE.MathUtils.lerp(stepState.stepFromZ, stepState.stepToZ, progress);
    if (unitOverlapsObstacle(targetX, state.player.body.position.y, targetZ)) {
      stepState.stepUntil = now;
    } else {
      state.player.body.position.x = targetX;
      state.player.body.position.z = targetZ;
    }
    state.player.body.velocity.x = 0;
    state.player.body.velocity.z = 0;
    state.player.state.action = 'step';
    action = 'step';
  } else if (stepState.stepUntil > 0) {
    stepState.stepUntil = 0;
    if (stepState.queuedMomentumVX !== 0 || stepState.queuedMomentumVZ !== 0) {
      state.player.state.momentumVX += stepState.queuedMomentumVX;
      state.player.state.momentumVZ += stepState.queuedMomentumVZ;
      stepState.queuedMomentumVX = 0;
      stepState.queuedMomentumVZ = 0;
    }
  } else if (input.jump && canInputMove && stepState.boost >= JUMP_BOOST_COST && (state.player.grounded || state.player.body.position.y <= getGroundLevelY(state.player) + 0.15) && now >= state.player.state.jumpCooldownUntil) {
    input.boost = false;
    state.player.state.boost = Math.max(0, state.player.state.boost - JUMP_BOOST_COST);
    state.player.state.refillPausedUntil = now + 500;
    state.player.state.jumpVelocity = 30;
    state.player.state.airborne = true;
    state.player.state.hoverUntil = now + 300;
    state.player.state.jumpCooldownUntil = now + 1500;
    inheritMomentum(state.player, 70);
    action = 'jump';
  } else if (input.boost && canInputMove) {
    state.player.state.antiMeleeUntil = now + 260;
    inheritMomentum(state.player, MOMENTUM_STANDARD * 1.5);
    action = 'dash';
    triggerDashDefense(now);
  }

  if (input.stepTap) {
    if (!inStep && canInputMove && now >= stepState.stepCooldownUntil && stepState.boost >= STEP_BOOST_COST) {
      let stepDir = move.clone();
      if (stepDir.lengthSq() < 0.03) stepDir.set(state.player.body.velocity.x, 0, state.player.body.velocity.z);
      if (stepDir.lengthSq() < 0.03) stepDir.set(p.x - e.x, 0, p.z - e.z);
      if (stepDir.lengthSq() < 0.03) stepDir.set(1, 0, 0);
      stepDir.normalize();

      stepState.stepStartAt = now;
      stepState.stepUntil = now + STEP_DURATION_MS;
      stepState.stepCooldownUntil = now + STEP_COOLDOWN_MS;
      stepState.stepFromX = state.player.body.position.x;
      stepState.stepFromZ = state.player.body.position.z;
      stepState.stepToX = stepState.stepFromX + stepDir.x * STEP_DISTANCE;
      stepState.stepToZ = stepState.stepFromZ + stepDir.z * STEP_DISTANCE;
      stepState.queuedMomentumVX = state.player.state.momentumVX * 0.65 + state.player.body.velocity.x * 0.35;
      stepState.queuedMomentumVZ = state.player.state.momentumVZ * 0.65 + state.player.body.velocity.z * 0.35;
      state.player.state.momentumVX = 0;
      state.player.state.momentumVZ = 0;
      state.player.state.boost = Math.max(0, state.player.state.boost - STEP_BOOST_COST);
      input.sprintLocked = false;
      state.player.state.refillPausedUntil = now + 500;
      clearIncomingHoming(state.player, now);
      action = 'step';
    }
    input.stepTap = false;
  }

  if (input.shootTap) {
    input.boost = false;
    attemptFire(state.player, state.enemy, now);
    triggerEnemyEvasion(now);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }
  // Player MG: continuous fire while shoot is held — no burst cap (cooldown still gates rate).
  if (input.shootHold && state.player.unit.spreadCount === 1 && !state.player.unit.sniperCharge) {
    const firedAt = state.player.state.lastFireAt;
    attemptFire(state.player, state.enemy, now);
    if (state.player.state.lastFireAt !== firedAt) {
      inheritMomentum(state.player, 70);
      triggerEnemyEvasion(now);
      if (action === 'idle') action = 'shoot';
    }
  }
  state.player.state.machineBurstRemaining = 0;

  applyMomentum(state.player, { suspend: action === 'step' });
  const canAttemptMove = moveMag > 0.2 && !hitStunned && !inStep;
  const horizontalSpeed = Math.hypot(state.player.body.velocity.x, state.player.body.velocity.z);
  if (canAttemptMove && horizontalSpeed < 0.08) {
    if (!state.playerStuckSince) state.playerStuckSince = now;
    if (now - state.playerStuckSince > 420) {
      state.player.body.position.x += move.x * 0.45;
      state.player.body.position.z += move.z * 0.45;
      state.player.body.velocity.x = move.x * 3.2;
      state.player.body.velocity.z = move.z * 3.2;
      state.player.state.momentumVX = 0;
      state.player.state.momentumVZ = 0;
      state.playerStuckSince = now;
    }
  } else {
    state.playerStuckSince = 0;
  }
  updateBoost(state.player, now, action);
}

function updateEnemy(now) {
  if (state.enemy.state.sniperChargeTarget) {
    state.enemy.body.velocity.x = 0;
    state.enemy.body.velocity.z = 0;
    state.enemy.state.momentumVX = 0;
    state.enemy.state.momentumVZ = 0;
    state.enemy.state.action = 'shoot';
    updateBoost(state.enemy, now, 'shoot');
    return;
  }
  const p = state.player.root.position;
  const e = state.enemy.root.position;
  const toPlayer = new THREE.Vector3().subVectors(p, e).setY(0);
  const dist = toPlayer.length();
  const dir = toPlayer.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);

  // dynamic evasion + aggressive kiting
  if (Math.random() > 0.985) state.enemy.state.strafeSign *= -1;
  const retreat = dist < 11 ? -0.9 : dist > 19 ? 0.62 : 0.15;
  const move = dir.clone().multiplyScalar(retreat).add(side.multiplyScalar(state.enemy.state.strafeSign * 1.05));

  const moveScalar = now < state.enemy.state.hitStunUntil ? 0 : 10.6;
  state.enemy.body.velocity.x = move.x * moveScalar;
  state.enemy.body.velocity.z = move.z * moveScalar;
  if (Math.abs(state.enemy.body.velocity.x) + Math.abs(state.enemy.body.velocity.z) < 0.08) {
    state.enemy.body.velocity.x = side.x * 4.5;
    state.enemy.body.velocity.z = side.z * 4.5;
  }

  if (dist < 10 && state.enemy.state.boost > 18 && now > state.enemy.state.evadeCooldownUntil && Math.random() > 0.66) {
    const dodge = Math.random() > 0.5 ? side : side.clone().multiplyScalar(-1);
    state.enemy.body.velocity.x += dodge.x * 22;
    state.enemy.body.velocity.z += dodge.z * 22;
    state.enemy.state.evadeHomingUntil = now + 240;
    state.enemy.state.evadeCooldownUntil = now + 520;
    state.enemy.state.action = 'dash';
  } else {
    state.enemy.state.action = 'dash';
    if (dist >= 10 && dist <= 20 && state.enemy.state.boost > 12 && Math.random() > 0.88) {
      const dodge = Math.random() > 0.5 ? side : side.clone().multiplyScalar(-1);
      state.enemy.body.velocity.x += dodge.x * 26;
      state.enemy.body.velocity.z += dodge.z * 26;
      state.enemy.state.evadeHomingUntil = now + 280;
    }
  }
  if (dist > 14 && Math.random() > 0.9) state.enemy.state.evadeHomingUntil = now + 90;

  if (now >= state.enemy.state.nextFireAt) {
    const u = state.enemy.unit;
    const s = state.enemy.state;
    if (u.magCapacity != null && s.ammo <= 0) {
      // Out of ammo — defer next attempt until reload completes (mirrors player gating).
      const wait = u.autoReload
        ? u.reloadMs
        : Math.max(120, (s.reloadingUntil || now + u.reloadMs) - now);
      s.nextFireAt = now + wait;
      s.machineBurstRemaining = 0;
    } else if (u.sniperCharge) {
      const fired = attemptFire(state.enemy, state.player, now);
      if (fired) {
        s.nextFireAt = now + u.fireCooldownMs + PhaserLikeBetween(400, 1200);
      } else {
        s.nextFireAt = now + 220;
      }
      s.machineBurstRemaining = 0;
    } else {
      if (u.spreadCount === 1 && s.machineBurstRemaining <= 0) s.machineBurstRemaining = 5;
      const firedAt = s.lastFireAt;
      attemptFire(state.enemy, state.player, now);
      const fired = s.lastFireAt !== firedAt;
      if (u.spreadCount === 1) {
        if (fired) s.machineBurstRemaining -= 1;
        s.nextFireAt = s.machineBurstRemaining > 0 ? now + 150 : now + PhaserLikeBetween(1300, 2400);
        if (s.machineBurstRemaining <= 0) s.machineBurstRemaining = 0;
      } else {
        if (fired) s.nextFireAt = now + PhaserLikeBetween(1500, 3000);
        else s.nextFireAt = now + 120;
      }
    }
  }
  if (dist < 7.2 && now > state.player.state.antiMeleeUntil && Math.random() > 0.82) {
    state.enemy.body.velocity.x += dir.x * 16;
    state.enemy.body.velocity.z += dir.z * 16;
    state.enemy.state.action = 'dash';
  }
  if (state.enemy.grounded && now > state.enemy.state.hoverUntil && state.enemy.state.action !== 'jump') {
    state.enemy.body.velocity.y = 0;
  }
  applyMomentum(state.enemy);
  updateBoost(state.enemy, now, state.enemy.state.action);
}

function updateLocksAndReticle() {
  const dist = state.player.root.position.distanceTo(state.enemy.root.position);
  state.player.state.redLock = dist <= state.player.unit.lockRange;
  state.enemy.state.redLock = dist <= state.enemy.unit.lockRange;

  state.reticle.position.set(0, 0.2, 0);
  state.reticle.material.color.set(state.player.state.redLock ? 0xff5f72 : 0x7effbd);
  if (state.player.state.redLock !== state.reticleWasRed) {
    state.reticlePulseUntil = performance.now() + 180;
    state.reticleWasRed = state.player.state.redLock;
  }
  // Scale the lock ring up with distance so it stays readable on long-range maps
  // (Streets/Square). Sprites are world-sized, so screen size = world-size / distance —
  // multiplying by distance keeps screen size roughly constant, with a floor for very
  // close range and a generous ceiling so far-away locks remain easy to read.
  const camDist = camera.position.distanceTo(state.enemy.root.position);
  const distScale = THREE.MathUtils.clamp(camDist / 22, 0.7, 4.5);
  const pulse = state.reticlePulseUntil > performance.now() ? 1.2 : 1;
  state.reticle.scale.setScalar(6.1 * distScale * pulse);
  state.reticle.quaternion.copy(camera.quaternion);
}

function updateTransforms(dt) {
  [state.player, state.enemy].forEach((m) => {
    const groundY = getGroundLevelY(m);

    if (m.state.airborne) {
      m.state.jumpVelocity += world.gravity.y * dt;
      m.body.position.y += m.state.jumpVelocity * dt;
      if (m.body.position.y <= groundY && m.state.jumpVelocity <= 0) {
        m.body.position.y = groundY;
        m.body.velocity.y = 0;
        m.state.airborne = false;
        m.state.jumpVelocity = 0;
      }
    } else if (m.body.position.y > groundY + 0.6) {
      m.state.airborne = true;
      m.state.jumpVelocity = 0;
    } else {
      m.body.position.y = groundY;
      m.body.velocity.y = 0;
    }

    m.body.linearFactor.set(1, 0, 1);
    m.root.position.set(m.body.position.x, m.body.position.y + m.modelYOffset, m.body.position.z);
    m.grounded = !m.state.airborne;
  });
  const pToE = new THREE.Vector3().subVectors(state.enemy.root.position, state.player.root.position).normalize();
  state.player.root.rotation.y = Math.atan2(pToE.x, pToE.z);
  state.enemy.root.rotation.y = Math.atan2(-pToE.x, -pToE.z);

  [state.player, state.enemy].forEach((m) => {
    m.arms.left.rotation.x = 0;
    m.arms.right.rotation.x = 0;
    m.arms.left.rotation.z = 0;
    m.arms.right.rotation.z = 0;
    m.root.rotation.x = 0;
    if (performance.now() < m.state.staggerUntil) m.root.rotation.x = 0.18;
    if (m.state.action === 'stagger' && performance.now() > m.state.staggerUntil) m.state.action = 'idle';
    if (!['dash'].includes(m.state.action)) return;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.4 }));
    puff.position.copy(m.root.position).add(new THREE.Vector3(0, -1.8, -0.6));
    scene.add(puff);
    m.trail.push({ mesh: puff, life: 0.2 });
  });

  [state.player, state.enemy].forEach((m) => {
    m.trail = m.trail.filter((t) => {
      t.life -= 1 / 60;
      t.mesh.material.opacity = Math.max(0, t.life * 1.6);
      t.mesh.scale.multiplyScalar(1.07);
      if (t.life > 0) return true;
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      return false;
    });
  });
}

function updateCamera() {
  const p = state.player.root.position;
  const e = state.enemy.root.position;
  const line = new THREE.Vector3().subVectors(e, p).normalize();
  const side = new THREE.Vector3(-line.z, 0, line.x);
  const desired = new THREE.Vector3(p.x - line.x * 13 + side.x * 2, p.y + 6.8, p.z - line.z * 13 + side.z * 2);

  camera.position.lerp(desired, 0.16);
  camera.lookAt(new THREE.Vector3((p.x + e.x) / 2, (p.y + e.y) / 2 + 2.2, (p.z + e.z) / 2));

  const dist = p.distanceTo(e);
  camera.fov = THREE.MathUtils.lerp(76, 46, THREE.MathUtils.clamp(1 - dist / 28, 0, 1));
  if (state.player.state.action === 'dash') camera.fov = Math.min(82, camera.fov + 5);
  camera.updateProjectionMatrix();
}

function updateHud() {
  hudRefs.hp.style.width = `${(state.player.state.hp / MAX_HP) * 100}%`;
  hudRefs.enemyHp.style.width = `${(state.enemy.state.hp / MAX_HP) * 100}%`;
  hudRefs.boost.style.width = `${(state.player.state.boost / BOOST_CAP) * 100}%`;
  hudRefs.boost.style.background = state.player.state.overheatedUntil > performance.now() ? '#ff8c45' : '#90ff63';
  if (state.speedLines) state.speedLines.style.opacity = '0';

  const u = state.player.unit;
  const s = state.player.state;
  if (u.magCapacity != null && hudRefs.ammoCount) {
    hudRefs.ammoCount.textContent = String(s.ammo);
    const now = performance.now();
    const isMg = !u.autoReload;
    const empty = isMg && s.ammo === 0;
    let progress = 0;
    let showRing = false;
    if (isMg) {
      if (s.ammo === 0 && s.reloadingUntil > 0) {
        progress = THREE.MathUtils.clamp(1 - (s.reloadingUntil - now) / u.reloadMs, 0, 1);
        showRing = true;
      }
    } else if (s.ammo < u.magCapacity) {
      const partial = s.reloadTickStartAt
        ? THREE.MathUtils.clamp((now - s.reloadTickStartAt) / u.reloadMs, 0, 1)
        : 0;
      progress = (s.ammo + partial) / u.magCapacity;
      showRing = true;
    }
    hudRefs.shootBtn.classList.toggle('empty', empty);
    hudRefs.shootBtn.classList.toggle('reloading', showRing);
    const circumference = 2 * Math.PI * 46;
    hudRefs.reloadRing.style.strokeDashoffset = String(circumference * (1 - progress));
  }
}

function cleanupMatch() {
  [state.player, state.enemy].forEach((m) => {
    if (!m) return;
    removeGlintFromMech(m);
    scene.remove(m.root);
    world.removeBody(m.body);
    m.trail.forEach((t) => scene.remove(t.mesh));
  });
  state.projectiles.forEach((p) => scene.remove(p.mesh));
  state.projectiles.length = 0;
  state.vfx.forEach((vfx) => scene.remove(vfx.mesh));
  state.vfx.length = 0;
  if (state.reticle?.parent) state.reticle.parent.remove(state.reticle);
}

function startMatch() {
  cleanupMatch();
  clearMenus();
  renderer.domElement.style.pointerEvents = 'auto';
  state.player = createMech(0x62d7ff, UNIT_DATA[state.playerUnitKey]);
  state.enemy = createMech(0xff7ad5, UNIT_DATA[state.enemyUnitKey]);
  if (state.mapKey === 'arena2') {
    // Streets: spawn on opposite ends of the cross road (X axis), not the bridge lane.
    state.player.body.position.set(-108, 2.45, 0);
    state.enemy.body.position.set(108, 2.45, 0);
  } else if (state.mapKey === 'lobby') {
    // Lobby: spawn on lower floor on opposite ends, mezzanine reachable via the central stairs.
    state.player.body.position.set(-30, 2.45, 50);
    state.enemy.body.position.set(30, 2.45, 50);
  } else if (state.mapKey === 'factory') {
    state.player.body.position.set(-50, 2.45, 0);
    state.enemy.body.position.set(50, 2.45, 0);
  } else if (state.mapKey === 'square') {
    // Diagonal spawn across the plaza — past the cathedral and clock tower zones.
    state.player.body.position.set(-95, 2.45, -45);
    state.enemy.body.position.set(95, 2.45, 45);
  } else {
    state.player.body.position.set(-24, 2.45, 0);
    state.enemy.body.position.set(24, 2.45, 0);
  }
  buildArenaForMap(state.mapKey);
  const now = performance.now();
  state.player.state.lastFireAt = now;
  state.enemy.state.lastFireAt = now;
  state.enemy.state.nextFireAt = now + 650;
  input.shootHold = false;
  input.shootTap = false;
  state.reticle = makeReticleSprite();
  state.enemy.root.add(state.reticle);
  hudRefs = setupHUD();
  state.phase = 'match';
  state.running = true;
  state.matchStartAt = performance.now();
}

function showSelectMenu() {
  cleanupMatch();
  clearMenus();
  state.phase = 'select';
  state.running = false;
  state.hud?.remove();
  renderer.domElement.style.pointerEvents = 'none';

  const unitEntries = Object.entries(UNIT_DATA);
  const mapEntries = Object.entries(MAP_DATA);

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `<h2>Select Your Unit</h2>${unitEntries.map(([id, unit]) => `<button data-player-unit="${id}">${unit.name}</button>`).join('')}`;
  app.appendChild(menu);

  menu.querySelectorAll('button[data-player-unit]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      state.playerUnitKey = button.dataset.playerUnit;
      clearMenus();

      const enemyMenu = document.createElement('div');
      enemyMenu.className = 'menu';
      enemyMenu.innerHTML = `<h2>Select Enemy Unit</h2>${unitEntries.map(([id, unit]) => `<button data-enemy-unit="${id}">${unit.name}</button>`).join('')}`;
      app.appendChild(enemyMenu);

      enemyMenu.querySelectorAll('button[data-enemy-unit]').forEach((enemyButton) => {
        enemyButton.addEventListener('pointerdown', (enemyEvent) => {
          enemyEvent.preventDefault();
          state.enemyUnitKey = enemyButton.dataset.enemyUnit;
          clearMenus();

          const mapMenu = document.createElement('div');
          mapMenu.className = 'menu';
          mapMenu.innerHTML = `<h2>Select Map</h2>
            <label style="display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 0 14px;color:#d8fcff;">
              <input type="checkbox" id="dummy-mode-toggle" />
              Dummy (BOT projectile damage = 0)
            </label>
            ${mapEntries.map(([id, map]) => `<button data-map="${id}">${map.name}</button>`).join('')}`;
          app.appendChild(mapMenu);
          const dummyModeToggle = mapMenu.querySelector('#dummy-mode-toggle');
          dummyModeToggle.checked = !!state.dummyMode;
          dummyModeToggle.addEventListener('change', () => {
            state.dummyMode = dummyModeToggle.checked;
          });

          mapMenu.querySelectorAll('button[data-map]').forEach((mapButton) => {
            mapButton.addEventListener('pointerdown', (mapEvent) => {
              mapEvent.preventDefault();
              state.mapKey = mapButton.dataset.map;
              startMatch();
            });
          });
        });
      });
    });
  });
}

function setupRootTouchAction() {
  document.documentElement.style.touchAction = 'none';
  document.body.style.touchAction = 'none';
  app.style.touchAction = 'none';
}

window.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('gesturechange', (e) => e.preventDefault());
window.addEventListener('gestureend', (e) => e.preventDefault());

window.addEventListener('dblclick', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('.pause-btn')) e.preventDefault();
});

window.addEventListener('touchstart', (e) => {
  if (!e.target.closest('.menu') && !e.target.closest('.pause-btn')) e.preventDefault();
}, { passive: false });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastSprintKeyAt = 0;
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || e.key === 'ArrowUp') keyState.up = true;
  else if (k === 's' || e.key === 'ArrowDown') keyState.down = true;
  else if (k === 'a' || e.key === 'ArrowLeft') keyState.left = true;
  else if (k === 'd' || e.key === 'ArrowRight') keyState.right = true;
  else if (k === ' ') input.jump = true;
  else if (k === 'k') {
    const now = performance.now();
    const hasDir = Math.hypot(input.x, input.y) > 0.15;
    if (now - lastSprintKeyAt < 260 && hasDir) input.sprintLocked = true;
    lastSprintKeyAt = now;
    input.boostHeld = true; input.boost = true;
  }
  else if (k === 'l') input.stepTap = true;
  else if (k === 'j') { input.shootTap = true; input.shootHold = true; }
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'w' || e.key === 'ArrowUp') keyState.up = false;
  else if (k === 's' || e.key === 'ArrowDown') keyState.down = false;
  else if (k === 'a' || e.key === 'ArrowLeft') keyState.left = false;
  else if (k === 'd' || e.key === 'ArrowRight') keyState.right = false;
  else if (k === ' ') input.jump = false;
  else if (k === 'k') { input.boostHeld = false; if (!input.sprintLocked) input.boost = false; }
  else if (k === 'j') input.shootHold = false;
  const hasKeyboardDir = keyState.up || keyState.down || keyState.left || keyState.right;
  if (!hasKeyboardDir) input.sprintLocked = false;
});

function syncKeyboardMovement() {
  const hasKeyboardDir = keyState.up || keyState.down || keyState.left || keyState.right;
  if (!hasKeyboardDir) {
    if (!touchSteeringActive) {
      input.x = 0;
      input.y = 0;
    }
    return;
  }

  const x = (keyState.right ? 1 : 0) - (keyState.left ? 1 : 0);
  const y = (keyState.down ? 1 : 0) - (keyState.up ? 1 : 0);
  const len = Math.hypot(x, y) || 1;
  input.x = x / len;
  input.y = y / len;
}

setupRootTouchAction();
showSelectMenu();
animate();

function showEndMenu(win) {
  state.phase = 'end';
  state.running = false;
  clearMenus();

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <h2>${win ? 'YOU WIN' : 'YOU LOSE'}</h2>
    <button id="rematch">Rematch</button>
    <button id="select">Select Unit</button>
  `;
  app.appendChild(menu);

  menu.querySelector('#rematch').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startMatch();
  });
  menu.querySelector('#select').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    showSelectMenu();
  });
}

function triggerEnemyEvasion(now) {
  if (state.enemy.state.hp <= 0 || now <= state.enemy.state.evadeCooldownUntil || Math.random() > 0.6) return;
  const toPlayer = new THREE.Vector3().subVectors(state.player.root.position, state.enemy.root.position).setY(0).normalize();
  const side = Math.random() > 0.5 ? new THREE.Vector3(-toPlayer.z, 0, toPlayer.x) : new THREE.Vector3(toPlayer.z, 0, -toPlayer.x);
  const shouldDash = Math.random() > 0.5;
  if (shouldDash) {
    state.enemy.body.velocity.x += side.x * 28;
    state.enemy.body.velocity.z += side.z * 28;
    state.enemy.state.action = 'dash';
  } else {
    state.enemy.body.velocity.x += side.x * 18;
    state.enemy.body.velocity.z += side.z * 18;
    state.enemy.state.action = 'dash';
  }
  state.enemy.state.evadeHomingUntil = now + 260;
  state.enemy.state.evadeCooldownUntil = now + 520;
}

function clearIncomingHoming(mech, now) {
  mech.state.evadeHomingUntil = now + STEP_HOMING_CUT_MS;
  for (const projectile of state.projectiles) {
    if (projectile.target !== mech) continue;
    projectile.homing = false;
    projectile.homingLost = true;
  }
}

function triggerDashDefense(now) {
  state.player.state.dashRecoverUntil = now + 180;
}

function PhaserLikeBetween(min, max) {
  return min + Math.random() * (max - min);
}

function spawnHitEffect(position, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.58, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.position.copy(position).add(new THREE.Vector3(0, 1.4, 0));
  ring.lookAt(camera.position);
  scene.add(ring);
  state.vfx.push({ mesh: ring, life: 0.18, growth: 1.26 });
}

function spawnMeleeHitboxVisual(mech, color, scaleBoost = 1) {
  const slash = new THREE.Mesh(
    new THREE.TorusGeometry(2.5 * scaleBoost, 0.18 * scaleBoost, 12, 36, Math.PI * 1.05),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
  );
  slash.position.copy(mech.root.position).add(new THREE.Vector3(0, 1.15, 2.55));
  slash.rotation.x = Math.PI / 2.6;
  slash.rotation.y = mech.root.rotation.y;
  scene.add(slash);
  state.vfx.push({ mesh: slash, life: 0.22, growth: 1.0, followMech: mech, followYOffset: 1.15, followForward: 2.55 });
}

function getMeleeHitboxCenter(mech, forward = 2.55) {
  return new THREE.Vector3(
    mech.root.position.x + Math.sin(mech.root.rotation.y) * forward,
    mech.root.position.y + 1.15,
    mech.root.position.z + Math.cos(mech.root.rotation.y) * forward
  );
}

function showPauseMenu() {
  if (!state.running || state.phase !== 'match') return;
  state.running = false;
  state.phase = 'pause';
  clearMenus();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `<h2>Paused</h2><button data-action="resume">Resume</button><button data-action="new">New Game</button>`;
  app.appendChild(menu);
  menu.querySelector('button[data-action="resume"]').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    clearMenus();
    state.phase = 'match';
    state.running = true;
  });
  menu.querySelector('button[data-action="new"]').addEventListener('pointerdown', (event) => {
    event.preventDefault();
    showSelectMenu();
  });
}

function clearMenus() {
  document.querySelectorAll('.menu').forEach((menu) => menu.remove());
}

function inheritMomentum(mech, momentumValue = MOMENTUM_STANDARD) {
  const factor = momentumValue / MOMENTUM_STANDARD;
  mech.state.momentumVX = mech.body.velocity.x * factor;
  mech.state.momentumVZ = mech.body.velocity.z * factor;
}

function applyMomentum(mech, { suspend = false } = {}) {
  if (suspend) return;
  mech.body.velocity.x += mech.state.momentumVX;
  mech.body.velocity.z += mech.state.momentumVZ;
  mech.state.momentumVX *= mech.state.momentumDecay;
  mech.state.momentumVZ *= mech.state.momentumDecay;
  if (Math.abs(mech.state.momentumVX) < 0.02) mech.state.momentumVX = 0;
  if (Math.abs(mech.state.momentumVZ) < 0.02) mech.state.momentumVZ = 0;
}


const arenaSurfaces = [];
const SURFACE_STEP_HEIGHT = 1.6;

function clearArenaDecor() {
  while (arenaDecor.length) {
    const obj = arenaDecor.pop();
    scene.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material.dispose();
    }
  }
  arenaObstacles.length = 0;
  arenaSurfaces.length = 0;
}

function addBlockingBox({ x, y, z, sx, sy, sz, material, topBuffer, decorOnly }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, y, z);
  mesh.userData.blocking = !decorOnly;
  scene.add(mesh);
  arenaDecor.push(mesh);
  if (decorOnly) return mesh;
  const obstacle = { minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, minY: y - sy / 2, maxY: y + sy / 2 };
  if (topBuffer !== undefined) obstacle.topBuffer = topBuffer;
  arenaObstacles.push(obstacle);
  return mesh;
}

function addPlatform({ minX, maxX, minZ, maxZ, top, material, thickness = 0.5 }) {
  const sx = maxX - minX;
  const sz = maxZ - minZ;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, thickness, sz), material);
  mesh.position.set((minX + maxX) / 2, top - thickness / 2, (minZ + maxZ) / 2);
  scene.add(mesh);
  arenaDecor.push(mesh);
  arenaSurfaces.push({ minX, maxX, minZ, maxZ, maxTop: top, heightAt: () => top });
  return mesh;
}

function addRamp({ minX, maxX, minZ, maxZ, axis, lowY, highY, material, thickness = 0.6 }) {
  const lowEnd = axis === 'x' ? minX : minZ;
  const highEnd = axis === 'x' ? maxX : maxZ;
  const span = (highEnd - lowEnd) || 1;
  const dy = highY - lowY;
  const angle = Math.atan2(dy, Math.abs(span));
  const length = Math.hypot(span, dy);
  const width = axis === 'x' ? (maxZ - minZ) : (maxX - minX);
  const geo = axis === 'x'
    ? new THREE.BoxGeometry(length, thickness, width)
    : new THREE.BoxGeometry(width, thickness, length);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set((minX + maxX) / 2, (lowY + highY) / 2, (minZ + maxZ) / 2);
  if (axis === 'x') mesh.rotation.z = -angle;
  else mesh.rotation.x = -angle;
  scene.add(mesh);
  arenaDecor.push(mesh);
  arenaSurfaces.push({
    minX, maxX, minZ, maxZ,
    maxTop: Math.max(lowY, highY),
    heightAt(x, z) {
      const v = axis === 'x' ? x : z;
      const t = (v - lowEnd) / span;
      const c = Math.max(0, Math.min(1, t));
      return lowY + dy * c;
    }
  });
  return mesh;
}

function groundHeightAt(x, z, currentSurfaceY = 0) {
  let best = 0;
  for (const s of arenaSurfaces) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    const h = s.heightAt(x, z);
    if (h > currentSurfaceY + SURFACE_STEP_HEIGHT) continue;
    if (h > best) best = h;
  }
  return best;
}

function getGroundLevelY(mech) {
  const pos = mech.body.position;
  const currentSurfaceY = pos.y - GROUND_BASE_Y;
  return groundHeightAt(pos.x, pos.z, currentSurfaceY) + GROUND_BASE_Y;
}

function surfaceHeightAtXZ(x, z) {
  let best = -Infinity;
  for (const s of arenaSurfaces) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    const h = s.heightAt(x, z);
    if (h > best) best = h;
  }
  return best;
}

function applyMapAmbience(mapKey) {
  // Defaults — match the original dim atmosphere used by Plain Field & Streets.
  scene.background.setHex(0x0b0f17);
  scene.fog.color.setHex(0x0b0f17);
  scene.fog.near = 28;
  scene.fog.far = 160;
  ambient.color.setHex(0x8cb2ff);
  ambient.intensity = 0.7;
  key.color.setHex(0xe5eeff);
  key.intensity = 1.15;
  if (mapKey === 'square' || mapKey === 'arena2') {
    // Overcast daylight palette — shared by Square and Streets.
    scene.background.setHex(0x6e8ba3);
    scene.fog.color.setHex(0x8ea3b6);
    scene.fog.near = 70;
    scene.fog.far = 280;
    ambient.color.setHex(0xb4c6db);
    ambient.intensity = 0.65;
    key.color.setHex(0xc4d2e2);
    key.intensity = 1.0;
  } else if (mapKey === 'lobby') {
    // Sleek sci-fi lobby: bright interior, deep blue night-sky background through the glass wall.
    scene.background.setHex(0x141d33);
    scene.fog.color.setHex(0x16213a);
    scene.fog.near = 60;
    scene.fog.far = 260;
    ambient.color.setHex(0xd4e2ff);
    ambient.intensity = 0.95;
    key.color.setHex(0xeaf2ff);
    key.intensity = 1.4;
  } else if (mapKey === 'factory') {
    scene.background.setHex(0x141821);
    scene.fog.color.setHex(0x14181f);
    scene.fog.near = 40;
    scene.fog.far = 200;
    ambient.color.setHex(0xc4d4e8);
    ambient.intensity = 0.6;
    key.color.setHex(0xfff6e0);
    key.intensity = 1.05;
  }
}

function buildArenaForMap(mapKey) {
  clearArenaDecor();
  applyMapAmbience(mapKey);
  if (mapKey === 'arena2') buildStreetsArena();
  else if (mapKey === 'factory') buildFactoryArena();
  else if (mapKey === 'square') buildSquareArena();
  else if (mapKey === 'lobby') buildLobbyArena();
}

function buildStreetsArena() {
  const road = new THREE.MeshStandardMaterial({ color: 0x1f2530, roughness: 0.92 });
  const sidewalk = new THREE.MeshStandardMaterial({ color: 0x8d96a4, roughness: 0.78 });
  const ramp = new THREE.MeshStandardMaterial({ color: 0xb89a3a, roughness: 0.7 });
  const bridgeDeck = new THREE.MeshStandardMaterial({ color: 0x9b8338, roughness: 0.7 });
  const railing = new THREE.MeshStandardMaterial({ color: 0xd4d8df, roughness: 0.55, metalness: 0.4 });
  const storefrontA = new THREE.MeshStandardMaterial({ color: 0xc05650, roughness: 0.78 });
  const storefrontB = new THREE.MeshStandardMaterial({ color: 0x5773a8, roughness: 0.78 });
  const storefrontC = new THREE.MeshStandardMaterial({ color: 0xe2c265, roughness: 0.72 });
  const storefrontD = new THREE.MeshStandardMaterial({ color: 0x3d4759, roughness: 0.82 });
  const sign = new THREE.MeshStandardMaterial({ color: 0xff6db0, emissive: 0x55173a, emissiveIntensity: 0.35, roughness: 0.55 });
  const signCyan = new THREE.MeshStandardMaterial({ color: 0x4dd6ff, emissive: 0x163d52, emissiveIntensity: 0.4, roughness: 0.55 });
  const vendor = new THREE.MeshStandardMaterial({ color: 0xe33c4d, roughness: 0.6 });
  const billboard = new THREE.MeshStandardMaterial({ color: 0xffe2a3, emissive: 0x4a3915, emissiveIntensity: 0.3, roughness: 0.6 });

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.4 });
  const lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff4c2, emissive: 0xfff4c2, emissiveIntensity: 0.9, roughness: 0.3 });
  const scooter = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6 });
  const stallAwning = new THREE.MeshStandardMaterial({ color: 0xd95a52, roughness: 0.7 });

  const base = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), road);
  base.rotation.x = -Math.PI / 2; base.position.y = 0.005; scene.add(base); arenaDecor.push(base);

  // ===== Bridge dimensions (referenced throughout) =====
  const BRIDGE_TOP = 8;
  const BRIDGE_HALF_X = 8;
  const BRIDGE_MIN_Z = -28;
  const BRIDGE_MAX_Z = 28;
  const RAMP_HALF_X = BRIDGE_HALF_X;
  const RAMP_LOW_Y = 0.45;
  const RAMP_S_MIN_Z = -56;
  const RAMP_S_MAX_Z = -28;
  const RAMP_N_MIN_Z = 28;
  const RAMP_N_MAX_Z = 56;

  // Sidewalks lining the main avenue (street runs along X, narrow in Z)
  addPlatform({ minX: -120, maxX: 120, minZ: -18, maxZ: -12, top: 0.45, material: sidewalk });
  addPlatform({ minX: -120, maxX: 120, minZ: 12, maxZ: 18, top: 0.45, material: sidewalk });

  // Plaza decks on each side (extend out to support longer ramps)
  addPlatform({ minX: -34, maxX: 34, minZ: -58, maxZ: -18, top: 0.45, material: sidewalk });
  addPlatform({ minX: -34, maxX: 34, minZ: 18, maxZ: 58, top: 0.45, material: sidewalk });

  // ===== Storefront buildings =====
  // Pulled closer to sidewalks while preserving movement lanes.
  const southBuildings = [
    { x: -100, sx: 28, h: 14, mat: storefrontA },
    { x: -68, sx: 22, h: 11, mat: storefrontC },
    { x: -42, sx: 14, h: 16, mat: storefrontB },
    { x: 42, sx: 14, h: 16, mat: storefrontD },
    { x: 68, sx: 22, h: 12, mat: storefrontA },
    { x: 100, sx: 28, h: 15, mat: storefrontC }
  ];
  southBuildings.forEach((b) => {
    addBlockingBox({ x: b.x, y: b.h / 2, z: -48, sx: b.sx, sy: b.h, sz: 24, material: b.mat });
  });
  const northBuildings = [
    { x: -100, sx: 28, h: 13, mat: storefrontD },
    { x: -68, sx: 22, h: 16, mat: storefrontB },
    { x: -42, sx: 14, h: 12, mat: storefrontA },
    { x: 42, sx: 14, h: 14, mat: storefrontC },
    { x: 68, sx: 22, h: 17, mat: storefrontB },
    { x: 100, sx: 28, h: 12, mat: storefrontA }
  ];
  northBuildings.forEach((b) => {
    addBlockingBox({ x: b.x, y: b.h / 2, z: 48, sx: b.sx, sy: b.h, sz: 24, material: b.mat });
  });

  // Outer back walls to close the block
  addBlockingBox({ x: 0, y: 10, z: -100, sx: 260, sy: 20, sz: 6, material: storefrontD });
  addBlockingBox({ x: 0, y: 10, z: 100, sx: 260, sy: 20, sz: 6, material: storefrontD });

  // ===== Footbridge (deck at y=8, spans 16m × 56m) =====
  addPlatform({
    minX: -BRIDGE_HALF_X, maxX: BRIDGE_HALF_X,
    minZ: BRIDGE_MIN_Z, maxZ: BRIDGE_MAX_Z,
    top: BRIDGE_TOP, thickness: 0.8, material: bridgeDeck
  });
  // Railings along bridge sides
  const RAIL_H = 1.6;
  const railLength = BRIDGE_MAX_Z - BRIDGE_MIN_Z;
  addBlockingBox({ x: -BRIDGE_HALF_X - 0.2, y: BRIDGE_TOP + RAIL_H / 2, z: 0, sx: 0.4, sy: RAIL_H, sz: railLength, material: railing });
  addBlockingBox({ x: BRIDGE_HALF_X + 0.2, y: BRIDGE_TOP + RAIL_H / 2, z: 0, sx: 0.4, sy: RAIL_H, sz: railLength, material: railing });
  // No hanging end-caps across bridge entries; slope gates are provided along ramp edges.
  // Underside support pillars (set into the sidewalks, not the street)
  addBlockingBox({ x: -BRIDGE_HALF_X + 0.6, y: BRIDGE_TOP / 2, z: -15, sx: 1.4, sy: BRIDGE_TOP, sz: 1.4, material: railing });
  addBlockingBox({ x: BRIDGE_HALF_X - 0.6, y: BRIDGE_TOP / 2, z: -15, sx: 1.4, sy: BRIDGE_TOP, sz: 1.4, material: railing });
  addBlockingBox({ x: -BRIDGE_HALF_X + 0.6, y: BRIDGE_TOP / 2, z: 15, sx: 1.4, sy: BRIDGE_TOP, sz: 1.4, material: railing });
  addBlockingBox({ x: BRIDGE_HALF_X - 0.6, y: BRIDGE_TOP / 2, z: 15, sx: 1.4, sy: BRIDGE_TOP, sz: 1.4, material: railing });

  // ===== Ramps (slopes — units walk straight up, no jump) =====
  // 16m horizontal × 7.55m rise → ~25° walkable; 8m wide
  addRamp({
    minX: -RAMP_HALF_X, maxX: RAMP_HALF_X,
    minZ: RAMP_S_MIN_Z, maxZ: RAMP_S_MAX_Z,
    axis: 'z', lowY: RAMP_LOW_Y, highY: BRIDGE_TOP,
    material: ramp
  });
  addRamp({
    minX: -RAMP_HALF_X, maxX: RAMP_HALF_X,
    minZ: RAMP_N_MIN_Z, maxZ: RAMP_N_MAX_Z,
    axis: 'z', lowY: BRIDGE_TOP, highY: RAMP_LOW_Y,
    material: ramp
  });
  // Long angled gate visuals that match slope angle, with matching collision samples.
  const RAMP_WALL_H = RAIL_H;
  const slopeSpan = (RAMP_S_MAX_Z - RAMP_S_MIN_Z);
  const slopeGateLen = slopeSpan - 2;
  const slopeRise = BRIDGE_TOP - RAMP_LOW_Y;
  const slopeAngle = Math.atan2(slopeRise, slopeSpan);
  const addAngledSlopeGate = ({ x, zCenter, yCenter, rotationX, zStart, zEnd }) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.45, RAMP_WALL_H, slopeGateLen), railing);
    mesh.position.set(x, yCenter, zCenter);
    mesh.rotation.x = rotationX;
    scene.add(mesh);
    arenaDecor.push(mesh);

    const samples = 5;
    for (let i = 0; i < samples; i += 1) {
      const t = (i + 0.5) / samples;
      const z = THREE.MathUtils.lerp(zStart, zEnd, t);
      const slopeY = THREE.MathUtils.lerp(RAMP_LOW_Y, BRIDGE_TOP, t);
      const y = slopeY + RAMP_WALL_H / 2;
      const sx = 0.45;
      const sy = RAMP_WALL_H;
      const sz = slopeGateLen / samples;
      arenaObstacles.push({
        minX: x - sx / 2, maxX: x + sx / 2,
        minZ: z - sz / 2, maxZ: z + sz / 2,
        minY: y - sy / 2, maxY: y + sy / 2
      });
      // Invisible under-slope bar: blocks units from walking beneath the slope from the road.
      // Top sits at the slope underside (below the gate above), so it never exceeds the gate.
      // noProjectile: true so bullets pass through this invisible block (it's only meant
      // to gate unit movement, not draw fire).
      if (slopeY > 0) {
        arenaObstacles.push({
          minX: x - sx / 2, maxX: x + sx / 2,
          minZ: z - sz / 2, maxZ: z + sz / 2,
          minY: 0, maxY: slopeY,
          noProjectile: true
        });
      }
    }
  };
  for (const sx of [-1, 1]) {
    addAngledSlopeGate({
      x: sx * (RAMP_HALF_X + 0.2),
      zCenter: (RAMP_S_MIN_Z + RAMP_S_MAX_Z) / 2,
      yCenter: (RAMP_LOW_Y + BRIDGE_TOP) / 2 + RAMP_WALL_H / 2,
      rotationX: -slopeAngle,
      zStart: RAMP_S_MIN_Z + 1,
      zEnd: RAMP_S_MAX_Z - 1
    });
    addAngledSlopeGate({
      x: sx * (RAMP_HALF_X + 0.2),
      zCenter: (RAMP_N_MIN_Z + RAMP_N_MAX_Z) / 2,
      yCenter: (RAMP_LOW_Y + BRIDGE_TOP) / 2 + RAMP_WALL_H / 2,
      rotationX: slopeAngle,
      zStart: RAMP_N_MAX_Z - 1,
      zEnd: RAMP_N_MIN_Z + 1
    });
  }
  // Cap the under-slope tunnel at each ramp's high-end short edge (the side facing
  // the main road). Top stays below the deck so bridge↔slope transit at y≈BRIDGE_TOP +
  // GROUND_BASE_Y clears the +4 collision Y buffer in resolveUnitObstacleCollisions.
  // noProjectile: true so bullets aren't blocked by these invisible caps.
  const underSlopeCapMaxY = BRIDGE_TOP - 2;
  const underSlopeCapThickness = 0.45;
  for (const edgeZ of [RAMP_S_MAX_Z, RAMP_N_MIN_Z]) {
    arenaObstacles.push({
      minX: -RAMP_HALF_X, maxX: RAMP_HALF_X,
      minZ: edgeZ - underSlopeCapThickness / 2, maxZ: edgeZ + underSlopeCapThickness / 2,
      minY: 0, maxY: underSlopeCapMaxY,
      noProjectile: true
    });
  }

  // ===== Akihabara dressing =====
  // Corner signage towers (neon-emissive)
  addBlockingBox({ x: -110, y: 12, z: -94, sx: 5, sy: 24, sz: 5, material: sign });
  addBlockingBox({ x: 110, y: 12, z: 94, sx: 5, sy: 24, sz: 5, material: signCyan });
  addBlockingBox({ x: -110, y: 14, z: 94, sx: 5, sy: 28, sz: 5, material: signCyan });
  addBlockingBox({ x: 110, y: 14, z: -94, sx: 5, sy: 28, sz: 5, material: sign });

  // Lamp posts along sidewalks
  const lampXs = [-110, -88, -66, -44, 44, 66, 88, 110];
  for (const lx of lampXs) {
    for (const lz of [-15, 15]) {
      addBlockingBox({ x: lx, y: 9.1, z: lz, sx: 0.35, sy: 18.2, sz: 0.35, material: lampMat });
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.7), lampGlow);
      head.position.set(lx, 18.4, lz);
      scene.add(head); arenaDecor.push(head);
    }
  }

  // Vending machines — clusters along sidewalks (not in front of buildings everywhere)
  const vendingPos = [
    [-95, -15.2], [-93.5, -15.2],
    [-50, -15.2], [-48.5, -15.2],
    [25, -15.2], [26.5, -15.2],
    [80, -15.2], [78.5, -15.2],
    [-78, 15.2], [-76.5, 15.2],
    [-25, 15.2], [-23.5, 15.2],
    [50, 15.2], [51.5, 15.2],
    [95, 15.2], [93.5, 15.2]
  ];
  vendingPos.forEach(([x, z]) => {
    addBlockingBox({ x, y: 1.4, z, sx: 1.4, sy: 2.6, sz: 1.2, material: vendor });
  });

  // Street stalls with awnings (sidewalk side, opposite ends from vending)
  const stallSpots = [[-30, -15], [30, 15], [-58, 14.8], [60, -14.8]];
  stallSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 0.85, z, sx: 3, sy: 1.7, sz: 1.5, material: stallAwning });
    addBlockingBox({ x, y: 2.7, z, sx: 3.4, sy: 0.18, sz: 2.0, material: storefrontA });
  });

  // Parked scooters (low cover)
  const scooterSpots = [[-20, -14.5], [-12, -14.5], [12, 14.5], [20, 14.5], [-100, -14.5], [100, 14.5]];
  scooterSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 0.55, z, sx: 1.8, sy: 1.0, sz: 0.7, material: scooter });
  });

  // Plaza dressing — planters and a vending row
  addBlockingBox({ x: -22, y: 0.85, z: -38, sx: 8, sy: 1.6, sz: 1.6, material: sidewalk });
  addBlockingBox({ x: 22, y: 0.85, z: -38, sx: 8, sy: 1.6, sz: 1.6, material: sidewalk });
  addBlockingBox({ x: -22, y: 0.85, z: 38, sx: 8, sy: 1.6, sz: 1.6, material: sidewalk });
  addBlockingBox({ x: 22, y: 0.85, z: 38, sx: 8, sy: 1.6, sz: 1.6, material: sidewalk });
  addBlockingBox({ x: -28, y: 1.4, z: -52, sx: 1.4, sy: 2.6, sz: 1.2, material: vendor });
  addBlockingBox({ x: -26, y: 1.4, z: -52, sx: 1.4, sy: 2.6, sz: 1.2, material: vendor });
  addBlockingBox({ x: 26, y: 1.4, z: 52, sx: 1.4, sy: 2.6, sz: 1.2, material: vendor });
  addBlockingBox({ x: 28, y: 1.4, z: 52, sx: 1.4, sy: 2.6, sz: 1.2, material: vendor });

  // Power-line / overhead banner strung between corner towers
  addBlockingBox({ x: 0, y: 16, z: -94, sx: 220, sy: 0.25, sz: 0.25, material: lampMat });
  addBlockingBox({ x: 0, y: 16, z: 94, sx: 220, sy: 0.25, sz: 0.25, material: lampMat });
}

function buildFactoryArena() {
  // Big interior hall (260 x 210) with dense industrial cover: workbenches,
  // assembly stations, hydraulic presses, conveyors with crates, storage racks,
  // crate stacks, and steel pillars. Sized for the ~5m-tall mech.
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2d3540, roughness: 0.92 });
  const floorPaint = new THREE.MeshStandardMaterial({ color: 0x37424f, roughness: 0.85 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xeae66f, roughness: 0.7 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x6a7383, roughness: 0.7 });
  const wallTrim = new THREE.MeshStandardMaterial({ color: 0xa8aebd, roughness: 0.5, metalness: 0.45 });
  const beltSurface = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.95 });
  const beltFrame = new THREE.MeshStandardMaterial({ color: 0xd9a028, roughness: 0.6 });
  const roller = new THREE.MeshStandardMaterial({ color: 0xa8aebd, roughness: 0.45, metalness: 0.7 });
  const machine = new THREE.MeshStandardMaterial({ color: 0x2b3f5f, roughness: 0.55, metalness: 0.4 });
  const machineAlt = new THREE.MeshStandardMaterial({ color: 0x37547a, roughness: 0.55, metalness: 0.4 });
  const machineTop = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
  const pipe = new THREE.MeshStandardMaterial({ color: 0x9c6526, roughness: 0.55, metalness: 0.4 });
  const crate = new THREE.MeshStandardMaterial({ color: 0x7e5635, roughness: 0.85 });
  const crateAlt = new THREE.MeshStandardMaterial({ color: 0x614126, roughness: 0.9 });
  const beam = new THREE.MeshStandardMaterial({ color: 0x8b3a36, roughness: 0.5 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0xfff5d6, emissiveIntensity: 0.9, roughness: 0.3 });
  const rackFrame = new THREE.MeshStandardMaterial({ color: 0xc09030, roughness: 0.6 });
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x6a7383, roughness: 0.5, metalness: 0.55 });
  const cautionMat = new THREE.MeshStandardMaterial({ color: 0xe6a630, roughness: 0.7 });

  const HALF_X = 130;  // interior x range -130 .. 130
  const HALF_Z = 105;  // interior z range -105 .. 105
  const CEIL_Y = 22;

  // Concrete floor (covers the arena grid)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), concrete);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.005;
  scene.add(floor); arenaDecor.push(floor);

  // Painted walkway markings on the floor
  for (const z of [-42, 42]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(230, 5), floorPaint);
    w.rotation.x = -Math.PI / 2; w.position.set(0, 0.02, z);
    scene.add(w); arenaDecor.push(w);
    for (let x = -110; x <= 110; x += 5) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), stripe);
      dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.03, z);
      scene.add(dash); arenaDecor.push(dash);
    }
  }
  // Cross-axis painted lane at z=0 (visual variety)
  const crossLane = new THREE.Mesh(new THREE.PlaneGeometry(6, 200), floorPaint);
  crossLane.rotation.x = -Math.PI / 2; crossLane.position.set(0, 0.02, 0);
  scene.add(crossLane); arenaDecor.push(crossLane);

  // Outer factory hall walls (interior 260 x 210)
  addBlockingBox({ x: 0, y: CEIL_Y / 2, z: -(HALF_Z + 1), sx: 2 * HALF_X + 4, sy: CEIL_Y, sz: 2, material: wall });
  addBlockingBox({ x: 0, y: CEIL_Y / 2, z: HALF_Z + 1, sx: 2 * HALF_X + 4, sy: CEIL_Y, sz: 2, material: wall });
  addBlockingBox({ x: -(HALF_X + 1), y: CEIL_Y / 2, z: 0, sx: 2, sy: CEIL_Y, sz: 2 * HALF_Z + 4, material: wall });
  addBlockingBox({ x: HALF_X + 1, y: CEIL_Y / 2, z: 0, sx: 2, sy: CEIL_Y, sz: 2 * HALF_Z + 4, material: wall });
  // Wall base trim
  addBlockingBox({ x: 0, y: 0.4, z: -HALF_Z, sx: 2 * HALF_X, sy: 0.8, sz: 0.6, material: wallTrim });
  addBlockingBox({ x: 0, y: 0.4, z: HALF_Z, sx: 2 * HALF_X, sy: 0.8, sz: 0.6, material: wallTrim });

  // ===== Conveyor belts (idle, with crates riding on top) =====
  // topBuffer: 2 lets units jumping over the belt skip collision once they're well above
  // the top. The "transport to opposite side" issue from the inside-bbox edge case is
  // handled in resolveUnitObstacleCollisions — see the velocity-aware exit branch.
  const drawConveyor = (cx, len, beltZ) => {
    // Belt body — top at y ≈ 2.6
    addBlockingBox({ x: cx, y: 1.4, z: beltZ, sx: 4.0, sy: 2.4, sz: len, material: beltSurface, topBuffer: 2 });
    // Yellow safety frames along both sides
    addBlockingBox({ x: cx - 2.3, y: 1.5, z: beltZ, sx: 0.5, sy: 2.8, sz: len, material: beltFrame, topBuffer: 2 });
    addBlockingBox({ x: cx + 2.3, y: 1.5, z: beltZ, sx: 0.5, sy: 2.8, sz: len, material: beltFrame, topBuffer: 2 });
    // End rollers
    [-len / 2, len / 2].forEach((dz) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 5.0, 16), roller);
      c.rotation.z = Math.PI / 2;
      c.position.set(cx, 2.4, beltZ + dz);
      scene.add(c); arenaDecor.push(c);
    });
    // Crates riding on the belt (idle parts left on a stopped line) — solid cover
    const stride = 9;
    let alt = false;
    for (let lz = -len / 2 + 6; lz <= len / 2 - 6; lz += stride) {
      addBlockingBox({
        x: cx, y: 4.0, z: beltZ + lz, sx: 2.6, sy: 2.6, sz: 2.6,
        material: alt ? crate : crateAlt, topBuffer: 2
      });
      alt = !alt;
    }
  };
  drawConveyor(-25, 90, 0);
  drawConveyor(25, 90, 0);

  // ===== Industrial partition walls (full hiding cover, ~8m tall, taller than the unit) =====
  const drawPartition = (x, z, axis = 'x', length = 10) => {
    // Sheet-metal panel
    if (axis === 'x') {
      addBlockingBox({ x, y: 4.0, z, sx: length, sy: 8.0, sz: 0.6, material: machineAlt });
      // Vertical seams (panel divisions)
      for (const dx of [-length / 4, 0, length / 4]) {
        addBlockingBox({ x: x + dx, y: 4.0, z, sx: 0.12, sy: 7.8, sz: 0.7, material: beltFrame });
      }
      // Top trim
      addBlockingBox({ x, y: 8.15, z, sx: length + 0.2, sy: 0.3, sz: 0.8, material: beam });
      // Caution stripe at the base
      addBlockingBox({ x, y: 0.05, z, sx: length, sy: 0.06, sz: 1.0, material: cautionMat });
    } else {
      addBlockingBox({ x, y: 4.0, z, sx: 0.6, sy: 8.0, sz: length, material: machineAlt });
      for (const dz of [-length / 4, 0, length / 4]) {
        addBlockingBox({ x, y: 4.0, z: z + dz, sx: 0.7, sy: 7.8, sz: 0.12, material: beltFrame });
      }
      addBlockingBox({ x, y: 8.15, z, sx: 0.8, sy: 0.3, sz: length + 0.2, material: beam });
      addBlockingBox({ x, y: 0.05, z, sx: 1.0, sy: 0.06, sz: length, material: cautionMat });
    }
  };
  // Central horizontal partitions (in the gap between the two main conveyors)
  drawPartition(0, -30, 'x', 12);
  drawPartition(0, 30, 'x', 12);
  // Side partitions (between conveyors and side machinery)
  drawPartition(-60, -10, 'z', 10);
  drawPartition(60, 10, 'z', 10);
  // Outer partitions (between machinery and pillars)
  drawPartition(-30, -65, 'x', 10);
  drawPartition(30, 65, 'x', 10);
  drawPartition(-90, 60, 'z', 8);
  drawPartition(90, -60, 'z', 8);

  // ===== Workbenches (10 spots — bigger map, more cover) =====
  const drawWorkbench = (x, z) => {
    // 4 thick legs
    for (const ox of [-3.5, 3.5]) {
      for (const oz of [-2, 2]) {
        addBlockingBox({ x: x + ox, y: 1.6, z: z + oz, sx: 0.7, sy: 3.2, sz: 0.7, material: roller });
      }
    }
    // Tabletop (8m × 4.5m × 0.5m)
    addBlockingBox({ x, y: 3.4, z, sx: 8, sy: 0.5, sz: 4.5, material: machine });
    // Toolbox at one end
    addBlockingBox({ x: x - 2.6, y: 4.4, z, sx: 2.4, sy: 1.5, sz: 1.6, material: machineTop });
    // Vise / parts cluster at the other end
    addBlockingBox({ x: x + 2.4, y: 4.2, z: z + 1, sx: 1.4, sy: 1.0, sz: 1.4, material: stripe });
    addBlockingBox({ x: x + 2.6, y: 4.6, z: z - 1, sx: 1.0, sy: 1.6, sz: 1.0, material: roller });
    // Backsplash panel — the back of the bench rises to give full cover
    addBlockingBox({ x, y: 5.5, z: z + 2.4, sx: 7.5, sy: 3.6, sz: 0.4, material: machineTop });
  };
  const workbenches = [
    [-70, -75], [70, -75], [-70, 75], [70, 75],
    [-70, -25], [70, -25], [-70, 25], [70, 25]
  ];
  workbenches.forEach(([x, z]) => drawWorkbench(x, z));

  // ===== Hydraulic presses (NEW — heavy industrial cover) =====
  const drawPress = (x, z) => {
    // Base plinth
    addBlockingBox({ x, y: 1.0, z, sx: 5.0, sy: 2.0, sz: 4.0, material: machineTop });
    // Press frame uprights
    addBlockingBox({ x: x - 2.0, y: 5.0, z, sx: 0.8, sy: 8, sz: 4, material: machine });
    addBlockingBox({ x: x + 2.0, y: 5.0, z, sx: 0.8, sy: 8, sz: 4, material: machine });
    // Crossbeam
    addBlockingBox({ x, y: 8.5, z, sx: 5, sy: 1.4, sz: 4, material: machineAlt });
    // Hydraulic ram
    addBlockingBox({ x, y: 6.0, z, sx: 1.6, sy: 2.0, sz: 1.6, material: roller });
    // Caution stripe at the base
    addBlockingBox({ x, y: 0.05, z, sx: 6.6, sy: 0.06, sz: 5.6, material: cautionMat });
  };
  drawPress(-40, -75);
  drawPress(40, -75);
  drawPress(-40, 75);
  drawPress(40, 75);

  // ===== Tall storage tanks (NEW — round full-cover obstacles) =====
  const drawTank = (x, z) => {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 12, 18), tankMat);
    tank.position.set(x, 6, z);
    scene.add(tank); arenaDecor.push(tank);
    // Cap dome
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2.2, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), tankMat);
    cap.position.set(x, 12, z);
    scene.add(cap); arenaDecor.push(cap);
    // Caution band
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.6, 18), cautionMat);
    band.position.set(x, 2, z);
    scene.add(band); arenaDecor.push(band);
    arenaObstacles.push({
      minX: x - 2.2, maxX: x + 2.2,
      minZ: z - 2.2, maxZ: z + 2.2,
      minY: 0, maxY: 14
    });
  };
  drawTank(-110, -50);
  drawTank(-110, 0);
  drawTank(-110, 50);
  drawTank(110, -50);
  drawTank(110, 0);
  drawTank(110, 50);

  // ===== Storage racks along the long walls (8 racks) =====
  const drawRack = (x, z) => {
    addBlockingBox({ x: x - 2.5, y: 4.5, z, sx: 0.5, sy: 9.0, sz: 0.5, material: rackFrame });
    addBlockingBox({ x: x + 2.5, y: 4.5, z, sx: 0.5, sy: 9.0, sz: 0.5, material: rackFrame });
    addBlockingBox({ x, y: 9.0, z, sx: 5.4, sy: 0.4, sz: 1.8, material: rackFrame });
    addBlockingBox({ x, y: 6.0, z, sx: 5.4, sy: 0.4, sz: 1.8, material: rackFrame });
    addBlockingBox({ x, y: 3.0, z, sx: 5.4, sy: 0.4, sz: 1.8, material: rackFrame });
    addBlockingBox({ x: x - 1.5, y: 3.9, z, sx: 1.4, sy: 1.4, sz: 1.4, material: crate });
    addBlockingBox({ x: x + 1.5, y: 3.9, z, sx: 1.4, sy: 1.4, sz: 1.4, material: crateAlt });
    addBlockingBox({ x, y: 6.9, z, sx: 1.4, sy: 1.4, sz: 1.4, material: crate });
    addBlockingBox({ x: x + 1.5, y: 9.9, z, sx: 1.4, sy: 1.4, sz: 1.4, material: crateAlt });
  };
  // Along z=±100 walls
  for (const z of [-100, 100]) {
    for (const x of [-75, -25, 25, 75]) {
      drawRack(x, z);
    }
  }

  // ===== Steel I-beam pillars (8 pillars, structural cover) =====
  const pillarSpots = [
    [-50, -55], [50, -55], [-50, 55], [50, 55],
    [-100, -85], [100, -85], [-100, 85], [100, 85]
  ];
  pillarSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: CEIL_Y / 2, z, sx: 2.4, sy: CEIL_Y, sz: 2.4, material: beam });
    addBlockingBox({ x, y: 0.4, z, sx: 3.6, sy: 0.8, sz: 3.6, material: wallTrim });
  });

  // ===== Workstation machinery along the long walls (just inside the rack rows) =====
  const machineLine = (z) => {
    [[-115, 14], [-50, 12], [0, 16], [50, 12], [115, 14]].forEach(([x, w]) => {
      addBlockingBox({ x, y: 2.6, z, sx: w, sy: 5.2, sz: 5.5, material: machine });
      addBlockingBox({ x, y: 5.7, z, sx: w * 0.5, sy: 1.5, sz: 2.5, material: machineTop });
      addBlockingBox({ x, y: 7.0, z, sx: w * 0.25, sy: 1.0, sz: 1.0, material: stripe });
    });
  };
  machineLine(-90);
  machineLine(90);

  // ===== Crate stack clusters scattered as proper cover (3m cubes stacked) =====
  const crateClusters = [
    [-15, -15], [15, 15], [-30, 35], [30, -35],
    [0, -55], [0, 55], [-85, -55], [85, 55],
    [-30, -50], [30, 50]
  ];
  crateClusters.forEach(([x, z]) => {
    addBlockingBox({ x, y: 1.5, z, sx: 2.8, sy: 2.8, sz: 2.8, material: crate });
    addBlockingBox({ x: x + 2.9, y: 1.5, z, sx: 2.8, sy: 2.8, sz: 2.8, material: crateAlt });
    addBlockingBox({ x, y: 1.5, z: z + 2.9, sx: 2.8, sy: 2.8, sz: 2.8, material: crateAlt });
    addBlockingBox({ x: x + 2.9, y: 1.5, z: z + 2.9, sx: 2.8, sy: 2.8, sz: 2.8, material: crate });
    addBlockingBox({ x: x + 1.45, y: 4.4, z: z + 1.45, sx: 2.8, sy: 2.8, sz: 2.8, material: crate });
  });

  // ===== Tool carts (NEW — low cover scattered around) =====
  const drawCart = (x, z) => {
    addBlockingBox({ x, y: 0.4, z, sx: 2.4, sy: 0.8, sz: 1.4, material: machineTop });
    addBlockingBox({ x, y: 1.4, z, sx: 2.0, sy: 1.2, sz: 1.0, material: roller });
    addBlockingBox({ x, y: 2.3, z, sx: 1.4, sy: 0.6, sz: 0.8, material: stripe });
  };
  const cartSpots = [
    [-60, -45], [60, 45], [-90, 35], [90, -35],
    [-15, 50], [15, -50], [-45, -30], [45, 30]
  ];
  cartSpots.forEach(([x, z]) => drawCart(x, z));

  // ===== Overhead pipework (visual only) =====
  for (const z of [-65, -28, 28, 65]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 260, 12), pipe);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, 16, z);
    scene.add(p); arenaDecor.push(p);
  }
  for (const x of [-80, -30, 30, 80]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 210, 12), pipe);
    p.position.set(x, 16, 0);
    scene.add(p); arenaDecor.push(p);
  }

  // ===== Ceiling truss beams =====
  for (const x of [-110, -75, -40, -10, 20, 55, 90]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 210), beam);
    b.position.set(x, CEIL_Y - 3, 0);
    scene.add(b); arenaDecor.push(b);
  }

  // ===== Hanging shop lights =====
  for (const x of [-90, -45, 0, 45, 90]) {
    for (const z of [-65, 0, 65]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.4, 1.6), lightMat);
      l.position.set(x, CEIL_Y - 4.5, z);
      scene.add(l); arenaDecor.push(l);
    }
  }
}

function buildSquareArena() {
  // Daytime English-square vibe — gothic cathedral with green-roof spires, Big Ben-style
  // clock tower, tiered white-stone fountain, and cream tile plaza. Obstacles scaled so
  // benches, planters, and trees actually serve as cover for the mech's ~5m height.
  const grass = new THREE.MeshStandardMaterial({ color: 0x6ab442, roughness: 0.95 });
  const plazaTile = new THREE.MeshStandardMaterial({ color: 0xead7a8, roughness: 0.85 });
  const plazaTileAlt = new THREE.MeshStandardMaterial({ color: 0xc8a874, roughness: 0.85 });
  const path = new THREE.MeshStandardMaterial({ color: 0xb0a886, roughness: 0.8 });
  const whiteStone = new THREE.MeshStandardMaterial({ color: 0xeae5d8, roughness: 0.65 });
  const creamStone = new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.7 });
  const stoneAccent = new THREE.MeshStandardMaterial({ color: 0xb8b09a, roughness: 0.8 });
  const greenRoof = new THREE.MeshStandardMaterial({ color: 0x5e7e3a, roughness: 0.7 });
  const goldTrim = new THREE.MeshStandardMaterial({ color: 0xc4a440, roughness: 0.55, metalness: 0.45 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x6fb6e0, transparent: true, opacity: 0.85, roughness: 0.2,
    emissive: 0x356d92, emissiveIntensity: 0.2
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x6fa8c8, roughness: 0.3, metalness: 0.4,
    emissive: 0x213a48, emissiveIntensity: 0.25
  });
  const clockFace = new THREE.MeshStandardMaterial({
    color: 0xfff2d4, roughness: 0.4, emissive: 0x806c40, emissiveIntensity: 0.3
  });
  const clockHand = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
  const treeFoliage = new THREE.MeshStandardMaterial({ color: 0x4a8b3a, roughness: 0.95 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x4a341e, roughness: 0.9 });
  const lamppost = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.55, metalness: 0.5 });
  const lampGlow = new THREE.MeshStandardMaterial({
    color: 0xfff7d0, emissive: 0xfff7d0, emissiveIntensity: 0.95, roughness: 0.4
  });

  // Grass base
  const grassPlane = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), grass);
  grassPlane.rotation.x = -Math.PI / 2; grassPlane.position.y = 0.005;
  scene.add(grassPlane); arenaDecor.push(grassPlane);

  // Cream tile plaza — alternating tiles in a checkerboard for visual depth
  for (let x = -55; x < 55; x += 11) {
    for (let z = -55; z < 55; z += 11) {
      const useAlt = (Math.floor((x + 55) / 11) + Math.floor((z + 55) / 11)) % 2 === 0;
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), useAlt ? plazaTileAlt : plazaTile);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(x + 5.5, 0.01, z + 5.5);
      scene.add(tile); arenaDecor.push(tile);
    }
  }
  // Sand/gravel paths radiating outward
  for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(22, 80), path);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = ang;
    p.position.set(Math.cos(ang) * 70, 0.02, Math.sin(ang) * 70);
    scene.add(p); arenaDecor.push(p);
  }

  // ===== Multi-tier central fountain (white stone, ~14m wide base, 3 cascading tiers) =====
  // Tier 1 base
  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 1.6, 24), whiteStone);
  tier1.position.set(0, 0.8, 0);
  scene.add(tier1); arenaDecor.push(tier1);
  const tier1Lip = new THREE.Mesh(new THREE.CylinderGeometry(13.4, 13.4, 0.4, 24), stoneAccent);
  tier1Lip.position.set(0, 1.4, 0);
  scene.add(tier1Lip); arenaDecor.push(tier1Lip);
  const water1 = new THREE.Mesh(new THREE.CylinderGeometry(12.2, 12.2, 0.3, 24), waterMat);
  water1.position.set(0, 1.5, 0);
  scene.add(water1); arenaDecor.push(water1);
  // Tier 2 pillar + bowl
  const tier2Pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 2.6, 16), whiteStone);
  tier2Pillar.position.set(0, 2.9, 0);
  scene.add(tier2Pillar); arenaDecor.push(tier2Pillar);
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 4.2, 1.4, 24), whiteStone);
  tier2.position.set(0, 4.9, 0);
  scene.add(tier2); arenaDecor.push(tier2);
  const water2 = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.25, 24), waterMat);
  water2.position.set(0, 5.6, 0);
  scene.add(water2); arenaDecor.push(water2);
  // Tier 3 pillar + bowl
  const tier3Pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 2.0, 16), whiteStone);
  tier3Pillar.position.set(0, 6.7, 0);
  scene.add(tier3Pillar); arenaDecor.push(tier3Pillar);
  const tier3 = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 2.2, 0.9, 24), whiteStone);
  tier3.position.set(0, 8.2, 0);
  scene.add(tier3); arenaDecor.push(tier3);
  const water3 = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 24), waterMat);
  water3.position.set(0, 8.75, 0);
  scene.add(water3); arenaDecor.push(water3);
  // Top finial (gold)
  const spireBase = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 1.4, 16), whiteStone);
  spireBase.position.set(0, 9.4, 0);
  scene.add(spireBase); arenaDecor.push(spireBase);
  const spirePeak = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 12), goldTrim);
  spirePeak.position.set(0, 11.0, 0);
  scene.add(spirePeak); arenaDecor.push(spirePeak);

  // Fountain collision: cross of AABBs approximating the round base, plus a tall center column.
  // topBuffer: 2 on the base ring lets a unit clear the top when jumping over.
  // The "transport to opposite side" edge case is handled in resolveUnitObstacleCollisions.
  const fountainBaseAABB = (sx, sz) => ({
    minX: -sx / 2, maxX: sx / 2, minZ: -sz / 2, maxZ: sz / 2, minY: 0, maxY: 1.6, topBuffer: 2
  });
  // Tall invisible perimeter fences — block units (and their jumps) but let projectiles
  // through. Mech jump apex is ~5.6m, so a 14m wall is unjumpable.
  const FENCE_HALF = 13.0;
  const FENCE_T = 0.12;
  const FENCE_H = 14;
  const fenceWall = ({ minX, maxX, minZ, maxZ }) => ({
    minX, maxX, minZ, maxZ, minY: 0, maxY: FENCE_H, noProjectile: true
  });
  arenaObstacles.push(
    fountainBaseAABB(26, 14),
    fountainBaseAABB(14, 26),
    // Tall central column (the cascading bowls + spire)
    { minX: -3.4, maxX: 3.4, minZ: -3.4, maxZ: 3.4, minY: 1.6, maxY: 11.5 },
    // North fence
    fenceWall({ minX: -FENCE_HALF, maxX: FENCE_HALF, minZ: -FENCE_HALF - FENCE_T, maxZ: -FENCE_HALF }),
    // South fence
    fenceWall({ minX: -FENCE_HALF, maxX: FENCE_HALF, minZ: FENCE_HALF, maxZ: FENCE_HALF + FENCE_T }),
    // East fence
    fenceWall({ minX: FENCE_HALF, maxX: FENCE_HALF + FENCE_T, minZ: -FENCE_HALF - FENCE_T, maxZ: FENCE_HALF + FENCE_T }),
    // West fence
    fenceWall({ minX: -FENCE_HALF - FENCE_T, maxX: -FENCE_HALF, minZ: -FENCE_HALF - FENCE_T, maxZ: FENCE_HALF + FENCE_T })
  );
  // Decorative low steps around the fountain base
  for (let i = 0; i < 3; i += 1) {
    const r = 13 + 1.4 + i * 1.1;
    const step = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.2, 32), whiteStone);
    step.position.set(0, 0.1 + i * 0.08, 0);
    scene.add(step); arenaDecor.push(step);
  }

  // ===== Gothic Cathedral on south side (multiple spires, green roofs) =====
  const cathX = 0;
  const cathZ = -78;
  // Main body (60m wide × 30m tall × 22m deep)
  addBlockingBox({ x: cathX, y: 15, z: cathZ, sx: 60, sy: 30, sz: 22, material: whiteStone });
  // Base trim
  addBlockingBox({ x: cathX, y: 1.0, z: cathZ, sx: 62, sy: 2.0, sz: 24, material: stoneAccent });
  // Buttresses (column ribs sticking out the front of the cathedral)
  for (let bx = -25; bx <= 25; bx += 8) {
    addBlockingBox({ x: cathX + bx, y: 13, z: cathZ + 11.5, sx: 1.8, sy: 26, sz: 2.5, material: whiteStone });
  }
  // Tall pointed gothic windows along the front
  for (let bx = -20; bx <= 20; bx += 8) {
    const gw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 12, 0.4), windowMat);
    gw.position.set(cathX + bx, 14, cathZ + 11.05);
    scene.add(gw); arenaDecor.push(gw);
    // Pointed arch top
    const arch = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.0, 8), windowMat);
    arch.position.set(cathX + bx, 21, cathZ + 11.05);
    scene.add(arch); arenaDecor.push(arch);
  }
  // Side gothic spires (4 small + 1 tall central)
  const sideSpires = [-22, -8, 8, 22];
  sideSpires.forEach((bx, i) => {
    const spireH = i % 2 === 0 ? 14 : 18;
    addBlockingBox({ x: cathX + bx, y: 30 + spireH / 2, z: cathZ + 4, sx: 3.2, sy: spireH, sz: 3.2, material: whiteStone });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, spireH * 0.55, 8), greenRoof);
    cone.position.set(cathX + bx, 30 + spireH + spireH * 0.275, cathZ + 4);
    scene.add(cone); arenaDecor.push(cone);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.3, 8), goldTrim);
    tip.position.set(cathX + bx, 30 + spireH + spireH * 0.55 + 0.65, cathZ + 4);
    scene.add(tip); arenaDecor.push(tip);
  });
  // Central larger spire over the apse
  const mainSpireH = 24;
  addBlockingBox({ x: cathX, y: 30 + mainSpireH / 2, z: cathZ - 4, sx: 5, sy: mainSpireH, sz: 5, material: whiteStone });
  const mainCone = new THREE.Mesh(new THREE.ConeGeometry(3.6, 14, 8), greenRoof);
  mainCone.position.set(cathX, 30 + mainSpireH + 7, cathZ - 4);
  scene.add(mainCone); arenaDecor.push(mainCone);
  const mainTip = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.2, 8), goldTrim);
  mainTip.position.set(cathX, 30 + mainSpireH + 15, cathZ - 4);
  scene.add(mainTip); arenaDecor.push(mainTip);

  // ===== Big Ben-style clock tower on east side =====
  const towerX = 92;
  const towerZ = 28;
  // Stacked tower body
  addBlockingBox({ x: towerX, y: 14, z: towerZ, sx: 13, sy: 28, sz: 13, material: creamStone });
  // Mid trim
  addBlockingBox({ x: towerX, y: 28.5, z: towerZ, sx: 14, sy: 1.2, sz: 14, material: stoneAccent });
  // Clock section (slightly inset)
  addBlockingBox({ x: towerX, y: 36, z: towerZ, sx: 11, sy: 14, sz: 11, material: whiteStone });
  // Clock faces on all four sides
  const clockY = 36;
  // West (facing plaza)
  const cfW = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.4, 24), clockFace);
  cfW.rotation.z = Math.PI / 2;
  cfW.position.set(towerX - 5.7, clockY, towerZ);
  scene.add(cfW); arenaDecor.push(cfW);
  // Hour hand
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.18), clockHand);
  hourHand.position.set(towerX - 5.85, clockY + 0.6, towerZ);
  scene.add(hourHand); arenaDecor.push(hourHand);
  // Minute hand
  const minuteHand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), clockHand);
  minuteHand.rotation.x = Math.PI / 5;
  minuteHand.position.set(towerX - 5.85, clockY - 0.4, towerZ + 0.7);
  scene.add(minuteHand); arenaDecor.push(minuteHand);
  // North & South clock faces
  for (const sz of [-1, 1]) {
    const cf = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.4, 24), clockFace);
    cf.rotation.x = Math.PI / 2;
    cf.position.set(towerX, clockY, towerZ + sz * 5.7);
    scene.add(cf); arenaDecor.push(cf);
  }
  // Top trim and green pyramid roof
  addBlockingBox({ x: towerX, y: 44, z: towerZ, sx: 12, sy: 1.0, sz: 12, material: stoneAccent });
  const pyramid = new THREE.Mesh(new THREE.ConeGeometry(8, 13, 4), greenRoof);
  pyramid.rotation.y = Math.PI / 4;
  pyramid.position.set(towerX, 51, towerZ);
  scene.add(pyramid); arenaDecor.push(pyramid);
  const towerTip = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.6, 8), goldTrim);
  towerTip.position.set(towerX, 58.8, towerZ);
  scene.add(towerTip); arenaDecor.push(towerTip);

  // ===== Other classical buildings around the plaza =====
  const drawClassicalBuilding = (cx, cz, sx, sz, h, opts = {}) => {
    addBlockingBox({ x: cx, y: h / 2, z: cz, sx, sy: h, sz, material: opts.alt ? creamStone : whiteStone });
    addBlockingBox({ x: cx, y: 0.7, z: cz, sx: sx + 0.5, sy: 1.4, sz: sz + 0.5, material: stoneAccent });
    // Green peaked roof
    const r = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.6, 2.6, sz + 0.6), greenRoof);
    r.position.set(cx, h + 1.3, cz);
    scene.add(r); arenaDecor.push(r);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(sx, 1.6, 1.4), greenRoof);
    ridge.position.set(cx, h + 3.0, cz);
    scene.add(ridge); arenaDecor.push(ridge);
    // Tall arched windows on the facade
    const facadeZ = opts.facadeFront ? cz + sz / 2 + 0.06 : cz - sz / 2 - 0.06;
    const xOffsets = [-0.36, -0.12, 0.12, 0.36];
    for (const wx of xOffsets) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, h * 0.42, 0.2), windowMat);
      w.position.set(cx + wx * sx, h * 0.55, facadeZ);
      scene.add(w); arenaDecor.push(w);
      // Pointed gothic arch above
      const arch = new THREE.Mesh(new THREE.ConeGeometry(1.3, 1.6, 8), windowMat);
      arch.position.set(cx + wx * sx, h * 0.55 + h * 0.21 + 0.5, facadeZ);
      scene.add(arch); arenaDecor.push(arch);
    }
  };
  // North-side classical buildings (facade faces -Z)
  drawClassicalBuilding(-60, 78, 36, 18, 22, { facadeFront: false });
  drawClassicalBuilding(60, 78, 36, 18, 22, { facadeFront: false, alt: true });
  // West-side row (next to clock tower)
  drawClassicalBuilding(-92, -10, 18, 38, 20, { facadeFront: true });
  drawClassicalBuilding(-92, 42, 18, 22, 18, { facadeFront: true, alt: true });

  // ===== Lampposts ringing the fountain plaza =====
  const lampSpots = [[-30, -30], [30, -30], [-30, 30], [30, 30], [-50, 0], [50, 0], [0, -50], [0, 50]];
  lampSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 4.5, z, sx: 0.45, sy: 9.0, sz: 0.45, material: lamppost });
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 1.0), lampGlow);
    head.position.set(x, 9.4, z);
    scene.add(head); arenaDecor.push(head);
  });

  // ===== Stone planters with shrubs (bigger so they break sightlines) =====
  const planterSpots = [[-44, -44], [44, -44], [-44, 44], [44, 44]];
  planterSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 1.0, z, sx: 3.2, sy: 2.0, sz: 3.2, material: stoneAccent });
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 14), treeFoliage);
    leaves.position.set(x, 3.6, z);
    scene.add(leaves); arenaDecor.push(leaves);
  });

  // ===== Trees on grass borders (large enough to actually hide a mech) =====
  const treeSpots = [[-95, -55], [-95, 90], [95, -55], [95, 90], [-50, 95], [50, 95]];
  treeSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 4, z, sx: 1.6, sy: 8, sz: 1.6, material: trunk });
    const crown = new THREE.Mesh(new THREE.SphereGeometry(4.6, 16, 16), treeFoliage);
    crown.position.set(x, 10, z);
    scene.add(crown); arenaDecor.push(crown);
  });

  // ===== Outer boundary walls (low cream-stone garden walls) =====
  addBlockingBox({ x: 0, y: 4, z: -110, sx: 240, sy: 8, sz: 4, material: creamStone });
  addBlockingBox({ x: 0, y: 4, z: 110, sx: 240, sy: 8, sz: 4, material: creamStone });
  addBlockingBox({ x: -120, y: 4, z: 0, sx: 4, sy: 8, sz: 240, material: creamStone });
  addBlockingBox({ x: 120, y: 4, z: 0, sx: 4, sy: 8, sz: 240, material: creamStone });
}

function buildLobbyArena() {
  // Sleek sci-fi lobby — white/silver marble + bright blue accent lighting,
  // glass back wall facing the night city, sleek angular benches with blue cushions,
  // tall structural pillars with glow rings.
  // Layout: full-width slope (no side gaps to sneak under the deck) merging into a
  // full-width mezzanine that reaches all four walls (no falling off the edges).
  const marble = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 0.3, metalness: 0.2 });
  const marbleDark = new THREE.MeshStandardMaterial({ color: 0x252830, roughness: 0.45, metalness: 0.15 });
  const marbleStair = new THREE.MeshStandardMaterial({ color: 0xd4d8e0, roughness: 0.35, metalness: 0.2 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xf4f5f7, roughness: 0.5 });
  const sideWall = new THREE.MeshStandardMaterial({ color: 0xc4cbd6, roughness: 0.4, metalness: 0.3 });
  const wallAccent = new THREE.MeshStandardMaterial({
    color: 0x3da0ff, roughness: 0.35, metalness: 0.4,
    emissive: 0x125a99, emissiveIntensity: 0.55
  });
  const blueGlow = new THREE.MeshStandardMaterial({
    color: 0x68c0ff, emissive: 0x68c0ff, emissiveIntensity: 0.95, roughness: 0.3
  });
  const benchBase = new THREE.MeshStandardMaterial({ color: 0xe6eaf0, roughness: 0.4, metalness: 0.15 });
  const benchSeat = new THREE.MeshStandardMaterial({ color: 0xdce0e6, roughness: 0.5 });
  const cushion = new THREE.MeshStandardMaterial({
    color: 0x4280ff, roughness: 0.7, emissive: 0x0d2a66, emissiveIntensity: 0.18
  });
  const railGlass = new THREE.MeshStandardMaterial({
    color: 0x9bc7e8, transparent: true, opacity: 0.32, roughness: 0.1
  });
  const desk = new THREE.MeshStandardMaterial({ color: 0xeaedf0, roughness: 0.4, metalness: 0.2 });
  const deskTop = new THREE.MeshStandardMaterial({ color: 0x252830, roughness: 0.4, metalness: 0.2 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xeef0f4, roughness: 0.35, metalness: 0.25 });
  const ceilingLight = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.3
  });
  const glassWall = new THREE.MeshStandardMaterial({
    color: 0x1a2640, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.5
  });
  const treeFoliage = new THREE.MeshStandardMaterial({ color: 0x4a8b3a, roughness: 0.95 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0xeaedf0, roughness: 0.5, metalness: 0.2 });
  const grassDecor = new THREE.MeshStandardMaterial({ color: 0x6ab442, roughness: 0.95 });
  const decorMat = new THREE.MeshStandardMaterial({ color: 0x1a3460, roughness: 0.5 });

  const HALF_X = 108;             // mezzanine + slope half-width (touches the side walls)
  const UPPER_Y = 5;
  const UPPER_MIN_Z = -98;        // back edge of mezzanine touches the back wall
  const UPPER_MAX_Z = -5;
  const SLOPE_MIN_Z = -5;
  const SLOPE_MAX_Z = 12;

  // Polished marble floor (covers the arena grid)
  const baseFloor = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), marble);
  baseFloor.rotation.x = -Math.PI / 2; baseFloor.position.y = 0.005;
  scene.add(baseFloor); arenaDecor.push(baseFloor);

  // Dark marble inset rectangle in front of the stairs (entrance runway)
  const inset = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), marbleDark);
  inset.rotation.x = -Math.PI / 2; inset.position.set(0, 0.012, 38);
  scene.add(inset); arenaDecor.push(inset);
  // Blue-glow runway strips pointing at the stairs
  for (const x of [-22, -8, 8, 22]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 30), blueGlow);
    strip.rotation.x = -Math.PI / 2; strip.position.set(x, 0.013, 38);
    scene.add(strip); arenaDecor.push(strip);
  }

  // ===== Outer walls (lobby interior 220 x 200) =====
  addBlockingBox({ x: 0, y: 12, z: -100, sx: 220, sy: 24, sz: 4, material: wall });
  addBlockingBox({ x: 0, y: 12, z: 100, sx: 220, sy: 24, sz: 4, material: wall });
  addBlockingBox({ x: -110, y: 12, z: 0, sx: 4, sy: 24, sz: 200, material: wall });
  addBlockingBox({ x: 110, y: 12, z: 0, sx: 4, sy: 24, sz: 200, material: wall });

  // ===== Glass back wall facing the night city skyline =====
  // Positioned just in front of the back wall, above the mezzanine deck (mezzanine extends to z=-98).
  const glassPanel = new THREE.Mesh(new THREE.BoxGeometry(180, 16, 0.3), glassWall);
  glassPanel.position.set(0, 14, -97.6);
  scene.add(glassPanel); arenaDecor.push(glassPanel);
  // Vertical mullions on the glass
  for (let mx = -80; mx <= 80; mx += 13) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 16, 0.5), sideWall);
    mullion.position.set(mx, 14, -97.4);
    scene.add(mullion); arenaDecor.push(mullion);
  }
  // Bright blue header bar above the glass wall
  addBlockingBox({ x: 0, y: 22.4, z: -97.6, sx: 182, sy: 0.8, sz: 0.4, material: blueGlow });
  // Lower glow line at the top of the mezzanine deck
  addBlockingBox({ x: 0, y: UPPER_Y + 0.6, z: -97.6, sx: 182, sy: 0.4, sz: 0.4, material: blueGlow });

  // Side wall logo accents (vertical glow strips + Millennium-style panels)
  for (const sxn of [-1, 1]) {
    addBlockingBox({ x: sxn * 107.6, y: 14, z: 0, sx: 0.5, sy: 8, sz: 60, material: wallAccent });
    // Glow line accent along its length
    addBlockingBox({ x: sxn * 107.4, y: 14, z: 0, sx: 0.4, sy: 0.4, sz: 64, material: blueGlow });
    // Logo panels along the wall (lower floor side only — z>0)
    for (let i = 0; i < 3; i += 1) {
      const z = 30 - i * 28;
      const lblock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 7), wallAccent);
      lblock.position.set(sxn * 107.2, 9, z);
      scene.add(lblock); arenaDecor.push(lblock);
    }
  }

  // ===== Mezzanine (full width, reaches the back & side walls) =====
  addPlatform({
    minX: -HALF_X, maxX: HALF_X,
    minZ: UPPER_MIN_Z, maxZ: UPPER_MAX_Z,
    top: UPPER_Y, thickness: 0.8, material: marble
  });
  // No front edge strip needed at the slope-mezzanine boundary — they merge seamlessly.

  // Support pillars under the mezzanine deck — purely visual now (no unit can reach them
  // since the slope and mezzanine cover the whole hall floor at z<12). Skip collision data.
  const supportSpots = [[-80, -75], [80, -75], [-80, -45], [80, -45], [-30, -75], [30, -75], [-30, -25], [30, -25]];
  supportSpots.forEach(([x, z]) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, UPPER_Y, 18), pillarMat);
    col.position.set(x, UPPER_Y / 2, z);
    scene.add(col); arenaDecor.push(col);
  });

  // ===== Big slope (full width — extends to both side walls) =====
  addRamp({
    minX: -HALF_X, maxX: HALF_X,
    minZ: SLOPE_MIN_Z, maxZ: SLOPE_MAX_Z,
    axis: 'z', lowY: UPPER_Y, highY: 0,
    material: marbleStair, thickness: 0.6
  });
  // Stepped front trim across the slope (escalator-feel)
  for (let i = 0; i < 9; i += 1) {
    const t = (i + 0.5) / 9;
    const z = THREE.MathUtils.lerp(SLOPE_MAX_Z, SLOPE_MIN_Z, t);
    const y = THREE.MathUtils.lerp(0.05, UPPER_Y - 0.15, t);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF_X + 0.4, 0.16, 0.3), marbleDark);
    trim.position.set(0, y, z);
    scene.add(trim); arenaDecor.push(trim);
  }
  // Blue accent lane markers tilted to follow the slope
  const slopeLen = SLOPE_MAX_Z - SLOPE_MIN_Z;
  const slopeAngle = Math.atan2(UPPER_Y, slopeLen);
  for (const sx of [-80, -40, 0, 40, 80]) {
    const accentBar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, slopeLen / Math.cos(slopeAngle)), blueGlow);
    accentBar.position.set(sx, UPPER_Y / 2 + 0.05, (SLOPE_MIN_Z + SLOPE_MAX_Z) / 2);
    accentBar.rotation.x = slopeAngle;
    scene.add(accentBar); arenaDecor.push(accentBar);
  }

  // ===== Reception desks on the lower floor (taller, proper cover) =====
  const drawDesk = (cx, cz) => {
    addBlockingBox({ x: cx, y: 1.5, z: cz, sx: 14, sy: 3.0, sz: 3.2, material: desk });
    addBlockingBox({ x: cx, y: 3.1, z: cz, sx: 14.4, sy: 0.3, sz: 3.4, material: deskTop });
    addBlockingBox({ x: cx, y: 4.4, z: cz - 1.4, sx: 14, sy: 2.0, sz: 0.4, material: deskTop });
    addBlockingBox({ x: cx, y: 5.3, z: cz - 1.4, sx: 12, sy: 0.2, sz: 0.5, material: blueGlow });
  };
  drawDesk(-60, 55);
  drawDesk(60, 55);

  // ===== Sleek angular benches with blue cushions (much bigger, proper cover ~5m total) =====
  const drawSciFiBench = (x, baseY, z, sofa = false) => {
    const w = sofa ? 9 : 6;
    // Angular base (white shell)
    addBlockingBox({ x, y: baseY + 0.9, z, sx: w, sy: 1.8, sz: 3.0, material: benchBase });
    // Seat slab on top
    addBlockingBox({ x, y: baseY + 1.95, z, sx: w + 0.5, sy: 0.3, sz: 3.2, material: benchSeat });
    // Blue cushion
    addBlockingBox({ x, y: baseY + 2.45, z, sx: w * 0.85, sy: 0.6, sz: 2.4, material: cushion });
    // Backrest
    addBlockingBox({ x, y: baseY + 3.6, z: z + 1.4, sx: w, sy: 2.9, sz: 0.5, material: benchSeat });
    // Backrest blue accent line
    addBlockingBox({ x, y: baseY + 4.95, z: z + 1.6, sx: w * 0.92, sy: 0.2, sz: 0.3, material: blueGlow });
  };
  // Lower-floor benches (z=12..98 walkable area)
  drawSciFiBench(-78, 0, 82, true);
  drawSciFiBench(-50, 0, 82, false);
  drawSciFiBench(78, 0, 82, true);
  drawSciFiBench(50, 0, 82, false);
  drawSciFiBench(-25, 0, 86, false);
  drawSciFiBench(25, 0, 86, false);
  drawSciFiBench(-78, 0, 25, true);
  drawSciFiBench(78, 0, 25, true);
  drawSciFiBench(-30, 0, 32, false);
  drawSciFiBench(30, 0, 32, false);

  // Coffee tables paired with seating (taller now)
  const coffeeTables = [[-60, 70], [60, 70], [0, 78]];
  coffeeTables.forEach(([x, z]) => {
    addBlockingBox({ x, y: 0.7, z, sx: 4.0, sy: 1.4, sz: 2.6, material: deskTop });
    addBlockingBox({ x, y: 1.45, z, sx: 4.2, sy: 0.18, sz: 2.8, material: railGlass });
  });

  // ===== Big indoor topiary plants (full cover ~5m wide × ~9m tall) =====
  // Replaces the earlier kiosk/pod silhouette. A wide stone planter at the base plus
  // a bushy foliage column that fully hides the ~5m mech behind it. The foliage AABB
  // matches the dense visible mass; sphere clusters break up the silhouette so it
  // reads as an organic plant.
  const drawHoloKiosk = (x, baseY, z /* axis ignored — plants are radially symmetric */) => {
    const potW = 5.2;
    const potH = 2.5;
    // Wide stone pot — solid cover for the lower body
    addBlockingBox({ x, y: baseY + potH / 2, z, sx: potW, sy: potH, sz: potW, material: pillarMat });
    // Pot rim (decor)
    addBlockingBox({ x, y: baseY + potH + 0.18, z, sx: potW + 0.5, sy: 0.36, sz: potW + 0.5, material: marbleDark, decorOnly: true });
    // Blue glow accent ring on the rim (sci-fi lobby touch)
    addBlockingBox({ x, y: baseY + potH + 0.42, z, sx: potW + 0.42, sy: 0.14, sz: potW + 0.42, material: blueGlow, decorOnly: true });
    // Soil / mulch layer (decor)
    addBlockingBox({ x, y: baseY + potH + 0.05, z, sx: potW * 0.86, sy: 0.1, sz: potW * 0.86, material: trunkMat, decorOnly: true });

    // Bush body — collision AABB providing upper-body cover, hidden inside the foliage spheres
    const bushBaseY = baseY + potH + 0.4;
    const bushW = 4.6;
    const bushH = 5.4;
    addBlockingBox({ x, y: bushBaseY + bushH / 2, z, sx: bushW, sy: bushH, sz: bushW, material: treeFoliage });

    // Stacked column of overlapping spheres along the central axis to hide the box edges
    const stack = [
      { dy: bushBaseY + 1.0, r: 3.0 },
      { dy: bushBaseY + 2.6, r: 2.8 },
      { dy: bushBaseY + 4.0, r: 2.5 },
      { dy: bushBaseY + 5.2, r: 2.0 }
    ];
    stack.forEach(({ dy, r }) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), treeFoliage);
      ball.position.set(x, dy, z);
      scene.add(ball); arenaDecor.push(ball);
    });
    // Off-axis offshoots for an asymmetric, more natural silhouette
    const offshoots = [
      { dx: 1.6, dz: 1.3, dy: bushBaseY + 1.6, r: 2.0 },
      { dx: -1.7, dz: -1.0, dy: bushBaseY + 2.2, r: 2.1 },
      { dx: 1.4, dz: -1.5, dy: bushBaseY + 3.4, r: 1.8 },
      { dx: -1.5, dz: 1.4, dy: bushBaseY + 3.9, r: 1.8 },
      { dx: 0.6, dz: 1.6, dy: bushBaseY + 4.7, r: 1.4 }
    ];
    offshoots.forEach(({ dx, dy, dz, r }) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), treeFoliage);
      ball.position.set(x + dx, dy, z + dz);
      scene.add(ball); arenaDecor.push(ball);
    });
    // Crowning tuft at the very top
    const top = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), treeFoliage);
    top.position.set(x, bushBaseY + bushH + 0.2, z);
    scene.add(top); arenaDecor.push(top);
  };

  // ===== Cube sculptures (full cover, ~8m tall stacked geometric forms) =====
  const drawCubeSculpture = (x, baseY, z) => {
    addBlockingBox({ x, y: baseY + 0.4, z, sx: 5.5, sy: 0.8, sz: 5.5, material: marbleDark });
    addBlockingBox({ x, y: baseY + 3.0, z, sx: 4.5, sy: 4.4, sz: 4.5, material: pillarMat });
    addBlockingBox({ x: x + 1.0, y: baseY + 6.5, z: z - 1.0, sx: 3.5, sy: 3.0, sz: 3.5, material: benchBase });
    addBlockingBox({ x, y: baseY + 8.4, z, sx: 2.6, sy: 0.2, sz: 2.6, material: blueGlow });
  };

  // ===== Big planter boxes with tall conifers (~9m total, full cover) =====
  const drawBigPlanter = (x, baseY, z) => {
    addBlockingBox({ x, y: baseY + 1.4, z, sx: 4.4, sy: 2.8, sz: 4.4, material: pillarMat });
    addBlockingBox({ x, y: baseY + 2.85, z, sx: 4.4, sy: 0.1, sz: 4.4, material: grassDecor });
    addBlockingBox({ x, y: baseY + 5.5, z, sx: 0.9, sy: 5.0, sz: 0.9, material: trunkMat });
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(3.0, 6.5, 16), treeFoliage);
    leaves.position.set(x, baseY + 8.7, z);
    scene.add(leaves); arenaDecor.push(leaves);
    // Decorative blue rim on the planter
    addBlockingBox({ x, y: baseY + 2.95, z, sx: 4.5, sy: 0.15, sz: 4.5, material: blueGlow });
  };

  // Lower-floor cover (entrance lounge area)
  drawHoloKiosk(0, 0, 42, 'x');
  drawHoloKiosk(-30, 0, 60, 'z');
  drawHoloKiosk(30, 0, 60, 'z');
  drawHoloKiosk(-15, 0, 88, 'x');
  drawHoloKiosk(15, 0, 88, 'x');
  drawCubeSculpture(-50, 0, 88);
  drawCubeSculpture(50, 0, 88);
  drawBigPlanter(-90, 0, 65);
  drawBigPlanter(90, 0, 65);

  // Mezzanine cover
  drawHoloKiosk(0, UPPER_Y, -30, 'x');
  drawCubeSculpture(-40, UPPER_Y, -78);
  drawCubeSculpture(40, UPPER_Y, -78);
  drawBigPlanter(-90, UPPER_Y, -45);
  drawBigPlanter(90, UPPER_Y, -45);

  // ===== Tall lobby pillars (full ceiling height, much thicker for cover) =====
  const tallPillars = [[-65, 65], [65, 65], [-30, 30], [30, 30], [-65, 25], [65, 25]];
  const PILLAR_R = 3.2;
  tallPillars.forEach(([x, z]) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R, PILLAR_R, 24, 24), pillarMat);
    col.position.set(x, 12, z);
    scene.add(col); arenaDecor.push(col);
    arenaObstacles.push({
      minX: x - PILLAR_R, maxX: x + PILLAR_R,
      minZ: z - PILLAR_R, maxZ: z + PILLAR_R,
      minY: 0, maxY: 24
    });
    // Base ring
    const baseTrim = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R + 0.5, PILLAR_R + 0.5, 0.5, 24), marbleDark);
    baseTrim.position.set(x, 0.25, z);
    scene.add(baseTrim); arenaDecor.push(baseTrim);
    // Blue glow accent ring at the base
    const accentRing = new THREE.Mesh(new THREE.CylinderGeometry(PILLAR_R + 0.2, PILLAR_R + 0.2, 0.3, 24), blueGlow);
    accentRing.position.set(x, 0.85, z);
    scene.add(accentRing); arenaDecor.push(accentRing);
  });

  // ===== Decorative indoor trees in planters =====
  const drawIndoorTree = (x, baseY, z) => {
    addBlockingBox({ x, y: baseY + 1.2, z, sx: 2.6, sy: 2.4, sz: 2.6, material: pillarMat });
    addBlockingBox({ x, y: baseY + 2.45, z, sx: 2.6, sy: 0.1, sz: 2.6, material: grassDecor });
    addBlockingBox({ x, y: baseY + 4.6, z, sx: 0.6, sy: 4.0, sz: 0.6, material: trunkMat });
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5.5, 14), treeFoliage);
    leaves.position.set(x, baseY + 8.4, z);
    scene.add(leaves); arenaDecor.push(leaves);
  };
  const lowerTrees = [[-95, 80], [95, 80], [-95, 55], [95, 55], [-95, 30], [95, 30]];
  lowerTrees.forEach(([x, z]) => drawIndoorTree(x, 0, z));

  // ===== Mezzanine furniture =====
  // Lounge benches on the mezzanine
  const mezzBenches = [[-50, -55], [50, -55], [-25, -80], [25, -80]];
  mezzBenches.forEach(([x, z]) => drawSciFiBench(x, UPPER_Y, z));

  // Mezzanine planters along the walls
  const mezzTrees = [[-95, -60], [95, -60], [-95, -25], [95, -25]];
  mezzTrees.forEach(([x, z]) => drawIndoorTree(x, UPPER_Y, z));

  // Mezzanine sculpture centerpiece — clean dark plinth, no orb
  addBlockingBox({ x: 0, y: UPPER_Y + 1.8, z: -55, sx: 5, sy: 3.6, sz: 5, material: decorMat });
  addBlockingBox({ x: 0, y: UPPER_Y + 3.8, z: -55, sx: 4, sy: 0.5, sz: 4, material: deskTop });
  addBlockingBox({ x: 0, y: UPPER_Y + 4.3, z: -55, sx: 2.4, sy: 0.6, sz: 2.4, material: wallAccent });
  // Blue glow ring around the sculpture base
  const sculpRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.18, 12, 36), blueGlow);
  sculpRing.rotation.x = Math.PI / 2;
  sculpRing.position.set(0, UPPER_Y + 0.15, -55);
  scene.add(sculpRing); arenaDecor.push(sculpRing);

  // ===== Ceiling lights and beams =====
  for (const x of [-80, -40, 0, 40, 80]) {
    for (const z of [-80, -40, 0, 40, 80]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(4, 0.18, 4), ceilingLight);
      light.position.set(x, 23.6, z);
      scene.add(light); arenaDecor.push(light);
    }
  }
  for (const z of [-80, -40, 0, 40, 80]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(220, 0.4, 1.2), wall);
    b.position.set(0, 23.8, z);
    scene.add(b); arenaDecor.push(b);
  }
  // Long blue accent strips along the ceiling
  for (const z of [-60, -20, 20, 60]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(220, 0.1, 0.3), blueGlow);
    strip.position.set(0, 23.5, z);
    scene.add(strip); arenaDecor.push(strip);
  }
}

function createArenaWalls() {
  const WALL_HEIGHT = 16;
  const HALF = 138;
  const THICKNESS = 2;
  const walls = [
    { x: HALF, z: 0, sx: THICKNESS, sz: HALF },
    { x: -HALF, z: 0, sx: THICKNESS, sz: HALF },
    { x: 0, z: HALF, sx: HALF, sz: THICKNESS },
    { x: 0, z: -HALF, sx: HALF, sz: THICKNESS }
  ];
  walls.forEach((wall) => {
    const wallBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(wall.sx, WALL_HEIGHT, wall.sz))
    });
    wallBody.position.set(wall.x, WALL_HEIGHT, wall.z);
    world.addBody(wallBody);
  });
}

function wrapAngle(angle) {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function unitOverlapsObstacle(x, y, z, radius = 1.15) {
  for (const o of arenaObstacles) {
    const topBuffer = o.topBuffer ?? 4;
    if (y < o.minY - 2 || y > o.maxY + topBuffer) continue;
    const nearestX = Math.max(o.minX, Math.min(x, o.maxX));
    const nearestZ = Math.max(o.minZ, Math.min(z, o.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

function resolveUnitObstacleCollisions(mech, prevPos) {
  const radius = 1.15;
  const pos = mech.body.position;
  for (const o of arenaObstacles) {
    const topBuffer = o.topBuffer ?? 4;
    if (pos.y < o.minY - 2 || pos.y > o.maxY + topBuffer) continue;
    const nearestX = Math.max(o.minX, Math.min(pos.x, o.maxX));
    const nearestZ = Math.max(o.minZ, Math.min(pos.z, o.maxZ));
    const dx = pos.x - nearestX;
    const dz = pos.z - nearestZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    const d = Math.sqrt(d2);
    if (d > 0.0001) {
      // Standard side-overlap: push out toward the nearest exterior edge.
      const push = radius - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    } else {
      // Unit ended up fully inside the AABB (tunneling, spawn, etc.). Picking the
      // axis-nearest edge can teleport them to the wrong side, which feels like
      // being "pushed to the other side" of the obstacle. Prefer reverting to the
      // previous (known-outside) position; if that's also inside, bail out by exiting
      // along the axis the unit penetrated least.
      const prevOutside = prevPos
        && (prevPos.x < o.minX - radius || prevPos.x > o.maxX + radius
          || prevPos.z < o.minZ - radius || prevPos.z > o.maxZ + radius);
      if (prevOutside) {
        pos.x = prevPos.x;
        pos.z = prevPos.z;
      } else {
        const dMinX = pos.x - o.minX;
        const dMaxX = o.maxX - pos.x;
        const dMinZ = pos.z - o.minZ;
        const dMaxZ = o.maxZ - pos.z;
        const minD = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
        if (minD === dMinX) pos.x = o.minX - radius;
        else if (minD === dMaxX) pos.x = o.maxX + radius;
        else if (minD === dMinZ) pos.z = o.minZ - radius;
        else pos.z = o.maxZ + radius;
      }
    }
    mech.body.velocity.x = 0; mech.body.velocity.z = 0;
  }
}

function updateVfx(dt) {
  state.vfx = state.vfx.filter((vfx) => {
    vfx.life -= dt;
    if (vfx.followMech) {
      vfx.mesh.position.copy(getMeleeHitboxCenter(vfx.followMech, vfx.followForward));
      vfx.mesh.rotation.y = vfx.followMech.root.rotation.y;
    }
    vfx.mesh.material.opacity = Math.max(0, vfx.life * 4);
    vfx.mesh.scale.multiplyScalar(vfx.growth);
    if (vfx.life > 0) return true;
    scene.remove(vfx.mesh);
    vfx.mesh.geometry.dispose();
    vfx.mesh.material.dispose();
    return false;
  });
}

const clock = new THREE.Clock();
function animate() {
  try {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const now = performance.now();

    if (state.running) {
      syncKeyboardMovement();
      tickAmmo(state.player, now);
      tickAmmo(state.enemy, now);
      tickSniperCharge(state.player, now);
      tickSniperCharge(state.enemy, now);
      updatePlayer(now);
      updateEnemy(now);
      applyRepulsion(now);
      const playerPrev = { x: state.player.body.position.x, z: state.player.body.position.z };
      const enemyPrev = { x: state.enemy.body.position.x, z: state.enemy.body.position.z };
      world.step(1 / 60, dt, 3);
      resolveUnitObstacleCollisions(state.player, playerPrev);
      resolveUnitObstacleCollisions(state.enemy, enemyPrev);

      updateTransforms(dt);
      updateLocksAndReticle();
      updateGlintScale(state.player);
      updateGlintScale(state.enemy);
      updateProjectileSystem(dt);
      updateVfx(dt);
      updateCamera();
      updateHud();

      if (state.player.state.hp <= 0 || state.enemy.state.hp <= 0) {
        showEndMenu(state.enemy.state.hp <= 0);
      }
    }
    renderer.render(scene, camera);
  } catch (error) {
    console.error('Render loop error:', error);
  }
  requestAnimationFrame(animate);
}
