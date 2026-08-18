import assert from 'node:assert/strict';
import { getMediaStoragePath, isSafeUpload, maxMediaBytes } from '../src/services/mediaStorage';
import { parseLocalOrderEdit } from '../src/orderEditParser';
import { buildMediaPayload, buildTextPayload } from '../src/cloudClient';

assert.throws(() => getMediaStoragePath('../../fuera-del-storage'));
assert.equal(maxMediaBytes, 25 * 1024 * 1024);
assert.equal(isSafeUpload(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
assert.equal(isSafeUpload(Buffer.from('MZ executable'), 'image/png'), false);
assert.equal(isSafeUpload(Buffer.from('<svg><script/></svg>'), 'image/svg+xml'), false);
assert.deepEqual(buildTextPayload('5491112345678', 'hola', 'wamid.original').context, { message_id: 'wamid.original' });
assert.deepEqual(buildMediaPayload('5491112345678', 'media-id', 'image', undefined, undefined, 'wamid.original').context, { message_id: 'wamid.original' });

const items = [
  { cod: 1, name: 'Cremoso', marca: 'Marca A', qty: 2, gate: 'horma', price: 100, total: 200, promo: false },
  { cod: 2, name: 'Muzzarella', marca: 'Marca B', qty: 5, gate: 'kg', price: 200, total: 1000, promo: false },
];
assert.equal(parseLocalOrderEdit('borrar 2', items).action, 'delete');
assert.deepEqual(parseLocalOrderEdit('borrar 2', items).targetIndices, [1]);
assert.equal(parseLocalOrderEdit('1 borrar', items).action, 'delete');
assert.deepEqual(parseLocalOrderEdit('1 borrar', items).targetIndices, [0]);
assert.equal(parseLocalOrderEdit('???', items).action, 'unknown');

import { encodeConversationCursor, decodeConversationCursor } from '../src/db/repository';

const testDate = new Date('2026-08-17T21:57:29.000Z');
const uuid = '55a0bf55-a3da-42db-924c-5bddfc8d17bc';
const encodedFromDate = encodeConversationCursor(testDate, uuid);
assert.ok(encodedFromDate);
const decodedFromDate = decodeConversationCursor(encodedFromDate);
assert.deepEqual(decodedFromDate, { at: '2026-08-17T21:57:29.000Z', id: uuid });

const legacyString = 'Mon Aug 17 2026 21:57:29 GMT+0000 (Coordinated Universal Time)';
const encodedLegacy = Buffer.from(`${legacyString}|${uuid}`).toString('base64url');
const decodedLegacy = decodeConversationCursor(encodedLegacy);
assert.deepEqual(decodedLegacy, { at: '2026-08-17T21:57:29.000Z', id: uuid });

assert.equal(decodeConversationCursor(''), null);
assert.equal(decodeConversationCursor('invalid-no-pipe'), null);

console.log('unit hardening tests: OK');
