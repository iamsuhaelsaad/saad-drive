import { sql } from '@vercel/postgres';
import { json } from './_security.js';

export default async function handler(_req, res) {
  try {
    await sql`SELECT 1`;
    return json(res, 200, {
      name: 'Saad Drive',
      status: 'ok',
      time: new Date().toISOString(),
      services: {
        db: 'ok',
        telegram: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? 'configured' : 'missing',
        auth: process.env.JWT_SECRET && process.env.APP_PIN_HASH ? 'configured' : 'missing',
      },
    });
  } catch {
    return json(res, 503, {
      name: 'Saad Drive',
      status: 'degraded',
      time: new Date().toISOString(),
      services: { db: 'down' },
    });
  }
}
