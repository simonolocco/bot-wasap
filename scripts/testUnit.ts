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

console.log('unit hardening tests: OK');
