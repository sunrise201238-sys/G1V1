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
scene.fog = new THREE.Fog(0x0a0d12, 30, 120);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300);

const hemi = new THREE.HemisphereLight(0x89b7ff, 0x141414, 1);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xcde2ff, 1.5);
key.position.set(20, 32, 14);
key.castShadow = true;
scene.add(key);

const world = new CANNON.World();
world.gravity.set(0, -9.82, 0);
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;

const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 220, 20, 20),
  new THREE.MeshToonMaterial({ color: 0x1b2029 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function createMech(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color, gradientMap: null });
  const dark = new THREE.MeshToonMaterial({ color: 0x2d3340 });

  const core = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 1.3), mat);
  core.castShadow = true;
  group.add(core);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.9), dark);
  head.position.y = 1.4;
  group.add(head);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), dark);
  leftArm.position.set(-1.05, 0.2, 0);
  group.add(leftArm);

  const rightArm = leftArm.clone();
  rightArm.position.x = 1.05;
  group.add(rightArm);

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.3, 0.6), dark);
  leftLeg.position.set(-0.42, -1.6, 0);
  group.add(leftLeg);

  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.42;
  group.add(rightLeg);

  const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x7efbff, transparent: true, opacity: 0.15 });
  const thrusterL = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.8, 10), thrusterMat);
  thrusterL.rotation.x = Math.PI;
  thrusterL.position.set(-0.35, -2.15, -0.35);
  group.add(thrusterL);

  const thrusterR = thrusterL.clone();
  thrusterR.position.x = 0.35;
  group.add(thrusterR);

  const body = new CANNON.Body({
    mass: 2,
    shape: new CANNON.Box(new CANNON.Vec3(0.8, 1.4, 0.7)),
    linearDamping: 0.22
  });
  body.position.set(0, 3, 0);
  world.addBody(body);

  scene.add(group);
  return {
    group,
    body,
    thrusters: [thrusterL, thrusterR],
    state: { boost: 100, overheated: false, overheatUntil: 0, action: 'idle' }
  };
}

const player = createMech(0x62d7ff);
player.body.position.set(-8, 3, 0);
const enemy = createMech(0xff7ad5);
enemy.body.position.set(8, 3, 0);

const moveInput = { x: 0, z: 0, boost: false, rise: false, drop: false, step: false, shoot: false, melee: false };

function makeTouchUI() {
  const hud = document.createElement('div');
  hud.className = 'touch-hud';
  hud.innerHTML = `
    <div class="status" id="status">LOCK-ON ENGAGED</div>
    <div class="boost"><div id="boost-fill"></div></div>
    <div class="joy" id="joy"></div>
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
  const stick = document.createElement('div');
  stick.className = 'stick';
  joy.appendChild(stick);
  let joyPointer = null;

  const updateStick = (x, y, pointer) => {
    const rect = joy.getBoundingClientRect();
    const dx = x - (rect.left + rect.width / 2);
    const dy = y - (rect.top + rect.height / 2);
    const len = Math.min(rect.width * 0.33, Math.hypot(dx, dy));
    const ang = Math.atan2(dy, dx);
    stick.style.transform = `translate(${Math.cos(ang) * len}px, ${Math.sin(ang) * len}px)`;
    moveInput.x = Math.cos(ang) * (len / (rect.width * 0.33));
    moveInput.z = Math.sin(ang) * (len / (rect.width * 0.33));
    joyPointer = pointer;
  };

  joy.addEventListener('pointerdown', (e) => updateStick(e.clientX, e.clientY, e.pointerId));
  window.addEventListener('pointermove', (e) => {
    if (joyPointer !== e.pointerId) return;
    updateStick(e.clientX, e.clientY, joyPointer);
  });
  window.addEventListener('pointerup', (e) => {
    if (joyPointer !== e.pointerId) return;
    joyPointer = null;
    moveInput.x = 0;
    moveInput.z = 0;
    stick.style.transform = 'translate(0px,0px)';
  });

  hud.querySelectorAll('button').forEach((btn) => {
    const key = btn.dataset.k;
    btn.addEventListener('pointerdown', () => {
      moveInput[key] = true;
    });
    btn.addEventListener('pointerup', () => {
      moveInput[key] = false;
    });
  });

  return {
    status: hud.querySelector('#status'),
    boostFill: hud.querySelector('#boost-fill')
  };
}

const hud = makeTouchUI();

function applyBoostState(mech, now) {
  const s = mech.state;
  if (s.overheated) {
    mech.thrusters.forEach((t) => (t.material.opacity = 0.05));
    if (now >= s.overheatUntil) {
      s.overheated = false;
      s.boost = 35;
    }
    return;
  }

  const boosting = s.action === 'dash' || s.action === 'rise' || s.action === 'step';
  if (boosting) s.boost = Math.max(0, s.boost - 0.9);
  else s.boost = Math.min(100, s.boost + 0.45);

  if (s.boost <= 0) {
    s.overheated = true;
    s.overheatUntil = now + 1500;
    s.action = 'overheat';
  }

  mech.thrusters.forEach((t) => {
    t.material.opacity = boosting ? 0.9 : 0.12;
    t.scale.setScalar(boosting ? 1.25 : 1);
  });
}

function updatePlayer(now) {
  const s = player.state;
  if (s.overheated) {
    player.body.velocity.x = 0;
    player.body.velocity.z = 0;
    return;
  }

  const speed = moveInput.boost ? 18 : 9;
  player.body.velocity.x = moveInput.x * speed;
  player.body.velocity.z = moveInput.z * speed;

  if (moveInput.rise) {
    player.body.velocity.y = 8;
    s.action = 'rise';
  } else if (moveInput.drop) {
    player.body.velocity.y = -8;
    s.action = 'drop';
  } else if (moveInput.step) {
    player.body.velocity.x += moveInput.x * 12;
    player.body.velocity.z += moveInput.z * 12;
    s.action = 'step'; // step cancel pivot
  } else if (moveInput.boost) {
    s.action = 'dash';
  } else if (moveInput.shoot) {
    s.action = 'shoot';
  } else if (moveInput.melee) {
    const dir = new THREE.Vector3(
      enemy.body.position.x - player.body.position.x,
      0,
      enemy.body.position.z - player.body.position.z
    ).normalize();
    player.body.velocity.x = dir.x * 14;
    player.body.velocity.z = dir.z * 14;
    s.action = 'melee'; // step cancel / dash can interrupt next frame
  } else {
    s.action = 'idle';
  }

  applyBoostState(player, now);
}

function updateEnemy(now) {
  const dir = new CANNON.Vec3(
    player.body.position.x - enemy.body.position.x,
    0,
    player.body.position.z - enemy.body.position.z
  );
  const dist = Math.hypot(dir.x, dir.z);
  if (dist > 0.1) {
    enemy.body.velocity.x = (dir.x / dist) * 7;
    enemy.body.velocity.z = (dir.z / dist) * 7;
  }
  enemy.state.action = dist > 10 ? 'dash' : 'shoot';
  if (Math.random() > 0.985) enemy.body.velocity.y = 8;
  applyBoostState(enemy, now);
}

function syncMechMeshes() {
  [player, enemy].forEach((mech) => {
    mech.group.position.copy(mech.body.position);
    const toward = new THREE.Vector3(
      (mech === player ? enemy.body.position.x : player.body.position.x) - mech.body.position.x,
      0,
      (mech === player ? enemy.body.position.z : player.body.position.z) - mech.body.position.z
    );
    if (toward.lengthSq() > 0.01) {
      mech.group.rotation.y = Math.atan2(toward.x, toward.z);
    }
  });
}

function updateCamera() {
  const p = player.body.position;
  const e = enemy.body.position;

  const toEnemy = new THREE.Vector3(e.x - p.x, e.y - p.y, e.z - p.z);
  const planar = new THREE.Vector3(toEnemy.x, 0, toEnemy.z).normalize();
  const shoulder = new THREE.Vector3(-planar.z, 0, planar.x);
  const distance = THREE.MathUtils.clamp(Math.hypot(toEnemy.x, toEnemy.z), 6, 26);

  const desired = new THREE.Vector3(
    p.x - planar.x * (distance * 0.7) + shoulder.x * 2,
    p.y + 6 + Math.abs(toEnemy.y) * 0.22,
    p.z - planar.z * (distance * 0.7) + shoulder.z * 2
  );

  camera.position.lerp(desired, 0.12);

  const midpoint = new THREE.Vector3((p.x + e.x) / 2, (p.y + e.y) / 2 + 1.8, (p.z + e.z) / 2);
  camera.lookAt(midpoint);

  const meleeZoom = THREE.MathUtils.clamp(1 - distance / 24, 0, 1);
  camera.fov = THREE.MathUtils.lerp(75, 45, meleeZoom);
  if (player.state.action === 'dash') camera.fov = Math.min(80, camera.fov + 6);
  camera.updateProjectionMatrix();
}

const clock = new THREE.Clock();
function animate() {
  const delta = Math.min(clock.getDelta(), 0.033);
  const now = performance.now();

  updatePlayer(now);
  updateEnemy(now);

  world.step(1 / 60, delta, 3);
  syncMechMeshes();
  updateCamera();

  hud.status.textContent = player.state.overheated ? 'OVERHEAT RECOVERY' : 'LOCK-ON ENGAGED';
  hud.boostFill.style.width = `${player.state.boost}%`;
  hud.boostFill.style.background = player.state.overheated ? '#ff8c45' : '#90ff63';

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
