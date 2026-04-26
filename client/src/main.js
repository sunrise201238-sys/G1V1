import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import './style.css';

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
scene.fog = new THREE.Fog(0x0a0d12, 35, 140);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 300);

scene.add(new THREE.HemisphereLight(0x89b7ff, 0x141414, 1));
const key = new THREE.DirectionalLight(0xcde2ff, 1.4);
key.position.set(20, 34, 14);
key.castShadow = true;
scene.add(key);

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), new THREE.MeshToonMaterial({ color: 0x1a1f2b }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
scene.add(new THREE.GridHelper(220, 44, 0x3f4a62, 0x252d3f));

function createMech(color) {
  const root = new THREE.Group();
  const armor = new THREE.MeshToonMaterial({ color });
  const steel = new THREE.MeshToonMaterial({ color: 0x394354 });

  const core = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 1.5), armor);
  root.add(core);

  const head = new THREE.Mesh(new THREE.BoxGeometry(1, 0.65, 1), steel);
  head.position.y = 1.55;
  root.add(head);

  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 1.4), steel);
  shoulderL.position.set(-1.35, 0.85, 0);
  root.add(shoulderL);
  const shoulderR = shoulderL.clone();
  shoulderR.position.x = 1.35;
  root.add(shoulderR);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), steel);
  armL.position.set(-1.45, -0.25, 0);
  root.add(armL);
  const armR = armL.clone();
  armR.position.x = 1.45;
  root.add(armR);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.45, 0.8), steel);
  legL.position.set(-0.45, -1.9, 0);
  root.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.45;
  root.add(legR);

  const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.12 });
  const thrusterL = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.9, 8), thrusterMat);
  thrusterL.rotation.x = Math.PI;
  thrusterL.position.set(-0.42, -2.4, -0.45);
  root.add(thrusterL);
  const thrusterR = thrusterL.clone();
  thrusterR.position.x = 0.42;
  root.add(thrusterR);

  const plumeLight = new THREE.PointLight(0x7efbff, 0, 7, 2);
  plumeLight.position.set(0, -2.2, -0.7);
  root.add(plumeLight);

  scene.add(root);

  const body = new CANNON.Body({
    mass: 3,
    shape: new CANNON.Box(new CANNON.Vec3(0.95, 1.8, 0.8)),
    material: new CANNON.Material('mech')
  });
  body.linearDamping = 0.24;
  body.position.set(0, 3, 0);
  world.addBody(body);

  return {
    root,
    body,
    thrusters: [thrusterL, thrusterR],
    plumeLight,
    trail: [],
    state: { action: 'idle', boost: 100, hp: 100, overheatedUntil: 0, redLock: false, lockRange: 24 }
  };
}

const player = createMech(0x62d7ff);
player.body.position.set(-8, 2.8, 0);
const enemy = createMech(0xff7ad5);
enemy.body.position.set(8, 2.8, 0);

const input = { x: 0, z: 0, boost: false, rise: false, drop: false, step: false, shootTap: false, meleeTap: false };
const projectiles = [];

function createHUD() {
  const hud = document.createElement('div');
  hud.className = 'touch-hud';
  hud.innerHTML = `
    <div class="lock" id="lock-state">GREEN LOCK</div>
    <div class="health"><div id="health-fill"></div></div>
    <div class="boost"><div id="boost-fill"></div></div>
    <div class="joy" id="joy"><div class="stick"></div></div>
    <div class="buttons">
      <button data-k="boost">BOOST</button>
      <button data-k="step">STEP</button>
      <button data-k="shoot">SHOOT</button>
      <button data-k="melee">MELEE</button>
      <button data-k="rise">RISE</button>
      <button data-k="drop">DROP</button>
    </div>
  `;
  app.appendChild(hud);

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
    input.z = Math.sin(ang) * (len / maxR);
  };

  joy.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    if (now - lastTapAt < 240) input.boost = true; // joystick double tap => BD
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
    input.z = 0;
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

  return {
    lock: hud.querySelector('#lock-state'),
    hp: hud.querySelector('#health-fill'),
    boost: hud.querySelector('#boost-fill')
  };
}

const hud = createHUD();

function spawnProjectile(owner, target) {
  const isRed = owner.state.redLock;
  const projectile = {
    owner,
    target,
    speed: isRed ? 34 : 28,
    homing: isRed,
    ttl: 2.5,
    mesh: new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: isRed ? 0xff5167 : 0x6df9ff }))
  };
  projectile.mesh.position.copy(owner.root.position).add(new THREE.Vector3(0, 0.8, 0));

  const dir = new THREE.Vector3().subVectors(target.root.position, owner.root.position).normalize();
  projectile.vel = dir.multiplyScalar(projectile.speed);
  scene.add(projectile.mesh);
  projectiles.push(projectile);
}

function updateProjectileSystem(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.ttl -= dt;
    if (p.ttl <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }

    if (p.homing) {
      const desired = new THREE.Vector3().subVectors(p.target.root.position, p.mesh.position).normalize().multiplyScalar(p.speed);
      p.vel.lerp(desired, 0.12);
    }

    p.mesh.position.addScaledVector(p.vel, dt);

    if (p.mesh.position.distanceTo(p.target.root.position) < 1.4) {
      p.target.state.hp = Math.max(0, p.target.state.hp - 6);
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function updateBoostAndAction(mech, now, desiredAction) {
  const s = mech.state;
  if (now < s.overheatedUntil) {
    s.action = 'hard-landing';
    mech.body.velocity.x = 0;
    mech.body.velocity.z = 0;
    mech.thrusters.forEach((t) => (t.material.opacity = 0.05));
    mech.plumeLight.intensity = 0;
    return;
  }

  s.action = desiredAction;
  const burnsBoost = ['dash', 'step', 'rise'].includes(s.action);
  if (burnsBoost) s.boost = Math.max(0, s.boost - 1.1);
  else s.boost = Math.min(100, s.boost + 0.45);

  if (s.boost <= 0) {
    s.overheatedUntil = now + 1500;
    s.action = 'hard-landing';
  }

  const thrusterOn = burnsBoost;
  mech.thrusters.forEach((t) => {
    t.material.opacity = thrusterOn ? 0.9 : 0.12;
    t.scale.set(1, thrusterOn ? 1.5 : 1, 1);
  });
  mech.plumeLight.intensity = thrusterOn ? 2.2 : 0;
}

function updatePlayer(now) {
  let action = 'idle';
  const speed = input.boost ? 20 : 10;
  player.body.velocity.x = input.x * speed;
  player.body.velocity.z = input.z * speed;

  if (input.rise) {
    player.body.velocity.y = 10;
    action = 'rise';
  } else if (input.drop) {
    player.body.velocity.y = -10;
    action = 'drop';
  } else if (input.step) {
    player.body.velocity.x += input.x * 15;
    player.body.velocity.z += input.z * 15;
    action = 'step';
  } else if (input.boost) {
    action = 'dash'; // BD-cancel: dash state overrides attacks instantly
  }

  if (input.shootTap) {
    spawnProjectile(player, enemy);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }

  if (input.meleeTap) {
    const dir = new THREE.Vector3().subVectors(enemy.root.position, player.root.position).normalize();
    player.body.velocity.x = dir.x * 16;
    player.body.velocity.z = dir.z * 16;
    if (action === 'idle') action = 'melee';
    input.meleeTap = false;
  }

  updateBoostAndAction(player, now, action);
}

function updateEnemy(now) {
  const vec = new THREE.Vector3().subVectors(player.root.position, enemy.root.position);
  const dist = Math.hypot(vec.x, vec.z);
  if (dist > 0.1) {
    enemy.body.velocity.x = (vec.x / dist) * 7;
    enemy.body.velocity.z = (vec.z / dist) * 7;
  }

  if (Math.random() > 0.986) spawnProjectile(enemy, player);
  if (Math.random() > 0.992) enemy.body.velocity.y = 9;
  updateBoostAndAction(enemy, now, dist > 10 ? 'dash' : 'idle');
}

function updateLocks() {
  const dist = player.root.position.distanceTo(enemy.root.position);
  player.state.redLock = dist <= player.state.lockRange;
  enemy.state.redLock = dist <= enemy.state.lockRange;
  hud.lock.textContent = player.state.redLock ? 'RED LOCK' : 'GREEN LOCK';
  hud.lock.className = `lock ${player.state.redLock ? 'red' : 'green'}`;
}

function updateMechTransforms() {
  [player, enemy].forEach((m) => {
    m.root.position.copy(m.body.position);
  });

  const pToE = new THREE.Vector3().subVectors(enemy.root.position, player.root.position).normalize();
  const eToP = pToE.clone().multiplyScalar(-1);
  player.root.rotation.y = Math.atan2(pToE.x, pToE.z);
  enemy.root.rotation.y = Math.atan2(eToP.x, eToP.z);

  [player, enemy].forEach((m) => {
    if (!['dash', 'rise'].includes(m.state.action)) return;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.4 }));
    puff.position.copy(m.root.position).add(new THREE.Vector3(0, -1.8, -0.6));
    scene.add(puff);
    m.trail.push({ mesh: puff, life: 0.22 });
  });

  [player, enemy].forEach((m) => {
    m.trail = m.trail.filter((t) => {
      t.life -= 1 / 60;
      t.mesh.material.opacity = Math.max(0, t.life * 1.5);
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
  const p = player.root.position;
  const e = enemy.root.position;
  const line = new THREE.Vector3().subVectors(e, p).normalize();
  const side = new THREE.Vector3(-line.z, 0, line.x);

  const desiredPos = new THREE.Vector3(
    p.x - line.x * 13 + side.x * 2,
    p.y + 6.8,
    p.z - line.z * 13 + side.z * 2
  );

  camera.position.lerp(desiredPos, 0.16);
  camera.lookAt(new THREE.Vector3((p.x + e.x) / 2, (p.y + e.y) / 2 + 2.2, (p.z + e.z) / 2));

  const dist = p.distanceTo(e);
  camera.fov = THREE.MathUtils.lerp(76, 46, THREE.MathUtils.clamp(1 - dist / 28, 0, 1));
  if (player.state.action === 'dash') camera.fov = Math.min(82, camera.fov + 5);
  camera.updateProjectionMatrix();
}

function updateHud() {
  hud.boost.style.width = `${player.state.boost}%`;
  hud.boost.style.background = player.state.overheatedUntil > performance.now() ? '#ff8c45' : '#90ff63';
  hud.hp.style.width = `${player.state.hp}%`;
}

const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const now = performance.now();

  updatePlayer(now);
  updateEnemy(now);
  world.step(1 / 60, dt, 3); // fixed timestep

  updateMechTransforms();
  updateLocks();
  updateProjectileSystem(dt);
  updateCamera();
  updateHud();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
