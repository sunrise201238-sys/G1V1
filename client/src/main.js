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
  make(new THREE.BoxGeometry(0.95, 0.75, 0.9), steel, -1.35, 0.95, 0);
  make(new THREE.BoxGeometry(0.95, 0.75, 0.9), steel, 1.35, 0.95, 0);
  const armL = make(new THREE.BoxGeometry(0.52, 1.7, 0.5), steel, -1.15, -0.28, 0);
  const armR = make(new THREE.BoxGeometry(0.52, 1.7, 0.5), steel, 1.15, -0.28, 0);
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
  x.strokeStyle = '#7effbd';
  x.lineWidth = 6;
  x.beginPath();
  x.arc(64, 64, 56, 0, Math.PI * 2);
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
  const s = THREE.MathUtils.clamp(0.45 + dist * 0.018, 0.45, 2.0);
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
    for (const obstacle of arenaObstacles) {
      if (p.mesh.position.x < obstacle.minX || p.mesh.position.x > obstacle.maxX) continue;
      if (p.mesh.position.y < obstacle.minY || p.mesh.position.y > obstacle.maxY) continue;
      if (p.mesh.position.z < obstacle.minZ || p.mesh.position.z > obstacle.maxZ) continue;
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
    if (state.player.unit.spreadCount === 1 && !state.player.unit.sniperCharge) {
      state.player.state.machineBurstRemaining = 4;
    }
    triggerEnemyEvasion(now);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }
  if (input.shootHold && state.player.unit.spreadCount === 1 && state.player.state.machineBurstRemaining > 0) {
    const firedAt = state.player.state.lastFireAt;
    attemptFire(state.player, state.enemy, now);
    if (state.player.state.lastFireAt !== firedAt) {
      state.player.state.machineBurstRemaining -= 1;
      inheritMomentum(state.player, 70);
      triggerEnemyEvasion(now);
      if (action === 'idle') action = 'shoot';
    }
  }
  if (!input.shootHold) state.player.state.machineBurstRemaining = 0;

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
  const distScale = THREE.MathUtils.clamp(7.3 / camera.position.distanceTo(state.enemy.root.position), 0.9, 1.35);
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
    state.player.body.position.set(-40, 2.45, 0);
    state.enemy.body.position.set(40, 2.45, 0);
  } else if (state.mapKey === 'square') {
    state.player.body.position.set(-32, 2.45, 0);
    state.enemy.body.position.set(32, 2.45, 0);
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

function addBlockingBox({ x, y, z, sx, sy, sz, material }) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, y, z);
  mesh.userData.blocking = true;
  scene.add(mesh);
  arenaDecor.push(mesh);
  arenaObstacles.push({ minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, minY: y - sy / 2, maxY: y + sy / 2 });
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

function buildArenaForMap(mapKey) {
  clearArenaDecor();
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
      if (slopeY > 0) {
        arenaObstacles.push({
          minX: x - sx / 2, maxX: x + sx / 2,
          minZ: z - sz / 2, maxZ: z + sz / 2,
          minY: 0, maxY: slopeY
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
  const underSlopeCapMaxY = BRIDGE_TOP - 2;
  const underSlopeCapThickness = 0.45;
  for (const edgeZ of [RAMP_S_MAX_Z, RAMP_N_MIN_Z]) {
    arenaObstacles.push({
      minX: -RAMP_HALF_X, maxX: RAMP_HALF_X,
      minZ: edgeZ - underSlopeCapThickness / 2, maxZ: edgeZ + underSlopeCapThickness / 2,
      minY: 0, maxY: underSlopeCapMaxY
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
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2d3540, roughness: 0.92 });
  const floorPaint = new THREE.MeshStandardMaterial({ color: 0x37424f, roughness: 0.85 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xeae66f, roughness: 0.7 });
  const wall = new THREE.MeshStandardMaterial({ color: 0x6a7383, roughness: 0.7 });
  const wallTrim = new THREE.MeshStandardMaterial({ color: 0xa8aebd, roughness: 0.5, metalness: 0.45 });
  const beltSurface = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.95 });
  const beltFrame = new THREE.MeshStandardMaterial({ color: 0xd9a028, roughness: 0.6 });
  const roller = new THREE.MeshStandardMaterial({ color: 0xa8aebd, roughness: 0.45, metalness: 0.7 });
  const machine = new THREE.MeshStandardMaterial({ color: 0x2b3f5f, roughness: 0.55, metalness: 0.4 });
  const machineTop = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
  const pipe = new THREE.MeshStandardMaterial({ color: 0x9c6526, roughness: 0.55, metalness: 0.4 });
  const crate = new THREE.MeshStandardMaterial({ color: 0x7e5635, roughness: 0.85 });
  const beam = new THREE.MeshStandardMaterial({ color: 0x8b3a36, roughness: 0.5 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff5d6, emissive: 0xfff5d6, emissiveIntensity: 0.9, roughness: 0.3 });

  // Concrete floor (covers the arena grid)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), concrete);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.005;
  scene.add(floor); arenaDecor.push(floor);

  // Painted walkway markings on the floor
  const walk1 = new THREE.Mesh(new THREE.PlaneGeometry(160, 3), floorPaint);
  walk1.rotation.x = -Math.PI / 2; walk1.position.set(0, 0.02, -28);
  scene.add(walk1); arenaDecor.push(walk1);
  const walk2 = new THREE.Mesh(new THREE.PlaneGeometry(160, 3), floorPaint);
  walk2.rotation.x = -Math.PI / 2; walk2.position.set(0, 0.02, 28);
  scene.add(walk2); arenaDecor.push(walk2);
  for (let x = -70; x <= 70; x += 4) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), stripe);
    dash.rotation.x = -Math.PI / 2; dash.position.set(x, 0.03, -28);
    scene.add(dash); arenaDecor.push(dash);
    const dash2 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), stripe);
    dash2.rotation.x = -Math.PI / 2; dash2.position.set(x, 0.03, 28);
    scene.add(dash2); arenaDecor.push(dash2);
  }

  // Outer factory hall walls (interior 200 x 150)
  addBlockingBox({ x: 0, y: 9, z: -75, sx: 204, sy: 18, sz: 2, material: wall });
  addBlockingBox({ x: 0, y: 9, z: 75, sx: 204, sy: 18, sz: 2, material: wall });
  addBlockingBox({ x: -101, y: 9, z: 0, sx: 2, sy: 18, sz: 152, material: wall });
  addBlockingBox({ x: 101, y: 9, z: 0, sx: 2, sy: 18, sz: 152, material: wall });
  // Wall base trim
  addBlockingBox({ x: 0, y: 0.35, z: -74, sx: 200, sy: 0.7, sz: 0.5, material: wallTrim });
  addBlockingBox({ x: 0, y: 0.35, z: 74, sx: 200, sy: 0.7, sz: 0.5, material: wallTrim });

  // ===== Conveyor belts =====
  const conveyors = [
    { cx: -22, len: 70 },
    { cx: 22, len: 70 },
    { cx: -65, len: 36 },
    { cx: 65, len: 36 }
  ];
  conveyors.forEach(({ cx, len }) => {
    // Belt body — acts as low cover (top at y ≈ 1.3)
    addBlockingBox({ x: cx, y: 1.0, z: 0, sx: 3.4, sy: 0.6, sz: len, material: beltSurface });
    // Yellow safety frame rails along both sides of the belt
    addBlockingBox({ x: cx - 1.9, y: 0.6, z: 0, sx: 0.4, sy: 1.2, sz: len, material: beltFrame });
    addBlockingBox({ x: cx + 1.9, y: 0.6, z: 0, sx: 0.4, sy: 1.2, sz: len, material: beltFrame });
    // End rollers (cylinders rotated to span the belt width)
    [-len / 2, len / 2].forEach((zEnd) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 4.0, 16), roller);
      c.rotation.z = Math.PI / 2;
      c.position.set(cx, 1.0, zEnd);
      scene.add(c); arenaDecor.push(c);
    });
    // Crates riding on the belt
    const crateZs = len > 50 ? [-26, -10, 8, 24] : [-12, 6];
    crateZs.forEach((cz) => {
      addBlockingBox({ x: cx, y: 1.95, z: cz, sx: 1.5, sy: 1.1, sz: 1.5, material: crate });
    });
    // Support legs along the underside of the belt
    for (let z = -len / 2 + 4; z <= len / 2 - 4; z += 8) {
      addBlockingBox({ x: cx, y: 0.4, z, sx: 0.6, sy: 0.8, sz: 0.5, material: roller });
    }
  });

  // Steel support pillars (red I-beams)
  const pillarSpots = [[-60, -40], [60, -40], [-60, 40], [60, 40], [-30, -55], [30, -55], [-30, 55], [30, 55]];
  pillarSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 9, z, sx: 1.4, sy: 18, sz: 1.4, material: beam });
    addBlockingBox({ x, y: 0.3, z, sx: 2.4, sy: 0.6, sz: 2.4, material: wallTrim });
  });

  // Workstation machinery along the long walls
  const machineLine = (z) => {
    [[-78, 8], [-50, 6], [50, 6], [78, 8]].forEach(([x, w]) => {
      addBlockingBox({ x, y: 1.6, z, sx: w, sy: 3.2, sz: 4, material: machine });
      addBlockingBox({ x, y: 3.6, z, sx: w * 0.4, sy: 1.0, sz: 1.5, material: machineTop });
    });
  };
  machineLine(-66);
  machineLine(66);

  // Crate stack clusters in open areas
  const crateClusters = [[-50, 18], [50, -18], [0, -50], [0, 50], [-12, -10], [12, 10]];
  crateClusters.forEach(([x, z]) => {
    addBlockingBox({ x, y: 0.9, z, sx: 1.7, sy: 1.8, sz: 1.7, material: crate });
    addBlockingBox({ x: x + 1.5, y: 0.9, z: z + 0.6, sx: 1.7, sy: 1.8, sz: 1.7, material: crate });
    addBlockingBox({ x: x + 0.5, y: 2.7, z: z - 0.4, sx: 1.5, sy: 1.5, sz: 1.5, material: crate });
  });

  // Overhead pipework (purely visual)
  for (const z of [-50, -20, 20, 50]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 200, 12), pipe);
    p.rotation.z = Math.PI / 2;
    p.position.set(0, 14, z);
    scene.add(p); arenaDecor.push(p);
  }
  for (const x of [-60, 0, 60]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 150, 12), pipe);
    p.position.set(x, 14, 0);
    scene.add(p); arenaDecor.push(p);
  }

  // Ceiling truss beams
  for (const x of [-80, -50, -20, 10, 40, 70]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 150), beam);
    b.position.set(x, 16.5, 0);
    scene.add(b); arenaDecor.push(b);
  }

  // Hanging shop lights
  for (const x of [-60, -30, 0, 30, 60]) {
    for (const z of [-40, 0, 40]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 1.2), lightMat);
      l.position.set(x, 14.6, z);
      scene.add(l); arenaDecor.push(l);
    }
  }
}

function buildSquareArena() {
  const cobble = new THREE.MeshStandardMaterial({ color: 0x8b8d92, roughness: 0.85 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x4a7c3a, roughness: 0.95 });
  const path = new THREE.MeshStandardMaterial({ color: 0xb0a886, roughness: 0.8 });
  const fountainStone = new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.6 });
  const fountainWater = new THREE.MeshStandardMaterial({
    color: 0x5fa8d8, transparent: true, opacity: 0.85, roughness: 0.2,
    emissive: 0x1a4f78, emissiveIntensity: 0.3
  });
  const brick = new THREE.MeshStandardMaterial({ color: 0x9b3f3a, roughness: 0.85 });
  const brickAlt = new THREE.MeshStandardMaterial({ color: 0xb6845c, roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xeadfc4, roughness: 0.7 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x2f1f12, roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x3a3a45, roughness: 0.7 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: 0.3, metalness: 0.4, emissive: 0x213a48, emissiveIntensity: 0.25 });
  const bench = new THREE.MeshStandardMaterial({ color: 0x5e3f1c, roughness: 0.85 });
  const lamppost = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.55, metalness: 0.5 });
  const lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff7d0, emissive: 0xfff7d0, emissiveIntensity: 0.9, roughness: 0.4 });
  const planter = new THREE.MeshStandardMaterial({ color: 0x3e3a35, roughness: 0.8 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0x355c2e, roughness: 0.95 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x4a341e, roughness: 0.9 });

  // Grass base covering the arena
  const grassPlane = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), grass);
  grassPlane.rotation.x = -Math.PI / 2; grassPlane.position.y = 0.005;
  scene.add(grassPlane); arenaDecor.push(grassPlane);

  // Cobblestone central plaza
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), cobble);
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01;
  scene.add(plaza); arenaDecor.push(plaza);

  // Sand/gravel paths radiating outward
  for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(20, 80), path);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = ang;
    p.position.set(Math.cos(ang) * 70, 0.02, Math.sin(ang) * 70);
    scene.add(p); arenaDecor.push(p);
  }

  // ===== Central fountain =====
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1.5, 8), fountainStone);
  baseRing.position.set(0, 0.75, 0);
  scene.add(baseRing); arenaDecor.push(baseRing);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.2, 32), fountainWater);
  water.position.set(0, 1.45, 0);
  scene.add(water); arenaDecor.push(water);
  const midPillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 2.5, 16), fountainStone);
  midPillar.position.set(0, 2.7, 0);
  scene.add(midPillar); arenaDecor.push(midPillar);
  const midBowl = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.4, 0.6, 16), fountainStone);
  midBowl.position.set(0, 4.2, 0);
  scene.add(midBowl); arenaDecor.push(midBowl);
  const topPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.0, 12), fountainStone);
  topPillar.position.set(0, 5.5, 0);
  scene.add(topPillar); arenaDecor.push(topPillar);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 16), fountainStone);
  finial.position.set(0, 6.7, 0);
  scene.add(finial); arenaDecor.push(finial);

  // Fountain collision: octagonal base approximated as a cross of two AABBs, plus a tall central spire
  const fountainObstacleSpec = (sx, sz) => ({
    minX: -sx / 2, maxX: sx / 2, minZ: -sz / 2, maxZ: sz / 2, minY: 0, maxY: 1.5
  });
  arenaObstacles.push(
    fountainObstacleSpec(12, 7),
    fountainObstacleSpec(7, 12),
    { minX: -1.7, maxX: 1.7, minZ: -1.7, maxZ: 1.7, minY: 1.5, maxY: 7.5 }
  );

  // ===== English-style buildings around the square =====
  const drawBuilding = (cx, cz, sx, sz, h, opts = {}) => {
    const wallMat = opts.alt ? brickAlt : brick;
    addBlockingBox({ x: cx, y: h / 2, z: cz, sx, sy: h, sz, material: wallMat });
    addBlockingBox({ x: cx, y: 0.4, z: cz, sx: sx + 0.4, sy: 0.8, sz: sz + 0.4, material: trim });
    // Gable roof slab
    const r = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.6, 1.6, sz + 0.6), roof);
    r.position.set(cx, h + 0.8, cz);
    scene.add(r); arenaDecor.push(r);
    // Roof ridge
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.4, 1.4, 1.2), roof);
    ridge.position.set(cx, h + 1.9, cz);
    scene.add(ridge); arenaDecor.push(ridge);
    // Tudor timbering on the facade facing the square
    const facadeZ = opts.facadeFront ? cz + sz / 2 + 0.06 : cz - sz / 2 - 0.06;
    for (let i = -1; i <= 1; i += 1) {
      const tm = new THREE.Mesh(new THREE.BoxGeometry(0.3, h * 0.7, 0.1), timber);
      tm.position.set(cx + i * (sx * 0.3), h * 0.4, facadeZ);
      scene.add(tm); arenaDecor.push(tm);
    }
    const ht = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.95, 0.3, 0.1), timber);
    ht.position.set(cx, h * 0.55, facadeZ);
    scene.add(ht); arenaDecor.push(ht);
    // Two windows on the facade
    for (const wx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 0.15), windowMat);
      w.position.set(cx + wx * (sx * 0.2), h * 0.55, facadeZ + (opts.facadeFront ? 0.04 : -0.04));
      scene.add(w); arenaDecor.push(w);
    }
  };

  // South-side buildings (facade faces +Z, toward the square center)
  drawBuilding(-70, -55, 28, 18, 14, { facadeFront: true });
  drawBuilding(0, -65, 34, 18, 16, { facadeFront: true, alt: true });
  drawBuilding(70, -55, 28, 18, 14, { facadeFront: true });
  // North-side buildings (facade faces -Z, toward the square center)
  drawBuilding(-70, 55, 28, 18, 14, { facadeFront: false, alt: true });
  drawBuilding(0, 65, 34, 18, 16, { facadeFront: false });
  drawBuilding(70, 55, 28, 18, 14, { facadeFront: false, alt: true });
  // Side row buildings (further out)
  drawBuilding(-100, -10, 14, 38, 13, { facadeFront: true });
  drawBuilding(100, 10, 14, 38, 13, { facadeFront: false });

  // ===== Lampposts ringing the fountain =====
  const lampSpots = [[-15, -15], [15, -15], [-15, 15], [15, 15], [-30, 0], [30, 0], [0, -30], [0, 30]];
  lampSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 3.5, z, sx: 0.35, sy: 7.0, sz: 0.35, material: lamppost });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.85), lampGlow);
    head.position.set(x, 7.4, z);
    scene.add(head); arenaDecor.push(head);
  });

  // ===== Park benches near the fountain (cover) =====
  const benchSpots = [
    [12, -8, false], [-12, -8, false], [12, 8, false], [-12, 8, false],
    [8, 12, true], [-8, 12, true], [8, -12, true], [-8, -12, true]
  ];
  benchSpots.forEach(([x, z, vertical]) => {
    addBlockingBox({ x, y: 0.55, z, sx: vertical ? 0.6 : 3.0, sy: 1.1, sz: vertical ? 3.0 : 0.6, material: bench });
  });

  // ===== Stone planters with shrubs =====
  const planterSpots = [[-26, -26], [26, -26], [-26, 26], [26, 26], [-44, 0], [44, 0], [0, -42], [0, 42]];
  planterSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 0.55, z, sx: 2.0, sy: 1.1, sz: 2.0, material: planter });
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 12), foliage);
    leaves.position.set(x, 2.3, z);
    scene.add(leaves); arenaDecor.push(leaves);
  });

  // ===== Trees scattered on the grass borders =====
  const treeSpots = [[-95, -88], [95, -88], [-95, 88], [95, 88], [-85, 0], [85, 0], [-55, -30], [55, 30]];
  treeSpots.forEach(([x, z]) => {
    addBlockingBox({ x, y: 2.5, z, sx: 1.0, sy: 5.0, sz: 1.0, material: trunk });
    const crown = new THREE.Mesh(new THREE.SphereGeometry(3.0, 14, 14), foliage);
    crown.position.set(x, 6.5, z);
    scene.add(crown); arenaDecor.push(crown);
  });

  // ===== Outer boundary walls (stone-brick) =====
  addBlockingBox({ x: 0, y: 6, z: -110, sx: 240, sy: 12, sz: 4, material: brick });
  addBlockingBox({ x: 0, y: 6, z: 110, sx: 240, sy: 12, sz: 4, material: brick });
  addBlockingBox({ x: -120, y: 6, z: 0, sx: 4, sy: 12, sz: 240, material: brick });
  addBlockingBox({ x: 120, y: 6, z: 0, sx: 4, sy: 12, sz: 240, material: brick });
}

function buildLobbyArena() {
  const marble = new THREE.MeshStandardMaterial({ color: 0xe5e7ec, roughness: 0.4, metalness: 0.15 });
  const marbleDark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.1 });
  const marbleStair = new THREE.MeshStandardMaterial({ color: 0xc4c8d0, roughness: 0.45, metalness: 0.15 });
  const wall = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.5 });
  const wallAccent = new THREE.MeshStandardMaterial({ color: 0x3d8bff, roughness: 0.4, metalness: 0.3, emissive: 0x0a3a8c, emissiveIntensity: 0.35 });
  const chair = new THREE.MeshStandardMaterial({ color: 0x2c3754, roughness: 0.7 });
  const railGlass = new THREE.MeshStandardMaterial({ color: 0x9bc7e8, transparent: true, opacity: 0.32, roughness: 0.1 });
  const railPost = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, roughness: 0.4, metalness: 0.7 });
  const desk = new THREE.MeshStandardMaterial({ color: 0xc8a574, roughness: 0.6 });
  const deskTop = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.2 });
  const pot = new THREE.MeshStandardMaterial({ color: 0xe2e6ec, roughness: 0.55 });
  const plant = new THREE.MeshStandardMaterial({ color: 0x355c2e, roughness: 0.95 });
  const decorMat = new THREE.MeshStandardMaterial({ color: 0x1a3460, roughness: 0.5 });
  const ceilingLight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.3 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.45, metalness: 0.15 });

  const UPPER_Y = 5;
  const UPPER_MIN_Z = -90;
  const UPPER_MAX_Z = -5;
  const STAIR_HALF_X = 22;
  const STAIR_MIN_Z = -5;
  const STAIR_MAX_Z = 10;

  // Polished marble floor (covers the arena grid)
  const baseFloor = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), marble);
  baseFloor.rotation.x = -Math.PI / 2; baseFloor.position.y = 0.005;
  scene.add(baseFloor); arenaDecor.push(baseFloor);

  // Dark marble runner pointing at the stairs
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(8, 80), marbleDark);
  runner.rotation.x = -Math.PI / 2; runner.position.set(0, 0.012, 50);
  scene.add(runner); arenaDecor.push(runner);

  // ===== Outer walls (lobby interior 220 x 200) =====
  addBlockingBox({ x: 0, y: 11, z: -100, sx: 220, sy: 22, sz: 4, material: wall });
  addBlockingBox({ x: 0, y: 11, z: 100, sx: 220, sy: 22, sz: 4, material: wall });
  addBlockingBox({ x: -110, y: 11, z: 0, sx: 4, sy: 22, sz: 200, material: wall });
  addBlockingBox({ x: 110, y: 11, z: 0, sx: 4, sy: 22, sz: 200, material: wall });

  // Logo bar on the back wall
  addBlockingBox({ x: 0, y: 14, z: -97.8, sx: 50, sy: 4, sz: 0.6, material: wallAccent });
  // Side-wall accent strips (windows feel)
  addBlockingBox({ x: -107.8, y: 13, z: 0, sx: 0.5, sy: 8, sz: 80, material: wallAccent });
  addBlockingBox({ x: 107.8, y: 13, z: 0, sx: 0.5, sy: 8, sz: 80, material: wallAccent });

  // ===== Mezzanine (upper floor) =====
  addPlatform({
    minX: -90, maxX: 90,
    minZ: UPPER_MIN_Z, maxZ: UPPER_MAX_Z,
    top: UPPER_Y, thickness: 0.8, material: marble
  });
  // Mezzanine front edge facing strip (visual lip under the railing)
  addBlockingBox({ x: 0, y: UPPER_Y - 0.4, z: UPPER_MAX_Z + 0.2, sx: 180, sy: 0.6, sz: 0.4, material: marbleDark });

  // Support pillars under the mezzanine deck. Visual cylinder reaches the deck for looks,
  // but the collision AABB is capped so a unit walking on top of the mezzanine (body.y ≈ 7.45)
  // is past the obstacle's `maxY + 4` filter and isn't blocked from above.
  const supportSpots = [[-70, -75], [70, -75], [-70, -40], [70, -40], [-30, -75], [30, -75], [-30, -25], [30, -25]];
  supportSpots.forEach(([x, z]) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, UPPER_Y, 16), pillarMat);
    col.position.set(x, UPPER_Y / 2, z);
    scene.add(col); arenaDecor.push(col);
    arenaObstacles.push({
      minX: x - 0.9, maxX: x + 0.9,
      minZ: z - 0.9, maxZ: z + 0.9,
      minY: 0, maxY: 3.0
    });
  });

  // ===== Big central staircase (wide ramp connecting the two levels) =====
  addRamp({
    minX: -STAIR_HALF_X, maxX: STAIR_HALF_X,
    minZ: STAIR_MIN_Z, maxZ: STAIR_MAX_Z,
    axis: 'z', lowY: UPPER_Y, highY: 0,
    material: marbleStair, thickness: 0.6
  });
  // Visual stepped front trim across the slope
  for (let i = 0; i < 6; i += 1) {
    const t = i / 6;
    const z = THREE.MathUtils.lerp(STAIR_MAX_Z, STAIR_MIN_Z, t);
    const y = THREE.MathUtils.lerp(0.05, UPPER_Y - 0.1, t);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(STAIR_HALF_X * 2 + 0.4, 0.2, 0.4), marbleDark);
    trim.position.set(0, y, z);
    scene.add(trim); arenaDecor.push(trim);
  }
  // Stair side cheek walls (from floor up to the ramp)
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.6, UPPER_Y, STAIR_MAX_Z - STAIR_MIN_Z), marbleStair);
    cheek.position.set(sx * (STAIR_HALF_X + 0.3), UPPER_Y / 2, (STAIR_MIN_Z + STAIR_MAX_Z) / 2);
    scene.add(cheek); arenaDecor.push(cheek);
    arenaObstacles.push({
      minX: sx * (STAIR_HALF_X + 0.3) - 0.3, maxX: sx * (STAIR_HALF_X + 0.3) + 0.3,
      minZ: STAIR_MIN_Z, maxZ: STAIR_MAX_Z,
      minY: 0, maxY: UPPER_Y
    });
  }

  // ===== Mezzanine glass railings =====
  const RAIL_H = 1.3;
  const railFrontZ = UPPER_MAX_Z + 0.05;
  // Front railing left segment (from -90 up to the stair opening)
  const leftLen = -STAIR_HALF_X - (-90);
  addBlockingBox({
    x: (-90 + -STAIR_HALF_X) / 2, y: UPPER_Y + RAIL_H / 2, z: railFrontZ,
    sx: leftLen, sy: RAIL_H, sz: 0.2, material: railGlass
  });
  // Front railing right segment (from the stair opening to +90)
  const rightLen = 90 - STAIR_HALF_X;
  addBlockingBox({
    x: (STAIR_HALF_X + 90) / 2, y: UPPER_Y + RAIL_H / 2, z: railFrontZ,
    sx: rightLen, sy: RAIL_H, sz: 0.2, material: railGlass
  });
  // Side railings down the long edges of the mezzanine
  addBlockingBox({
    x: -90.1, y: UPPER_Y + RAIL_H / 2, z: (UPPER_MIN_Z + UPPER_MAX_Z) / 2,
    sx: 0.2, sy: RAIL_H, sz: UPPER_MAX_Z - UPPER_MIN_Z, material: railGlass
  });
  addBlockingBox({
    x: 90.1, y: UPPER_Y + RAIL_H / 2, z: (UPPER_MIN_Z + UPPER_MAX_Z) / 2,
    sx: 0.2, sy: RAIL_H, sz: UPPER_MAX_Z - UPPER_MIN_Z, material: railGlass
  });
  // Decorative metal posts along the front railing
  for (let x = -88; x <= 88; x += 8) {
    if (x >= -STAIR_HALF_X - 1 && x <= STAIR_HALF_X + 1) continue;
    addBlockingBox({
      x, y: UPPER_Y + RAIL_H / 2, z: railFrontZ,
      sx: 0.2, sy: RAIL_H + 0.15, sz: 0.3, material: railPost
    });
  }

  // ===== Reception desks on the lower floor =====
  const drawDesk = (cx, cz) => {
    addBlockingBox({ x: cx, y: 0.6, z: cz, sx: 12, sy: 1.2, sz: 2.4, material: desk });
    addBlockingBox({ x: cx, y: 1.32, z: cz, sx: 12.4, sy: 0.18, sz: 2.7, material: deskTop });
  };
  drawDesk(-50, 50);
  drawDesk(50, 50);

  // ===== Lounge seating on the lower floor =====
  const drawChair = (x, y, z, sofa = false) => {
    const w = sofa ? 4.0 : 1.6;
    addBlockingBox({ x, y: y + 0.5, z, sx: w, sy: 1.0, sz: 1.6, material: chair });
    addBlockingBox({ x, y: y + 1.4, z: z + 0.65, sx: w, sy: 0.8, sz: 0.3, material: chair });
  };
  drawChair(-70, 0, 78);
  drawChair(-60, 0, 78);
  drawChair(-50, 0, 78);
  drawChair(50, 0, 78);
  drawChair(60, 0, 78);
  drawChair(70, 0, 78);
  drawChair(-30, 0, 70, true);
  drawChair(30, 0, 70, true);
  drawChair(-40, 0, 25, true);
  drawChair(40, 0, 25, true);
  drawChair(-15, 0, 30);
  drawChair(15, 0, 30);

  // Coffee tables paired with seating
  const coffeeTables = [[-40, 84], [40, 84], [0, 75]];
  coffeeTables.forEach(([x, z]) => {
    addBlockingBox({ x, y: 0.4, z, sx: 2.6, sy: 0.8, sz: 1.6, material: deskTop });
  });

  // ===== Tall lobby pillars (full ceiling height) =====
  const tallPillars = [[-60, 60], [60, 60], [-30, 30], [30, 30], [-60, 20], [60, 20]];
  tallPillars.forEach(([x, z]) => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 22, 18), pillarMat);
    col.position.set(x, 11, z);
    scene.add(col); arenaDecor.push(col);
    arenaObstacles.push({
      minX: x - 1.5, maxX: x + 1.5,
      minZ: z - 1.5, maxZ: z + 1.5,
      minY: 0, maxY: 22
    });
    const baseTrim = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 18), marbleDark);
    baseTrim.position.set(x, 0.2, z);
    scene.add(baseTrim); arenaDecor.push(baseTrim);
  });

  // ===== Potted plants (lower floor + mezzanine) =====
  const drawPot = (x, baseY, z) => {
    addBlockingBox({ x, y: baseY + 0.7, z, sx: 1.6, sy: 1.4, sz: 1.6, material: pot });
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 12), plant);
    leaves.position.set(x, baseY + 2.6, z);
    scene.add(leaves); arenaDecor.push(leaves);
  };
  const lowerPlants = [[-95, 80], [95, 80], [-95, 50], [95, 50], [-95, 0], [95, 0], [-95, -55], [95, -55]];
  lowerPlants.forEach(([x, z]) => drawPot(x, 0, z));
  const mezzPlants = [[-70, -30], [70, -30], [-50, -75], [50, -75]];
  mezzPlants.forEach(([x, z]) => drawPot(x, UPPER_Y, z));

  // ===== Mezzanine lounge furniture =====
  const mezzChairs = [[-40, -50], [40, -50], [-20, -70], [20, -70]];
  mezzChairs.forEach(([x, z]) => drawChair(x, UPPER_Y, z));

  // Mezzanine sculpture centerpiece
  addBlockingBox({ x: 0, y: UPPER_Y + 1.5, z: -55, sx: 3, sy: 3, sz: 3, material: decorMat });
  const sculpTop = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 16), wallAccent);
  sculpTop.position.set(0, UPPER_Y + 4.2, -55);
  scene.add(sculpTop); arenaDecor.push(sculpTop);

  // ===== Ceiling lights and beams =====
  for (const x of [-60, -20, 20, 60]) {
    for (const z of [-60, -20, 20, 60]) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.15, 3.5), ceilingLight);
      light.position.set(x, 21.6, z);
      scene.add(light); arenaDecor.push(light);
    }
  }
  for (const z of [-80, -40, 0, 40, 80]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(220, 0.4, 1.2), wall);
    b.position.set(0, 21.8, z);
    scene.add(b); arenaDecor.push(b);
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
    if (y < o.minY - 2 || y > o.maxY + 4) continue;
    const nearestX = Math.max(o.minX, Math.min(x, o.maxX));
    const nearestZ = Math.max(o.minZ, Math.min(z, o.maxZ));
    const dx = x - nearestX;
    const dz = z - nearestZ;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

function resolveUnitObstacleCollisions(mech) {
  const radius = 1.15;
  const pos = mech.body.position;
  for (const o of arenaObstacles) {
    if (pos.y < o.minY - 2 || pos.y > o.maxY + 4) continue;
    const nearestX = Math.max(o.minX, Math.min(pos.x, o.maxX));
    const nearestZ = Math.max(o.minZ, Math.min(pos.z, o.maxZ));
    const dx = pos.x - nearestX;
    const dz = pos.z - nearestZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    const d = Math.sqrt(d2);
    const push = radius - Math.max(d, 0.0001);
    if (d > 0.0001) {
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    } else {
      const cx = (o.minX + o.maxX) / 2;
      const cz = (o.minZ + o.maxZ) / 2;
      const ox = pos.x - cx;
      const oz = pos.z - cz;
      if (Math.abs(ox) >= Math.abs(oz)) pos.x += Math.sign(ox || 1) * push;
      else pos.z += Math.sign(oz || 1) * push;
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
      world.step(1 / 60, dt, 3);
      resolveUnitObstacleCollisions(state.player);
      resolveUnitObstacleCollisions(state.enemy);

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
