import test from 'node:test';
import assert from 'node:assert/strict';
import { wouldCreateCycleFromAncestors } from './_tree_guards.js';

test('detects when source appears in ancestor chain', () => {
  assert.equal(wouldCreateCycleFromAncestors('a', ['x', 'a', 'z']), true);
});

test('returns false when source is absent from ancestors', () => {
  assert.equal(wouldCreateCycleFromAncestors('a', ['x', 'y', 'z']), false);
});
