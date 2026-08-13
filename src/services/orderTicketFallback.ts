import { sendCloudTemplateMessage, sendCloudTextMessage } from '../cloudClient';
import { audit, closeSupportTicket, markOrderTicketFallbackFailed, markOrderTicketFallbackSent, markOutgoingFailed, markOutgoingSent, prepareOutgoingMessage, type OrderTicketFallback } from '../db/repository';
import { buildOrderFallbackMessage, buildOrderForwardLink } from './orderTicket';

const FALLBACK_TEMPLATE_NAME = process.env.ORDER_FALLBACK_TEMPLATE_NAME?.trim();
const FALLBACK_TEMPLATE_LANGUAGE = process.env.ORDER_FALLBACK_TEMPLATE_LANGUAGE ?? 'es_AR';

export function orderWindowExpired(lastIncomingAt: string | null) {
  return !lastIncomingAt || Date.now() - new Date(lastIncomingAt).getTime() >= 24 * 60 * 60 * 1000;
}

export async function sendOrderTicketFallback(data: OrderTicketFallback, expired: boolean, actor = 'admin') {
  if (expired && !FALLBACK_TEMPLATE_NAME) {
    const error = new Error('La ventana de WhatsApp venció. Configurá ORDER_FALLBACK_TEMPLATE_NAME con una plantilla aprobada para enviar el link fuera de las 24 horas.');
    await markOrderTicketFallbackFailed(data.ticket.id, error);
    throw error;
  }
  const customerName = data.order.customerName || data.contact.name || data.contact.publicName || 'Cliente';
  const link = buildOrderForwardLink(data.order.detail, customerName, data.order.id);
  const body = expired
    ? `📦 Pedido #${data.order.id}: link de continuidad enviado mediante plantilla aprobada.\n${link}`
    : buildOrderFallbackMessage(data.order.detail, customerName, data.order.id);
  const stored = await prepareOutgoingMessage(data.contact.id, `order-fallback:${data.ticket.id}`, body, expired ? 'template' : 'text');
  if (stored.delivery_status === 'sent') {
    await markOrderTicketFallbackSent(data.ticket.id);
    await closeSupportTicket(data.ticket.id, 'fallback_sent', actor);
    return { sent: true, body, link, viaTemplate: expired };
  }
  try {
    const providerId = expired
      ? await sendCloudTemplateMessage(data.contact.phone, FALLBACK_TEMPLATE_NAME!, FALLBACK_TEMPLATE_LANGUAGE, [link])
      : await sendCloudTextMessage(data.contact.phone, body);
    await markOutgoingSent(stored.id, providerId);
    await markOrderTicketFallbackSent(data.ticket.id);
    await closeSupportTicket(data.ticket.id, 'fallback_sent', actor);
    await audit(actor, 'order_ticket_fallback_sent', data.contact.id, stored.id, { ticketId: data.ticket.id, orderId: data.order.id, viaTemplate: expired });
    return { sent: true, body, link, viaTemplate: expired };
  } catch (error) {
    await markOutgoingFailed(stored.id, error);
    await markOrderTicketFallbackFailed(data.ticket.id, error);
    await audit(actor, 'order_ticket_fallback_failed', data.contact.id, stored.id, { ticketId: data.ticket.id, orderId: data.order.id, viaTemplate: expired });
    throw error;
  }
}
