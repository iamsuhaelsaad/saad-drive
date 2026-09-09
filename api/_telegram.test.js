import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupTelegramFileReference, isIgnorableTelegramDeleteError, parseTelegramUpload } from './_telegram.js';

test('parseTelegramUpload extracts file and message metadata', () => {
  const payload = {
    ok: true,
    result: {
      message_id: 77,
      chat: { id: '-100123' },
      document: { file_id: 'abc', file_size: 1024 },
    },
  };
  assert.deepEqual(parseTelegramUpload(payload), {
    fileId: 'abc',
    fileSize: 1024,
    messageId: 77,
    chatId: '-100123',
  });
});

test('parseTelegramUpload handles nested message payload shape', () => {
  const payload = {
    ok: true,
    result: {
      message: {
        message_id: 88,
        chat: { id: 12345 },
        document: { file_id: 'nested-file-id', file_size: 2048 },
      },
    },
  };

  assert.deepEqual(parseTelegramUpload(payload), {
    fileId: 'nested-file-id',
    fileSize: 2048,
    messageId: 88,
    chatId: '12345',
  });
});

test('parseTelegramUpload handles array payload shape', () => {
  const payload = {
    ok: true,
    result: [
      {
        message_id: 99,
        chat: { id: '-10099' },
        document: { file_id: 'array-file-id', file_size: 4096 },
      },
    ],
  };

  assert.deepEqual(parseTelegramUpload(payload), {
    fileId: 'array-file-id',
    fileSize: 4096,
    messageId: 99,
    chatId: '-10099',
  });
});

test('parseTelegramUpload prefers document node and accepts numeric string message id', () => {
  const payload = {
    ok: true,
    result: {
      message_id: '101',
      chat: { id: '-100101' },
      thumb: { file_id: 'thumb-id' },
      document: { file_id: 'doc-id', file_size: '555' },
    },
  };

  assert.deepEqual(parseTelegramUpload(payload), {
    fileId: 'doc-id',
    fileSize: 555,
    messageId: 101,
    chatId: '-100101',
  });
});

test('ignorable delete errors are classified', () => {
  assert.equal(isIgnorableTelegramDeleteError('Bad Request: message to delete not found'), true);
  assert.equal(isIgnorableTelegramDeleteError('Bad Request: message can not be deleted'), true);
  assert.equal(isIgnorableTelegramDeleteError('Forbidden: bot was blocked by the user'), false);
});

test('cleanupTelegramFileReference skips when only file_id is present', async () => {
  const result = await cleanupTelegramFileReference({
    telegram_file_id: 'abc',
    telegram_message_id: null,
    telegram_chat_id: '-1001',
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.ok, true);
  assert.match(result.reason, /file_id/i);
});

test('cleanupTelegramFileReference reports failed Telegram delete attempts', async () => {
  const result = await cleanupTelegramFileReference(
    {
      telegram_file_id: 'abc',
      telegram_message_id: 77,
      telegram_chat_id: '-1001',
    },
    '-1001',
    async () => ({ ok: false, description: 'network timeout' })
  );

  assert.deepEqual(result, {
    status: 'failed',
    ok: false,
    reason: 'network timeout',
  });
});
