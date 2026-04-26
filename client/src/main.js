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
scene.background = new THREE.Color(0x0b0f17);
scene.fog = new THREE.Fog(0x0b0f17, 28, 150);

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

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(280, 280),
  new THREE.MeshToonMaterial({ map: gridTex, color: 0xaac2ff })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

function createMech(color) {
  const root = new THREE.Group();
  const armor = new THREE.MeshToonMaterial({ color });
  const steel = new THREE.MeshToonMaterial({ color: 0x3b4658 });

  const make = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };

  make(new THREE.BoxGeometry(2, 2.2, 1.6), armor, 0, 0, 0);
  make(new THREE.BoxGeometry(1, 0.65, 1), steel, 0, 1.55, 0);
  make(new THREE.BoxGeometry(0.85, 0.85, 1.4), steel, -1.35, 0.85, 0);
  make(new THREE.BoxGeometry(0.85, 0.85, 1.4), steel, 1.35, 0.85, 0);
  make(new THREE.BoxGeometry(0.5, 1.2, 0.5), steel, -1.45, -0.25, 0);
  make(new THREE.BoxGeometry(0.5, 1.2, 0.5), steel, 1.45, -0.25, 0);
  make(new THREE.BoxGeometry(0.75, 1.45, 0.8), steel, -0.45, -1.9, 0);
  make(new THREE.BoxGeometry(0.75, 1.45, 0.8), steel, 0.45, -1.9, 0);

  const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.12 });
  const thrusterL = make(new THREE.ConeGeometry(0.24, 0.9, 8), thrusterMat, -0.42, -2.4, -0.45);
  thrusterL.rotation.x = Math.PI;
  const thrusterR = make(new THREE.ConeGeometry(0.24, 0.9, 8), thrusterMat, 0.42, -2.4, -0.45);
  thrusterR.rotation.x = Math.PI;

  const plumeLight = new THREE.PointLight(0x7efbff, 0, 7, 2);
  plumeLight.position.set(0, -2.2, -0.7);
  root.add(plumeLight);

  scene.add(root);

  const body = new CANNON.Body({
    mass: 3,
    shape: new CANNON.Box(new CANNON.Vec3(0.95, 1.8, 0.8)),
    linearDamping: 0.24
  });
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

const reticle = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x7effbd, transparent: true, opacity: 0.9 }));
reticle.scale.set(1.8, 1.8, 1);
scene.add(reticle);

const input = { x: 0, y: 0, boost: false, rise: false, step: false, shootTap: false, meleeTap: false };
const projectiles = [];

function createHUD() {
  const hud = document.createElement('div');
  hud.className = 'touch-hud';
  hud.innerHTML = `
    <div class="health"><div id="health-fill"></div></div>
    <div class="boost"><div id="boost-fill"></div></div>
    <div class="joy" id="joy"><div class="stick"></div></div>
    <div class="buttons" id="buttons"></div>
  `;
  app.appendChild(hud);

  const actions = ['boost', 'step', 'shoot', 'melee', 'rise']; // scalable action list
  const buttons = hud.querySelector('#buttons');
  actions.forEach((action) => {
    const b = document.createElement('button');
    b.dataset.k = action;
    b.textContent = action.toUpperCase();
    buttons.appendChild(b);
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

  return {
    hp: hud.querySelector('#health-fill'),
    boost: hud.querySelector('#boost-fill')
  };
}

const hud = createHUD();

function spawnProjectile(owner, target) {
  const red = owner.state.redLock;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), new THREE.MeshBasicMaterial({ color: red ? 0xff4f66 : 0x6df9ff }));
  mesh.position.copy(owner.root.position).add(new THREE.Vector3(0, 0.8, 0));
  scene.add(mesh);

  const vel = new THREE.Vector3().subVectors(target.root.position, owner.root.position).normalize().multiplyScalar(red ? 34 : 28);
  projectiles.push({ owner, target, mesh, vel, homing: red, ttl: 2.5 });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const p = projectiles[i];
    p.ttl -= dt;
    if (p.ttl <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }

    if (p.homing) {
      const desired = new THREE.Vector3().subVectors(p.target.root.position, p.mesh.position).normalize().multiplyScalar(p.vel.length());
      p.vel.lerp(desired, 0.12);
    }

    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.mesh.position.distanceTo(p.target.root.position) < 1.4) {
      p.target.state.hp = Math.max(0, p.target.state.hp - 8);
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function updateBoost(mech, now, action) {
  const s = mech.state;
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
  s.boost = consume ? Math.max(0, s.boost - 1.1) : Math.min(100, s.boost + 0.45);
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
  const p = player.root.position;
  const e = enemy.root.position;
  const forward = new THREE.Vector3().subVectors(e, p).setY(0).normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);

  // joystick fix: up (negative y) means forward toward opponent; left/right strafe
  const move = forward.clone().multiplyScalar(-input.y).add(right.multiplyScalar(input.x));
  const speed = input.boost ? 21 : 10;
  player.body.velocity.x = move.x * speed;
  player.body.velocity.z = move.z * speed;

  let action = 'idle';
  if (input.rise) {
    player.body.velocity.y = 10;
    action = 'rise';
  } else if (input.step) {
    player.body.velocity.x += move.x * 15;
    player.body.velocity.z += move.z * 15;
    action = 'step';
  } else if (input.boost) {
    action = 'dash'; // BD-cancel
  }

  if (input.shootTap) {
    spawnProjectile(player, enemy);
    if (action === 'idle') action = 'shoot';
    input.shootTap = false;
  }

  if (input.meleeTap) {
    const dist = p.distanceTo(e);
    if (dist < 11) {
      const lunge = new THREE.Vector3().subVectors(e, p).setY(0).normalize();
      player.body.velocity.x = lunge.x * 18;
      player.body.velocity.z = lunge.z * 18;
      enemy.state.hp = Math.max(0, enemy.state.hp - 12); // hitbox activation
      action = 'melee-hit';
    } else {
      action = 'melee-whiff';
    }
    input.meleeTap = false;
  }

  updateBoost(player, now, action);
}

function updateEnemy(now) {
  const vec = new THREE.Vector3().subVectors(player.root.position, enemy.root.position);
  const d = Math.hypot(vec.x, vec.z);
  if (d > 0.1) {
    enemy.body.velocity.x = (vec.x / d) * 7;
    enemy.body.velocity.z = (vec.z / d) * 7;
  }

  if (Math.random() > 0.985) spawnProjectile(enemy, player);
  if (Math.random() > 0.992) enemy.body.velocity.y = 9;
  updateBoost(enemy, now, d > 10 ? 'dash' : 'idle');
}

function updateLocks() {
  const dist = player.root.position.distanceTo(enemy.root.position);
  player.state.redLock = dist <= player.state.lockRange;
  enemy.state.redLock = dist <= enemy.state.lockRange;

  reticle.position.copy(enemy.root.position).add(new THREE.Vector3(0, 2.7, 0));
  reticle.material.color.set(player.state.redLock ? 0xff5f72 : 0x7effbd);
  reticle.quaternion.copy(camera.quaternion); // billboard
}

function updateTransforms() {
  [player, enemy].forEach((m) => m.root.position.copy(m.body.position));
  const pToE = new THREE.Vector3().subVectors(enemy.root.position, player.root.position).normalize();
  player.root.rotation.y = Math.atan2(pToE.x, pToE.z);
  enemy.root.rotation.y = Math.atan2(-pToE.x, -pToE.z);

  [player, enemy].forEach((m) => {
    if (!['dash', 'rise', 'step'].includes(m.state.action)) return;
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.4 }));
    puff.position.copy(m.root.position).add(new THREE.Vector3(0, -1.8, -0.6));
    scene.add(puff);
    m.trail.push({ mesh: puff, life: 0.2 });
  });

  [player, enemy].forEach((m) => {
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
  const p = player.root.position;
  const e = enemy.root.position;
  const line = new THREE.Vector3().subVectors(e, p).normalize();
  const side = new THREE.Vector3(-line.z, 0, line.x);

  const desired = new THREE.Vector3(p.x - line.x * 13 + side.x * 2, p.y + 6.8, p.z - line.z * 13 + side.z * 2);
  camera.position.lerp(desired, 0.16);
  camera.lookAt(new THREE.Vector3((p.x + e.x) / 2, (p.y + e.y) / 2 + 2.2, (p.z + e.z) / 2));

  const dist = p.distanceTo(e);
  camera.fov = THREE.MathUtils.lerp(76, 46, THREE.MathUtils.clamp(1 - dist / 28, 0, 1));
  if (player.state.action === 'dash') camera.fov = Math.min(82, camera.fov + 5);
  camera.updateProjectionMatrix();
}

function updateHUD() {
  hud.hp.style.width = `${player.state.hp}%`;
  hud.boost.style.width = `${player.state.boost}%`;
  hud.boost.style.background = player.state.overheatedUntil > performance.now() ? '#ff8c45' : '#90ff63';
}

const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const now = performance.now();

  updatePlayer(now);
  updateEnemy(now);
  world.step(1 / 60, dt, 3);

  updateTransforms();
  updateLocks();
  updateProjectiles(dt);
  updateCamera();
  updateHUD();

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
