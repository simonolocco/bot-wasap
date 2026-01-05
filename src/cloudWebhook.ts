import 'dotenv/config';
import express from 'express';
import {
  BUSINESS_ADDRESS,
  BUSINESS_SCHEDULE,
  MENU_BUTTON_LABEL,
  MENU_PROMPT,
  MENU_HEADER_TEXT,
  MenuOptionId,
  buildGreetingIntro,
  buildMenuListSections,
  formatPriceListMessage,
} from './botMenu';
import { cancelOrder, createOrder, submitOrder } from './pedidos';
import { sendCloudMessage, sendCloudTextMessage, sendCloudAudio } from './cloudClient';

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const PORT = Number(process.env.CLOUD_PORT ?? '4002');
const FORWARD_ORDER_NUMBER_RAW = process.env.FORWARD_ORDER_NUMBER ?? '+54 9 351 756-5641';
const FORWARD_ORDER_NUMBER = FORWARD_ORDER_NUMBER_RAW.replace(/[^0-9]/g, '');
const FORWARD_ORDER_DISPLAY = process.env.FORWARD_ORDER_DISPLAY ?? `+${FORWARD_ORDER_NUMBER}`;

const app = express();
app.use(express.json());
app.use('/static', express.static('public'));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!VERIFY_TOKEN) {
    console.error('[webhook] Falta META_VERIFY_TOKEN en .env');
    return res.sendStatus(500);
  }

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[webhook] Verificación exitosa');
    return res.status(200).send(challenge);
  }

  console.warn('[webhook] Verificación rechazada');
  return res.sendStatus(403);
});

type CloudMessage = {
  profileName?: string;
  text?: string;
  from: string;
  selectedOptionId?: MenuOptionId;
  buttonReplyId?: ConfirmationButtonId;
};

const greetedChats = new Set<string>();
const awaitingOrderDetail = new Set<string>();
const awaitingConfirmation = new Map<string, { orderId: number; detail: string }>();
const chatNames = new Map<string, string>();
const CONFIRM_BUTTON_ID = 'confirm_yes';
const CANCEL_BUTTON_ID = 'confirm_no';
type ConfirmationButtonId = typeof CONFIRM_BUTTON_ID | typeof CANCEL_BUTTON_ID;

async function sendWhatsAppText(to: string, body: string) {
  console.log(`[webhook] Respondemos a ${to}: ${body}`);
  await sendCloudTextMessage(to, body);
}

async function sendWhatsAppInteractiveMenu(to: string) {
  console.log(`[webhook] Enviamos menu interactivo a ${to}`);
  await sendCloudMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: {
        type: 'text',
        text: MENU_HEADER_TEXT,
      },
      body: { text: MENU_PROMPT },
      action: {
        button: MENU_BUTTON_LABEL,
        sections: buildMenuListSections(),
      },
    },
  });
}

async function sendMenu(chatId: string, preface?: string) {
  if (preface) {
    await sendWhatsAppText(chatId, preface);
  }
  await sendWhatsAppInteractiveMenu(chatId);
}

async function sendConfirmationButtons(chatId: string, body: string) {
  console.log(`[webhook] Enviamos botones de confirmacion a ${chatId}`);
  await sendCloudMessage({
    messaging_product: 'whatsapp',
    to: chatId,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: [
          { type: 'reply', reply: { id: CONFIRM_BUTTON_ID, title: 'Si' } },
          { type: 'reply', reply: { id: CANCEL_BUTTON_ID, title: 'No' } },
        ],
      },
    },
  });
}

function buildForwardLink(detail: string, customerName?: string): string {
  const message = `Hola! Soy ${customerName ?? 'cliente'} y este es mi pedido:\n${detail}`;
  return `https://wa.me/${FORWARD_ORDER_NUMBER}?text=${encodeURIComponent(message)}`;
}

function buildAdvisorLink(): string {
  return `https://wa.me/${FORWARD_ORDER_NUMBER}?text=${encodeURIComponent('Hola, tengo una consulta')}`;
}

async function sendGreetingAndMenu(chatId: string, displayName?: string): Promise<boolean> {
  if (greetedChats.has(chatId)) return false;
  const safeName = displayName?.trim() || 'alli';
  chatNames.set(chatId, safeName);
  await sendWhatsAppText(chatId, buildGreetingIntro(safeName));
  await sendWhatsAppInteractiveMenu(chatId);
  greetedChats.add(chatId);
  return true;
}

async function handleMenuSelection(chatId: string, optionId: MenuOptionId, hostBaseUrl: string) {
  let keepMenu = true;
  switch (optionId) {
    case 'horarios':
      await sendWhatsAppText(chatId, `Nuestro horario de atencion es:\n${BUSINESS_SCHEDULE}`);
      break;
    case 'direccion':
      await sendWhatsAppText(chatId, `Nos encontras en:\n${BUSINESS_ADDRESS}`);
      break;
    case 'lista_precio':
      await sendWhatsAppText(chatId, formatPriceListMessage());
      // Enviar audio
      const audioUrl = `${hostBaseUrl}/static/mensaje_bot.ogg`;
      await sendCloudAudio(chatId, audioUrl).catch(e => console.error('Error enviando audio:', e));
      break;
    case 'hacer_pedido':
      awaitingOrderDetail.add(chatId);
      await sendWhatsAppText(
        chatId,
        [
          '🧾 *Armemos tu pedido*',
          '━━━━━━━━━━━━',
          'Para empezar, escribí en un mensaje *la lista de productos* que necesitás.',
          '',
          '💡 *Ejemplos:*',
          '• "3 cajas j.cocido, 2 hormas pategras"',
          '• "5 uxb leche, 2 packs azúcar"',
          '',
          '🚀 *Tip:* Cuanto más claro escribas, ¡más rápido preparamos todo!',
          'Enviá tu lista ahora 👇',
        ].join('\n')
      );
      await sendWhatsAppText(chatId, 'Cuando termines podes volver al menu tocando "Ver opciones".');
      keepMenu = false;
      break;
    case 'asesor':
      await sendWhatsAppText(
        chatId,
        ['✅ *Listo!*', 'Si querés hablar con nuestro asesor tocá este enlace y te derivamos directamente:', buildAdvisorLink()].join('\n')
      );
      break;
    default:
      await sendWhatsAppText(chatId, 'No reconoci esa opcion. Probemos nuevamente.');
      break;
  }

  if (keepMenu) {
    awaitingOrderDetail.delete(chatId);
    await sendMenu(chatId);
  }
}

async function handleIncomingCloudMessage(message: CloudMessage, hostBaseUrl: string) {
  const chatId = message.from;
  const text = message.text ?? '';
  const optionId = message.selectedOptionId;
  const buttonId = message.buttonReplyId;

  const greetingSent = await sendGreetingAndMenu(chatId, message.profileName);
  if (greetingSent) return;

  const inOrderFlow = awaitingOrderDetail.has(chatId) || awaitingConfirmation.has(chatId);
  if (!inOrderFlow && !optionId) {
    console.log('[webhook] Ignoramos mensaje sin seleccion interactiva.');
    return;
  }

  if (awaitingOrderDetail.has(chatId)) {
    if (!text.trim()) {
      await sendWhatsAppText(chatId, 'Necesito que me envies el detalle del pedido en texto.');
      return;
    }
    const customerName = chatNames.get(chatId);
    const order = await createOrder(chatId, customerName, text);
    awaitingOrderDetail.delete(chatId);
    awaitingConfirmation.set(chatId, { orderId: order.id, detail: text });
    await sendWhatsAppText(chatId, ['Pedido:', text].join('\n'));
    await sendConfirmationButtons(
      chatId,
      [
        '🤔 *Confirmación*',
        '━━━━━━━━━━━━',
        `¿Querés enviar este pedido para que lo procese el equipo comercial (${FORWARD_ORDER_DISPLAY})?`,
        '',
        'Si tocas *SÍ*, lo dejamos listo para enviar.',
        'Si tocas *NO*, podés volver a corregirlo.',
      ].join('\n')
    );
    return;
  }

  if (awaitingConfirmation.has(chatId)) {
    if (!buttonId) {
      console.log('[webhook] Ignoramos respuesta sin botones en confirmacion.');
      return;
    }
    const confirmation = awaitingConfirmation.get(chatId)!;
    const positive = buttonId === CONFIRM_BUTTON_ID;
    const negative = buttonId === CANCEL_BUTTON_ID;

    if (positive) {
      await submitOrder(confirmation.orderId);
      awaitingConfirmation.delete(chatId);
      awaitingOrderDetail.delete(chatId);
      const customerName = chatNames.get(chatId);
      const forwardLink = buildForwardLink(confirmation.detail, customerName);
      await sendWhatsAppText(
        chatId,
        [
          `Perfecto, tu pedido #${confirmation.orderId} esta listo.`,
          `Para enviarlo al equipo comercial (${FORWARD_ORDER_DISPLAY}) solo toca este link y manda el mensaje:`,
          forwardLink,
        ].join('\n')
      );
      await sendMenu(chatId);
      return;
    }

    if (negative) {
      await cancelOrder(confirmation.orderId);
      awaitingConfirmation.delete(chatId);
      awaitingOrderDetail.delete(chatId);
      await sendWhatsAppText(chatId, 'Listo, lo cancelamos. Volve al menu para enviar otro pedido cuando quieras.');
      await sendMenu(chatId);
      return;
    }

    await sendWhatsAppText(chatId, 'No entendi. Responde SI para confirmar o NO para corregir el pedido.');
    return;
  }

  if (optionId) {
    await handleMenuSelection(chatId, optionId, hostBaseUrl);
  }
}

app.post('/webhook', async (req, res) => {
  const body = req.body;
  console.log('[webhook] Evento recibido:', JSON.stringify(body, null, 2));

  try {
    if (body.object === 'whatsapp_business_account') {
      res.sendStatus(200);
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];
      const contact = value?.contacts?.[0];
      if (message) {
        const incoming: CloudMessage = {
          from: message.from,
          profileName: contact?.profile?.name,
        };
        if (message.type === 'text') {
          incoming.text = message.text?.body ?? '';
        } else if (message.type === 'interactive') {
          const listReply = message.interactive?.list_reply;
          if (listReply) {
            incoming.text = listReply.title ?? '';
            incoming.selectedOptionId = listReply.id as MenuOptionId | undefined;
          }
          const buttonReply = message.interactive?.button_reply;
          if (buttonReply) {
            incoming.text = buttonReply.title ?? '';
            incoming.buttonReplyId = buttonReply.id as ConfirmationButtonId;
          }
        }
        if (incoming.text !== undefined || incoming.selectedOptionId) {
          const host = req.get('host') || `localhost:${PORT}`;
          const protocol = host.includes('localhost') ? 'http' : 'https';
          const hostBaseUrl = `${protocol}://${host}`;
          await handleIncomingCloudMessage(incoming, hostBaseUrl);
        } else {
          console.warn('[webhook] Mensaje no soportado recibido via Cloud API.');
        }
      }
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error('[webhook] Error procesando evento:', error);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

app.listen(PORT, () => {
  console.log(`[webhook] Escuchando en http://localhost:${PORT}/webhook`);
});
