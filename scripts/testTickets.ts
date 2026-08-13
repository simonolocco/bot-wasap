import assert from 'node:assert/strict';
import { ORDER_INSTRUCTIONS } from '../src/botMenu';
import { buildOrderForwardLink } from '../src/services/orderTicket';
import { ticketClosureMessage } from '../src/messageCatalog';

const orderClosed = ticketClosureMessage('order', 'order_completed');
assert.equal(orderClosed, '✅ Tu pedido fue atendido y quedó finalizado. Si necesitás algo más, escribinos nuevamente.');
assert.match(orderClosed, /pedido/);
assert.doesNotMatch(orderClosed, /consulta/);

const questionClosed = ticketClosureMessage('question', 'question_answered');
assert.equal(questionClosed, '✅ Tu consulta fue atendida y quedó finalizada. Si necesitás algo más, escribinos nuevamente.');
assert.match(questionClosed, /consulta/);
assert.doesNotMatch(questionClosed, /pedido/);

assert.match(ticketClosureMessage('order', 'customer_no_reply')!, /Cerramos esta atención/);
assert.match(ticketClosureMessage('question', 'operator_cancelled')!, /Cerramos esta atención/);
assert.throws(() => ticketClosureMessage('question', 'order_completed' as never));
assert.throws(() => ticketClosureMessage('order', 'question_answered' as never));

assert.match(ORDER_INSTRUCTIONS, /La voy a compartir completa con nuestro asesor, sin modificarla\./);
assert.match(ORDER_INSTRUCTIONS, /Enviá tu lista ahora/);
assert.doesNotMatch(ORDER_INSTRUCTIONS, /tocá este link/);
assert.doesNotMatch(ORDER_INSTRUCTIONS, /ticket se cerró/);

const link = buildOrderForwardLink('2 cajas de queso', 'Simón', 30);
assert.match(link, /^https:\/\/wa\.me\/\d+\?text=/);
assert.match(decodeURIComponent(link), /Pedido #30 - Simón/);
assert.match(decodeURIComponent(link), /2 cajas de queso/);

console.log('ticket tests: OK');
