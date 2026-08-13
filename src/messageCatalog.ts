import type { SupportTicket } from './db/repository';
export {
  BUSINESS_ADDRESS, BUSINESS_SCHEDULE, FAQ_GENERAL, FAQ_OTHER_NO_ID, FAQ_OTHER_PROMPT, FAQ_OTHER_YES_ID,
  MAIN_MENU_OPTIONS, MENU_BUTTON_LABEL, MENU_HEADER_TEXT, MENU_PROMPT, ORDER_INSTRUCTIONS, SUPPORT_TICKET_PROMPT,
  buildGreetingIntro, buildMenuListSections, formatPriceListMessage, normalizeText, resolveOptionIdFromText,
} from './botMenu';
export type { MenuOptionId } from './botMenu';

export type TicketClosureReason =
  | 'order_completed'
  | 'question_answered'
  | 'customer_no_reply'
  | 'operator_cancelled'
  | 'fallback_sent';

export const ORDER_TICKET_ACK =
  '\u2705 Recibimos tu lista y la dejamos en un ticket de pedido. Un asesor la va a revisar y te responderá por este chat. Mientras tanto, el bot queda pausado para no interrumpir la atención.';

export const EMPTY_ORDER_MESSAGE = 'Necesito que me envíes la lista del pedido en texto.';

export function advisorReply(link: string) {
  return ['\u2705 *Listo!*', 'Si querés hablar con nuestro asesor humano, podés escribirle desde este link:', link].join('\n');
}

/** The ticket type and the explicit reason are the only source of truth. */
export function ticketClosureMessage(ticketType: SupportTicket['ticketType'], reason: TicketClosureReason) {
  if (reason === 'fallback_sent') return null;
  if (reason === 'order_completed' && ticketType !== 'order') throw new Error('order_completed sólo corresponde a tickets de pedido.');
  if (reason === 'question_answered' && ticketType !== 'question') throw new Error('question_answered sólo corresponde a tickets de pregunta.');
  if (ticketType === 'order' && reason === 'order_completed') {
    return '\u2705 Tu pedido fue atendido y quedó finalizado. Si necesitás algo más, escribinos nuevamente.';
  }
  if (ticketType === 'question' && reason === 'question_answered') {
    return '\u2705 Tu consulta fue atendida y quedó finalizada. Si necesitás algo más, escribinos nuevamente.';
  }
  if (reason === 'customer_no_reply') {
    return '\u2139\ufe0f Cerramos esta atención porque no recibimos la información necesaria. Si todavía necesitás ayuda, escribinos nuevamente.';
  }
  if (reason === 'operator_cancelled') {
    return '\u2139\ufe0f Cerramos esta atención. Si necesitás ayuda, escribinos nuevamente.';
  }
  throw new Error('Motivo de cierre inválido para el tipo de ticket.');
}

export const TICKET_CLOSURE_REASONS = [
  'order_completed',
  'question_answered',
  'customer_no_reply',
  'operator_cancelled',
  'fallback_sent',
] as const;
