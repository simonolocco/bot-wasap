import { sendCloudMessage, sendCloudTextMessage } from '../cloudClient';
import {
  audit, claimInitialGreeting, claimOutgoingMessage, completeJob, createOrder, createSupportTicket,
  getContactById, getJobEvent, getSession, hasRecentDuplicateIncoming, markOutgoingFailed, markOutgoingSent,
  prepareOutgoingMessage, recordBotInteractionEvent, recordSupportTicketQuestion, retryJob, updateSession,
} from '../db/repository';
import {
  advisorReply, BUSINESS_ADDRESS, BUSINESS_SCHEDULE, EMPTY_ORDER_MESSAGE, FAQ_GENERAL, FAQ_OTHER_NO_ID, FAQ_OTHER_PROMPT,
  FAQ_OTHER_YES_ID, FOLLOW_UP_MENU_HEADER_TEXT, FOLLOW_UP_MENU_PROMPT, MAIN_MENU_OPTIONS, MENU_BUTTON_LABEL, MENU_HEADER_TEXT, MENU_PROMPT, ORDER_INSTRUCTIONS,
  SUPPORT_TICKET_PROMPT, buildGreetingIntro, buildMenuListSections, formatPriceListMessage, normalizeText, resolveOptionIdFromText, type MenuOptionId,
} from '../messageCatalog';
import { buildOrderForwardLink } from './orderTicket';

type Incoming = { from: string; profileName?: string; text?: string; selectedOptionId?: MenuOptionId; buttonReplyId?: string; type: string; sourceTimestamp?: number };
const DUPLICATE_AUTO_RESPONSE_WINDOW_SECONDS = Math.max(0, Number.parseInt(process.env.DUPLICATE_AUTO_RESPONSE_WINDOW_SECONDS ?? '90', 10) || 90);
const AUTO_RESPONSE_MAX_DELAY_SECONDS = Math.max(0, Number.parseInt(process.env.AUTO_RESPONSE_MAX_DELAY_SECONDS ?? '120', 10) || 120);

export function automaticResponseAgeMs(sourceTimestamp: number | undefined, receivedAt: string, now = Date.now()) {
  const source = Number(sourceTimestamp);
  const sourceAt = Number.isFinite(source) && source > 0 ? source : Date.parse(receivedAt);
  return Number.isFinite(sourceAt) ? Math.max(0, now - sourceAt) : Number.POSITIVE_INFINITY;
}

export function shouldSkipAutomaticResponse(sourceTimestamp: number | undefined, receivedAt: string, now = Date.now(), maxDelaySeconds = AUTO_RESPONSE_MAX_DELAY_SECONDS) {
  return automaticResponseAgeMs(sourceTimestamp, receivedAt, now) > maxDelaySeconds * 1000;
}

function advisorLink() {
  const number = (process.env.FORWARD_ORDER_NUMBER ?? '+54 9 351 756-5641').replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent('Hola, tengo una consulta')}`;
}

async function outgoing(contactId: string, to: string, key: string, body: string, payload?: Record<string, unknown>) {
  const stored = await prepareOutgoingMessage(contactId, key, body, payload ? 'interactive' : 'text');
  if (stored.delivery_status === 'sent') return;
  if (stored.delivery_status === 'sending') return;
  if (!(await claimOutgoingMessage(stored.id))) return;
  try {
    const providerId = payload ? await sendCloudMessage(payload) : await sendCloudTextMessage(to, body);
    await markOutgoingSent(stored.id, providerId);
  } catch (error) {
    await markOutgoingFailed(stored.id, error);
    throw error;
  }
}

async function sendMenu(contactId: string, to: string, key: string) {
  // Idempotency bucket: repeated menu triggers for the same contact within
  // three seconds reuse the same outbound row and cannot send another menu.
  const cooldownBucket = Math.floor(Date.now() / 3000);
  await outgoing(contactId, to, `menu-cooldown:${contactId}:${cooldownBucket}`, MENU_PROMPT, {
    messaging_product: 'whatsapp', to, type: 'interactive', interactive: {
      type: 'list', header: { type: 'text', text: MENU_HEADER_TEXT }, body: { text: MENU_PROMPT },
      action: { button: MENU_BUTTON_LABEL, sections: buildMenuListSections() },
    },
  });
}

async function sendFollowUpMenu(contactId: string, to: string, key: string) {
  const cooldownBucket = Math.floor(Date.now() / 3000);
  await outgoing(contactId, to, `follow-up-menu-cooldown:${contactId}:${cooldownBucket}`, FOLLOW_UP_MENU_PROMPT, {
    messaging_product: 'whatsapp', to, type: 'interactive', interactive: {
      type: 'list', header: { type: 'text', text: FOLLOW_UP_MENU_HEADER_TEXT }, body: { text: FOLLOW_UP_MENU_PROMPT },
      action: { button: MENU_BUTTON_LABEL, sections: buildMenuListSections() },
    },
  });
}

export function isMenuCommand(text: string | undefined) {
  const normalized = normalizeText(text);
  return ['hola', 'hola bot', 'buenas', 'buenas bot', 'buen dia', 'buenas tardes', 'buenas noches', 'menu', 'opciones', 'ver menu', 'ver opciones'].includes(normalized);
}

export function resolveIncomingMenuOption(incoming: Pick<Incoming, 'text' | 'selectedOptionId' | 'buttonReplyId'>): MenuOptionId | undefined {
  const structuredOption = incoming.selectedOptionId ?? incoming.buttonReplyId;
  if (structuredOption && MAIN_MENU_OPTIONS.some(item => item.id === structuredOption)) return structuredOption as MenuOptionId;
  const normalizedText = normalizeText(incoming.text);
  if (/^[1-6]\s+/.test(normalizedText)) return undefined;

  return resolveOptionIdFromText(incoming.text);
}

function orderLinkMessage(detail: string, customerName: string, orderId: number) {
  return [
    '✅ Recibimos tu pedido.',
    '',
    'Para enviárselo al asesor, tocá este link:',
    buildOrderForwardLink(detail, customerName, orderId),
  ].join('\n');
}

function faqFollowUpPayload(to: string): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp', to, type: 'interactive', interactive: {
      type: 'button', body: { text: FAQ_OTHER_PROMPT },
      action: { buttons: [
        { type: 'reply', reply: { id: FAQ_OTHER_YES_ID, title: 'Sí, preguntar' } },
        { type: 'reply', reply: { id: FAQ_OTHER_NO_ID, title: 'Volver al menú' } },
      ] },
    },
  };
}

async function handleOption(contactId: string, incoming: Incoming, option: MenuOptionId, key: string) {
  const to = incoming.from;
  switch (option) {
    case 'horarios': await outgoing(contactId, to, `${key}:schedule`, BUSINESS_SCHEDULE); break;
    case 'direccion': await outgoing(contactId, to, `${key}:address`, BUSINESS_ADDRESS); break;
    case 'lista_precio': await outgoing(contactId, to, `${key}:prices`, formatPriceListMessage()); break;
    case 'preguntas_frecuentes':
      await outgoing(contactId, to, `${key}:faq`, FAQ_GENERAL);
      await outgoing(contactId, to, `${key}:faq-follow-up`, FAQ_OTHER_PROMPT, faqFollowUpPayload(to));
      break;
    case 'asesor': await outgoing(contactId, to, `${key}:advisor`, advisorReply(advisorLink())); break;
    case 'hacer_pedido':
      await updateSession(contactId, { awaitingOrderDetail: true });
      await outgoing(contactId, to, `${key}:order-instructions`, ORDER_INSTRUCTIONS);
      return;
  }
  await updateSession(contactId, { awaitingOrderDetail: false });
  if (option !== 'preguntas_frecuentes') await sendFollowUpMenu(contactId, to, key);
}

export async function processIncomingJob(job: { id: string; contact_id: string; attempts: number }) {
  const event = await getJobEvent(job.id);
  if (!event) { await completeJob(job.id); return; }
  try {
    const incoming = (event.payload as { incoming?: Incoming }).incoming as Incoming;
    if (!incoming) throw new Error('Evento sin mensaje entrante');
    const sourceTimestamp = Number(incoming.sourceTimestamp ?? (event.source_timestamp ? Date.parse(event.source_timestamp) : NaN));
    const ageMs = automaticResponseAgeMs(sourceTimestamp, event.received_at);
    const stale = shouldSkipAutomaticResponse(sourceTimestamp, event.received_at);
    if (stale) {
      await audit('bot', 'auto_response_skipped_stale', job.contact_id, undefined, {
        jobId: job.id,
        providerMessageId: event.provider_message_id,
        ageSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
        maxDelaySeconds: AUTO_RESPONSE_MAX_DELAY_SECONDS,
      });
    }
    if (stale) {
      console.warn(`[worker] Job ${job.id} descartado: evento entrante demasiado antiguo para responder automáticamente.`);
      await completeJob(job.id); return;
    }
    const contact = await getContactById(job.contact_id);
    if (!contact) throw new Error('Contacto inexistente');
    console.info(`[worker] Evento recibido para ${job.contact_id}: tipo=${incoming.type}, botPaused=${contact.botPaused}.`);

    const rawText = incoming.text?.trim() || '';
    const normText = normalizeText(rawText);
    const eventTime = event.source_timestamp ? new Date(event.source_timestamp) : new Date(event.received_at);

    if (contact.botPaused) {
      const question = incoming.text?.trim() || `[Mensaje ${incoming.type} recibido]`;
      const ticket = await recordSupportTicketQuestion(job.contact_id, event.provider_message_id, question);
      if (ticket) console.info(`[worker] Pregunta agregada al ticket ${ticket.id} del contacto ${job.contact_id}.`);
      else console.info(`[worker] Mensaje retenido para ${job.contact_id}: ticket abierto sin pregunta inicial disponible.`);

      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'bot_paused_message',
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { botPaused: true, ticketId: ticket?.id ?? null },
        createdAt: eventTime,
      });

      await completeJob(job.id);
      return;
    }

    const incomingSignature = incoming.text?.trim() || incoming.selectedOptionId || incoming.buttonReplyId || '';
    const menuCommand = isMenuCommand(incoming.text);
    if (!menuCommand && await hasRecentDuplicateIncoming(job.contact_id, event.provider_message_id, incomingSignature, DUPLICATE_AUTO_RESPONSE_WINDOW_SECONDS)) {
      console.info(`[worker] Respuesta automática omitida para ${job.contact_id}: mensaje repetido dentro de ${DUPLICATE_AUTO_RESPONSE_WINDOW_SECONDS}s.`);
      await completeJob(job.id);
      return;
    }
    const session = await getSession(job.contact_id);
    const key = `event:${event.provider_message_id}`;

    if (incoming.buttonReplyId === FAQ_OTHER_YES_ID) {
      const result = await createSupportTicket(job.contact_id, 'bot');
      console.info(`[worker] Solicitud de atención humana para ${job.contact_id}: ticket=${result.ticket?.id ?? 'existente'}, creado=${result.created}.`);
      await updateSession(job.contact_id, { awaitingOrderDetail: false });

      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'human_advisor_requested',
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { source: 'faq_followup_button', ticketCreated: result.created },
        createdAt: eventTime,
      });

      if (result.created) await outgoing(job.contact_id, incoming.from, `${key}:support-ticket-prompt`, SUPPORT_TICKET_PROMPT);
      await completeJob(job.id);
      return;
    }
    if (incoming.buttonReplyId === FAQ_OTHER_NO_ID) {
      console.info(`[worker] Cliente volvió al menú: ${job.contact_id}.`);

      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'menu_requested',
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { source: 'faq_followup_button' },
        createdAt: eventTime,
      });

      await sendFollowUpMenu(job.contact_id, incoming.from, key);
      await completeJob(job.id);
      return;
    }
    let option = resolveIncomingMenuOption(incoming);

    const initialName = incoming.profileName?.trim() || session.display_name || '¡hola!';
    const firstInteraction = !session.greeted && await claimInitialGreeting(job.contact_id, initialName);
    if (firstInteraction) {
      await outgoing(job.contact_id, incoming.from, `${key}:greeting`, buildGreetingIntro(initialName));
      console.info(`[worker] Primera interacción de ${job.contact_id}: saludo enviado.`);
      if (!option) {
        if (!isMenuCommand(incoming.text)) {
          await recordBotInteractionEvent({
            contactId: job.contact_id,
            providerMessageId: event.provider_message_id,
            eventType: 'unrecognized_message',
            rawText,
            normalizedText: normText,
            messageType: incoming.type,
            metadata: { reason: 'first_interaction_unrecognized_text' },
            createdAt: eventTime,
          });
        }
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'menu_requested',
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { source: 'first_greeting' },
          createdAt: eventTime,
        });
        await sendMenu(job.contact_id, incoming.from, key);
        await completeJob(job.id);
        return;
      }
    }

    if (session.awaiting_order_detail && (isMenuCommand(incoming.text) || normalizeText(incoming.text) === 'cancelar')) {
      await updateSession(job.contact_id, { awaitingOrderDetail: false });
      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'flow_command',
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { action: 'cancel_order_mode', command: normText },
        createdAt: eventTime,
      });
      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'menu_requested',
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { source: 'order_cancel' },
        createdAt: eventTime,
      });
      await sendMenu(job.contact_id, incoming.from, key);
      await completeJob(job.id);
      return;
    }

    if (session.awaiting_order_detail) {
      if (option) {
        await updateSession(job.contact_id, { awaitingOrderDetail: false });
        console.info(`[worker] Modo pedido cancelado por ${job.contact_id}; eligió la opción ${option}.`);
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'menu_option',
          selectedOption: option,
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { interruptedOrderMode: true },
          createdAt: eventTime,
        });
        if (option === 'asesor') {
          await recordBotInteractionEvent({
            contactId: job.contact_id,
            providerMessageId: event.provider_message_id,
            eventType: 'human_advisor_requested',
            selectedOption: option,
            rawText,
            normalizedText: normText,
            messageType: incoming.type,
            metadata: { source: 'menu_option' },
            createdAt: eventTime,
          });
        }
        if (option === 'hacer_pedido') {
          await recordBotInteractionEvent({
            contactId: job.contact_id,
            providerMessageId: event.provider_message_id,
            eventType: 'order_started',
            selectedOption: option,
            rawText,
            normalizedText: normText,
            messageType: incoming.type,
            metadata: { source: 'menu_option' },
            createdAt: eventTime,
          });
        }
        await handleOption(job.contact_id, incoming, option, key);
        await completeJob(job.id);
        return;
      }
      const text = incoming.text?.trim() ?? '';
      if (!text) {
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'flow_command',
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { action: 'empty_order_text' },
          createdAt: eventTime,
        });
        await outgoing(job.contact_id, incoming.from, `${key}:empty-order`, EMPTY_ORDER_MESSAGE);
        await completeJob(job.id);
        return;
      }
      if (['menu', 'cancelar'].includes(text.toLowerCase()) || /\bhola\b/i.test(text)) {
        await updateSession(job.contact_id, { awaitingOrderDetail: false });
        console.info(`[worker] Modo pedido cancelado por ${job.contact_id}; menú solicitado.`);
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'flow_command',
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { action: 'cancel_order_mode' },
          createdAt: eventTime,
        });
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'menu_requested',
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { source: 'order_cancel_keyword' },
          createdAt: eventTime,
        });
        await sendMenu(job.contact_id, incoming.from, key);
        await completeJob(job.id);
        return;
      }
      const orderId = await createOrder(job.contact_id, contact.name || contact.publicName, text);
      await updateSession(job.contact_id, { awaitingOrderDetail: false });

      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'order_submitted',
        rawText: text,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { orderId },
        createdAt: eventTime,
      });

      await outgoing(job.contact_id, incoming.from, `${key}:order-link`, orderLinkMessage(text, contact.name || contact.publicName, orderId));
      await sendFollowUpMenu(job.contact_id, incoming.from, key);
      console.info(`[worker] Pedido ${orderId} creado para ${job.contact_id}; link enviado sin ticket automático.`);
      await completeJob(job.id);
      return;
    }

    if (!option) {
      if (menuCommand) {
        console.info(`[worker] Menú solicitado por ${job.contact_id}.`);
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'menu_requested',
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { source: 'keyword_command' },
          createdAt: eventTime,
        });
        await sendMenu(job.contact_id, incoming.from, key);
      } else {
        console.info(`[worker] Mensaje no entendido de ${job.contact_id}: "${rawText}".`);
        await recordBotInteractionEvent({
          contactId: job.contact_id,
          providerMessageId: event.provider_message_id,
          eventType: 'unrecognized_message',
          rawText,
          normalizedText: normText,
          messageType: incoming.type,
          metadata: { type: incoming.type },
          createdAt: eventTime,
        });
      }
      await completeJob(job.id);
      return;
    }

    await recordBotInteractionEvent({
      contactId: job.contact_id,
      providerMessageId: event.provider_message_id,
      eventType: 'menu_option',
      selectedOption: option,
      rawText,
      normalizedText: normText,
      messageType: incoming.type,
      metadata: { structured: Boolean(incoming.selectedOptionId || incoming.buttonReplyId) },
      createdAt: eventTime,
    });
    if (option === 'asesor') {
      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'human_advisor_requested',
        selectedOption: option,
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { source: 'menu_option' },
        createdAt: eventTime,
      });
    }
    if (option === 'hacer_pedido') {
      await recordBotInteractionEvent({
        contactId: job.contact_id,
        providerMessageId: event.provider_message_id,
        eventType: 'order_started',
        selectedOption: option,
        rawText,
        normalizedText: normText,
        messageType: incoming.type,
        metadata: { source: 'menu_option' },
        createdAt: eventTime,
      });
    }

    await handleOption(job.contact_id, incoming, option, key);
    await completeJob(job.id);
  } catch (error) {
    await retryJob(job.id, job.attempts, error);
    console.error('[worker] Error procesando job', job.id, error);
  }
}
