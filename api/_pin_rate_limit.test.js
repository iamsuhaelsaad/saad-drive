import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRateLimitState, isCurrentlyLocked } from './_pin_rate_limit.js';

const limits = {
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
  maxAttempts: 3,
};

test('rate limit increments attempts within active window', () => {
  const now = Date.now();
  const first = computeRateLimitState(null, now, limits);
  const second = computeRateLimitState(first, now + 10_000, limits);
  assert.equal(first.attempts, 1);
  assert.equal(second.attempts, 2);
});

test('rate limit locks after max attempts', () => {
  const now = Date.now();
  const first = computeRateLimitState(null, now, limits);
  const second = computeRateLimitState(first, now + 1, limits);
  const third = computeRateLimitState(second, now + 2, limits);
  assert.equal(third.attempts, 3);
  assert.ok(isCurrentlyLocked(third, now + 3));
});

test('rate limit resets after lock/window expiry', () => {
  const now = Date.now();
  const locked = { attempts: 3, windowStartedAtMs: now - 1_000, lockUntilMs: now - 1 };
  const next = computeRateLimitState(locked, now, limits);
  assert.equal(next.attempts, 1);
  assert.equal(next.lockUntilMs, 0);
});
