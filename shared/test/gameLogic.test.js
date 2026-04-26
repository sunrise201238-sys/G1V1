import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFighterState,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  tickFighter,
  interpolateSnapshot,
  createInputBuffer
} from '../src/gameLogic.js';

test('shoot applies damage in range', () => {
  const p1 = createFighterState('p1', 100, 100);
  const p2 = createFighterState('p2', 160, 120);
  const result = resolveAction(p1, p2, 'SHOOT', 1000);
  assert.equal(result.applied, true);
  assert.equal(p2.health, 92);
});

test('step cuts projectile tracking', () => {
  const p1 = createFighterState('p1', 100, 100);
  const p2 = createFighterState('p2', 160, 120);
  applyBoostStep(p2, { x: 1, z: 0 }, 1000);
  const result = resolveAction(p1, p2, 'SHOOT', 1020);
  assert.equal(result.applied, false);
  assert.equal(result.cut, true);
});

test('boost dash drains and can trigger overheat', () => {
  const p1 = createFighterState('p1', 100, 100);
  const ok = applyBoostDash(p1, { x: 1, z: 0 }, 2000);
  assert.equal(ok, true);
  for (let i = 0; i < 60; i += 1) tickFighter(p1);
  assert.equal(p1.isOverheated, true);
});

test('snapshot interpolation smooths positions', () => {
  const prev = { fighters: { p1: { x: 0, y: 0, z: 0 }, p2: { x: 10, y: 10, z: 10 } } };
  const next = { fighters: { p1: { x: 10, y: 10, z: 10 }, p2: { x: 20, y: 20, z: 20 } } };
  const interpolated = interpolateSnapshot(prev, next, 0.5);
  assert.equal(interpolated.fighters.p1.x, 5);
  assert.equal(interpolated.fighters.p2.z, 15);
});

test('input buffer stores and flushes multi taps', () => {
  const buffer = createInputBuffer(2);
  buffer.push({ type: 'SHOOT' });
  buffer.push({ type: 'MELEE' });
  buffer.push({ type: 'BOOST_STEP' });
  assert.equal(buffer.size(), 2);
  assert.deepEqual(buffer.flush().map((item) => item.type), ['MELEE', 'BOOST_STEP']);
});
