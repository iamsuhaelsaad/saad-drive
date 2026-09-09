import { sql } from '@vercel/postgres';
import { auth, isUuid, json, safeFilename, tg } from './_security.js';
import { ensureDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return json(res, 503, { error: 'Telegram storage is not configured in production.' });
  }

  try {
    await ensureDb();

    const id = String(req.query.id || '');
    if (!isUuid(id)) return json(res, 400, { error: 'id must be a valid UUID' });

    const result = await sql`
      SELECT name, telegram_file_id, mime_type
      FROM drive_items
      WHERE id = ${id} AND kind = 'file'
    `;

    if (!result.rowCount) return json(res, 404, { error: 'File not found' });

    const item = result.rows[0];
    if (!item.telegram_file_id) return json(res, 409, { error: 'File metadata is incomplete' });

    const meta = await fetch(tg('getFile'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: item.telegram_file_id }),
    });

    const metadata = await meta.json();
    if (!meta.ok || !metadata?.ok || !metadata?.result?.file_path) {
      return json(res, 502, { error: 'Telegram file metadata is unavailable' });
    }

    const remote = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${metadata.result.file_path}`);
    if (!remote.ok) return json(res, 502, { error: 'Download failed from Telegram' });

    const filename = safeFilename(item.name);

    res.status(200);
    res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.end(Buffer.from(await remote.arrayBuffer()));
  } catch {
    return json(res, 500, { error: 'Download failed' });
  }
}
