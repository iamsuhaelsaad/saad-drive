import { tg } from './_security.js';

const TELEGRAM_TIMEOUT_MS = Math.max(1000, Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS || 20000));

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
  const queue = [{ node: root, message: null }];
  const visited = new Set();

  while (queue.length) {
    const { node, message } = queue.shift();
    if (!node || typeof node !== 'object' || visited.has(node)) continue;
    visited.add(node);

    const messageNode = (Number.isInteger(node.message_id) || node?.chat?.id !== undefined) ? node : message;
    if (typeof node.file_id === 'string' && node.file_id.trim()) {
      return {
        fileId: node.file_id.trim(),
        fileSize: Number.isFinite(node.file_size) ? Number(node.file_size) : undefined,
        messageId: Number.isInteger(messageNode?.message_id) ? messageNode.message_id : null,
        chatId: messageNode?.chat?.id !== undefined && messageNode?.chat?.id !== null ? String(messageNode.chat.id) : null,
      };
    }

    for (const value of Object.values(node)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) queue.push({ node: item, message: messageNode });
      } else {
        queue.push({ node: value, message: messageNode });
      }
    }
  }

  return null;
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
