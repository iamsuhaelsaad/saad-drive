import { sql } from '@vercel/postgres';
import { auth, isUuid, json } from './_security.js';
import { ensureDb } from './_db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;

  try {
    await ensureDb();

    const parentRaw = req.query.parent_id;
    const parentId = parentRaw === undefined || parentRaw === null || parentRaw === '' ? null : String(parentRaw);

    if (parentId && !isUuid(parentId)) {
      return json(res, 400, { error: 'parent_id must be a valid UUID' });
    }

    const result = parentId
      ? await sql`
          SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
          FROM drive_items
          WHERE parent_id = ${parentId}
          ORDER BY kind DESC, lower(name)
        `
      : await sql`
          SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
          FROM drive_items
          WHERE parent_id IS NULL
          ORDER BY kind DESC, lower(name)
        `;

    return json(res, 200, { items: result.rows, parentId });
  } catch {
    return json(res, 500, { error: 'Could not load files.' });
  }
}
