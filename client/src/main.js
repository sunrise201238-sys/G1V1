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
scene.add(new THREE.HemisphereLight(0x8cb2ff, 0x181818, 1));
const key = new THREE.DirectionalLight(0xe5eeff, 1.2);
key.position.set(18, 34, 12);
scene.add(key);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const gridCanvas = document.createElement('canvas');
gridCanvas.width = 512;
gridCanvas.height = 512;
const ctx = gridCanvas.getContext('2d');
ctx.fillStyle = '#1c2230';
ctx.fillRect(0, 0, 512, 512);
ctx.strokeStyle = '#3d4b64';
ctx.lineWidth = 2;
for (let i = 0; i < 16; i += 1) {
  ctx.beginPath();
  ctx.moveTo(i * 32, 0);
  ctx.lineTo(i * 32, 512);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, i * 32);
  ctx.lineTo(512, i * 32);
  ctx.stroke();
}
const gridTex = new THREE.CanvasTexture(gridCanvas);
gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
gridTex.repeat.set(8, 8);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), new THREE.MeshToonMaterial({ map: gridTex, color: 0xaac2ff }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

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

  make(new THREE.BoxGeometry(2.4, 2.35, 1.8), armor, 0, 0, 0);
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
  body.position.set(0, 3, 0);
  world.addBody(body);

  return {
    root,
    body,
    unit: unitData,
    thrusters: [thrusterL, thrusterR],
    plumeLight,
    trail: [],
    arms: { left: armL, right: armR },
    state: {
      action: 'idle',
      boost: 100,
      hp: 100,
      redLock: false,
      overheatedUntil: 0,
      hitStunUntil: 0,
      meleeAnimUntil: 0,
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
  for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
    const p = state.projectiles[i];
    p.ttl -= dt;
    if (p.ttl <= 0) {
      scene.remove(p.mesh);
      state.projectiles.splice(i, 1);
      continue;
    }

    if (p.homing) {
      const desired = new THREE.Vector3().subVectors(p.target.root.position, p.mesh.position).normalize().multiplyScalar(p.vel.length());
      p.vel.lerp(desired, 0.12);
    }

    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.distanceTo(p.target.root.position) < 1.4) {
      p.target.state.hp = Math.max(0, p.target.state.hp - p.damage);
      p.target.state.hitStunUntil = performance.now() + p.hitStunMs;
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
  const grounded = mech.body.position.y <= 2.9;

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

  const forward = new THREE.Vector3().subVectors(e, p).setY(0).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const move = forward.clone().multiplyScalar(-input.y).add(right.multiplyScalar(input.x));

  const speed = input.boost ? 21 : 10;
  state.player.body.velocity.x = move.x * speed;
  state.player.body.velocity.z = move.z * speed;

  let action = 'idle';
  if (input.rise) {
    state.player.body.velocity.y = 10;
    action = 'rise';
  } else if (input.step) {
    state.player.body.velocity.x += move.x * 15;
    state.player.body.velocity.z += move.z * 15;
    action = 'step';
  } else if (input.boost) {
    action = 'dash';
  }

  if (input.shootTap) {
    spawnProjectiles(state.player, state.enemy);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }

  if (input.meleeTap) {
    if (state.player.state.redLock) {
      const lunge = new THREE.Vector3().subVectors(e, p).setY(0).normalize();
      state.player.body.velocity.x = lunge.x * 20;
      state.player.body.velocity.z = lunge.z * 20;
      if (p.distanceTo(e) < 10) state.enemy.state.hp = Math.max(0, state.enemy.state.hp - 14);
      state.player.state.meleeAnimUntil = now + 180;
      action = 'melee-lunge';
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
  const retreat = dist < 14 ? -1.25 : dist > 22 ? 0.5 : -0.15;
  const lateral = Math.sin(now * 0.0024 + dist) > 0 ? 1 : -1;
  const move = dir.clone().multiplyScalar(retreat).add(side.multiplyScalar(lateral * (0.7 + Math.random() * 0.35)));

  state.enemy.body.velocity.x = move.x * 8.7;
  state.enemy.body.velocity.z = move.z * 8.7;

  if (dist < 9 && state.enemy.state.boost > 25 && Math.random() > 0.8) {
    state.enemy.body.velocity.x += -dir.x * 20;
    state.enemy.body.velocity.z += -dir.z * 20;
    state.enemy.state.action = 'step';
  }

  if (Math.random() > 0.982) spawnProjectiles(state.enemy, state.player);
  if (Math.random() > 0.994) state.enemy.body.velocity.y = 9;

  updateBoost(state.enemy, now, dist > 10 ? 'dash' : 'idle');
}

function updateLocksAndReticle() {
  const dist = state.player.root.position.distanceTo(state.enemy.root.position);
  state.player.state.redLock = dist <= state.player.unit.lockRange;
  state.enemy.state.redLock = dist <= state.enemy.unit.lockRange;

  state.reticle.position.copy(state.enemy.root.position).add(new THREE.Vector3(0, 2.8, 0));
  state.reticle.material.color.set(state.player.state.redLock ? 0xff5f72 : 0x7effbd);
  const distScale = THREE.MathUtils.clamp(7 / camera.position.distanceTo(state.enemy.root.position), 0.75, 1.6);
  state.reticle.scale.setScalar(5.4 * distScale);
  state.reticle.quaternion.copy(camera.quaternion);
}

function updateTransforms() {
  [state.player, state.enemy].forEach((m) => m.root.position.copy(m.body.position));
  const pToE = new THREE.Vector3().subVectors(state.enemy.root.position, state.player.root.position).normalize();
  state.player.root.rotation.y = Math.atan2(pToE.x, pToE.z);
  state.enemy.root.rotation.y = Math.atan2(-pToE.x, -pToE.z);

  [state.player, state.enemy].forEach((m) => {
    if (performance.now() < m.state.meleeAnimUntil) {
      m.arms.left.rotation.x = -0.95;
      m.arms.right.rotation.x = -0.95;
    } else {
      m.arms.left.rotation.x = 0;
      m.arms.right.rotation.x = 0;
    }
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
  if (state.reticle) scene.remove(state.reticle);
}

function startMatch() {
  cleanupMatch();
  state.player = createMech(0x62d7ff, UNIT_DATA[state.playerUnitKey]);
  state.enemy = createMech(0xff7ad5, UNIT_DATA[state.enemyUnitKey]);
  state.player.body.position.set(-8, 2.8, 0);
  state.enemy.body.position.set(8, 2.8, 0);
  state.reticle = makeReticleSprite();
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

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <h2>Select Unit</h2>
    <button id="u1">${UNIT_DATA.unit1.name}</button>
    <button id="u2">${UNIT_DATA.unit2.name}</button>
  `;
  app.appendChild(menu);

  menu.querySelector('#u1').onclick = () => {
    state.playerUnitKey = 'unit1';
    state.enemyUnitKey = 'unit2';
    startMatch();
  };
  menu.querySelector('#u2').onclick = () => {
    state.playerUnitKey = 'unit2';
    state.enemyUnitKey = 'unit1';
    startMatch();
  };
}

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

  menu.querySelector('#rematch').onclick = () => startMatch();
  menu.querySelector('#select').onclick = () => showSelectMenu();
}

const clock = new THREE.Clock();
function animate() {
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
  requestAnimationFrame(animate);
}

window.addEventListener('touchstart', (e) => {
  if (e.target.closest('.menu')) return;
  e.preventDefault();
}, { passive: false });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

showSelectMenu();
animate();
