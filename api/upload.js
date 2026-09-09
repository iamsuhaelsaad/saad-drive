import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { sql } from '@vercel/postgres';
import { auth, isUuid, json, safeFilename } from './_security.js';
import { ensureDb } from './_db.js';
import { deleteTelegramMessage, fetchTelegram, parseTelegramUpload, readTelegramPayload } from './_telegram.js';

export const config = { api: { bodyParser: false } };

const DEFAULT_MAX_UPLOAD_MB = 20;
const DEFAULT_UPLOAD_TIMEOUT_MS = 60000;
const parsedUploadLimit = Number(process.env.MAX_UPLOAD_MB);
const MAX_MB = Number.isFinite(parsedUploadLimit) && parsedUploadLimit > 0 ? parsedUploadLimit : DEFAULT_MAX_UPLOAD_MB;
const MAX = Math.max(1, MAX_MB) * 1024 * 1024;
const parsedUploadTimeout = Number(process.env.TELEGRAM_UPLOAD_TIMEOUT_MS || process.env.TELEGRAM_REQUEST_TIMEOUT_MS);
const TELEGRAM_UPLOAD_TIMEOUT_MS = Number.isFinite(parsedUploadTimeout) && parsedUploadTimeout >= 5000
  ? parsedUploadTimeout
  : DEFAULT_UPLOAD_TIMEOUT_MS;

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let tooBig = false;
    let parentId = null;
    let file = null;
    let fileRead = Promise.resolve();

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const succeed = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { fileSize: MAX, fields: 10 } });
    } catch {
      fail(Object.assign(new Error('Invalid multipart upload'), { status: 400, source: 'client' }));
      return;
    }

    req.once('aborted', () => {
      fail(Object.assign(new Error('Upload was aborted by the client'), { status: 400, source: 'client' }));
    });

    req.once('error', () => {
      fail(Object.assign(new Error('Could not read upload request body'), { status: 400, source: 'client' }));
    });

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

      const tempPath = path.join(os.tmpdir(), `saad-drive-${Date.now()}-${crypto.randomUUID()}.upload`);
      const writeStream = createWriteStream(tempPath);
      const hash = crypto.createHash('sha256');
      let size = 0;
      let digest = null;

      file = {
        path: tempPath,
        name: safeFilename(info.filename || 'file'),
        type: info.mimeType || 'application/octet-stream',
      };

      stream.on('data', chunk => {
        size += chunk.length;
        hash.update(chunk);
      });

      stream.on('limit', () => {
        tooBig = true;
      });

      stream.on('end', () => {
        digest = hash.digest('hex');
      });

      fileRead = new Promise((resolveFile, rejectFile) => {
        stream.on('error', () => rejectFile(Object.assign(new Error('Could not read upload stream'), { status: 400, source: 'client' })));
        writeStream.on('error', () => rejectFile(Object.assign(new Error('Could not write upload stream'), { status: 500, source: 'server' })));
        writeStream.on('finish', () => {
          file.size = size;
          file.checksum = digest;
          resolveFile();
        });
        stream.pipe(writeStream);
      });
    });

    parser.once('error', () => {
      fail(Object.assign(new Error('Could not read upload'), { status: 400, source: 'client' }));
    });

    parser.once('finish', async () => {
      if (settled) return;
      try {
        await fileRead;
      } catch (error) {
        fail(error);
        return;
      }
      if (tooBig) {
        fail(Object.assign(new Error(`File exceeds the ${MAX_MB} MB limit.`), { status: 413, source: 'client' }));
        return;
      }
      if (!file?.size) {
        fail(Object.assign(new Error('No file supplied in multipart upload body.'), { status: 400, source: 'client' }));
        return;
      }
      succeed({ file, parentId });
    });

    req.pipe(parser);
  });
}

async function cleanupLocalFile(filePath) {
  if (!filePath) return;
  try {
    await rm(filePath, { force: true });
  } catch {
    // ignore cleanup errors
  }
}

async function toTelegramUploadBlob(file) {
  try {
    const bytes = await readFile(file.path);
    return new Blob([bytes], { type: file.type });
  } catch {
    throw Object.assign(new Error('Could not prepare the uploaded file for Telegram transfer.'), {
      status: 500,
      source: 'server',
    });
  }
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

function describeTelegramResult(payload) {
  const result = payload?.result;
  if (!result || typeof result !== 'object') return 'Telegram returned no result object.';
  const keys = Object.keys(result).slice(0, 8);
  return keys.length ? `Telegram result keys: ${keys.join(', ')}` : 'Telegram result object was empty.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;

  const requestId = crypto.randomUUID();
  const telegramChatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!process.env.TELEGRAM_BOT_TOKEN || !telegramChatId) {
    return json(res, 503, { error: 'Telegram storage is not configured in production.' });
  }

  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
    return json(res, 400, { error: 'Content-Type must be multipart/form-data', source: 'client' });
  }

  let uploadedTelegram = null;
  let uploadedFilePath = null;

  try {
    await ensureDb();
    await mkdir(os.tmpdir(), { recursive: true });

    const { file, parentId } = await parseMultipart(req);
    uploadedFilePath = file.path;
    console.info(JSON.stringify({
      event: 'upload.received',
      requestId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      parentId: parentId || null,
    }));
    const validParentId = await validateParent(parentId);

    if (await hasDuplicateName(file.name, validParentId)) {
      return json(res, 409, {
        error: 'A file with this name already exists in the destination folder',
        source: 'database',
      });
    }

    const form = new FormData();
    form.append('chat_id', telegramChatId);
    form.append('caption', `Saad Drive | ${file.name}`);
    form.append('document', await toTelegramUploadBlob(file), file.name);

    const telegramResponse = await fetchTelegram('sendDocument', form, TELEGRAM_UPLOAD_TIMEOUT_MS);
    const telegram = await readTelegramPayload(telegramResponse);
    const telegramDocument = parseTelegramUpload(telegram);

    console.info(JSON.stringify({
      event: 'upload.telegram_response',
      requestId,
      status: telegramResponse.status,
      ok: telegramResponse.ok,
      telegramOk: telegram?.ok === true,
      hasResult: Boolean(telegram?.result),
    }));

    if (!telegramResponse.ok || !telegram?.ok) {
      const fallbackDetail = telegram?.description
        || (telegram
          ? `Telegram returned ok=false.${telegramResponse.status ? ` HTTP ${telegramResponse.status}.` : ''}`
          : `Telegram returned a non-JSON response.${telegramResponse.status ? ` HTTP ${telegramResponse.status}.` : ''}`);
      return json(res, 502, {
        error: 'Telegram rejected the upload.',
        detail: fallbackDetail,
        source: 'telegram',
      });
    }

    if (!telegramDocument?.fileId) {
      return json(res, 502, {
        error: 'Telegram response was incomplete after upload.',
        detail: `Missing Telegram file identifier in upload response. ${describeTelegramResult(telegram)}`,
        source: 'telegram',
      });
    }

    uploadedTelegram = telegramDocument;

    let result;
    try {
      result = await sql`
        INSERT INTO drive_items(
          name,
          kind,
          parent_id,
          telegram_file_id,
          telegram_message_id,
          telegram_chat_id,
          checksum_sha256,
          mime_type,
          size_bytes
        )
        VALUES(
          ${file.name},
          'file',
          ${validParentId},
          ${telegramDocument.fileId},
          ${telegramDocument.messageId},
          ${telegramDocument.chatId || telegramChatId},
          ${file.checksum || null},
          ${file.type},
          ${telegramDocument.fileSize ?? file.size}
        )
        RETURNING *
      `;
    } catch (error) {
      if (uploadedTelegram?.messageId) {
        await deleteTelegramMessage(uploadedTelegram.chatId || telegramChatId, uploadedTelegram.messageId);
      }
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

    console.info(JSON.stringify({
      event: 'upload.db_saved',
      requestId,
      telegramMessageId: uploadedTelegram?.messageId || null,
      telegramFileIdPresent: Boolean(uploadedTelegram?.fileId),
    }));
    return json(res, 201, { item: result.rows[0] });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'upload.failed',
      requestId,
      source: error?.source || (error instanceof TypeError ? 'telegram' : 'server'),
      message: error?.message || 'Upload failed',
      status: error?.status || null,
    }));
    if (error?.name === 'AbortError') {
      return json(res, 504, { error: 'Telegram request timed out.', source: 'telegram' });
    }
    if (error instanceof TypeError) {
      return json(res, 502, {
        error: 'Could not reach Telegram API.',
        detail: error.message || 'Network request failed.',
        source: 'telegram',
      });
    }
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
  } finally {
    await cleanupLocalFile(uploadedFilePath);
  }
}
