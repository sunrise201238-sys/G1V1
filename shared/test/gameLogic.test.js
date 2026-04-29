import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOST,
  createMatchState,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  applyMoveVector,
  tickMatch,
  interpolateSnapshot,
  createInputBuffer
} from '../src/gameLogic.js';

test('shoot spawns tracking projectile', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  const p2 = match.fighters.p2;
  const result = resolveAction(p1, p2, 'SHOOT', 1000, match.projectiles);
  assert.equal(result.applied, true);
  assert.equal(result.spawnedProjectile, true);
  assert.equal(match.projectiles.length, 1);
});

test('step breaks projectile tracking window', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  const p2 = match.fighters.p2;

  resolveAction(p1, p2, 'SHOOT', 1000, match.projectiles);
  applyBoostStep(p2, { x: 1, z: 0 }, 1005);
  const hitBefore = p2.health;
  for (let i = 0; i < 4; i += 1) tickMatch(match, 1010 + i * 25);
  assert.equal(p2.health, hitBefore);
});

test('boost depletion triggers 1.5s overheat', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  p1.boost = 2;
  applyBoostDash(p1, { x: 1, z: 0 }, 1000);

  tickMatch(match, 1025);
  assert.equal(p1.isOverheated, true);
  assert.equal(p1.overheatUntil, 1025 + BOOST.overheatDurationMs);

  tickMatch(match, p1.overheatUntil - 1);
  assert.equal(p1.isOverheated, true);
  tickMatch(match, p1.overheatUntil + 1);
  assert.equal(p1.isOverheated, false);
});

test('interpolation includes projectiles', () => {
  const prev = {
    fighters: { p1: { x: 0, y: 0, z: 0 }, p2: { x: 10, y: 10, z: 10 } },
    projectiles: [{ id: 'a', x: 10, y: 0, z: 10 }]
  };
  const next = {
    fighters: { p1: { x: 20, y: 10, z: 20 }, p2: { x: 30, y: 20, z: 30 } },
    projectiles: [{ id: 'a', x: 20, y: 0, z: 20 }]
  };
  const out = interpolateSnapshot(prev, next, 0.5);
  assert.equal(out.fighters.p1.x, 10);
  assert.equal(out.projectiles[0].x, 15);
});

test('input buffer preserves latest taps', () => {
  const buffer = createInputBuffer(3);
  buffer.push({ type: 'SHOOT' });
  buffer.push({ type: 'MELEE' });
  buffer.push({ type: 'BOOST_STEP' });
  buffer.push({ type: 'BOOST_DASH' });
  assert.equal(buffer.size(), 3);
  assert.deepEqual(buffer.flush().map((x) => x.type), ['MELEE', 'BOOST_STEP', 'BOOST_DASH']);
});

test('airborne boost step suspends fall during action window', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  p1.y = 300;
  p1.vy = -6;
  applyBoostStep(p1, { x: 1, z: 0 }, 1000);
  tickMatch(match, 1025);
  assert.equal(p1.vy >= 0, true);
});

test('airborne shoot suspends fall during action window', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  const p2 = match.fighters.p2;
  p1.y = 300;
  p1.vy = -4;
  resolveAction(p1, p2, 'SHOOT', 1000, match.projectiles);
  tickMatch(match, 1400);
  assert.equal(p1.vy >= 0, true);
});

test('movement input is ignored in momentum phase', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  applyBoostDash(p1, { x: 1, z: 0 }, 1000);
  tickMatch(match, 1250); // exits dash phase, enters momentum phase
  const before = p1.vx;
  applyMoveVector(p1, { x: -1, z: 0 }, 1260);
  assert.equal(p1.vx, before);
});

test('gravity applies stronger downward acceleration when airborne', () => {
  const match = createMatchState();
  const fighter = match.fighters.p1;
  fighter.y = 320;
  fighter.vy = -2;
  tickMatch(match, 1000);
  assert.equal(fighter.vy < -2, true);
});

test('boost momentum lasts about 0.5s without boost drain', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  const startBoost = p1.boost;

  applyBoostDash(p1, { x: 1, z: 0 }, 1000);
  tickMatch(match, 1250); // dash ended
  const postDashBoost = p1.boost;

  tickMatch(match, 1500); // still in momentum window
  assert.equal(p1.momentumUntil >= 1500, true);
  assert.equal(p1.boost, postDashBoost);

  tickMatch(match, 1800); // momentum expired, normal regen resumes
  assert.equal(p1.boost > postDashBoost, true);
  assert.equal(startBoost > postDashBoost, true);
});

test('falling move input changes facing only', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  p1.y = 300;
  p1.vy = -3;
  p1.vx = 4;
  p1.vz = 2;
  applyMoveVector(p1, { x: -1, z: 0 }, 1000);
  assert.equal(p1.facing, -1);
  assert.equal(p1.vx, 4);
  assert.equal(p1.vz, 2);
});

test('projectile outside initial 45 degree cone does not home', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  const p2 = match.fighters.p2;
  p2.x = p1.x;
  p2.z = p1.z + 300;
  resolveAction(p1, p2, 'SHOOT', 1000, match.projectiles);
  const projectile = match.projectiles[0];
  assert.equal(projectile.isHoming, false);
});
