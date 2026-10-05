import test from 'node:test';
import assert from 'node:assert/strict';

import { clamp } from '../public/modules/match-pulse.js';

test('clamp preserves valid numeric and boundary behavior', () => {
  assert.equal(clamp(0, 0, 100), 0);
  assert.equal(clamp(100, 0, 100), 100);
  assert.equal(clamp(42.5, 0, 100), 42.5);
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp(105, 0, 100), 100);
});

test('clamp accepts finite numeric strings', () => {
  assert.equal(clamp('25', 0, 100), 25);
  assert.equal(clamp('25.5', '0', '100'), 25.5);
});

test('clamp rejects nullish, empty, malformed and infinite input', () => {
  for (const value of [null, undefined, '', 'not-a-number', Infinity, -Infinity, NaN]) {
    assert.throws(() => clamp(value, 0, 100), TypeError);
  }
});

test('clamp rejects invalid bounds and reversed ranges', () => {
  assert.throws(() => clamp(10, NaN, 100), TypeError);
  assert.throws(() => clamp(10, 0, Infinity), TypeError);
  assert.throws(() => clamp(10, 20, 10), RangeError);
});
