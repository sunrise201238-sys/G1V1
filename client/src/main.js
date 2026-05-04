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
    damage: 4
  },
  unit2: {
    name: 'Unit 2 / Shotgun',
    lockRange: 56,
    projectileSpeed: 45,
    fireCooldownMs: 700,
    spreadCount: 8,
    spreadAngle: THREE.MathUtils.degToRad(16),
    damage: 5
  }
};

const MAP_DATA = {
  arena1: { name: 'Map 1 / Arena' },
  arena2: { name: 'Map 2 / Urban Plaza' }
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
      lastFireAt: 0
    }
  };
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  s.scale.set(5.4, 5.4, 1);
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
    b.textContent = action === 'boost' ? 'SPRINT' : (action === 'step' ? 'DODGE' : action.toUpperCase());
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
    boost: hud.querySelector('#boost-fill')
  };
}

let hudRefs = null;

function spawnProjectiles(owner, target) {
  const now = performance.now();
  if (now - owner.state.lastFireAt < owner.unit.fireCooldownMs) return;
  owner.state.lastFireAt = now;

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
    for (const obstacle of arenaDecor) {
      if (!obstacle.userData?.blocking) continue;
      const half = obstacle.geometry.parameters ? { x: obstacle.geometry.parameters.width / 2, y: obstacle.geometry.parameters.height / 2, z: obstacle.geometry.parameters.depth / 2 } : null;
      if (!half) continue;
      const ox = obstacle.position.x; const oy = obstacle.position.y; const oz = obstacle.position.z;
      if (Math.abs(p.mesh.position.x - ox) <= half.x && Math.abs(p.mesh.position.y - oy) <= half.y && Math.abs(p.mesh.position.z - oz) <= half.z) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        state.projectiles.splice(i, 1);
        p.ttl = 0;
        break;
      }
    }
    if (p.ttl <= 0) continue;
    const hitRadius = p.target.state.vulnerabilityMove ? 2.25 : 1.6;
    const path = new THREE.Line3(prevPos, p.mesh.position.clone());
    const nearest = new THREE.Vector3();
    path.closestPointToPoint(p.target.root.position, true, nearest);
    if (nearest.distanceTo(p.target.root.position) < hitRadius) {
      const mitigation = p.target.state.vulnerabilityMove ? 1.35 : 1;
      p.target.state.hp = Math.max(0, p.target.state.hp - p.damage * mitigation);
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
  const grounded = mech.grounded || mech.body.position.y <= 2.55;

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

  const recoveringFromDash = now < state.player.state.dashRecoverUntil;
  const speed = input.boost ? BOOST_MOVE_SPEED : (recoveringFromDash ? 4.55 : 16);
  const hitStunScale = now < state.player.state.hitStunUntil ? 0.25 : 1;
  const emptyPenaltyActive = now < state.player.state.emptyRecoverUntil;
  const canInputMove = state.player.state.boost > 0 && !emptyPenaltyActive;
  if (!inStep) {
    state.player.body.velocity.x = canInputMove ? move.x * speed * hitStunScale : 0;
    state.player.body.velocity.z = canInputMove ? move.z * speed * hitStunScale : 0;
  }
  state.player.state.vulnerabilityMove = !input.boost && Math.hypot(input.x, input.y) > 0.2;

  let action = 'idle';
  if (inStep) {
    const span = Math.max(1, stepState.stepUntil - stepState.stepStartAt);
    const progress = THREE.MathUtils.clamp((now - stepState.stepStartAt) / span, 0, 1);
    state.player.body.position.x = THREE.MathUtils.lerp(stepState.stepFromX, stepState.stepToX, progress);
    state.player.body.position.z = THREE.MathUtils.lerp(stepState.stepFromZ, stepState.stepToZ, progress);
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
  } else if (input.jump && canInputMove && stepState.boost >= JUMP_BOOST_COST && (state.player.grounded || state.player.body.position.y <= 2.6) && now >= state.player.state.jumpCooldownUntil) {
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
    spawnProjectiles(state.player, state.enemy);
    if (state.player.unit.spreadCount === 1) state.player.state.machineBurstRemaining = 4;
    triggerEnemyEvasion(now);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }
  if (input.shootHold && state.player.unit.spreadCount === 1 && state.player.state.machineBurstRemaining > 0) {
    const firedAt = state.player.state.lastFireAt;
    spawnProjectiles(state.player, state.enemy);
    if (state.player.state.lastFireAt !== firedAt) {
      state.player.state.machineBurstRemaining -= 1;
      inheritMomentum(state.player, 70);
      triggerEnemyEvasion(now);
      if (action === 'idle') action = 'shoot';
    }
  }
  if (!input.shootHold) state.player.state.machineBurstRemaining = 0;

  if (state.player.grounded) {
    state.player.body.position.y = 2.45;
    state.player.body.velocity.y = 0;
    state.player.body.linearFactor.set(1, 0, 1);
    state.player.state.airborne = false;
    state.player.state.jumpVelocity = 0;
  }

  applyMomentum(state.player, { suspend: action === 'step' });
  updateBoost(state.player, now, action);
}

function updateEnemy(now) {
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

  const moveScalar = now < state.enemy.state.hitStunUntil ? 5.8 : 10.6;
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
    if (state.enemy.unit.spreadCount === 1 && state.enemy.state.machineBurstRemaining <= 0) state.enemy.state.machineBurstRemaining = 5;
    const firedAt = state.enemy.state.lastFireAt;
    spawnProjectiles(state.enemy, state.player);
    const fired = state.enemy.state.lastFireAt !== firedAt;
    if (state.enemy.unit.spreadCount === 1) {
      if (fired) state.enemy.state.machineBurstRemaining -= 1;
      state.enemy.state.nextFireAt = state.enemy.state.machineBurstRemaining > 0 ? now + 150 : now + PhaserLikeBetween(1300, 2400);
      if (state.enemy.state.machineBurstRemaining <= 0) state.enemy.state.machineBurstRemaining = 0;
    } else {
      if (fired) state.enemy.state.nextFireAt = now + PhaserLikeBetween(1500, 3000);
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
    if (m.state.airborne) {
      m.state.jumpVelocity += world.gravity.y * dt;
      m.body.position.y += m.state.jumpVelocity * dt;
      if (m.body.position.y <= 2.45) {
        m.body.position.y = 2.45;
        m.state.airborne = false;
        m.state.jumpVelocity = 0;
      }
    }
    if (m.grounded) {
      m.body.position.y = 2.45;
      m.body.velocity.y = 0;
      m.body.linearFactor.set(1, 0, 1);
      m.state.airborne = false;
      m.state.jumpVelocity = 0;
    }
    m.root.position.set(m.body.position.x, m.body.position.y + m.modelYOffset, m.body.position.z);
    const from = new CANNON.Vec3(m.body.position.x, m.body.position.y + 1.1, m.body.position.z);
    const to = new CANNON.Vec3(m.body.position.x, m.body.position.y - 6, m.body.position.z);
    raycastResult.reset();
    m.grounded = world.raycastClosest(from, to, { collisionFilterMask: -1, skipBackfaces: true }, raycastResult)
      && raycastResult.body === groundBody
      && raycastResult.distance <= m.legLength;
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
}

function cleanupMatch() {
  [state.player, state.enemy].forEach((m) => {
    if (!m) return;
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
  state.player.body.position.set(-16, 2.45, 0);
  state.enemy.body.position.set(16, 2.45, 0);
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
          mapMenu.innerHTML = `<h2>Select Map</h2>${mapEntries.map(([id, map]) => `<button data-map="${id}">${map.name}</button>`).join('')}`;
          app.appendChild(mapMenu);

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

function buildArenaForMap(mapKey) {
  clearArenaDecor();
  if (mapKey !== 'arena2') return;
  const road = new THREE.MeshStandardMaterial({ color: 0x2b3342, roughness: 0.88 });
  const curb = new THREE.MeshStandardMaterial({ color: 0x9198a7, roughness: 0.8 });
  const block = new THREE.MeshStandardMaterial({ color: 0xc9b04a, roughness: 0.75 });
  const deco = new THREE.MeshStandardMaterial({ color: 0x4c7aa8, roughness: 0.7 });

  const base = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), road);
  base.rotation.x = -Math.PI / 2; base.position.y = 0.01; scene.add(base); arenaDecor.push(base);

  addBlockingBox({ x: 0, y: 0.5, z: 0, sx: 20, sy: 1, sz: 150, material: curb });
  addBlockingBox({ x: 0, y: 0.5, z: 0, sx: 150, sy: 1, sz: 20, material: curb });

  for (let i = -3; i <= 3; i += 1) {
    addBlockingBox({ x: i * 18, y: 3.4, z: -26, sx: 6, sy: 6.8, sz: 3.5, material: block });
    addBlockingBox({ x: i * 18, y: 3.4, z: 26, sx: 6, sy: 6.8, sz: 3.5, material: block });
  }

  addBlockingBox({ x: -44, y: 4.5, z: 44, sx: 24, sy: 9, sz: 10, material: deco });
  addBlockingBox({ x: 44, y: 4.5, z: -44, sx: 24, sy: 9, sz: 10, material: deco });
  addBlockingBox({ x: -44, y: 4.5, z: -44, sx: 10, sy: 9, sz: 24, material: deco });
  addBlockingBox({ x: 44, y: 4.5, z: 44, sx: 10, sy: 9, sz: 24, material: deco });

  addBlockingBox({ x: -2, y: 0.8, z: -55, sx: 18, sy: 1.6, sz: 8, material: curb });
  addBlockingBox({ x: 2, y: 0.8, z: 55, sx: 18, sy: 1.6, sz: 8, material: curb });
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
    const d = Math.sqrt(d2) || 0.0001;
    const push = radius - d;
    pos.x += (dx / d) * push;
    pos.z += (dz / d) * push;
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
      updatePlayer(now);
      updateEnemy(now);
      applyRepulsion(now);
      world.step(1 / 60, dt, 3);
      resolveUnitObstacleCollisions(state.player);
      resolveUnitObstacleCollisions(state.enemy);

      updateTransforms(dt);
      updateLocksAndReticle();
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
