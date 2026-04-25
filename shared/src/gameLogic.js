export const TICK_RATE_MS = 33;
export const ARENA = { width: 1280, height: 720, floorY: 560 };

export const MOVE_SET = {
  MAIN_ATTACK: { name: 'Main Attack', damage: 8, cooldownMs: 400, range: 90 },
  SUB_ATTACK: { name: 'Sub Attack', damage: 5, cooldownMs: 250, range: 70 },
  SP_ATTACK: { name: 'SP Attack', damage: 14, cooldownMs: 900, range: 110 },
  MAIN_MELEE: { name: 'Main Melee', damage: 11, cooldownMs: 600, range: 60 },
  SUB_MELEE: { name: 'Sub Melee', damage: 6, cooldownMs: 350, range: 50 },
  SP_MELEE: { name: 'SP Melee', damage: 16, cooldownMs: 1000, range: 65 }
};

export function createFighterState(id, x, characterId = 'nova') {
  return {
    id,
    characterId,
    x,
    y: ARENA.floorY,
    vx: 0,
    health: 100,
    facing: 1,
    dashEnergy: 100,
    lastActionAt: 0,
    lastActionType: null,
    comboCount: 0,
    isKO: false
  };
}

export function resolveAction(attacker, defender, actionType, now) {
  const move = MOVE_SET[actionType];
  if (!move || attacker.isKO || defender.isKO) return { applied: false };

  if (now - attacker.lastActionAt < move.cooldownMs) return { applied: false };

  const distance = Math.abs(attacker.x - defender.x);
  if (distance > move.range) {
    attacker.lastActionAt = now;
    attacker.lastActionType = actionType;
    return { applied: false, whiff: true };
  }

  defender.health = Math.max(0, defender.health - move.damage);
  defender.isKO = defender.health <= 0;
  attacker.lastActionAt = now;
  attacker.lastActionType = actionType;
  attacker.comboCount += 1;

  return {
    applied: true,
    damage: move.damage,
    defenderHealth: defender.health,
    isKO: defender.isKO
  };
}

export function applyBoostDash(fighter, direction, now) {
  if (fighter.dashEnergy < 20 || fighter.isKO) return false;
  fighter.dashEnergy -= 20;
  fighter.vx = 24 * direction;
  fighter.lastActionAt = now;
  fighter.lastActionType = 'BOOST_DASH';
  return true;
}

export function tickFighter(fighter) {
  fighter.x = Math.max(70, Math.min(ARENA.width - 70, fighter.x + fighter.vx));
  fighter.vx *= 0.7;
  fighter.dashEnergy = Math.min(100, fighter.dashEnergy + 0.2);
}
