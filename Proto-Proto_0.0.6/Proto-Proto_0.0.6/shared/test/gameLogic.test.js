import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOST, createMatchState, resolveAction, applyBoostDash, applyBoostStep, applyMoveVector, tickMatch, interpolateSnapshot, createInputBuffer } from '../src/gameLogic.js';

test('shoot spawns tracking projectile', () => {
  const match = createMatchState();
  const r = resolveAction(match.fighters.p1, match.fighters.p2, 'SHOOT', 1000, match.projectiles);
  assert.equal(r.applied, true);
  assert.equal(match.projectiles.length, 1);
});

test('step breaks projectile tracking window', () => {
  const match = createMatchState();
  resolveAction(match.fighters.p1, match.fighters.p2, 'SHOOT', 1000, match.projectiles);
  applyBoostStep(match.fighters.p2, { x: 1, z: 0 }, 1005);
  const hp = match.fighters.p2.health;
  for (let i = 0; i < 4; i += 1) tickMatch(match, 1010 + i * 25);
  assert.equal(match.fighters.p2.health, hp);
});

test('boost depletion triggers overheat', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  p1.boost = 2;
  applyBoostDash(p1, { x: 1, z: 0 }, 1000);
  tickMatch(match, 1025);
  assert.equal(p1.isOverheated, true);
  assert.equal(p1.overheatUntil, 1025 + BOOST.overheatDurationMs);
});

test('interpolation includes projectiles', () => {
  const prev = { fighters: { p1: { x: 0, y: 0, z: 0 }, p2: { x: 10, y: 10, z: 10 } }, projectiles: [{ id: 'a', x: 10, y: 0, z: 10 }] };
  const next = { fighters: { p1: { x: 20, y: 10, z: 20 }, p2: { x: 30, y: 20, z: 30 } }, projectiles: [{ id: 'a', x: 20, y: 0, z: 20 }] };
  const out = interpolateSnapshot(prev, next, 0.5);
  assert.equal(out.projectiles[0].x, 15);
});

test('input buffer preserves latest taps', () => {
  const buffer = createInputBuffer(3);
  buffer.push({ type: 'SHOOT' }); buffer.push({ type: 'MELEE' }); buffer.push({ type: 'BOOST_STEP' }); buffer.push({ type: 'BOOST_DASH' });
  assert.deepEqual(buffer.flush().map((x) => x.type), ['MELEE', 'BOOST_STEP', 'BOOST_DASH']);
});

test('movement sets velocity directly (no momentum system)', () => {
  const p1 = createMatchState().fighters.p1;
  applyMoveVector(p1, { x: 1, z: 0 }, 1000);
  assert.equal(p1.vx > 0, true);
  assert.equal(p1.vz, 0);
});

test('airborne unit descends naturally without anti-fall lock', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  p1.y = 320;
  p1.vy = -2;
  tickMatch(match, 1000);
  assert.equal(p1.y < 320, true);
});

test('scatter shot red-lock range is ten times base range', () => {
  const match = createMatchState();
  const p1 = match.fighters.p1;
  const p2 = match.fighters.p2;
  p2.x = p1.x + 20000;
  p2.z = p1.z;
  const result = resolveAction(p1, p2, 'SUB_SHOOT', 1000, match.projectiles);
  assert.equal(result.applied, true);
  assert.equal(match.projectiles[0].isHoming, true);
});
