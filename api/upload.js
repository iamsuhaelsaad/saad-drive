import Busboy from 'busboy';
import { sql } from '@vercel/postgres';
import { auth, isUuid, json, safeFilename, tg } from './_security.js';
import { ensureDb } from './_db.js';

export const config = { api: { bodyParser: false } };

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const MAX = Math.max(1, MAX_MB) * 1024 * 1024;

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let parsed = false;
    let tooBig = false;
    let parentId = null;
    let file = null;
    let fileRead = Promise.resolve();

    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { fileSize: MAX, fields: 10 } });
    } catch {
      reject(Object.assign(new Error('Invalid multipart upload'), { status: 400, source: 'client' }));
      return;
    }

    parser.on('field', (name, value) => {
      if (name === 'parent_id') {
        const normalized = String(value || '').trim();
        parentId = normalized || null;
      }
    });

    parser.on('file', (_field, stream, info) => {
      if (file) {
        stream.resume();
        return;
      }

      const chunks = [];
      let size = 0;

      file = {
        name: safeFilename(info.filename || 'file'),
        type: info.mimeType || 'application/octet-stream',
      };

      fileRead = new Promise((resolveFile, rejectFile) => {
        stream.on('data', chunk => {
          size += chunk.length;
          if (size <= MAX) chunks.push(chunk);
        });

        stream.on('limit', () => {
          tooBig = true;
        });

        stream.on('error', () => rejectFile(Object.assign(new Error('Could not read upload stream'), { status: 400, source: 'client' })));

        stream.on('end', () => {
          if (!file) {
            resolveFile();
            return;
          }
          file.buffer = Buffer.concat(chunks);
          file.size = size;
          resolveFile();
        });
      });
    });

    parser.once('error', () => {
      reject(Object.assign(new Error('Could not read upload'), { status: 400, source: 'client' }));
    });

    parser.once('finish', async () => {
      if (parsed) return;
      parsed = true;
      try {
        await fileRead;
      } catch (error) {
        reject(error);
        return;
      }
      if (tooBig) {
        reject(Object.assign(new Error(`File exceeds the ${MAX_MB} MB limit.`), { status: 413, source: 'client' }));
        return;
      }
      if (!file?.buffer?.length) {
        reject(Object.assign(new Error('No file supplied in multipart upload body.'), { status: 400, source: 'client' }));
        return;
      }
      resolve({ file, parentId });
    });

    req.pipe(parser);
  });
}

async function validateParent(parentId) {
  if (!parentId) return null;
  if (!isUuid(parentId)) throw Object.assign(new Error('parent_id must be a valid UUID'), { status: 400 });

  const result = await sql`SELECT id, kind FROM drive_items WHERE id = ${parentId}`;
  if (!result.rowCount) throw Object.assign(new Error('Destination folder not found'), { status: 404 });
  if (result.rows[0].kind !== 'folder') throw Object.assign(new Error('parent_id must reference a folder'), { status: 400 });
  return result.rows[0].id;
}

async function hasDuplicateName(name, parentId) {
  const result = parentId
    ? await sql`
        SELECT 1
        FROM drive_items
        WHERE parent_id = ${parentId}
          AND lower(name) = lower(${name})
        LIMIT 1
      `
    : await sql`
        SELECT 1
        FROM drive_items
        WHERE parent_id IS NULL
          AND lower(name) = lower(${name})
        LIMIT 1
      `;
  return Boolean(result.rowCount);
}

function readTelegramDocument(payload) {
  const queue = [payload?.result];
  const visited = new Set();

  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (visited.has(node)) continue;
    visited.add(node);

    if (typeof node.file_id === 'string' && node.file_id.trim()) {
      return {
        file_id: node.file_id.trim(),
        file_size: Number.isFinite(node.file_size) ? node.file_size : undefined,
      };
    }

    for (const value of Object.values(node)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) queue.push(item);
      } else {
        queue.push(value);
      }
    }
  }

  return null;
}

function describeTelegramResult(payload) {
  const result = payload?.result;
  if (!result || typeof result !== 'object') return 'Telegram returned no result object.';
  const keys = Object.keys(result).slice(0, 8);
  return keys.length ? `Telegram result keys: ${keys.join(', ')}` : 'Telegram result object was empty.';
}

async function readTelegramPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return json(res, 503, { error: 'Telegram storage is not configured in production.' });
  }

  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
    return json(res, 400, { error: 'Content-Type must be multipart/form-data', source: 'client' });
  }

  try {
    await ensureDb();

    const { file, parentId } = await parseMultipart(req);
    const validParentId = await validateParent(parentId);

    if (await hasDuplicateName(file.name, validParentId)) {
      return json(res, 409, {
        error: 'A file with this name already exists in the destination folder',
        source: 'database',
      });
    }

    const form = new FormData();
    form.append('chat_id', process.env.TELEGRAM_CHAT_ID);
    form.append('caption', `Saad Drive | ${file.name}`);
    form.append('document', new Blob([file.buffer], { type: file.type }), file.name);

    const telegramResponse = await fetch(tg('sendDocument'), { method: 'POST', body: form });
    const telegram = await readTelegramPayload(telegramResponse);
    const telegramDocument = readTelegramDocument(telegram);

    if (!telegramResponse.ok || !telegram?.ok) {
      return json(res, 502, {
        error: 'Telegram rejected the upload.',
        detail: telegram?.description || 'Unknown Telegram error.',
        source: 'telegram',
      });
    }

    if (!telegramDocument?.file_id) {
      return json(res, 502, {
        error: 'Telegram response was incomplete after upload.',
        detail: `Missing Telegram file identifier in upload response. ${describeTelegramResult(telegram)}`,
        source: 'telegram',
      });
    }

    let result;
    try {
      result = await sql`
        INSERT INTO drive_items(name, kind, parent_id, telegram_file_id, mime_type, size_bytes)
        VALUES(${file.name}, 'file', ${validParentId}, ${telegramDocument.file_id}, ${file.type}, ${telegramDocument.file_size ?? file.size})
        RETURNING *
      `;
    } catch (error) {
      if (error?.code === '23505') {
        return json(res, 409, {
          error: 'Upload reached Telegram, but this folder already has a file with the same name.',
          source: 'database',
        });
      }
      throw Object.assign(new Error('Upload succeeded on Telegram but saving metadata failed.'), {
        status: 500,
        source: 'database',
      });
    }

    return json(res, 201, { item: result.rows[0] });
  } catch (error) {
    if (error?.status) {
      return json(res, error.status, {
        error: error.message,
        ...(error.source ? { source: error.source } : {}),
      });
    }

    if (error?.code === '23505') {
      return json(res, 409, { error: 'A file with this name already exists in the destination folder' });
    }

    return json(res, 500, { error: 'Upload failed.' });
  }
}
