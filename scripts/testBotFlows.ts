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
  ['📍 Dirección', 'direccion'],
  ['¿Cuál es la ubicación del negocio?', 'direccion'],
  ['💲 Precios', 'lista_precio'],
  ['lista de precios', 'lista_precio'],
  ['📝 Nuevo Pedido', 'hacer_pedido'],
  ['nuevo pedido', 'hacer_pedido'],
  ['👤 Asesor Humano', 'asesor'],
  ['asesor humano', 'asesor'],
  ['hablar con alguien', 'asesor'],
  ['❓ Preguntas frecuentes', 'preguntas_frecuentes'],
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
assert.equal(resolveIncomingMenuOption({ text: '📍 Dirección' }), 'direccion');
assert.equal(resolveIncomingMenuOption({ text: '💲 Precios' }), 'lista_precio');
assert.equal(resolveIncomingMenuOption({ text: '2 cajas de queso cremoso' }), undefined);

const now = Date.now();
assert.equal(automaticResponseAgeMs(now - 30_000, new Date(now).toISOString(), now), 30_000);
assert.equal(shouldSkipAutomaticResponse(now - 30_000, new Date(now).toISOString(), now, 120), false);
assert.equal(shouldSkipAutomaticResponse(now - 121_000, new Date(now).toISOString(), now, 120), true);
assert.equal(shouldSkipAutomaticResponse(undefined, new Date(now - 121_000).toISOString(), now, 120), true);
assert.equal(shouldSkipAutomaticResponse(now - 121_000, new Date(now).toISOString(), now, 120), true, 'Meta timestamp debe prevalecer sobre received_at');

import { isMenuCommand } from '../src/services/botProcessor';

assert.equal(isMenuCommand('Hola'), true);
assert.equal(isMenuCommand('hola bot'), true);
assert.equal(isMenuCommand('buenas tardes'), true);
assert.equal(isMenuCommand('ver menu'), true);
assert.equal(isMenuCommand('opciones'), true);
assert.equal(isMenuCommand('2 cajas de queso cremoso'), false);
assert.equal(isMenuCommand('tienen manteca?'), false);

// Classification logic verification
function classifyInteraction(incoming: { text?: string; selectedOptionId?: string; buttonReplyId?: string }) {
  const option = resolveIncomingMenuOption(incoming as any);
  if (option) return { type: 'menu_option', option };
  if (isMenuCommand(incoming.text)) return { type: 'menu_requested', option: null };
  return { type: 'unrecognized_message', option: null };
}

assert.deepEqual(classifyInteraction({ text: '1' }), { type: 'menu_option', option: 'horarios' });
assert.deepEqual(classifyInteraction({ text: 'horarios' }), { type: 'menu_option', option: 'horarios' });
assert.deepEqual(classifyInteraction({ text: 'ubicacion' }), { type: 'menu_option', option: 'direccion' });
assert.deepEqual(classifyInteraction({ text: 'lista de precios' }), { type: 'menu_option', option: 'lista_precio' });
assert.deepEqual(classifyInteraction({ text: 'quiero hacer un pedido' }), { type: 'menu_option', option: 'hacer_pedido' });
assert.deepEqual(classifyInteraction({ text: 'hablar con un asesor' }), { type: 'menu_option', option: 'asesor' });
assert.deepEqual(classifyInteraction({ text: 'preguntas frecuentes' }), { type: 'menu_option', option: 'preguntas_frecuentes' });
assert.deepEqual(classifyInteraction({ text: 'hola' }), { type: 'menu_requested', option: null });
assert.deepEqual(classifyInteraction({ text: 'tienen stock de salame?' }), { type: 'unrecognized_message', option: null });
assert.deepEqual(classifyInteraction({ text: 'hacen envíos a Carlos Paz?' }), { type: 'unrecognized_message', option: null });

// A contact can be without a menu selection and still have received a valid automatic reply.
function responseStatusForContact(incomingAt: string[], automaticOutgoingAt: string[], manualOutgoingAt: string[] = []) {
  const incoming = incomingAt.map(value => new Date(value).getTime());
  const automatic = automaticOutgoingAt.map(value => new Date(value).getTime());
  const manual = new Set(manualOutgoingAt.map(value => new Date(value).getTime()));
  const responseCount = automatic.filter(outgoing => !manual.has(outgoing) && incoming.some(input => outgoing >= input && outgoing <= input + 10 * 60 * 1000)).length;
  return { responseCount, responseStatus: responseCount > 0 ? 'responded' : 'unanswered' };
}

assert.deepEqual(
  responseStatusForContact(['2026-08-20T16:00:00.000Z'], ['2026-08-20T16:00:10.000Z']),
  { responseCount: 1, responseStatus: 'responded' },
  'Un contacto sin selección de menú no debe marcarse sin respuesta si el bot contestó'
);
assert.deepEqual(
  responseStatusForContact(['2026-08-20T16:00:00.000Z'], []),
  { responseCount: 0, responseStatus: 'unanswered' },
  'Un contacto sin respuesta automática debe quedar como unanswered'
);
assert.deepEqual(
  responseStatusForContact(['2026-08-20T16:00:00.000Z'], ['2026-08-20T16:00:10.000Z'], ['2026-08-20T16:00:10.000Z']),
  { responseCount: 0, responseStatus: 'unanswered' },
  'Una respuesta manual no cuenta como respuesta automática del bot'
);

// First interaction classification verification (Feedback 1)
function classifyFirstInteraction(incoming: { text?: string }) {
  const option = resolveIncomingMenuOption(incoming as any);
  const events: string[] = [];
  if (!option) {
    if (!isMenuCommand(incoming.text)) {
      events.push('unrecognized_message');
    }
    events.push('menu_requested');
  } else {
    events.push('menu_option');
  }
  return events;
}

assert.deepEqual(classifyFirstInteraction({ text: 'Hola' }), ['menu_requested'], 'Saludo estándar sólo pide menú');
assert.deepEqual(classifyFirstInteraction({ text: 'Buenas tardes' }), ['menu_requested'], 'Saludo estándar sólo pide menú');
assert.deepEqual(classifyFirstInteraction({ text: '1' }), ['menu_option'], 'Opción directa en primer mensaje');
assert.deepEqual(classifyFirstInteraction({ text: 'Tienen queso azul?' }), ['unrecognized_message', 'menu_requested'], 'Texto libre en primera interacción registra unrecognized_message y menu_requested');
assert.deepEqual(classifyFirstInteraction({ text: 'Hola, hacen envíos?' }), ['unrecognized_message', 'menu_requested'], 'Texto libre en primera interacción registra unrecognized_message y menu_requested');

// Trend calculation verification with flow_command, bot_paused, order_submitted (Feedback 4)
function calculateDailyTrend(
  dailyIncomingMsgs: Array<{ day: string; count: number; uniqueContacts: number }>,
  dailyEvents: Array<{ day: string; optionsRecognized: number; unrecognized: number; menuInteractions: number; menuRequested?: number }>
) {
  const msgMap = new Map(dailyIncomingMsgs.map(m => [m.day, m]));
  const evMap = new Map(dailyEvents.map(e => [e.day, e]));
  const days = Array.from(new Set([...msgMap.keys(), ...evMap.keys()])).sort();
  return days.map(day => {
    const msg = msgMap.get(day);
    const ev = evMap.get(day);
    return {
      date: day,
      incomingMessages: msg?.count ?? (Number(ev?.optionsRecognized || 0) + Number(ev?.unrecognized || 0)),
      optionsRecognized: ev?.optionsRecognized || 0,
      unrecognized: ev?.unrecognized || 0,
      menuInteractions: ev?.menuInteractions || 0,
      menuRequested: ev?.menuRequested ?? Math.max(0, (ev?.menuInteractions || 0) - (ev?.optionsRecognized || 0)),
      uniqueContacts: msg?.uniqueContacts || 0,
    };
  });
}

const trendResult = calculateDailyTrend(
  [{ day: '2026-08-20', count: 15, uniqueContacts: 8 }],
  [{ day: '2026-08-20', optionsRecognized: 5, unrecognized: 3, menuInteractions: 6 }]
);
assert.equal(trendResult[0].incomingMessages, 15, 'incomingMessages debe ser el total de messages.direction=incoming');
assert.equal(trendResult[0].optionsRecognized, 5);
assert.equal(trendResult[0].unrecognized, 3);
assert.equal(trendResult[0].menuRequested, 1);
assert.equal(trendResult[0].uniqueContacts, 8);

// Advisor derivations include the menu option itself and the explicit follow-up event,
// but the same provider message must count only once.
function countAdvisorRequests(events: Array<{ providerMessageId: string; eventType: string; selectedOption?: string | null }>) {
  return new Set(
    events
      .filter(event => event.eventType === 'human_advisor_requested' || (event.eventType === 'menu_option' && event.selectedOption === 'asesor'))
      .map(event => event.providerMessageId)
  ).size;
}

assert.equal(countAdvisorRequests([
  { providerMessageId: 'p1', eventType: 'menu_option', selectedOption: 'asesor' },
  { providerMessageId: 'p1', eventType: 'human_advisor_requested', selectedOption: 'asesor' },
  { providerMessageId: 'p2', eventType: 'menu_option', selectedOption: 'asesor' },
  { providerMessageId: 'p3', eventType: 'menu_option', selectedOption: 'direccion' },
]), 2, 'Cada selección de Asesor cuenta una vez, aunque genere dos eventos');

// Coverage boundary logic verification for contacts without menu (Feedback - Iteration 3)
function computeContactsWithoutMenuCoverage({
  totalEventsTracked,
  earliestEventAt,
  fromDate,
  historicalMessages,
  menuOptionEvents,
}: {
  totalEventsTracked: number;
  earliestEventAt: string | null;
  fromDate: string;
  historicalMessages: Array<{ contactId: string; createdAt: string }>;
  menuOptionEvents: Array<{ contactId: string; createdAt: string }>;
}) {
  const hasTrackingData = totalEventsTracked > 0 && earliestEventAt !== null;
  if (!hasTrackingData) {
    return {
      count: 0,
      items: [],
      hasTrackingData: false,
      note: 'Sin eventos analíticos registrados todavía.',
    };
  }

  const earliestEventTime = new Date(earliestEventAt!).getTime();
  const fromTime = new Date(fromDate).getTime();
  const effectiveFromTime = Math.max(fromTime, earliestEventTime);

  const eligibleMsgs = historicalMessages.filter(m => new Date(m.createdAt).getTime() >= effectiveFromTime);
  const menuContactIds = new Set(
    menuOptionEvents
      .filter(e => new Date(e.createdAt).getTime() >= effectiveFromTime)
      .map(e => e.contactId)
  );

  const contactsWithoutMenu = new Set(
    eligibleMsgs
      .map(m => m.contactId)
      .filter(id => !menuContactIds.has(id))
  );

  return {
    count: contactsWithoutMenu.size,
    items: Array.from(contactsWithoutMenu),
    hasTrackingData: true,
    note: fromTime < earliestEventTime ? 'Período restringido a cobertura de tracking.' : 'Métricas generadas con cobertura completa.',
  };
}

// Test case 1: Database with historical incoming messages but ZERO bot_analytics_events
const emptyTrackingResult = computeContactsWithoutMenuCoverage({
  totalEventsTracked: 0,
  earliestEventAt: null,
  fromDate: '2026-07-22T00:00:00.000Z',
  historicalMessages: [
    { contactId: 'c1', createdAt: '2026-08-01T10:00:00.000Z' },
    { contactId: 'c2', createdAt: '2026-08-05T12:00:00.000Z' },
  ],
  menuOptionEvents: [],
});
assert.equal(emptyTrackingResult.count, 0, 'Si no hay eventos, no debe clasificar mensajes históricos como contactos sin menú');
assert.equal(emptyTrackingResult.hasTrackingData, false);
assert.match(emptyTrackingResult.note, /Sin eventos/);

// Test case 2: Database with tracking active starting at earliestEventAt
const partialTrackingResult = computeContactsWithoutMenuCoverage({
  totalEventsTracked: 50,
  earliestEventAt: '2026-08-15T00:00:00.000Z',
  fromDate: '2026-08-01T00:00:00.000Z',
  historicalMessages: [
    { contactId: 'c-old', createdAt: '2026-08-05T10:00:00.000Z' },
    { contactId: 'c-active-with-menu', createdAt: '2026-08-18T10:00:00.000Z' },
    { contactId: 'c-active-no-menu', createdAt: '2026-08-19T10:00:00.000Z' },
  ],
  menuOptionEvents: [
    { contactId: 'c-active-with-menu', createdAt: '2026-08-18T10:01:00.000Z' },
  ],
});
assert.equal(partialTrackingResult.count, 1, 'Sólo c-active-no-menu debe ser contado, ignorando c-old previo al tracking');
assert.deepEqual(partialTrackingResult.items, ['c-active-no-menu']);
assert.match(partialTrackingResult.note, /restringido/);

console.log('bot flow tests: OK');
