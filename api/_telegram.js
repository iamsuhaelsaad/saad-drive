import { tg } from './_security.js';

const TELEGRAM_TIMEOUT_MS = Math.max(1000, Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS || 20000));

function parseTelegramInteger(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function parseTelegramFileSize(value) {
  const size = parseTelegramInteger(value);
  return Number.isFinite(size) && size >= 0 ? size : undefined;
}

function parseTelegramFileId(node) {
  if (typeof node?.file_id === 'string' && node.file_id.trim()) return node.file_id.trim();
  if (typeof node?.fileId === 'string' && node.fileId.trim()) return node.fileId.trim();
  return null;
}

export async function fetchTelegram(method, body, timeoutMs = TELEGRAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = typeof body === 'string' ? { 'content-type': 'application/json' } : undefined;
    return await fetch(tg(method), { method: 'POST', body, headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function readTelegramPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function parseTelegramUpload(payload) {
  const root = payload?.result && typeof payload.result === 'object' ? payload.result : null;
  const queue = [{ node: root, message: null, relation: 'root' }];
  const visited = new Set();
  let fallbackCandidate = null;

  while (queue.length) {
    const { node, message, relation } = queue.shift();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);

    const messageNode = (parseTelegramInteger(node.message_id) !== null || node?.chat?.id !== undefined) ? node : message;
    const fileId = parseTelegramFileId(node);
    if (fileId) {
      const candidate = {
        fileId,
        fileSize: parseTelegramFileSize(node.file_size ?? node.fileSize),
        messageId: parseTelegramInteger(messageNode?.message_id),
        chatId: messageNode?.chat?.id !== undefined && messageNode?.chat?.id !== null ? String(messageNode.chat.id) : null,
      };
      if (relation === 'document') return candidate;
      if (!fallbackCandidate) fallbackCandidate = candidate;
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) queue.push({ node: item, message: messageNode, relation: key });
      } else {
        queue.push({ node: value, message: messageNode, relation: key });
      }
    }
  }

  return fallbackCandidate;
}

export function isIgnorableTelegramDeleteError(description = '') {
  const value = String(description || '').toLowerCase();
  return value.includes('message to delete not found')
    || value.includes('message identifier is not specified')
    || value.includes('message can\'t be deleted')
    || value.includes('message can not be deleted');
}

export async function deleteTelegramMessage(chatId, messageId) {
  if (!chatId || !messageId) return { ok: false, skipped: true };
  const response = await fetchTelegram('deleteMessage', JSON.stringify({ chat_id: chatId, message_id: messageId }));
  const payload = await readTelegramPayload(response);
  const description = payload?.description || '';

  if (response.ok && payload?.ok) return { ok: true };
  if (isIgnorableTelegramDeleteError(description)) return { ok: true, ignored: true };
  return { ok: false, description: description || 'Telegram deleteMessage failed.' };
}

export async function cleanupTelegramFileReference(
  file,
  defaultChatId = process.env.TELEGRAM_CHAT_ID,
  deleteMessage = deleteTelegramMessage
) {
  const chatId = file?.telegram_chat_id || defaultChatId;
  const messageId = parseTelegramInteger(file?.telegram_message_id);
  const hasFileId = Boolean(parseTelegramFileId({ file_id: file?.telegram_file_id }));

  if (!messageId) {
    return hasFileId
      ? {
          status: 'skipped',
          ok: true,
          reason: 'Telegram Bot API does not support deleting stored blobs by file_id without message_id.',
        }
      : { status: 'skipped', ok: true, reason: 'No Telegram identifiers found for this file.' };
  }

  if (!chatId) {
    return {
      status: 'skipped',
      ok: true,
      reason: 'Missing Telegram chat_id required for deleteMessage cleanup.',
    };
  }

  const deletion = await deleteMessage(String(chatId), messageId);
  if (deletion.ok && deletion.ignored) {
    return {
      status: 'skipped',
      ok: true,
      reason: 'Telegram reported the message is already unavailable or non-deletable.',
    };
  }
  if (deletion.ok) return { status: 'deleted', ok: true };
  return {
    status: 'failed',
    ok: false,
    reason: deletion.description || 'Telegram deleteMessage failed.',
  };
}
