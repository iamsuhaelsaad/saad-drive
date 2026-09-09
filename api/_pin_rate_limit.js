export function computeRateLimitState(previousState, nowMs, { windowMs, lockMs, maxAttempts }) {
  const base = previousState || { attempts: 0, windowStartedAtMs: nowMs, lockUntilMs: 0 };
  const isWindowExpired = nowMs - base.windowStartedAtMs > windowMs;
  const isLockExpired = base.lockUntilMs && base.lockUntilMs <= nowMs;
  const reset = isWindowExpired || isLockExpired;
  const windowStartedAtMs = reset ? nowMs : base.windowStartedAtMs;
  const attempts = reset ? 1 : base.attempts + 1;
  const lockUntilMs = attempts >= maxAttempts ? nowMs + lockMs : 0;
  return { attempts, windowStartedAtMs, lockUntilMs };
}

export function isCurrentlyLocked(state, nowMs) {
  return Boolean(state?.lockUntilMs && state.lockUntilMs > nowMs);
}
