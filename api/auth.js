import jwt from 'jsonwebtoken';
import { hashPin, json, readJsonBody } from './_security.js';
import { ensureDb, withDbTransaction } from './_db.js';
import { computeRateLimitState, isCurrentlyLocked } from './_pin_rate_limit.js';

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(req) {
  const remoteAddress = String(req.socket?.remoteAddress || 'unknown');
  const userAgent = String(req.headers['user-agent'] || '');
  return hashPin(`${remoteAddress}|${userAgent}`);
}

function nowMs() {
  return Date.now();
}

function toMs(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

async function getRateState(keyHash) {
  const result = await withDbTransaction(async client => {
    const rowResult = await client.sql`
      SELECT attempts, window_started_at, lock_until
      FROM pin_auth_attempts
      WHERE key_hash = ${keyHash}
      FOR UPDATE
    `;
    if (!rowResult.rowCount) return { attempts: 0, windowStartedAtMs: nowMs(), lockUntilMs: 0 };
    const row = rowResult.rows[0];
    return {
      attempts: Number(row.attempts || 0),
      windowStartedAtMs: toMs(row.window_started_at),
      lockUntilMs: toMs(row.lock_until),
    };
  });
  return result;
}

async function clearRateState(keyHash) {
  await withDbTransaction(async client => {
    await client.sql`DELETE FROM pin_auth_attempts WHERE key_hash = ${keyHash}`;
  });
}

async function recordFailure(keyHash) {
  const now = nowMs();
  return withDbTransaction(async client => {
    const rowResult = await client.sql`
      SELECT attempts, window_started_at, lock_until
      FROM pin_auth_attempts
      WHERE key_hash = ${keyHash}
      FOR UPDATE
    `;
    const previousState = rowResult.rowCount
      ? {
          attempts: Number(rowResult.rows[0].attempts || 0),
          windowStartedAtMs: toMs(rowResult.rows[0].window_started_at),
          lockUntilMs: toMs(rowResult.rows[0].lock_until),
        }
      : null;

    const next = computeRateLimitState(previousState, now, {
      windowMs: WINDOW_MS,
      lockMs: LOCK_MS,
      maxAttempts: MAX_ATTEMPTS,
    });

    await client.sql`
      INSERT INTO pin_auth_attempts(key_hash, attempts, window_started_at, lock_until, updated_at)
      VALUES(
        ${keyHash},
        ${next.attempts},
        ${new Date(next.windowStartedAtMs).toISOString()},
        ${next.lockUntilMs ? new Date(next.lockUntilMs).toISOString() : null},
        now()
      )
      ON CONFLICT (key_hash)
      DO UPDATE SET
        attempts = EXCLUDED.attempts,
        window_started_at = EXCLUDED.window_started_at,
        lock_until = EXCLUDED.lock_until,
        updated_at = now()
    `;
    return next;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  if (!process.env.APP_PIN_HASH || !process.env.JWT_SECRET) {
    return json(res, 503, { error: 'Authentication is not configured.' });
  }

  try {
    await ensureDb();
    const key = clientKey(req);
    const state = await getRateState(key);
    const now = nowMs();

    if (isCurrentlyLocked(state, now)) {
      const retryAfter = Math.ceil((state.lockUntilMs - now) / 1000);
      if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter));
      return json(res, 429, { error: 'Too many attempts. Try again later.' });
    }

    const body = await readJsonBody(req, 8 * 1024);
    const pin = String(body.pin ?? '').trim();

    if (!pin || hashPin(pin) !== process.env.APP_PIN_HASH) {
      const failed = await recordFailure(key);
      const retryAfter = failed.lockUntilMs ? Math.ceil((failed.lockUntilMs - nowMs()) / 1000) : 0;
      if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter));
      return json(res, 401, { error: 'Invalid PIN' });
    }

    await clearRateState(key);

    return json(res, 200, {
      token: jwt.sign({ scope: 'drive' }, process.env.JWT_SECRET, { expiresIn: '2h' }),
    });
  } catch (error) {
    const status = error?.status || 400;
    return json(res, status, { error: status === 413 ? 'Payload too large' : 'Invalid request' });
  }
}
