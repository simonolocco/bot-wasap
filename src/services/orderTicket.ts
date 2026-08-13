const FORWARD_ORDER_NUMBER = (process.env.FORWARD_ORDER_NUMBER ?? '+54 9 351 756-5641').replace(/\D/g, '');
const FORWARD_ORDER_DISPLAY = process.env.FORWARD_ORDER_DISPLAY ?? `+${FORWARD_ORDER_NUMBER}`;

export { ORDER_TICKET_ACK } from '../messageCatalog';

export function buildOrderForwardLink(detail: string, customerName: string, orderId: number) {
  const text = [`Pedido #${orderId} - ${customerName || 'Cliente'}`, '━━━━━━━━━━━━', detail.trim(), '━━━━━━━━━━━━'].join('\n');
  return `https://wa.me/${FORWARD_ORDER_NUMBER}?text=${encodeURIComponent(text)}`;
}

export function buildOrderFallbackMessage(detail: string, customerName: string, orderId: number) {
  return [
    '📦 Para continuar con tu pedido, enviáselo al asesor desde este link:',
    '',
    `Asesor (${FORWARD_ORDER_DISPLAY}):`,
    buildOrderForwardLink(detail, customerName, orderId),
    '',
    'El ticket se cerró y el bot volvió a estar activo. Si necesitás ayuda, escribinos nuevamente.',
  ].join('\n');
}
