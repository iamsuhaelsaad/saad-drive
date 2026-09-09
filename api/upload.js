import Busboy from 'busboy';
import { sql } from '@vercel/postgres';
import { json, auth, tg } from './_security.js';
import { ensureDb } from './_db.js';

export const config = { api: { bodyParser: false } };
const MAX = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!auth(req, res)) return;
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return json(res, 503, { error: 'Telegram storage is not configured in Production.' });
  let file = null, tooBig = false, parentId = null;
  let parser;
  try { parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX, fields: 10 } }); }
  catch (error) { return json(res, 400, { error: 'Invalid multipart upload.', detail: error.message }); }
  parser.on('field', (name, value) => { if (name === 'parent_id') parentId = value || null; });
  parser.on('file', (field, stream, info) => {
    const chunks = []; let size = 0;
    file = { name: info.filename, type: info.mimeType || 'application/octet-stream' };
    stream.on('data', chunk => { size += chunk.length; if (size <= MAX) chunks.push(chunk); });
    stream.on('limit', () => { tooBig = true; });
    stream.on('end', () => { if (file) { file.buffer = Buffer.concat(chunks); file.size = size; } });
  });
  parser.on('error', error => json(res, 400, { error: 'Could not read upload.', detail: error.message }));
  parser.on('finish', async () => {
    try {
      if (tooBig) return json(res, 413, { error: `File exceeds the ${MAX / 1024 / 1024} MB limit.` });
      if (!file?.buffer?.length) return json(res, 400, { error: 'No file supplied. Choose a file first.' });
      const form = new FormData();
      form.append('chat_id', process.env.TELEGRAM_CHAT_ID);
      form.append('caption', `Saad Drive | ${file.name}`);
      form.append('document', new Blob([file.buffer], { type: file.type }), file.name);
      const telegramResponse = await fetch(tg('sendDocument'), { method: 'POST', body: form });
      const telegram = await telegramResponse.json();
      if (!telegramResponse.ok || !telegram.ok) return json(res, 502, { error: 'Telegram rejected the upload.', detail: telegram.description || 'Unknown Telegram error.' });
      await ensureDb();
      const document = telegram.result.document;
      const result = await sql`INSERT INTO drive_items(name, kind, parent_id, telegram_file_id, mime_type, size_bytes) VALUES(${file.name}, 'file', ${parentId}, ${document.file_id}, ${file.type}, ${document.file_size || file.size}) RETURNING *`;
      return json(res, 201, { item: result.rows[0] });
    } catch (error) { return json(res, 500, { error: 'Upload failed.', detail: error.message }); }
  });
  req.pipe(parser);
}
