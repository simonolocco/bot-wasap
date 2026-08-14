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
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  quoteMessageId?: string | null;
  quotedProviderMessageId?: string | null;
  quotedMessage?: {
    id: string | null;
    providerMessageId: string | null;
    direction: 'incoming' | 'outgoing' | null;
    body: string | null;
    messageType: string | null;
    mediaMimeType: string | null;
    mediaFilename: string | null;
    mediaCaption: string | null;
    mediaStatus: 'pending' | 'ready' | 'failed' | null;
    mediaWidth: number | null;
    mediaHeight: number | null;
  } | null;
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

export type DashboardData = {
  stats: { total: number | string; optedIn: number | string; unknown: number | string; optedOut: number | string };
  transport: 'mock' | 'cloud';
  cloudReady: boolean;
  work: Record<string, number>;
  failures: { failedMessages: number | string };
  worker: { healthy: boolean };
  queue: { pending: number; processing: number; retrying: number; failed: number; oldestPendingSeconds: number };
  provider: { lastIncomingAt: string | null; lastOutgoingAt: string | null; lastActivityAt: string | null };
  backup: { kind: string; status: 'running' | 'succeeded' | 'failed'; startedAt: string; completedAt: string | null; objectKey: string | null; error: string | null } | null;
  restore: { status: 'running' | 'succeeded' | 'failed'; startedAt: string; completedAt: string | null; error: string | null } | null;
  archive: { enabled: boolean; archivedCount: number; failedCount: number; lastArchivedAt: string | null; lastFailedAt: string | null };
  media: { ready: number; pending: number; failed: number; bytes: number; driver: string };
  mediaStorage: { healthy: boolean; driver: string; latencyMs: number; error: string | null };
  database: { bytes: number };
  thresholds: { workerStaleSeconds: number; queueOldestWarningSeconds: number; backupWarningSeconds: number; archiveRpoSeconds: number };
};
