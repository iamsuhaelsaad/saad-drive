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

    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX, fields: 10 } });
    } catch {
      reject(Object.assign(new Error('Invalid multipart upload'), { status: 400 }));
      return;
    }

    parser.on('field', (name, value) => {
      if (name === 'parent_id') {
        const normalized = String(value || '').trim();
        parentId = normalized || null;
      }
    });

    parser.on('file', (_field, stream, info) => {
      const chunks = [];
      let size = 0;

      file = {
        name: safeFilename(info.filename || 'file'),
        type: info.mimeType || 'application/octet-stream',
      };

      stream.on('data', chunk => {
        size += chunk.length;
        if (size <= MAX) chunks.push(chunk);
      });

      stream.on('limit', () => {
        tooBig = true;
      });

      stream.on('end', () => {
        if (!file) return;
        file.buffer = Buffer.concat(chunks);
        file.size = size;
      });
    });

    parser.once('error', () => {
      reject(Object.assign(new Error('Could not read upload'), { status: 400 }));
    });

    parser.once('finish', () => {
      if (parsed) return;
      parsed = true;
      if (tooBig) {
        reject(Object.assign(new Error(`File exceeds the ${MAX_MB} MB limit.`), { status: 413 }));
        return;
      }
      if (!file?.buffer?.length) {
        reject(Object.assign(new Error('No file supplied. Choose a file first.'), { status: 400 }));
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return json(res, 503, { error: 'Telegram storage is not configured in production.' });
  }

  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
    return json(res, 400, { error: 'Content-Type must be multipart/form-data' });
  }

  try {
    await ensureDb();

    const { file, parentId } = await parseMultipart(req);
    const validParentId = await validateParent(parentId);

    const form = new FormData();
    form.append('chat_id', process.env.TELEGRAM_CHAT_ID);
    form.append('caption', `Saad Drive | ${file.name}`);
    form.append('document', new Blob([file.buffer], { type: file.type }), file.name);

    const telegramResponse = await fetch(tg('sendDocument'), { method: 'POST', body: form });
    const telegram = await telegramResponse.json();

    if (!telegramResponse.ok || !telegram.ok || !telegram?.result?.document?.file_id) {
      return json(res, 502, {
        error: 'Telegram rejected the upload.',
        detail: telegram?.description || 'Unknown Telegram error.',
      });
    }

    const document = telegram.result.document;

    const result = await sql`
      INSERT INTO drive_items(name, kind, parent_id, telegram_file_id, mime_type, size_bytes)
      VALUES(${file.name}, 'file', ${validParentId}, ${document.file_id}, ${file.type}, ${document.file_size || file.size})
      RETURNING *
    `;

    return json(res, 201, { item: result.rows[0] });
  } catch (error) {
    if (error?.status) {
      return json(res, error.status, { error: error.message });
    }

    if (error?.code === '23505') {
      return json(res, 409, { error: 'A file with this name already exists in the destination folder' });
    }

    return json(res, 500, { error: 'Upload failed.' });
  }
}
