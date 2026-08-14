import assert from 'node:assert/strict';
import {
  FOLLOW_UP_MENU_HEADER_TEXT,
  FOLLOW_UP_MENU_PROMPT,
  buildMenuListSections,
  normalizeText,
  resolveOptionIdFromText,
} from '../src/botMenu';
import {
  automaticResponseAgeMs,
  resolveIncomingMenuOption,
  shouldSkipAutomaticResponse,
} from '../src/services/botProcessor';

const menuCases: Array<[string, string]> = [
  ['1', 'horarios'],
  ['dirección!!!', 'direccion'],
  ['lista de precios', 'lista_precio'],
  ['nuevo pedido', 'hacer_pedido'],
  ['asesor humano', 'asesor'],
  ['hablar con alguien', 'asesor'],
  ['preguntas frecuentes', 'preguntas_frecuentes'],
];

for (const [input, expected] of menuCases) {
  assert.equal(resolveIncomingMenuOption({ text: input }), expected, `opción durante pedido: ${input}`);
  assert.equal(resolveOptionIdFromText(input), expected, `menú: ${input}`);
}
assert.equal(normalizeText('  ¿DÓNDE están?  '), 'donde estan');
assert.equal(buildMenuListSections()[0].rows.length, 6);
assert.equal(FOLLOW_UP_MENU_HEADER_TEXT, '¿En qué más podemos ayudarte?');
assert.match(FOLLOW_UP_MENU_PROMPT, /otra consulta/);
assert.match(FOLLOW_UP_MENU_PROMPT, /Asesor Humano/);
assert.equal(resolveIncomingMenuOption({ selectedOptionId: 'horarios' }), 'horarios');
assert.equal(resolveIncomingMenuOption({ buttonReplyId: 'asesor' }), 'asesor');
assert.equal(resolveIncomingMenuOption({ text: '👤 Asesor Humano' }), 'asesor');
assert.equal(resolveIncomingMenuOption({ text: '🕒 Horarios' }), 'horarios');
assert.equal(resolveIncomingMenuOption({ text: '2 cajas de queso cremoso' }), undefined);

const now = Date.now();
assert.equal(automaticResponseAgeMs(now - 30_000, new Date(now).toISOString(), now), 30_000);
assert.equal(shouldSkipAutomaticResponse(now - 30_000, new Date(now).toISOString(), now, 120), false);
assert.equal(shouldSkipAutomaticResponse(now - 121_000, new Date(now).toISOString(), now, 120), true);
assert.equal(shouldSkipAutomaticResponse(undefined, new Date(now - 121_000).toISOString(), now, 120), true);
assert.equal(shouldSkipAutomaticResponse(now - 121_000, new Date(now).toISOString(), now, 120), true, 'Meta timestamp debe prevalecer sobre received_at');

console.log('bot flow tests: OK');
