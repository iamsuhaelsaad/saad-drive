import { sql } from '@vercel/postgres';
import { auth, cleanName, isUuid, json, readJsonBody } from './_security.js';
import { ensureDb, withDbTransaction } from './_db.js';
import { cleanupTelegramFileReference } from './_telegram.js';
import { wouldCreateCycleFromAncestors } from './_tree_guards.js';

function normalizeParentId(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function queryFn(queryable) {
  return typeof queryable === 'function' ? queryable : queryable.sql.bind(queryable);
}

function assertUuidOrNull(value, label = 'id') {
  if (value === null) return null;
  if (!isUuid(value)) throw httpError(400, `${label} must be a valid UUID`);
  return value;
}

async function lockTreeMutations(queryable) {
  const run = queryFn(queryable);
  await run`SELECT pg_advisory_xact_lock(hashtext('drive_items_tree_mutation'))`;
}

async function getItem(id, queryable = sql, forUpdate = false) {
  const run = queryFn(queryable);
  const result = forUpdate
    ? await run`
        SELECT id, name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes, created_at, updated_at
        FROM drive_items
        WHERE id = ${id}
        FOR UPDATE
      `
    : await run`
        SELECT id, name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes, created_at, updated_at
        FROM drive_items
        WHERE id = ${id}
      `;
  return result.rows[0] || null;
}

async function assertValidParent(parentId, sourceItem = null, queryable = sql) {
  const run = queryFn(queryable);
  const normalizedParentId = assertUuidOrNull(normalizeParentId(parentId), 'parent_id');
  if (!normalizedParentId) return null;

  const parent = await getItem(normalizedParentId, run, Boolean(sourceItem));
  if (!parent) throw httpError(404, 'Destination folder not found');
  if (parent.kind !== 'folder') throw httpError(400, 'parent_id must reference a folder');

  if (sourceItem) {
    if (parent.id === sourceItem.id) {
      throw httpError(400, 'Cannot place an item inside itself');
    }

    if (sourceItem.kind === 'folder') {
      const cycleResult = await run`
        WITH RECURSIVE chain AS (
          SELECT id, parent_id
          FROM drive_items
          WHERE id = ${parent.id}
          UNION ALL
          SELECT di.id, di.parent_id
          FROM drive_items di
          JOIN chain ch ON di.id = ch.parent_id
        )
        SELECT id FROM chain
      `;
      if (wouldCreateCycleFromAncestors(sourceItem.id, cycleResult.rows.map(row => row.id))) {
        throw httpError(400, 'Cannot place a folder inside itself or its descendants');
      }
    }
  }

  return parent.id;
}

async function cloneItemTree(sourceItem, targetParentId, queryable = sql) {
  const run = queryFn(queryable);
  const childrenResult = sourceItem.kind === 'folder'
    ? await run`
        SELECT id, name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes, created_at, updated_at
        FROM drive_items
        WHERE parent_id = ${sourceItem.id}
        ORDER BY created_at ASC, lower(name)
      `
    : { rows: [] };

  const insertResult = await run`
    INSERT INTO drive_items(name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes)
    VALUES(
      ${sourceItem.name},
      ${sourceItem.kind},
      ${targetParentId},
      ${sourceItem.telegram_file_id || null},
      ${sourceItem.telegram_message_id || null},
      ${sourceItem.telegram_chat_id || null},
      ${sourceItem.checksum_sha256 || null},
      ${sourceItem.mime_type || null},
      ${sourceItem.size_bytes || 0}
    )
    RETURNING *
  `;

  const copy = insertResult.rows[0];

  for (const child of childrenResult.rows) {
    await cloneItemTree(child, copy.id, run);
  }

  return copy;
}

async function listFilesForDeletion(id, queryable = sql) {
  const run = queryFn(queryable);
  const result = await run`
    WITH RECURSIVE descendants AS (
      SELECT id, kind, telegram_file_id, telegram_message_id, telegram_chat_id
      FROM drive_items
      WHERE id = ${id}
      UNION ALL
      SELECT di.id, di.kind, di.telegram_file_id, di.telegram_message_id, di.telegram_chat_id
      FROM drive_items di
      JOIN descendants d ON di.parent_id = d.id
    )
    SELECT id, telegram_file_id, telegram_message_id, telegram_chat_id
    FROM descendants
    WHERE kind = 'file'
  `;
  return result.rows;
}

function summarizeTelegramCleanup(results) {
  const summary = { attempted: 0, deleted: 0, skipped: 0, failed: 0 };
  for (const result of results) {
    if (result.status === 'deleted') {
      summary.attempted += 1;
      summary.deleted += 1;
    } else if (result.status === 'failed') {
      summary.attempted += 1;
      summary.failed += 1;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;

  try {
    await ensureDb();

    if (req.method === 'GET') {
      if (req.query.all === '1') {
        const result = await sql`
          SELECT id, name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes, created_at, updated_at
          FROM drive_items
          ORDER BY kind DESC, lower(name)
        `;
        return json(res, 200, { items: result.rows, parentId: null });
      }

      const parent = assertUuidOrNull(normalizeParentId(req.query.parent_id), 'parent_id');
      const result = parent
        ? await sql`
            SELECT id, name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes, created_at, updated_at
            FROM drive_items
            WHERE parent_id = ${parent}
            ORDER BY kind DESC, lower(name)
          `
        : await sql`
            SELECT id, name, kind, parent_id, telegram_file_id, telegram_message_id, telegram_chat_id, checksum_sha256, mime_type, size_bytes, created_at, updated_at
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

        const copy = await withDbTransaction(async client => {
          const run = client.sql.bind(client);
          await lockTreeMutations(run);
          const sourceItem = await getItem(String(body.id), run, true);
          if (!sourceItem) throw httpError(404, 'Source item not found');
          const targetParentId = await assertValidParent(body.parent_id, sourceItem, run);
          return cloneItemTree(sourceItem, targetParentId, run);
        });
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

      const hasName = body.name !== undefined;
      const hasParent = body.parent_id !== undefined;

      if (!hasName && !hasParent) {
        const currentItem = await getItem(id);
        return currentItem
          ? json(res, 200, { item: currentItem })
          : json(res, 404, { error: 'Not found' });
      }

      const updated = await withDbTransaction(async client => {
        const run = client.sql.bind(client);
        await lockTreeMutations(run);

        const currentItem = await getItem(id, run, true);
        if (!currentItem) throw httpError(404, 'Not found');

        let nextName = currentItem.name;
        if (hasName) {
          nextName = cleanName(body.name);
          if (!nextName) throw httpError(400, 'name must be a non-empty string up to 255 chars');
        }

        const nextParentId = hasParent
          ? await assertValidParent(body.parent_id, currentItem, run)
          : currentItem.parent_id;

        const result = await run`
          UPDATE drive_items
          SET name = ${nextName},
              parent_id = ${nextParentId}
          WHERE id = ${id}
          RETURNING *
        `;
        return result.rows[0];
      });

      return json(res, 200, { item: updated });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      if (!isUuid(id)) return json(res, 400, { error: 'id is required' });

      const files = await listFilesForDeletion(id);
      const cleanupResults = [];
      const fallbackChatId = String(process.env.TELEGRAM_CHAT_ID || '').trim() || null;

      console.info(JSON.stringify({
        event: 'items.delete.start',
        itemId: id,
        fileCount: files.length,
      }));

      for (const file of files) {
        const cleanup = await cleanupTelegramFileReference(
          {
            telegram_chat_id: file.telegram_chat_id,
            telegram_message_id: file.telegram_message_id,
            telegram_file_id: file.telegram_file_id,
          },
          fallbackChatId
        );
        cleanupResults.push({
          id: file.id,
          status: cleanup.status,
          ...(cleanup.reason ? { detail: cleanup.reason } : {}),
        });
      }

      const cleanupSummary = summarizeTelegramCleanup(cleanupResults);

      if (!files.length) {
        const result = await sql`DELETE FROM drive_items WHERE id = ${id} RETURNING id`;
        return result.rowCount
          ? json(res, 200, { deleted: id, telegram_cleanup: cleanupSummary })
          : json(res, 404, { error: 'Not found' });
      }

      const result = await sql`DELETE FROM drive_items WHERE id = ${id} RETURNING id`;
      console.info(JSON.stringify({
        event: 'items.delete.telegram_cleanup',
        itemId: id,
        ...cleanupSummary,
      }));

      const details = cleanupResults.slice(0, 25);
      return result.rowCount
        ? json(res, 200, {
            deleted: id,
            telegram_cleanup: {
              ...cleanupSummary,
              results: details,
              truncated: cleanupResults.length > details.length ? cleanupResults.length - details.length : 0,
            },
          })
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
