export const TICK_RATE_MS = 25;
export const ARENA = {
  width: 1280,
  depth: 900,
  minAltitude: 60,
  maxAltitude: 640
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const BOOST = {
  max: 100,
  dashDrainPerTick: 2.4,
  stepCost: 18,
  riseDropCostPerTick: 1.6,
  regenPerTick: 0.92,
  dashSpeed: 22,
  cruiseSpeed: 8.8,
  altitudeSpeed: 9,
  stepDistance: 180,
  friction: 0.82,
  drag: 0.88,
  fallDrag: 0.96,
  gravityPerTick: 1.25,
  maxFallSpeed: 18,
  riseThrustFactor: 0.3,
  dropThrustFactor: 0.68,
  dashFallSuspendMs: 560,
  stepFallSuspendMs: 380,
  shootFallSuspendMs: 540,
  dashDurationMs: 220,
  boostMomentumDurationMs: 500,
  boostMomentumCarry: 0.72,
  stepMomentumDurationMs: 260,
  stepMomentumCarry: 0.52,
  shootMomentumDurationMs: 220,
  shootMomentumCarry: 0.35,
  meleeMomentumDurationMs: 280,
  meleeMomentumCarry: 0.45,
  trackingCutMs: 220,
  overheatDurationMs: 1500,
  cancelWindowMs: 280
};

export const MOVE_SET = {
  SHOOT: { name: 'Beam Rifle', damage: 8, cooldownMs: 230, range: 920, projectileSpeed: 24, turnRate: 0.12, hitRadius: 34, isMelee: false },
  SUB_SHOOT: { name: 'Scatter Shot', damage: 10, cooldownMs: 500, range: 760, projectileSpeed: 18, turnRate: 0.09, hitRadius: 40, isMelee: false },
  MELEE: { name: 'Beam Saber', damage: 16, cooldownMs: 620, range: 240, magnetismSpeed: 20, isMelee: true },
  HEAVY_MELEE: { name: 'Crush Slash', damage: 22, cooldownMs: 950, range: 270, magnetismSpeed: 25, isMelee: true, heavy: true }
};

const ACTION_HANDLERS = {
  MOVE_VECTOR: applyMoveVectorAction,
  BOOST_DASH: applyBoostDashAction,
  BOOST_STEP: applyBoostStepAction,
  VERTICAL_THRUST: applyVerticalThrustAction,
  SHOOT: applyCombatAction,
  SUB_SHOOT: applyCombatAction,
  MELEE: applyCombatAction,
  HEAVY_MELEE: applyCombatAction
};

export function createFighterState(id, x, z, characterId = 'nova') {
  return {
    id,
    characterId,
    x,
    z,
    y: 220,
    vx: 0,
    vz: 0,
    vy: 0,
    health: 100,
    facing: 1,
    boost: BOOST.max,
    isBoostDashing: false,
    dashEndsAt: 0,
    isOverheated: false,
    overheatUntil: 0,
    canCancelUntil: 0,
    lockTargetId: id === 'p1' ? 'p2' : 'p1',
    trackingCutUntil: 0,
    suspendFallUntil: 0,
    momentumUntil: 0,
    momentumStartedAt: 0,
    momentumDurationMs: 0,
    momentumVx: 0,
    momentumVz: 0,
    actionState: 'idle',
    lastActionAt: 0,
    lastActionType: null,
    comboCount: 0,
    isKO: false
  };
}

export function createMatchState() {
  return {
    fighters: {
      p1: createFighterState('p1', 320, 260, 'nova'),
      p2: createFighterState('p2', 940, 620, 'aegis')
    },
    projectiles: [],
    tick: 0
  };
}

export function getDistance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function applyBoostDash(fighter, move, now) {
  const result = applyAction({ attacker: fighter, actionType: 'BOOST_DASH', move, now });
  return result.applied;
}

export function applyBoostStep(fighter, move, now) {
  const result = applyAction({ attacker: fighter, actionType: 'BOOST_STEP', move, now });
  return result.applied;
}

export function applyVerticalThrust(fighter, direction = 0, now = Date.now()) {
  const result = applyAction({ attacker: fighter, actionType: 'VERTICAL_THRUST', vertical: direction, now });
  return result.applied;
}

function enterOverheat(fighter, now) {
  fighter.isOverheated = true;
  fighter.overheatUntil = now + BOOST.overheatDurationMs;
  fighter.isBoostDashing = false;
  fighter.dashEndsAt = 0;
  clearMomentum(fighter);
  fighter.vx = 0;
  fighter.vz = 0;
  fighter.vy = -2;
  fighter.actionState = 'overheat';
}

export function resolveAction(attacker, defender, actionType, now, projectiles = []) {
  return applyAction({ attacker, defender, actionType, now, projectiles });
}

export function applyMoveVector(fighter, move, now = Date.now()) {
  const result = applyAction({ attacker: fighter, actionType: 'MOVE_VECTOR', move, now });
  return result.applied;
}

export function applyAction({ attacker, defender = null, actionType, now = Date.now(), move = null, vertical = 0, projectiles = [] }) {
  const handler = ACTION_HANDLERS[actionType];
  if (!handler) return { applied: false, reason: 'unknown-action' };
  return handler({ attacker, defender, actionType, now, move, vertical, projectiles });
}

function applyMoveVectorAction({ attacker, move, now }) {
  if (attacker.isKO || attacker.isOverheated) return { applied: false };
  const mag = Math.hypot(move?.x ?? 0, move?.z ?? 0);
  if (mag < 0.1) return { applied: false };

  const targetVx = (move?.x ?? 0) * BOOST.cruiseSpeed;
  const targetVz = (move?.z ?? 0) * BOOST.cruiseSpeed;
  if (isInMomentumPhase(attacker, now)) {
    return { applied: true };
  } else {
    attacker.vx = targetVx;
    attacker.vz = targetVz;
  }
  attacker.facing = (move?.x ?? 0) >= 0 ? 1 : -1;
  return { applied: true };
}

function applyBoostDashAction({ attacker, now, move }) {
  if (attacker.isKO || attacker.isOverheated) return { applied: false };
  const mag = Math.hypot(move?.x ?? 0, move?.z ?? 0);
  if (mag < 0.1 || attacker.boost <= 0) return { applied: false };

  const angle = Math.atan2(move.z, move.x);
  attacker.vx = Math.cos(angle) * BOOST.dashSpeed;
  attacker.vz = Math.sin(angle) * BOOST.dashSpeed;
  attacker.isBoostDashing = true;
  attacker.dashEndsAt = now + BOOST.dashDurationMs;
  clearMomentum(attacker);
  attacker.actionState = 'dashing';
  attacker.lastActionAt = now;
  attacker.lastActionType = 'BOOST_DASH';
  suspendFall(attacker, now, BOOST.dashFallSuspendMs);
  return { applied: true };
}

function applyBoostStepAction({ attacker, now, move }) {
  if (attacker.isKO || attacker.isOverheated || attacker.boost < BOOST.stepCost) return { applied: false };

  const angle = Math.atan2(move?.z ?? 0, move?.x ?? attacker.facing);
  attacker.x += Math.cos(angle) * BOOST.stepDistance;
  attacker.z += Math.sin(angle) * BOOST.stepDistance;
  attacker.boost = Math.max(0, attacker.boost - BOOST.stepCost);
  attacker.trackingCutUntil = now + BOOST.trackingCutMs;
  attacker.canCancelUntil = now + BOOST.cancelWindowMs;
  attacker.actionState = 'stepping';
  attacker.lastActionAt = now;
  attacker.lastActionType = 'BOOST_STEP';
  startMomentum(attacker, now, {
    durationMs: BOOST.stepMomentumDurationMs,
    vx: Math.cos(angle) * BOOST.cruiseSpeed * BOOST.stepMomentumCarry,
    vz: Math.sin(angle) * BOOST.cruiseSpeed * BOOST.stepMomentumCarry
  });
  suspendFall(attacker, now, BOOST.stepFallSuspendMs);
  return { applied: true };
}

function applyVerticalThrustAction({ attacker, now, vertical }) {
  if (attacker.isKO || attacker.isOverheated || vertical === 0 || attacker.boost <= 0) return { applied: false };
  const thrustFactor = vertical > 0 ? BOOST.riseThrustFactor : BOOST.dropThrustFactor;
  attacker.vy += vertical * BOOST.altitudeSpeed * thrustFactor;
  attacker.boost = Math.max(0, attacker.boost - BOOST.riseDropCostPerTick);
  attacker.actionState = vertical > 0 ? 'rising' : 'dropping';
  attacker.canCancelUntil = now + BOOST.cancelWindowMs;
  return { applied: true };
}

function applyCombatAction({ attacker, defender, actionType, now, projectiles }) {
  const move = MOVE_SET[actionType];
  if (!move || attacker.isKO || defender?.isKO || attacker.isOverheated || !defender) return { applied: false };

  const sinceLast = now - attacker.lastActionAt;
  const canCancel = now <= attacker.canCancelUntil;
  if (!canCancel && sinceLast < move.cooldownMs) return { applied: false, reason: 'cooldown' };

  attacker.lastActionAt = now;
  attacker.lastActionType = actionType;
  attacker.canCancelUntil = now + BOOST.cancelWindowMs;

  if (!move.isMelee) {
    projectiles.push(createProjectile(attacker, defender, move, now));
    attacker.actionState = 'shooting';
    startMomentum(attacker, now, {
      durationMs: BOOST.shootMomentumDurationMs,
      vx: attacker.vx * BOOST.shootMomentumCarry,
      vz: attacker.vz * BOOST.shootMomentumCarry
    });
    suspendFall(attacker, now, BOOST.shootFallSuspendMs);
    return { applied: true, spawnedProjectile: true };
  }

  const distance = getDistance3D(attacker, defender);
  if (distance <= move.range * 1.75) {
    const angle = Math.atan2(defender.z - attacker.z, defender.x - attacker.x);
    attacker.vx = Math.cos(angle) * move.magnetismSpeed;
    attacker.vz = Math.sin(angle) * move.magnetismSpeed;
    attacker.actionState = 'magnet-dash';
  }

  if (distance > move.range) return { applied: false, whiff: true };

  defender.health = clamp(defender.health - move.damage, 0, 100);
  defender.isKO = defender.health <= 0;
  attacker.comboCount += 1;
  attacker.actionState = move.heavy ? 'heavy-melee' : 'melee';
  startMomentum(attacker, now, {
    durationMs: BOOST.meleeMomentumDurationMs,
    vx: attacker.vx * BOOST.meleeMomentumCarry,
    vz: attacker.vz * BOOST.meleeMomentumCarry
  });
  return { applied: true, damage: move.damage, isKO: defender.isKO, heavy: !!move.heavy };
}

function createProjectile(attacker, defender, move, now) {
  const angle = Math.atan2(defender.z - attacker.z, defender.x - attacker.x);
  return {
    id: `${attacker.id}-${now}-${Math.random().toString(16).slice(2, 8)}`,
    ownerId: attacker.id,
    targetId: defender.id,
    x: attacker.x,
    y: attacker.y,
    z: attacker.z,
    vx: Math.cos(angle) * move.projectileSpeed,
    vy: 0,
    vz: Math.sin(angle) * move.projectileSpeed,
    damage: move.damage,
    turnRate: move.turnRate,
    maxRange: move.range,
    travelled: 0,
    hitRadius: move.hitRadius,
    expiresAt: now + 3000
  };
}

export function tickProjectiles(matchState, now = Date.now()) {
  const { fighters, projectiles } = matchState;
  const survivors = [];
  const hits = [];

  for (const projectile of projectiles) {
    const target = fighters[projectile.targetId];
    if (!target || target.isKO || now > projectile.expiresAt) continue;

    if (target.trackingCutUntil <= now) {
      const desiredAngle = Math.atan2(target.z - projectile.z, target.x - projectile.x);
      const currentAngle = Math.atan2(projectile.vz, projectile.vx);
      const nextAngle = currentAngle + PhaserMathAngleWrap(desiredAngle - currentAngle) * projectile.turnRate;
      const speed = Math.hypot(projectile.vx, projectile.vz);
      projectile.vx = Math.cos(nextAngle) * speed;
      projectile.vz = Math.sin(nextAngle) * speed;
    }

    projectile.x += projectile.vx;
    projectile.y += projectile.vy;
    projectile.z += projectile.vz;
    projectile.travelled += Math.hypot(projectile.vx, projectile.vz, projectile.vy);

    const inRange = projectile.travelled <= projectile.maxRange;
    if (!inRange) continue;

    const distance = Math.hypot(projectile.x - target.x, projectile.y - target.y, projectile.z - target.z);
    if (distance <= projectile.hitRadius) {
      target.health = clamp(target.health - projectile.damage, 0, 100);
      target.isKO = target.health <= 0;
      hits.push({ targetId: target.id, damage: projectile.damage });
      continue;
    }

    survivors.push(projectile);
  }

  matchState.projectiles = survivors;
  return hits;
}

export function tickFighter(fighter, now = Date.now()) {
  if (fighter.isOverheated) {
    fighter.x = clamp(fighter.x, 80, ARENA.width - 80);
    fighter.z = clamp(fighter.z, 80, ARENA.depth - 80);
    fighter.y = clamp(fighter.y + fighter.vy, ARENA.minAltitude, ARENA.maxAltitude);
    fighter.vy *= BOOST.drag;
    fighter.actionState = 'overheat';
    if (now >= fighter.overheatUntil) {
      fighter.isOverheated = false;
      fighter.actionState = 'idle';
      fighter.boost = Math.max(BOOST.max * 0.35, fighter.boost);
      fighter.vy = 0;
    }
    return;
  }

  const fallingLocked = isFallingSuspended(fighter, now);
  tickMomentum(fighter, now);
  if (fallingLocked && fighter.y > ARENA.minAltitude && fighter.vy < 0) fighter.vy = 0;

  fighter.x = clamp(fighter.x + fighter.vx, 80, ARENA.width - 80);
  fighter.z = clamp(fighter.z + fighter.vz, 80, ARENA.depth - 80);
  fighter.y = clamp(fighter.y + fighter.vy, ARENA.minAltitude, ARENA.maxAltitude);

  fighter.vx *= BOOST.friction;
  fighter.vz *= BOOST.friction;
  fighter.vy *= fighter.vy < 0 ? BOOST.fallDrag : BOOST.drag;

  if (fighter.y <= ARENA.minAltitude) fighter.vy = Math.max(0, fighter.vy);
  else if (fallingLocked) fighter.vy = Math.max(0, fighter.vy);
  else fighter.vy = Math.max(-BOOST.maxFallSpeed, fighter.vy - BOOST.gravityPerTick);

  if (fighter.isBoostDashing) {
    fighter.boost = Math.max(0, fighter.boost - BOOST.dashDrainPerTick);
    if (now >= fighter.dashEndsAt) {
      fighter.isBoostDashing = false;
      startMomentum(fighter, now, {
        durationMs: BOOST.boostMomentumDurationMs,
        vx: fighter.vx * BOOST.boostMomentumCarry,
        vz: fighter.vz * BOOST.boostMomentumCarry
      });
    }
    if (fighter.boost <= 0) {
      enterOverheat(fighter, now);
      return;
    }
  } else if (isInMomentumPhase(fighter, now)) {
    // Momentum glide itself should not consume or regenerate boost.
  } else {
    fighter.boost = Math.min(BOOST.max, fighter.boost + BOOST.regenPerTick);
  }

  if (Math.abs(fighter.vx) < 0.14) fighter.vx = 0;
  if (Math.abs(fighter.vz) < 0.14) fighter.vz = 0;
  if (Math.abs(fighter.vy) < 0.14) fighter.vy = 0;

  fighter.isBoostDashing = fighter.isBoostDashing && fighter.boost > 0.5 && now < fighter.dashEndsAt;
  if (!fighter.isBoostDashing && now > fighter.canCancelUntil && !fighter.actionState.includes('melee') && fighter.actionState !== 'shooting') {
    fighter.actionState = 'idle';
  }
}

export function tickMatch(matchState, now = Date.now()) {
  tickFighter(matchState.fighters.p1, now);
  tickFighter(matchState.fighters.p2, now);
  const hits = tickProjectiles(matchState, now);
  matchState.tick += 1;
  return hits;
}

export function interpolateSnapshot(prev, next, alpha) {
  if (!prev || !next) return next ?? prev ?? null;
  const lerp = (a, b) => a + (b - a) * alpha;
  const lerpFighter = (a, b) => ({
    ...b,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z)
  });
  const lerpProjectile = (a, b) => ({
    ...b,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z)
  });

  const prevProjMap = new Map((prev.projectiles ?? []).map((p) => [p.id, p]));
  const projectiles = (next.projectiles ?? []).map((p) => {
    const prevP = prevProjMap.get(p.id);
    return prevP ? lerpProjectile(prevP, p) : p;
  });

  return {
    ...next,
    fighters: {
      p1: lerpFighter(prev.fighters.p1, next.fighters.p1),
      p2: lerpFighter(prev.fighters.p2, next.fighters.p2)
    },
    projectiles
  };
}

export function createInputBuffer(maxSize = 10) {
  const queue = [];
  return {
    push(input) {
      queue.push(input);
      if (queue.length > maxSize) queue.shift();
    },
    flush() {
      const drained = [...queue];
      queue.length = 0;
      return drained;
    },
    size() {
      return queue.length;
    }
  };
}

function PhaserMathAngleWrap(angle) {
  while (angle <= -Math.PI) angle += Math.PI * 2;
  while (angle > Math.PI) angle -= Math.PI * 2;
  return angle;
}

function suspendFall(fighter, now, durationMs = BOOST.cancelWindowMs) {
  fighter.suspendFallUntil = Math.max(fighter.suspendFallUntil ?? 0, now + durationMs);
}

function isFallingSuspended(fighter, now) {
  return fighter.isBoostDashing || now <= (fighter.suspendFallUntil ?? 0);
}

function isInMomentumPhase(fighter, now) {
  return fighter.isBoostDashing || now <= (fighter.momentumUntil ?? 0);
}

function clearMomentum(fighter) {
  fighter.momentumUntil = 0;
  fighter.momentumStartedAt = 0;
  fighter.momentumDurationMs = 0;
  fighter.momentumVx = 0;
  fighter.momentumVz = 0;
}

function startMomentum(fighter, now, { durationMs, vx, vz }) {
  fighter.momentumStartedAt = now;
  fighter.momentumDurationMs = durationMs;
  fighter.momentumUntil = now + durationMs;
  fighter.momentumVx = vx;
  fighter.momentumVz = vz;
}

function tickMomentum(fighter, now) {
  if (fighter.isBoostDashing) return;
  if (now > (fighter.momentumUntil ?? 0)) return;

  const elapsed = now - fighter.momentumStartedAt;
  const ratio = 1 - elapsed / Math.max(1, fighter.momentumDurationMs);
  const desiredVx = fighter.momentumVx * Math.max(0, ratio);
  const desiredVz = fighter.momentumVz * Math.max(0, ratio);

  if (Math.abs(fighter.vx) < Math.abs(desiredVx)) fighter.vx = desiredVx;
  if (Math.abs(fighter.vz) < Math.abs(desiredVz)) fighter.vz = desiredVz;
}
