import test from 'node:test';
import assert from 'node:assert/strict';
import { createFighterState, resolveAction, applyBoostDash } from '../src/gameLogic.js';

test('action applies damage in range', () => {
  const p1 = createFighterState('p1', 100);
  const p2 = createFighterState('p2', 150);
  const result = resolveAction(p1, p2, 'MAIN_ATTACK', 1000);
  assert.equal(result.applied, true);
  assert.equal(p2.health, 92);
});

test('action whiffs out of range', () => {
  const p1 = createFighterState('p1', 100);
  const p2 = createFighterState('p2', 600);
  const result = resolveAction(p1, p2, 'MAIN_ATTACK', 1000);
  assert.equal(result.applied, false);
  assert.equal(result.whiff, true);
  assert.equal(p2.health, 100);
});

test('boost dash consumes energy', () => {
  const p1 = createFighterState('p1', 100);
  const ok = applyBoostDash(p1, 1, 2000);
  assert.equal(ok, true);
  assert.equal(p1.dashEnergy, 80);
});
