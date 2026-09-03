import assert from 'node:assert/strict';
import { getMediaStoragePath, isSafeUpload, maxMediaBytes } from '../src/services/mediaStorage';
import { parseLocalOrderEdit } from '../src/orderEditParser';
import { buildMediaPayload, buildTextPayload } from '../src/cloudClient';
import { parseIncoming } from '../src/whatsappIncoming';
import { shouldIgnoreIncomingForAutomaticResponse } from '../src/services/botProcessor';

assert.throws(() => getMediaStoragePath('../../fuera-del-storage'));
assert.equal(maxMediaBytes, 25 * 1024 * 1024);
assert.equal(isSafeUpload(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
assert.equal(isSafeUpload(Buffer.from('MZ executable'), 'image/png'), false);
assert.equal(isSafeUpload(Buffer.from('<svg><script/></svg>'), 'image/svg+xml'), false);
assert.deepEqual(buildTextPayload('5491112345678', 'hola', 'wamid.original').context, { message_id: 'wamid.original' });
assert.deepEqual(buildMediaPayload('5491112345678', 'media-id', 'image', undefined, undefined, 'wamid.original').context, { message_id: 'wamid.original' });

const parsedReaction = parseIncoming({
  id: 'wamid.reaction',
  from: '5491112345678',
  type: 'reaction',
  timestamp: '1787850960',
  reaction: { message_id: 'wamid.original', emoji: '🙌' },
});
assert.equal(parsedReaction?.text, 'Reacción: 🙌');
assert.equal(parsedReaction?.quotedProviderMessageId, 'wamid.original');
assert.equal(shouldIgnoreIncomingForAutomaticResponse(parsedReaction?.type || ''), true);

const parsedLocation = parseIncoming({
  id: 'wamid.location',
  from: '5491112345678',
  type: 'location',
  location: { latitude: -31.4167, longitude: -64.1833, name: 'Local Centro' },
});
assert.match(parsedLocation?.text || '', /Local Centro/);
assert.match(parsedLocation?.text || '', /maps\.google\.com/);

const parsedContact = parseIncoming({
  id: 'wamid.contact',
  from: '5491112345678',
  type: 'contacts',
  contacts: [{ name: { formatted_name: 'Ana Pérez' }, phones: [{ phone: '+54 9 351 555-0101' }] }],
});
assert.match(parsedContact?.text || '', /Ana Pérez/);

const items = [
  { cod: 1, name: 'Cremoso', marca: 'Marca A', qty: 2, gate: 'horma', price: 100, total: 200, promo: false },
  { cod: 2, name: 'Muzzarella', marca: 'Marca B', qty: 5, gate: 'kg', price: 200, total: 1000, promo: false },
];
assert.equal(parseLocalOrderEdit('borrar 2', items).action, 'delete');
assert.deepEqual(parseLocalOrderEdit('borrar 2', items).targetIndices, [1]);
assert.equal(parseLocalOrderEdit('1 borrar', items).action, 'delete');
assert.deepEqual(parseLocalOrderEdit('1 borrar', items).targetIndices, [0]);
assert.equal(parseLocalOrderEdit('???', items).action, 'unknown');

import { encodeConversationCursor, decodeConversationCursor, isValidAnalyticsDateOnly, resolveAnalyticsPeriod } from '../src/db/repository';

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

assert.equal(isValidAnalyticsDateOnly('2026-08-27'), true);
assert.equal(isValidAnalyticsDateOnly('2026-02-30'), false);
assert.equal(isValidAnalyticsDateOnly('2026-8-27'), false);

const analyticsNow = new Date('2026-08-27T18:30:00.000Z');
const sevenDayRange = resolveAnalyticsPeriod({ period: '7d' }, analyticsNow);
assert.equal(sevenDayRange.fromDate.toISOString(), '2026-08-21T03:00:00.000Z');
assert.equal(sevenDayRange.toDate.toISOString(), analyticsNow.toISOString());
const thirtyDayRange = resolveAnalyticsPeriod({ period: '30d' }, analyticsNow);
assert.equal(thirtyDayRange.fromDate.toISOString(), '2026-07-29T03:00:00.000Z');
const customRange = resolveAnalyticsPeriod({ period: 'custom', from: '2026-08-01', to: '2026-08-15' }, analyticsNow);
assert.equal(customRange.fromDate.toISOString(), '2026-08-01T03:00:00.000Z');
assert.equal(customRange.toDate.toISOString(), '2026-08-16T02:59:59.999Z');
assert.throws(() => resolveAnalyticsPeriod({ period: 'custom', from: '2026-02-30', to: '2026-03-01' }, analyticsNow));

console.log('unit hardening tests: OK');
