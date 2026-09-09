import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { sql } from '@vercel/postgres';
import { auth, isUuid, json, safeFilename, setSecurityHeaders } from './_security.js';
import { ensureDb } from './_db.js';
import { fetchTelegram, readTelegramPayload } from './_telegram.js';

const DOWNLOAD_TIMEOUT_MS = Math.max(1000, Number(process.env.DOWNLOAD_TIMEOUT_MS || 30000));
const MAX_DOWNLOAD_MB = Math.max(1, Number(process.env.MAX_DOWNLOAD_MB || 200));
const MAX_DOWNLOAD_BYTES = MAX_DOWNLOAD_MB * 1024 * 1024;

async function fetchWithTimeout(url, options = {}, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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
      SELECT name, telegram_file_id, mime_type, size_bytes
      FROM drive_items
      WHERE id = ${id} AND kind = 'file'
    `;

    if (!result.rowCount) return json(res, 404, { error: 'File not found' });

    const item = result.rows[0];
    if (!item.telegram_file_id) return json(res, 409, { error: 'File metadata is incomplete' });
    if (Number(item.size_bytes || 0) > MAX_DOWNLOAD_BYTES) {
      return json(res, 413, { error: `File exceeds max download size of ${MAX_DOWNLOAD_MB} MB` });
    }

    const meta = await fetchTelegram('getFile', JSON.stringify({ file_id: item.telegram_file_id }));
    const metadata = await readTelegramPayload(meta);
    if (!meta.ok || !metadata?.ok || !metadata?.result?.file_path) {
      return json(res, 502, { error: 'Telegram file metadata is unavailable' });
    }

    if (Number(metadata?.result?.file_size || 0) > MAX_DOWNLOAD_BYTES) {
      return json(res, 413, { error: `File exceeds max download size of ${MAX_DOWNLOAD_MB} MB` });
    }

    const remote = await fetchWithTimeout(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${metadata.result.file_path}`);
    if (!remote.ok || !remote.body) return json(res, 502, { error: 'Download failed from Telegram' });

    const filename = safeFilename(item.name);

    res.status(200);
    setSecurityHeaders(res);
    res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    await pipeline(Readable.fromWeb(remote.body), res);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return json(res, 504, { error: 'Download request timed out' });
    }
    if (!res.headersSent) return json(res, 500, { error: 'Download failed' });
    res.end();
  }
}
