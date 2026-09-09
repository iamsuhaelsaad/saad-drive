import jwt from 'jsonwebtoken';
import { hashPin, json, readJsonBody } from './_security.js';

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();

function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function now() {
  return Date.now();
}

function getState(key) {
  const value = attempts.get(key);
  if (!value) return { count: 0, start: now(), lockUntil: 0 };

  if (value.lockUntil && value.lockUntil <= now()) {
    attempts.delete(key);
    return { count: 0, start: now(), lockUntil: 0 };
  }

  if (now() - value.start > WINDOW_MS) {
    return { count: 0, start: now(), lockUntil: 0 };
  }

  return value;
}

function recordFailure(key) {
  const state = getState(key);
  const count = state.count + 1;
  const lockUntil = count >= MAX_ATTEMPTS ? now() + LOCK_MS : 0;
  const next = { count, start: state.start, lockUntil };
  attempts.set(key, next);
  return next;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  if (!process.env.APP_PIN_HASH || !process.env.JWT_SECRET) {
    return json(res, 503, { error: 'Authentication is not configured.' });
  }

  const key = clientKey(req);
  const state = getState(key);

  if (state.lockUntil && state.lockUntil > now()) {
    return json(res, 429, { error: 'Too many attempts. Try again later.' });
  }

  try {
    const body = await readJsonBody(req, 8 * 1024);
    const pin = String(body.pin ?? '').trim();

    if (!pin || hashPin(pin) !== process.env.APP_PIN_HASH) {
      const failed = recordFailure(key);
      const retryAfter = failed.lockUntil ? Math.ceil((failed.lockUntil - now()) / 1000) : 0;
      if (retryAfter > 0) res.setHeader('Retry-After', String(retryAfter));
      return json(res, 401, { error: 'Invalid PIN' });
    }

    attempts.delete(key);

    return json(res, 200, {
      token: jwt.sign({ scope: 'drive' }, process.env.JWT_SECRET, { expiresIn: '2h' }),
    });
  } catch (error) {
    const status = error?.status || 400;
    return json(res, status, { error: status === 413 ? 'Payload too large' : 'Invalid request' });
  }
}
