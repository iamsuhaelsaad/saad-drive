import jwt from 'jsonwebtoken';
import { json } from '../_security.js';

const REFRESH_GRACE_MS = Math.max(60 * 1000, Number(process.env.JWT_REFRESH_GRACE_MS || 24 * 60 * 60 * 1000));

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!process.env.JWT_SECRET) return json(res, 503, { error: 'Authentication is not configured.' });

  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return json(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
    const expMs = Number(payload?.exp || 0) * 1000;
    const now = Date.now();

    if (payload?.scope !== 'drive') {
      return json(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    if (expMs && now - expMs > REFRESH_GRACE_MS) {
      return json(res, 401, { error: 'Session expired, please sign in again.', code: 'REFRESH_EXPIRED' });
    }

    return json(res, 200, {
      token: jwt.sign({ scope: 'drive' }, process.env.JWT_SECRET, { expiresIn: '2h' }),
    });
  } catch {
    return json(res, 401, { error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
}
