import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

export function auth(req, res, options = {}) {
  const { allowQueryToken = false } = options;

  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const queryToken = allowQueryToken ? req.query?.token || null : null;
    const token = bearer || queryToken;

    if (!token) throw new Error('Unauthorized');
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    json(res, 401, { error: 'Unauthorized' });
    return null;
  }
}

export const requireAuth = auth;
export const tg = method => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
