export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';
export type TicketType = 'question' | 'order';
export type TicketStatus = 'open' | 'responded' | 'closed';

export type Contact = {
  id: string;
  phone: string;
  name: string;
  publicName: string;
  consentStatus: ConsentStatus;
  consentSource: string | null;
  consentAt: string | null;
  notes: string;
  labels: string[];
  pipelineStatus: string;
  assignedTo: string | null;
  followUpAt: string | null;
  unreadCount: number;
  lastIncomingAt: string | null;
  lastMessageAt: string | null;
  botPaused: boolean;
};

export type ConversationRow = Contact & {
  lastMessage?: string;
  lastDirection?: 'incoming' | 'outgoing' | '';
  lastMessageCreatedAt?: string;
  lastDeliveryStatus?: string | null;
  openTicketId?: string | null;
  ticketStatus?: string | null;
};

export type MediaAsset = {
  id: string;
  mimeType: string;
  filename: string;
  size: number | null;
  status: 'pending' | 'ready' | 'failed';
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
};

export type Message = {
  id: string;
  direction: 'incoming' | 'outgoing';
  body: string;
  messageType: string;
  createdAt: string;
  providerMessageId: string | null;
  deliveryStatus: 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | null;
  mediaId?: string | null;
  mediaAssetId?: string | null;
  mediaStatus?: 'pending' | 'ready' | 'failed' | null;
  mediaMimeType?: string | null;
  mediaFilename?: string | null;
  mediaSize?: number | null;
  mediaCaption?: string | null;
  quoteMessageId?: string | null;
  error?: string | null;
};

export type SupportTicket = {
  id: string;
  contactId: string;
  status: 'open' | 'closed';
  displayStatus?: TicketStatus;
  subject: string;
  question: string;
  ticketType: TicketType;
  orderId: number | string | null;
  answeredAt: string | null;
  createdAt: string;
  updatedAt?: string;
  closedAt: string | null;
  closureReason: string | null;
  closedBy?: string | null;
  fallbackError?: string | null;
  lastIncomingAt?: string | null;
  contactName?: string;
  publicName?: string;
  phone?: string;
  lastMessage?: string;
  lastDirection?: string;
};

export type ConversationDetail = {
  contact: Contact;
  lastOrder: { id: number; customerName: string; detail: string; status: string; createdAt: string } | null;
  messageCount: number;
  openTicket: SupportTicket | null;
  tickets: SupportTicket[];
};
