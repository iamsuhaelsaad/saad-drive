import { sql } from '@vercel/postgres';
import { auth, cleanName, isUuid, json, readJsonBody } from './_security.js';
import { ensureDb } from './_db.js';

function normalizeParentId(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function assertUuidOrNull(value, label = 'id') {
  if (value === null) return null;
  if (!isUuid(value)) throw httpError(400, `${label} must be a valid UUID`);
  return value;
}

async function getItem(id) {
  const result = await sql`
    SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
    FROM drive_items
    WHERE id = ${id}
  `;
  return result.rows[0] || null;
}

async function assertValidParent(parentId, sourceItem = null) {
  const normalizedParentId = assertUuidOrNull(normalizeParentId(parentId), 'parent_id');
  if (!normalizedParentId) return null;

  const parent = await getItem(normalizedParentId);
  if (!parent) throw httpError(404, 'Destination folder not found');
  if (parent.kind !== 'folder') throw httpError(400, 'parent_id must reference a folder');

  if (sourceItem) {
    if (parent.id === sourceItem.id) {
      throw httpError(400, 'Cannot place an item inside itself');
    }

    if (sourceItem.kind === 'folder') {
      let cursor = parent;
      while (cursor) {
        if (cursor.id === sourceItem.id) {
          throw httpError(400, 'Cannot place a folder inside itself or its descendants');
        }
        cursor = cursor.parent_id ? await getItem(cursor.parent_id) : null;
      }
    }
  }

  return parent.id;
}

async function cloneItemTree(sourceItem, targetParentId) {
  const childrenResult = sourceItem.kind === 'folder'
    ? await sql`
        SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
        FROM drive_items
        WHERE parent_id = ${sourceItem.id}
        ORDER BY created_at ASC, lower(name)
      `
    : { rows: [] };

  const insertResult = await sql`
    INSERT INTO drive_items(name, kind, parent_id, telegram_file_id, mime_type, size_bytes)
    VALUES(
      ${sourceItem.name},
      ${sourceItem.kind},
      ${targetParentId},
      ${sourceItem.telegram_file_id || null},
      ${sourceItem.mime_type || null},
      ${sourceItem.size_bytes || 0}
    )
    RETURNING *
  `;

  const copy = insertResult.rows[0];

  for (const child of childrenResult.rows) {
    await cloneItemTree(child, copy.id);
  }

  return copy;
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  try {
    await ensureDb();

    if (req.method === 'GET') {
      if (req.query.all === '1') {
        const result = await sql`
          SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
          FROM drive_items
          ORDER BY kind DESC, lower(name)
        `;
        return json(res, 200, { items: result.rows, parentId: null });
      }

      const parent = assertUuidOrNull(normalizeParentId(req.query.parent_id), 'parent_id');
      const result = parent
        ? await sql`
            SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
            FROM drive_items
            WHERE parent_id = ${parent}
            ORDER BY kind DESC, lower(name)
          `
        : await sql`
            SELECT id, name, kind, parent_id, telegram_file_id, mime_type, size_bytes, created_at, updated_at
            FROM drive_items
            WHERE parent_id IS NULL
            ORDER BY kind DESC, lower(name)
          `;

      return json(res, 200, { items: result.rows, parentId: parent });
    }

    const body = (req.method === 'POST' || req.method === 'PATCH') ? await readJsonBody(req) : {};

    if (req.method === 'POST') {
      if (body.action === 'copy') {
        if (!body.id || !isUuid(String(body.id))) return json(res, 400, { error: 'id is required' });

        const sourceItem = await getItem(String(body.id));
        if (!sourceItem) return json(res, 404, { error: 'Source item not found' });

        const targetParentId = await assertValidParent(body.parent_id, sourceItem);
        const copy = await cloneItemTree(sourceItem, targetParentId);
        return json(res, 201, { item: copy });
      }

      const itemName = cleanName(body.name);
      const kind = body.kind;
      const parentId = await assertValidParent(body.parent_id);

      if (!itemName || !['file', 'folder'].includes(kind)) {
        return json(res, 400, { error: 'Valid name and kind are required' });
      }

      const result = await sql`
        INSERT INTO drive_items(name, kind, parent_id)
        VALUES(${itemName}, ${kind}, ${parentId})
        RETURNING *
      `;

      return json(res, 201, { item: result.rows[0] });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!isUuid(id)) return json(res, 400, { error: 'id is required' });

      const currentItem = await getItem(id);
      if (!currentItem) return json(res, 404, { error: 'Not found' });

      const hasName = body.name !== undefined;
      const hasParent = body.parent_id !== undefined;

      if (!hasName && !hasParent) {
        return json(res, 200, { item: currentItem });
      }

      let nextName = currentItem.name;
      if (hasName) {
        nextName = cleanName(body.name);
        if (!nextName) return json(res, 400, { error: 'name must be a non-empty string up to 255 chars' });
      }

      const nextParentId = hasParent
        ? await assertValidParent(body.parent_id, currentItem)
        : currentItem.parent_id;

      const result = await sql`
        UPDATE drive_items
        SET name = ${nextName},
            parent_id = ${nextParentId}
        WHERE id = ${id}
        RETURNING *
      `;

      return json(res, 200, { item: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!isUuid(id)) return json(res, 400, { error: 'id is required' });

      const result = await sql`DELETE FROM drive_items WHERE id = ${id} RETURNING id`;
      return result.rowCount
        ? json(res, 200, { deleted: id })
        : json(res, 404, { error: 'Not found' });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    if (error?.status) {
      return json(res, error.status, { error: error.message });
    }

    if (error?.code === '23505') {
      return json(res, 409, { error: 'An item with this name already exists in the destination folder' });
    }

    if (error?.code === '22P02') {
      return json(res, 400, { error: 'Invalid UUID value provided' });
    }

    return json(res, 500, { error: 'Database error.' });
  }
}
