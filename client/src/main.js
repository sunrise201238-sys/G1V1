import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import './style.css';

const app = document.getElementById('app');

const UNIT_DATA = {
  unit1: {
    name: 'Unit 1 / Machine Gun',
    lockRange: 28,
    projectileSpeed: 36,
    fireCooldownMs: 140,
    spreadCount: 1,
    spreadAngle: 0.02,
    damage: 4
  },
  unit2: {
    name: 'Unit 2 / Shotgun',
    lockRange: 16,
    projectileSpeed: 30,
    fireCooldownMs: 520,
    spreadCount: 5,
    spreadAngle: Math.PI / 12,
    damage: 5
  }
};

const state = {
  phase: 'select',
  playerUnitKey: 'unit1',
  enemyUnitKey: 'unit2',
  player: null,
  enemy: null,
  projectiles: [],
  hud: null,
  reticle: null,
  speedLines: null,
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

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
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

const input = { x: 0, y: 0, boost: false, rise: false, step: false, shootTap: false, meleeTap: false };

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

  const torso = make(new THREE.BoxGeometry(2.4, 2.35, 1.8), armor, 0, 0, 0);
  make(new THREE.BoxGeometry(1.1, 0.68, 1.05), steel, 0, 1.62, 0);
  make(new THREE.BoxGeometry(1.25, 1.0, 1.7), steel, -1.65, 0.95, 0);
  make(new THREE.BoxGeometry(1.25, 1.0, 1.7), steel, 1.65, 0.95, 0);
  const armL = make(new THREE.BoxGeometry(0.68, 1.3, 0.62), steel, -1.55, -0.25, 0);
  const armR = make(new THREE.BoxGeometry(0.68, 1.3, 0.62), steel, 1.55, -0.25, 0);
  make(new THREE.BoxGeometry(0.9, 1.55, 1.0), steel, -0.52, -1.95, 0);
  make(new THREE.BoxGeometry(0.9, 1.55, 1.0), steel, 0.52, -1.95, 0);

  const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.12 });
  const thrusterL = make(new THREE.ConeGeometry(0.24, 0.9, 8), thrusterMat, -0.42, -2.4, -0.45);
  thrusterL.rotation.x = Math.PI;
  const thrusterR = make(new THREE.ConeGeometry(0.24, 0.9, 8), thrusterMat, 0.42, -2.4, -0.45);
  thrusterR.rotation.x = Math.PI;

  const plumeLight = new THREE.PointLight(0x7efbff, 0, 7, 2);
  plumeLight.position.set(0, -2.2, -0.7);
  root.add(plumeLight);

  scene.add(root);

  const body = new CANNON.Body({ mass: 3, shape: new CANNON.Box(new CANNON.Vec3(0.95, 1.8, 0.8)), linearDamping: 0.24 });
  body.position.set(0, 2.45, 0);
  world.addBody(body);

  return {
    root,
    body,
    unit: unitData,
    thrusters: [thrusterL, thrusterR],
    plumeLight,
    trail: [],
    torso,
    modelYOffset: 2.35,
    legLength: 2.35,
    grounded: false,
    arms: { left: armL, right: armR },
    state: {
      action: 'idle',
      boost: 100,
      hp: 100,
      redLock: false,
      overheatedUntil: 0,
      hitStunUntil: 0,
      meleeAnimUntil: 0,
      meleeLungeUntil: 0,
      staggerUntil: 0,
      evadeHomingUntil: 0,
      stepCooldownUntil: 0,
      nextFireAt: 0,
      strafeSign: 1,
      vulnerabilityMove: false,
      stackUntil: 0,
      lastFireAt: 0
    }
  };
}

function makeReticleSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.strokeStyle = '#7effbd';
  x.lineWidth = 3;
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
    <div class="boost"><div id="boost-fill"></div></div>
    <div class="joy" id="joy"><div class="stick"></div></div>
    <div class="buttons" id="buttons"></div>
    <div class="speed-lines" id="speed-lines"></div>
  `;
  app.appendChild(hud);

  ['boost', 'step', 'shoot', 'melee', 'rise'].forEach((action) => {
    const b = document.createElement('button');
    b.dataset.k = action;
    b.textContent = action.toUpperCase();
    hud.querySelector('#buttons').appendChild(b);
  });

  const joy = hud.querySelector('#joy');
  const stick = joy.querySelector('.stick');
  let pointerId = null;
  let lastTapAt = 0;

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
    applyStick(e.clientX, e.clientY);
  });

  window.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId) return;
    applyStick(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', (e) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    input.x = 0;
    input.y = 0;
    input.boost = false;
    stick.style.transform = 'translate(0px,0px)';
  });

  hud.querySelectorAll('button').forEach((btn) => {
    const k = btn.dataset.k;
    btn.addEventListener('pointerdown', () => {
      if (k === 'shoot') input.shootTap = true;
      else if (k === 'melee') input.meleeTap = true;
      else input[k] = true;
    });
    btn.addEventListener('pointerup', () => {
      if (k !== 'shoot' && k !== 'melee') input[k] = false;
    });
  });

  state.hud = hud;
  state.speedLines = hud.querySelector('#speed-lines');
  return {
    hp: hud.querySelector('#health-fill'),
    boost: hud.querySelector('#boost-fill')
  };
}

let hudRefs = null;

function spawnProjectiles(owner, target) {
  const now = performance.now();
  if (now - owner.state.lastFireAt < owner.unit.fireCooldownMs) return;
  owner.state.lastFireAt = now;

  const baseDir = new THREE.Vector3().subVectors(target.root.position, owner.root.position).normalize();

  for (let i = 0; i < owner.unit.spreadCount; i += 1) {
    const yaw = (Math.random() - 0.5) * owner.unit.spreadAngle;
    const pitch = (Math.random() - 0.5) * owner.unit.spreadAngle * 0.35;
    const dir = baseDir.clone()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), pitch);

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: owner.state.redLock ? 0xff4f66 : 0x6df9ff }));
    mesh.position.copy(owner.root.position).add(new THREE.Vector3(0, 0.8, 0));
    scene.add(mesh);

    state.projectiles.push({
      owner,
      target,
      mesh,
      vel: dir.multiplyScalar(owner.unit.projectileSpeed),
      homing: owner.state.redLock,
      ttl: 2.2,
      damage: owner.unit.damage,
      hitStunMs: 200
    });
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

    if (p.homing && now >= p.target.state.evadeHomingUntil) {
      const desired = new THREE.Vector3().subVectors(p.target.root.position, p.mesh.position).normalize().multiplyScalar(p.vel.length());
      p.vel.lerp(desired, 0.12);
    }

    p.mesh.position.addScaledVector(p.vel, dt);
    const hitRadius = p.target.state.vulnerabilityMove ? 2 : 1.15;
    if (p.mesh.position.distanceTo(p.target.root.position) < hitRadius) {
      const mitigation = p.target.state.vulnerabilityMove ? 1.35 : 1;
      p.target.state.hp = Math.max(0, p.target.state.hp - p.damage * mitigation);
      p.target.state.hitStunUntil = performance.now() + p.hitStunMs;
      if (p.target.state.action === 'melee-lunge') {
        p.target.state.action = 'stagger';
        p.target.state.staggerUntil = now + 280;
        p.target.state.meleeLungeUntil = 0;
      }
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
  const grounded = mech.grounded;

  if (now < s.overheatedUntil) {
    s.action = 'hard-landing';
    mech.body.velocity.x = 0;
    mech.body.velocity.z = 0;
    mech.thrusters.forEach((t) => (t.material.opacity = 0.05));
    mech.plumeLight.intensity = 0;
    return;
  }

  s.action = action;
  const consume = ['dash', 'step', 'rise'].includes(action);
  if (consume) s.boost = Math.max(0, s.boost - 1.1);
  else if (grounded && now >= s.stackUntil) s.boost = Math.min(100, s.boost + 0.68); // +75% recovery

  if (s.boost <= 0) {
    s.overheatedUntil = now + 1500;
    s.action = 'hard-landing';
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
  if (now < state.player.state.hitStunUntil) {
    state.player.body.velocity.set(0, 0, 0);
    return;
  }

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const move = forward.clone().multiplyScalar(-input.y).add(right.multiplyScalar(input.x));

  const speed = input.boost ? 21 : 10;
  state.player.body.velocity.x = move.x * speed;
  state.player.body.velocity.z = move.z * speed;
  state.player.state.vulnerabilityMove = !input.boost && !input.step && Math.hypot(input.x, input.y) > 0.2;

  let action = 'idle';
  if (input.rise) {
    state.player.body.velocity.y = 10;
    action = 'rise';
  } else if (input.step) {
    state.player.body.velocity.x += move.x * 15;
    state.player.body.velocity.z += move.z * 15;
    state.player.state.evadeHomingUntil = now + 220;
    action = 'step';
  } else if (input.boost) {
    state.player.state.evadeHomingUntil = now + 120;
    action = 'dash';
  }

  if (input.shootTap) {
    spawnProjectiles(state.player, state.enemy);
    triggerEnemyEvasion(now);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }

  if (input.meleeTap) {
    if (state.player.state.redLock) {
      const lunge = new THREE.Vector3().subVectors(e, p).setY(0).normalize();
      state.player.body.velocity.x = lunge.x * 26;
      state.player.body.velocity.z = lunge.z * 26;
      const meleeReach = 4.4;
      if (p.distanceTo(e) < meleeReach) state.enemy.state.hp = Math.max(0, state.enemy.state.hp - 14);
      state.player.state.meleeAnimUntil = now + 120;
      state.player.state.meleeLungeUntil = now + 170;
      action = 'melee-lunge';
      if (state.speedLines) state.speedLines.style.opacity = '1';
    } else {
      action = 'melee-whiff';
    }
    input.meleeTap = false;
  }

  updateBoost(state.player, now, action);
}

function updateEnemy(now) {
  if (now < state.enemy.state.hitStunUntil) {
    state.enemy.body.velocity.set(0, 0, 0);
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

  state.enemy.body.velocity.x = move.x * 9.8;
  state.enemy.body.velocity.z = move.z * 9.8;

  if (dist < 10 && state.enemy.state.boost > 18 && now > state.enemy.state.stepCooldownUntil && Math.random() > 0.75) {
    const dodge = Math.random() > 0.5 ? side : side.clone().multiplyScalar(-1);
    state.enemy.body.velocity.x += dodge.x * 22;
    state.enemy.body.velocity.z += dodge.z * 22;
    state.enemy.state.evadeHomingUntil = now + 240;
    state.enemy.state.stepCooldownUntil = now + 520;
    state.enemy.state.action = 'step';
  } else {
    state.enemy.state.action = 'dash';
  }
  if (dist > 14 && Math.random() > 0.9) state.enemy.state.evadeHomingUntil = now + 90;

  if (now >= state.enemy.state.nextFireAt) {
    spawnProjectiles(state.enemy, state.player);
    state.enemy.state.nextFireAt = now + PhaserLikeBetween(1500, 3000);
  }
  if (Math.random() > 0.994) state.enemy.body.velocity.y = 9;

  if (dist < 5.5 && Math.random() > 0.82) {
    state.enemy.body.velocity.x += dir.x * 16;
    state.enemy.body.velocity.z += dir.z * 16;
    state.enemy.state.action = 'melee-lunge';
  }
  updateBoost(state.enemy, now, state.enemy.state.action);
}

function updateLocksAndReticle() {
  const dist = state.player.root.position.distanceTo(state.enemy.root.position);
  state.player.state.redLock = dist <= state.player.unit.lockRange;
  state.enemy.state.redLock = dist <= state.enemy.unit.lockRange;

  state.reticle.position.set(0, 0, 0.95);
  state.reticle.material.color.set(state.player.state.redLock ? 0xff5f72 : 0x7effbd);
  if (state.player.state.redLock !== state.reticleWasRed) {
    state.reticlePulseUntil = performance.now() + 180;
    state.reticleWasRed = state.player.state.redLock;
  }
  const distScale = THREE.MathUtils.clamp(7 / camera.position.distanceTo(state.enemy.root.position), 0.75, 1.6);
  const pulse = state.reticlePulseUntil > performance.now() ? 1.2 : 1;
  state.reticle.scale.setScalar(5.4 * distScale * pulse);
  state.reticle.quaternion.copy(camera.quaternion);
}

function updateTransforms() {
  [state.player, state.enemy].forEach((m) => {
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
    if (performance.now() < m.state.meleeAnimUntil) {
      m.arms.left.rotation.x = -1.65;
      m.arms.right.rotation.x = -1.65;
      m.arms.left.rotation.z = -0.25;
      m.arms.right.rotation.z = 0.25;
    } else {
      m.arms.left.rotation.x = 0;
      m.arms.right.rotation.x = 0;
      m.arms.left.rotation.z = 0;
      m.arms.right.rotation.z = 0;
    }
    m.root.rotation.x = m.state.action === 'melee-lunge' ? -0.22 : 0;
    if (performance.now() < m.state.staggerUntil) m.root.rotation.x = 0.18;
    if (m.state.action === 'melee-lunge' && performance.now() > m.state.meleeLungeUntil) m.state.action = 'idle';
    if (m.state.action === 'stagger' && performance.now() > m.state.staggerUntil) m.state.action = 'idle';
    if (!['dash', 'rise', 'step'].includes(m.state.action)) return;
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
  hudRefs.hp.style.width = `${state.player.state.hp}%`;
  hudRefs.boost.style.width = `${state.player.state.boost}%`;
  hudRefs.boost.style.background = state.player.state.overheatedUntil > performance.now() ? '#ff8c45' : '#90ff63';
  if (state.speedLines && performance.now() > state.player.state.meleeLungeUntil) state.speedLines.style.opacity = '0';
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
  if (state.reticle?.parent) state.reticle.parent.remove(state.reticle);
}

function startMatch() {
  cleanupMatch();
  renderer.domElement.style.pointerEvents = 'auto';
  state.player = createMech(0x62d7ff, UNIT_DATA[state.playerUnitKey]);
  state.enemy = createMech(0xff7ad5, UNIT_DATA[state.enemyUnitKey]);
  state.player.body.position.set(-8, 2.45, 0);
  state.enemy.body.position.set(8, 2.45, 0);
  state.reticle = makeReticleSprite();
  state.enemy.torso.add(state.reticle);
  hudRefs = setupHUD();
  state.phase = 'match';
  state.running = true;
  state.matchStartAt = performance.now();
  document.querySelector('.menu')?.remove();
}

function showSelectMenu() {
  cleanupMatch();
  state.phase = 'select';
  state.running = false;
  state.hud?.remove();
  renderer.domElement.style.pointerEvents = 'none';

  const menu = document.createElement('div');
  menu.className = 'menu';
  const unitEntries = Object.entries(UNIT_DATA);
  const unitButtons = unitEntries.map(([id, unit]) => `<button data-unit="${id}">${unit.name}</button>`).join('');
  menu.innerHTML = `<h2>Select Unit</h2>${unitButtons}`;
  app.appendChild(menu);

  menu.querySelectorAll('button[data-unit]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      state.playerUnitKey = button.dataset.unit;
      const fallbackEnemy = unitEntries.find(([id]) => id !== state.playerUnitKey)?.[0] ?? state.playerUnitKey;
      state.enemyUnitKey = fallbackEnemy;
      startMatch();
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
  if (!e.target.closest('.menu')) e.preventDefault();
});

window.addEventListener('touchstart', (e) => {
  if (!e.target.closest('.menu')) e.preventDefault();
}, { passive: false });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setupRootTouchAction();
showSelectMenu();
animate();

function showEndMenu(win) {
  state.phase = 'end';
  state.running = false;

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
  if (state.enemy.state.hp <= 0 || now <= state.enemy.state.stepCooldownUntil || Math.random() > 0.6) return;
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
    state.enemy.state.action = 'step';
  }
  state.enemy.state.evadeHomingUntil = now + 260;
  state.enemy.state.stepCooldownUntil = now + 520;
}

function PhaserLikeBetween(min, max) {
  return min + Math.random() * (max - min);
}

const clock = new THREE.Clock();
function animate() {
  try {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    const now = performance.now();

    if (state.running) {
      updatePlayer(now);
      updateEnemy(now);
      applyRepulsion(now);
      world.step(1 / 60, dt, 3);

      updateTransforms();
      updateLocksAndReticle();
      updateProjectileSystem(dt);
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
