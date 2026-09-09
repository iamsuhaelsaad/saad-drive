import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

export function json(res, status, body) {
  res.status(status);
  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin ?? '')).digest('hex');
}

export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function cleanName(name, maxLength = 255) {
  const value = String(name ?? '').trim();
  if (!value || value === '.' || value === '..') return '';
  if (value.length > maxLength) return '';
  return value;
}

export function safeFilename(name) {
  const value = String(name ?? '')
    .replace(/[\r\n]/g, ' ')
    .replace(/[\\/]/g, '-')
    .trim();
  const normalized = value || 'file';
  return normalized.length > 255 ? normalized.slice(0, 255) : normalized;
}

export function auth(req, res) {
  if (!process.env.JWT_SECRET) {
    json(res, 503, { error: 'Authentication is not configured.' });
    return null;
  }

  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) throw new Error('Unauthorized');
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error?.name === 'TokenExpiredError') {
      json(res, 401, { error: 'Token expired', code: 'TOKEN_EXPIRED' });
      return null;
    }
    json(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return null;
  }
}

export function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });

    req.on('error', reject);
  });
}

export const requireAuth = auth;
export const tg = method => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
