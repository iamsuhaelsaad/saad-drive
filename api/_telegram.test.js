import test from 'node:test';
import assert from 'node:assert/strict';
import { isIgnorableTelegramDeleteError, parseTelegramUpload } from './_telegram.js';

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

test('ignorable delete errors are classified', () => {
  assert.equal(isIgnorableTelegramDeleteError('Bad Request: message to delete not found'), true);
  assert.equal(isIgnorableTelegramDeleteError('Bad Request: message can not be deleted'), true);
  assert.equal(isIgnorableTelegramDeleteError('Forbidden: bot was blocked by the user'), false);
});
