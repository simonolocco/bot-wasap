export type ParsedIncoming = {
  providerMessageId: string;
  from: string;
  profileName?: string;
  text?: string;
  selectedOptionId?: string;
  buttonReplyId?: string;
  type: string;
  sourceTimestamp?: number;
  quotedProviderMessageId?: string;
  media?: { id?: string; mimeType?: string; filename?: string; caption?: string };
};

function text(value: unknown, max = 4096): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sharedContactsText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  const contacts = value.slice(0, 10).map((contact: any) => {
    const name = text(contact?.name?.formatted_name || contact?.name?.first_name, 200) || 'Contacto compartido';
    const phones = Array.isArray(contact?.phones)
      ? contact.phones.map((phone: any) => text(phone?.phone || phone?.wa_id, 40)).filter(Boolean).join(', ')
      : '';
    return `👤 ${name}${phones ? ` · ${phones}` : ''}`;
  });
  return contacts.join('\n').slice(0, 4096);
}

export function parseIncoming(message: any, profileName?: string): ParsedIncoming | null {
  if (!message?.id || !message?.from) return null;
  const providerMessageId = String(message.id).slice(0, 512);
  const from = String(message.from).replace(/\D/g, '');
  if (!providerMessageId || from.length < 6 || from.length > 20) return null;

  const incoming: ParsedIncoming = {
    providerMessageId,
    from,
    profileName: profileName?.slice(0, 200),
    type: String(message.type ?? 'unknown').slice(0, 40),
  };
  if (message.context?.id) incoming.quotedProviderMessageId = String(message.context.id).slice(0, 512);
  const timestamp = Number(message.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) incoming.sourceTimestamp = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;

  if (incoming.type === 'text') incoming.text = text(message.text?.body);
  if (incoming.type === 'interactive') {
    if (message.interactive?.list_reply) {
      incoming.text = text(message.interactive.list_reply.title);
      incoming.selectedOptionId = text(message.interactive.list_reply.id, 200);
    }
    if (message.interactive?.button_reply) {
      incoming.text = text(message.interactive.button_reply.title);
      incoming.buttonReplyId = text(message.interactive.button_reply.id, 200);
    }
  }
  if (incoming.type === 'button') {
    incoming.text = text(message.button?.text || message.button?.payload);
    incoming.buttonReplyId = text(message.button?.payload, 200) || undefined;
  }
  if (incoming.type === 'reaction') {
    const emoji = text(message.reaction?.emoji, 32);
    incoming.text = emoji ? `Reacción: ${emoji}` : 'Reacción eliminada';
    if (message.reaction?.message_id) incoming.quotedProviderMessageId = String(message.reaction.message_id).slice(0, 512);
  }
  if (incoming.type === 'location') {
    const latitude = Number(message.location?.latitude);
    const longitude = Number(message.location?.longitude);
    const title = text(message.location?.name || message.location?.address, 500) || 'Ubicación compartida';
    incoming.text = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `📍 ${title}\nhttps://maps.google.com/?q=${latitude},${longitude}`
      : `📍 ${title}`;
  }
  if (incoming.type === 'contacts') incoming.text = sharedContactsText(message.contacts) || '👤 Contacto compartido';
  if (incoming.type === 'order') {
    const count = Array.isArray(message.order?.product_items) ? message.order.product_items.length : 0;
    incoming.text = `🛒 Pedido recibido${count ? ` (${count} ${count === 1 ? 'producto' : 'productos'})` : ''}`;
  }
  if (incoming.type === 'system') incoming.text = text(message.system?.body) || 'Mensaje del sistema de WhatsApp';
  if (['image', 'document', 'audio', 'video', 'sticker'].includes(incoming.type)) {
    const media = message[incoming.type] ?? {};
    incoming.text = text(media.caption);
    incoming.media = {
      id: media.id ? String(media.id) : undefined,
      mimeType: media.mime_type ? String(media.mime_type) : incoming.type === 'sticker' ? 'image/webp' : undefined,
      filename: media.filename ? String(media.filename) : incoming.type === 'sticker' ? 'sticker.webp' : undefined,
      caption: media.caption ? text(media.caption, 1024) : undefined,
    };
  }
  return incoming;
}
