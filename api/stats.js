import { sql } from '@vercel/postgres';
import { auth, json } from './_security.js';
import { ensureDb } from './_db.js';

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;

  try {
    await ensureDb();
    const result = await sql`
      SELECT
        COUNT(*) FILTER (WHERE kind = 'file')::int AS files,
        COUNT(*) FILTER (WHERE kind = 'folder')::int AS folders,
        COALESCE(SUM(size_bytes) FILTER (WHERE kind = 'file'), 0)::bigint AS used_bytes
      FROM drive_items
    `;
    const row = result.rows[0] || { files: 0, folders: 0, used_bytes: 0 };

    return json(res, 200, {
      files: Number(row.files || 0),
      folders: Number(row.folders || 0),
      usedBytes: Number(row.used_bytes || 0),
      capacity: 'telegram-backed',
      maxUploadMb: MAX_UPLOAD_MB,
    });
  } catch {
    return json(res, 500, { error: 'Could not load storage stats.' });
  }
}
