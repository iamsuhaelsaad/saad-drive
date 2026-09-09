import { sql } from '@vercel/postgres';
import { json, auth } from './_security.js';
import { ensureDb } from './_db.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;
  try {
    await ensureDb();
    if (req.method === 'GET') {
      const parent = req.query.parent_id || null;
      const result = parent
        ? await sql`SELECT id,name,kind,parent_id,telegram_file_id,mime_type,size_bytes,created_at,updated_at FROM drive_items WHERE parent_id=${parent} ORDER BY kind DESC, lower(name)`
        : await sql`SELECT id,name,kind,parent_id,telegram_file_id,mime_type,size_bytes,created_at,updated_at FROM drive_items WHERE parent_id IS NULL ORDER BY kind DESC, lower(name)`;
      return json(res, 200, { items: result.rows, parentId: parent });
    }
    const body = (req.method === 'POST' || req.method === 'PATCH') ? await readBody(req) : {};
    if (req.method === 'POST') {
      if (body.action === 'copy') {
        if (!body.id) return json(res, 400, { error: 'id is required' });
        const result = await sql`INSERT INTO drive_items(name,kind,parent_id,telegram_file_id,mime_type,size_bytes) SELECT name,kind,${body.parent_id || null},telegram_file_id,mime_type,size_bytes FROM drive_items WHERE id=${body.id} RETURNING *`;
        return result.rowCount ? json(res, 201, { item: result.rows[0] }) : json(res, 404, { error: 'Source item not found' });
      }
      const { name, kind, parent_id = null } = body;
      if (!name || !['file', 'folder'].includes(kind)) return json(res, 400, { error: 'name and kind are required' });
      const result = await sql`INSERT INTO drive_items(name,kind,parent_id) VALUES(${name},${kind},${parent_id}) RETURNING *`;
      return json(res, 201, { item: result.rows[0] });
    }
    if (req.method === 'PATCH') {
      const { id, name, parent_id } = body;
      if (!id) return json(res, 400, { error: 'id is required' });
      const result = await sql`UPDATE drive_items SET name=COALESCE(${name || null},name), parent_id=${parent_id === undefined ? null : parent_id}, updated_at=now() WHERE id=${id} RETURNING *`;
      return result.rowCount ? json(res, 200, { item: result.rows[0] }) : json(res, 404, { error: 'Not found' });
    }
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return json(res, 400, { error: 'id is required' });
      const result = await sql`DELETE FROM drive_items WHERE id=${id} RETURNING id`;
      return result.rowCount ? json(res, 200, { deleted: id }) : json(res, 404, { error: 'Not found' });
    }
    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    return json(res, 500, { error: 'Database error.', detail: error.message });
  }
}
