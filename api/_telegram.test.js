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

test('ignorable delete errors are classified', () => {
  assert.equal(isIgnorableTelegramDeleteError('Bad Request: message to delete not found'), true);
  assert.equal(isIgnorableTelegramDeleteError('Bad Request: message can not be deleted'), true);
  assert.equal(isIgnorableTelegramDeleteError('Forbidden: bot was blocked by the user'), false);
});
