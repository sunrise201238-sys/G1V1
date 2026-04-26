export const TICK_RATE_MS = 33;
export const ARENA = {
  width: 1280,
  depth: 900,
  minAltitude: 80,
  maxAltitude: 620
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const BOOST = {
  max: 100,
  dashDrainPerTick: 2.2,
  stepCost: 20,
  jumpCostPerTick: 1.3,
  regenPerTick: 0.85,
  overheatRecoverPerTick: 1.2,
  overheatThreshold: 28,
  dashSpeed: 18,
  cruiseSpeed: 8,
  altitudeSpeed: 7,
  stepDistance: 140,
  friction: 0.84,
  drag: 0.9,
  invulnerableStepMs: 140,
  cancelWindowMs: 250
};

export const MOVE_SET = {
  SHOOT: { name: 'Beam Rifle', damage: 8, cooldownMs: 250, range: 840, tracking: 0.13, isMelee: false },
  SUB_SHOOT: { name: 'Sub Weapon', damage: 11, cooldownMs: 550, range: 760, tracking: 0.08, isMelee: false },
  MELEE: { name: 'Beam Saber', damage: 17, cooldownMs: 700, range: 220, tracking: 0, isMelee: true, magnetism: 18 },
  HEAVY_MELEE: { name: 'Heavy Slash', damage: 23, cooldownMs: 1000, range: 260, tracking: 0, isMelee: true, magnetism: 22 }
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
    isStepping: false,
    isOverheated: false,
    overheatRecoveryTicks: 0,
    lockTargetId: id === 'p1' ? 'p2' : 'p1',
    trackingCutUntil: 0,
    actionState: 'idle',
    lastActionAt: 0,
    lastActionType: null,
    comboCount: 0,
    isKO: false
  };
}

export function getDistance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function applyBoostDash(fighter, move, now) {
  if (fighter.isKO || fighter.isOverheated) return false;

  const hasMove = Math.hypot(move.x ?? 0, move.z ?? 0) > 0.1;
  if (!hasMove || fighter.boost <= 0) return false;

  const angle = Math.atan2(move.z, move.x);
  fighter.vx = Math.cos(angle) * BOOST.dashSpeed;
  fighter.vz = Math.sin(angle) * BOOST.dashSpeed;
  fighter.isBoostDashing = true;
  fighter.actionState = 'dashing';
  fighter.lastActionAt = now;
  fighter.lastActionType = 'BOOST_DASH';
  return true;
}

export function applyBoostStep(fighter, move, now) {
  if (fighter.isKO || fighter.isOverheated || fighter.boost < BOOST.stepCost) return false;

  const x = move.x ?? fighter.facing;
  const z = move.z ?? 0;
  const angle = Math.atan2(z, x || 0.001);
  fighter.x += Math.cos(angle) * BOOST.stepDistance;
  fighter.z += Math.sin(angle) * BOOST.stepDistance;
  fighter.boost = Math.max(0, fighter.boost - BOOST.stepCost);
  fighter.isStepping = true;
  fighter.actionState = 'stepping';
  fighter.trackingCutUntil = now + BOOST.invulnerableStepMs;
  fighter.lastActionAt = now;
  fighter.lastActionType = 'BOOST_STEP';
  return true;
}

export function applyVerticalThrust(fighter, direction = 0) {
  if (fighter.isKO || fighter.isOverheated || direction === 0) return;
  fighter.vy += direction * BOOST.altitudeSpeed * 0.24;
  fighter.boost = Math.max(0, fighter.boost - BOOST.jumpCostPerTick);
}

export function resolveAction(attacker, defender, actionType, now) {
  const move = MOVE_SET[actionType];
  if (!move || attacker.isKO || defender.isKO) return { applied: false };

  const sinceLast = now - attacker.lastActionAt;
  const canCancel = sinceLast <= BOOST.cancelWindowMs && ['SHOOT', 'SUB_SHOOT', 'MELEE', 'HEAVY_MELEE'].includes(attacker.lastActionType);
  if (!canCancel && sinceLast < move.cooldownMs) {
    return { applied: false, reason: 'cooldown' };
  }

  if (move.isMelee) {
    const distance = getDistance3D(attacker, defender);
    if (distance <= move.range * 1.7) {
      const angle = Math.atan2(defender.z - attacker.z, defender.x - attacker.x);
      attacker.vx = Math.cos(angle) * move.magnetism;
      attacker.vz = Math.sin(angle) * move.magnetism;
      attacker.actionState = 'magnet-dash';
    }
  }

  const distance = getDistance3D(attacker, defender);
  if (distance > move.range) {
    attacker.lastActionAt = now;
    attacker.lastActionType = actionType;
    return { applied: false, whiff: true };
  }

  const stepCutTracking = !move.isMelee && defender.trackingCutUntil > now;
  if (stepCutTracking) {
    attacker.lastActionAt = now;
    attacker.lastActionType = actionType;
    return { applied: false, cut: true };
  }

  defender.health = clamp(defender.health - move.damage, 0, 100);
  defender.isKO = defender.health <= 0;
  attacker.lastActionAt = now;
  attacker.lastActionType = actionType;
  attacker.comboCount += 1;
  attacker.actionState = move.isMelee ? 'melee' : 'shooting';

  return {
    applied: true,
    damage: move.damage,
    defenderHealth: defender.health,
    isKO: defender.isKO
  };
}

export function tickFighter(fighter) {
  fighter.x = clamp(fighter.x + fighter.vx, 80, ARENA.width - 80);
  fighter.z = clamp(fighter.z + fighter.vz, 80, ARENA.depth - 80);
  fighter.y = clamp(fighter.y + fighter.vy, ARENA.minAltitude, ARENA.maxAltitude);

  fighter.vx *= BOOST.friction;
  fighter.vz *= BOOST.friction;
  fighter.vy *= BOOST.drag;

  if (fighter.isBoostDashing) {
    fighter.boost = Math.max(0, fighter.boost - BOOST.dashDrainPerTick);
    if (fighter.boost <= 0) {
      fighter.isOverheated = true;
      fighter.isBoostDashing = false;
      fighter.actionState = 'overheat';
      fighter.overheatRecoveryTicks = 0;
    }
  } else if (!fighter.isOverheated) {
    fighter.boost = Math.min(BOOST.max, fighter.boost + BOOST.regenPerTick);
  } else {
    fighter.overheatRecoveryTicks += 1;
    fighter.boost = Math.min(BOOST.max, fighter.boost + BOOST.overheatRecoverPerTick);
    fighter.vy -= 0.4;
    fighter.actionState = 'landing';
    if (fighter.boost >= BOOST.overheatThreshold) {
      fighter.isOverheated = false;
      fighter.actionState = 'idle';
    }
  }

  fighter.isStepping = false;
  if (Math.abs(fighter.vx) < 0.12) fighter.vx = 0;
  if (Math.abs(fighter.vz) < 0.12) fighter.vz = 0;
  if (Math.abs(fighter.vy) < 0.12) fighter.vy = 0;

  if (!fighter.isBoostDashing && !fighter.isOverheated && fighter.actionState !== 'shooting' && fighter.actionState !== 'melee') {
    fighter.actionState = 'idle';
  }
}

export function interpolateSnapshot(prev, next, alpha) {
  if (!prev || !next) return next ?? prev ?? null;
  const lerp = (a, b) => a + (b - a) * alpha;
  return {
    ...next,
    fighters: {
      p1: {
        ...next.fighters.p1,
        x: lerp(prev.fighters.p1.x, next.fighters.p1.x),
        y: lerp(prev.fighters.p1.y, next.fighters.p1.y),
        z: lerp(prev.fighters.p1.z, next.fighters.p1.z)
      },
      p2: {
        ...next.fighters.p2,
        x: lerp(prev.fighters.p2.x, next.fighters.p2.x),
        y: lerp(prev.fighters.p2.y, next.fighters.p2.y),
        z: lerp(prev.fighters.p2.z, next.fighters.p2.z)
      }
    }
  };
}

export function createInputBuffer(maxSize = 8) {
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
    peek() {
      return queue[0];
    },
    size() {
      return queue.length;
    }
  };
}
