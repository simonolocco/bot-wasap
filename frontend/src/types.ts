export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';
export type TicketType = 'question' | 'order';
export type TicketStatus = 'open' | 'responded' | 'closed';
export type SecondaryView = 'dashboard' | 'analytics' | 'contacts' | 'orders' | 'tickets' | 'templates';

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
  inquiryTypes?: string[];
  inquiryCounts?: Record<string, number>;
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

export type ConversationStats = {
  totalConversations: number;
  unreadConversations: number;
  unreadMessages: number;
  totalMessages: number;
  openTickets: number;
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

export type AnalyticsPeriodKey = '7d' | '30d' | '90d' | 'custom';

export type BotAnalyticsSummary = {
  totalUniqueContacts: number;
  totalNewContacts: number;
  totalReturningContacts: number;
  totalIncomingMessages: number;
  totalMenuInteractions: number;
  totalMenuOptionsRecognized: number;
  totalUnrecognizedMessages: number;
  totalOrdersStarted: number;
  totalOrdersSubmitted: number;
  totalAdvisorRequests: number;
  contactsWithoutMenuCount: number;
  contactsWithoutBotResponseCount: number;
  menuOptionRate: number;
  unrecognizedRate: number;
};

export type MenuOptionStat = {
  id: string;
  label: string;
  number: string;
  count: number;
  uniqueContacts: number;
  percentage: number;
};

export type TrendPoint = {
  date: string;
  incomingMessages: number;
  menuInteractions: number;
  menuRequested: number;
  optionsRecognized: number;
  unrecognized: number;
  uniqueContacts: number;
};

export type NewContactsByDayPoint = {
  date: string;
  /** Number of contacts whose very first message ever falls on this day */
  newContacts: number;
};

export type ReturningContactsByDayPoint = {
  date: string;
  returningContacts: number;
};

export type UnrecognizedPattern = {
  text: string;
  normalizedText: string;
  count: number;
  uniqueContacts: number;
  lastSeenAt: string;
};

export type UnrecognizedMessageItem = {
  id: string;
  contactId: string;
  contactName: string;
  phone: string;
  rawText: string;
  normalizedText: string;
  messageType: string;
  createdAt: string;
};

export type ContactWithoutMenuItem = {
  id: string;
  name: string;
  publicName: string;
  phone: string;
  pipelineStatus: string;
  lastMessageAt: string | null;
  lastIncomingAt: string;
  messageCount: number;
  botResponseCount: number;
  lastBotResponseAt: string | null;
  responseStatus: 'responded' | 'unanswered';
};

export type BotAnalyticsData = {
  period: {
    key: AnalyticsPeriodKey;
    from: string;
    to: string;
    label: string;
  };
  summary: BotAnalyticsSummary;
  menuOptions: MenuOptionStat[];
  trend: TrendPoint[];
  /** New contacts by day: first-ever message for each contact that occurred within the period */
  newContactsByDay: NewContactsByDayPoint[];
  /** Returning contacts by day: contacts who wrote that day and had written before that day. */
  returningContactsByDay: ReturningContactsByDayPoint[];
  unrecognizedMessages: {
    total: number;
    uniqueContacts: number;
    topPatterns: UnrecognizedPattern[];
    items: UnrecognizedMessageItem[];
  };
  contactsWithoutMenu: {
    total: number;
    withoutBotResponse: number;
    items: ContactWithoutMenuItem[];
  };
  coverage: {
    hasTrackingData: boolean;
    earliestEventAt: string | null;
    totalEventsTracked: number;
    note: string;
  };
};
