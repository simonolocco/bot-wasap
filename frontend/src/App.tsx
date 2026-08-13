import { FormEvent, KeyboardEvent, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { api, formatDate, initials, mediaUrl, shortText, thumbnailUrl } from './api';
import type {
  Contact,
  ConversationDetail,
  ConversationRow,
  DashboardData,
  Message,
  SupportTicket,
} from './types';
import './styles.css';

type View = 'inbox' | 'dashboard' | 'contacts' | 'orders' | 'tickets' | 'templates';
type Theme = 'system' | 'light' | 'dark';

const stages: Record<string, string> = {
  new: 'Nueva',
  in_attention: 'En atención',
  follow_up: 'Seguimiento',
  order_received: 'Pedido recibido',
  won: 'Ganada',
  lost: 'Perdida',
};

const consentNames: Record<string, string> = {
  unknown: 'Sin confirmar',
  opted_in: 'Consentido',
  opted_out: 'Excluido',
};

const closureNames: Record<string, string> = {
  order_completed: 'Pedido finalizado',
  question_answered: 'Consulta respondida',
  customer_no_reply: 'Sin respuesta',
  operator_cancelled: 'Cancelado',
  fallback_sent: 'Link enviado',
  answered: 'Respondido',
};

/* ═══════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════ */

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <span className="brand-kicker">ABASTOBOT</span>
        <h1>Tu bandeja comercial</h1>
        <p>Respondé consultas y pedidos desde un solo lugar.</p>
        <label>
          Usuario
          <input
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="button primary full" disabled={loading}>
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}

/* ═══════════════════════════════════════════════════════
   AVATAR
   ═══════════════════════════════════════════════════════ */

function Avatar({
  row,
  large = false,
}: {
  row: { name?: string; publicName?: string; phone?: string };
  large?: boolean;
}) {
  return <span className={`avatar ${large ? 'large' : ''}`}>{initials(row)}</span>;
}

/* ═══════════════════════════════════════════════════════
   ICONS + CLASSIC NAVIGATION
   ═══════════════════════════════════════════════════════ */

type IconName =
  | 'dashboard'
  | 'chat'
  | 'ticket'
  | 'contact'
  | 'order'
  | 'template'
  | 'bell'
  | 'bellOff'
  | 'refresh'
  | 'logout'
  | 'info'
  | 'take'
  | 'release'
  | 'close'
  | 'back'
  | 'attach'
  | 'smile'
  | 'send'
  | 'reply'
  | 'copy'
  | 'download'
  | 'search'
  | 'check';

function SvgIcon({ name, size = 17 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    chat: <><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.4 8.4 0 0 1-3.2-.6L4 20l1.6-3.9A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    ticket: <><path d="M4 7a2 2 0 0 0 0 4 2 2 0 0 0 0 4v2h16v-2a2 2 0 0 0 0-4 2 2 0 0 0 0-4V5H4v2Z" /><path d="M12 7v8" /></>,
    contact: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    order: <><path d="M6 3h12v18H6z" /><path d="M9 7h6M9 11h6M9 15h4" /></>,
    template: <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h4M8 12h8M8 16h6" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
    bellOff: <><path d="m4 4 16 16M10 21h4M18 9a6 6 0 0 0-8-5" /><path d="M6 9c0 7-3 7-3 9h13" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-4L3 10" /><path d="M3 4v6h6M4 13a8 8 0 0 0 14.7 4L21 14" /><path d="M21 20v-6h-6" /></>,
    logout: <><path d="M10 5H5v14h5M15 8l4 4-4 4M19 12H9" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    take: <><path d="M8 11V5a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 4-3 7-7 7h-1c-2 0-4-1-5-3l-3-5a2 2 0 0 1 4-2l2 2" /></>,
    release: <><path d="M4 12h13M13 8l4 4-4 4" /><path d="M4 5v14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    back: <><path d="m15 18-6-6 6-6M9 12h11" /></>,
    attach: <><path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7" /></>,
    smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    reply: <><path d="M9 17 4 12l5-5" /><path d="M4 12h9a7 7 0 0 1 7 7" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
  };
  return <svg className="svg-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const viewTitles: Record<View, [string, string]> = {
  dashboard: ['Resumen', 'Trabajo pendiente y actividad comercial.'],
  inbox: ['Conversaciones', 'Bandeja comercial con historial completo.'],
  tickets: ['Tickets', 'Preguntas y pedidos que requieren atención.'],
  contacts: ['Contactos', 'Toda tu base, paginada y editable.'],
  orders: ['Pedidos', 'Seguimiento de pedidos recibidos.'],
  templates: ['Plantillas', 'Preparadas para comunicaciones autorizadas.'],
};

function Sidebar({
  view,
  onNavigate,
  unread,
  sidebarOpen,
}: {
  view: View;
  onNavigate: (view: View) => void;
  unread: number;
  sidebarOpen: boolean;
}) {
  const items: Array<[View, IconName, string]> = [
    ['dashboard', 'dashboard', 'Resumen'],
    ['inbox', 'chat', 'Conversaciones'],
    ['tickets', 'ticket', 'Tickets'],
    ['contacts', 'contact', 'Contactos'],
    ['orders', 'order', 'Pedidos'],
    ['templates', 'template', 'Plantillas'],
  ];
  return (
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand-block">
        <span>ABASTOBOT</span>
        <strong>Bandeja comercial</strong>
      </div>
      <nav className="sidebar-nav" aria-label="Navegación principal">
        {items.map(([id, icon, label]) => (
          <button key={id} aria-label={label} title={label} className={`sidebar-link ${view === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
            <SvgIcon name={icon} />
            <span>{label}</span>
            {id === 'inbox' && unread > 0 && <b>{unread}</b>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <span className="connection-badge"><i /> WhatsApp conectado</span>
        <button className="sidebar-logout" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }}>
          <SvgIcon name="logout" />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  view,
  theme,
  setTheme,
  notifications,
  setNotifications,
  onRefresh,
  onMenu,
}: {
  view: View;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  notifications: boolean;
  setNotifications: (value: boolean) => void;
  onRefresh: () => void;
  onMenu: () => void;
}) {
  const [title, subtitle] = viewTitles[view];
  return (
    <header className="topbar">
      <button className="menu-button" onClick={onMenu}>
        <SvgIcon name="chat" />
        <span>Menú</span>
      </button>
      <div className="topbar-copy">
        <p className="eyebrow">AbastoBot / {title}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="topbar-actions">
        <span className="live-state"><i /> En vivo</span>
        <button className="text-action" aria-pressed={notifications} onClick={() => { if (!notifications && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission(); setNotifications(!notifications); }}>
          <SvgIcon name={notifications ? 'bell' : 'bellOff'} />
          <span>{notifications ? 'Notificaciones activadas' : 'Notificaciones silenciadas'}</span>
        </button>
        <select value={theme} onChange={e => setTheme(e.target.value as Theme)} aria-label="Tema visual">
          <option value="system">Sistema</option>
          <option value="light">Claro</option>
          <option value="dark">Oscuro</option>
        </select>
        <button className="text-action" onClick={onRefresh}>
          <SvgIcon name="refresh" />
          <span>Actualizar</span>
        </button>
      </div>
    </header>
  );
}

function ActionButton({
  icon,
  variant = 'secondary',
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`action-button ${variant} ${className}`.trim()} {...props}>
      {icon && <SvgIcon name={icon} size={15} />}
      <span>{children}</span>
    </button>
  );
}

function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'question' | 'order';
  children: React.ReactNode;
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function LoadingState({ label = 'Cargando información' }: { label?: string }) {
  return <div className="loading-state"><span className="spinner" /> <span>{label}</span></div>;
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

function ErrorState({
  title = 'No se pudo cargar la información',
  onRetry,
}: {
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state">
      <strong>{title}</strong>
      <p>Revisá la conexión e intentá nuevamente.</p>
      {onRetry && <ActionButton variant="secondary" icon="refresh" onClick={onRetry}>Reintentar carga</ActionButton>}
    </div>
  );
}

function WindowStatus({
  withinWindow,
  newMessages,
  messagesRef,
  onTemplates,
  onRespond,
}: {
  withinWindow: boolean;
  newMessages: number;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  onTemplates: () => void;
  onRespond: () => void;
}) {
  return (
    <div className={`window-status ${withinWindow ? 'open' : 'closed'}`}>
      <div className="window-status-copy">
        <strong>{withinWindow ? 'Ventana de atención abierta' : 'Ventana de atención vencida'}</strong>
        <span>{withinWindow ? 'Podés responder con texto o archivos.' : 'WhatsApp requiere una plantilla aprobada.'}</span>
      </div>
      {withinWindow ? (
        <ActionButton variant="ghost" onClick={onRespond}>Responder</ActionButton>
      ) : (
        <ActionButton variant="ghost" onClick={onTemplates}>Ver plantillas</ActionButton>
      )}
      {newMessages > 0 && (
        <ActionButton
          variant="primary"
          onClick={() => {
            if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
          }}
        >
          Ver {newMessages} mensajes nuevos
        </ActionButton>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CONVERSATION LIST (inside left panel)
   ═══════════════════════════════════════════════════════ */

function ConversationControlBar({
  contact,
  ticket,
  onTake,
  onRelease,
  onClose,
  onToggleInfo,
  busy,
}: {
  contact: Contact;
  ticket: SupportTicket | null;
  onTake: () => void;
  onRelease: () => void;
  onClose: (ticket: SupportTicket) => void;
  onToggleInfo: () => void;
  busy: boolean;
}) {
  const paused = Boolean(contact.botPaused);

  return (
    <div className={`conversation-control-bar ${paused ? 'paused' : 'active'}`}>
      <div className="conversation-control-copy">
        <strong>{paused ? (ticket ? 'Atención humana activa' : 'Bot pausado') : 'Bot activo'}</strong>
        <span>
          {paused
            ? ticket
              ? 'El bot no responderá mientras atendés este ticket.'
              : 'Las respuestas automáticas están pausadas.'
            : 'Tomá la conversación para pausar el bot y responder manualmente.'}
        </span>
      </div>
      <div className="conversation-control-actions">
        {!paused && (
          <ActionButton variant="primary" icon="take" onClick={onTake} disabled={busy}>
            Tomar conversación y pausar bot
          </ActionButton>
        )}
        {paused && !ticket && (
          <ActionButton variant="secondary" icon="release" onClick={onRelease} disabled={busy}>
            Liberar bot
          </ActionButton>
        )}
        {paused && ticket && (
          <ActionButton variant="secondary" icon="check" onClick={() => onClose(ticket)} disabled={busy}>
            Finalizar ticket
          </ActionButton>
        )}
        <ActionButton variant="secondary" icon="info" onClick={onToggleInfo}>
          Ver ficha comercial
        </ActionButton>
      </div>
    </div>
  );
}

function ConversationList({
  items,
  selectedId,
  loading,
  error,
  hasMore,
  search,
  filter,
  onSearch,
  onFilter,
  onMore,
  onSelect,
  onRetry,
}: {
  items: ConversationRow[];
  selectedId: string | null;
  loading: boolean;
  hasMore: boolean;
  search: string;
  filter: string;
  onSearch: (v: string) => void;
  onFilter: (v: string) => void;
  onMore: () => void;
  onSelect: (id: string) => void;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <>
      <div className="search-bar">
        <div className="search-wrap">
          <span><SvgIcon name="search" size={16} /></span>
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Buscar nombre, teléfono o mensaje"
          />
        </div>
        <select
          className="filter-select"
          value={filter}
          onChange={e => onFilter(e.target.value)}
        >
          <option value="">Todas</option>
          <option value="unread">Sin leer</option>
          <option value="new">Nuevas</option>
          <option value="in_attention">En atención</option>
          <option value="follow_up">Seguimiento</option>
          <option value="order_received">Pedidos</option>
          <option value="paused">Bot pausado</option>
          <option value="overdue">Vencidas</option>
        </select>
      </div>

      <div className="panel-content">
        <div className="list-count">
          {items.length}
          {hasMore ? '+' : ''} conversaciones
          {loading && <span className="spinner" />}
        </div>

        <div className="conv-list">
          {items.map(item => (
            <button
              key={item.id}
              className={`conv-row ${selectedId === item.id ? 'selected' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <Avatar row={item} />
              <span className="conv-body">
                <strong>{item.name || item.publicName || 'Sin nombre'}</strong>
                <small>{item.lastDirection === 'incoming' ? 'Cliente: ' : item.lastDirection === 'outgoing' ? 'Vos: ' : ''}{shortText(item.lastMessage, 55)}</small>
                <span className="conversation-tags">
                  <StatusBadge tone={item.pipelineStatus === 'lost' ? 'danger' : item.pipelineStatus === 'won' ? 'success' : item.pipelineStatus === 'follow_up' ? 'warning' : 'neutral'}>{stages[item.pipelineStatus] || 'Nueva'}</StatusBadge>
                  {item.ticketStatus === 'open' && <span className="mini-status open" title="Ticket abierto">Ticket abierto</span>}
                  {item.botPaused && <span className="mini-status paused" title="Bot pausado">Bot pausado</span>}
                  {item.labels?.slice(0, 2).map(label => <span className="mini-status" title={label} key={label}>{label}</span>)}
                </span>
              </span>
              <span className="conv-meta">
                <time>{formatDate(item.lastMessageAt)}</time>
                {item.unreadCount > 0 && <b>{item.unreadCount}</b>}
              </span>
            </button>
          ))}
        </div>

        {error && <ErrorState title={error} onRetry={onRetry} />}

        {!error && !loading && items.length === 0 && (
          <EmptyState title="No hay conversaciones" description="Probá cambiar los filtros o iniciar una búsqueda." />
        )}

        {hasMore && (
          <button className="load-more" disabled={loading} onClick={onMore}>
            {loading ? 'Cargando conversaciones' : 'Cargar más conversaciones'}
          </button>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   MESSAGE HELPERS
   ═══════════════════════════════════════════════════════ */

function formatBytes(size?: number | null) {
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatBody(body: string) {
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function deliveryStatus(msg: Message) {
  if (msg.direction === 'incoming') return '';
  if (msg.deliveryStatus === 'sending') return ' · Enviando';
  if (msg.deliveryStatus === 'failed') return ' · Fallido';
  if (msg.deliveryStatus === 'read') return ' · Leído';
  if (msg.deliveryStatus === 'delivered') return ' · Entregado';
  if (msg.deliveryStatus === 'sent') return ' · Enviado';
  return ' · Pendiente';
}

/* ═══════════════════════════════════════════════════════
   MESSAGE BUBBLE
   ═══════════════════════════════════════════════════════ */

function MessageBubble({
  message,
  messages,
  onReply,
  onLightbox,
  onRetry,
}: {
  message: Message;
  messages: Message[];
  onReply: (m: Message) => void;
  onLightbox: (url: string, name: string) => void;
  onRetry: (id: string) => void;
}) {
  const media = Boolean(
    message.mediaAssetId ||
      message.mediaId ||
      ['image', 'document', 'audio'].includes(message.messageType),
  );
  const url = mediaUrl(message.id);
  const image = message.messageType === 'image';
  const pdf =
    message.mediaMimeType === 'application/pdf' ||
    message.mediaFilename?.toLowerCase().endsWith('.pdf');
  const loadedQuote = message.quoteMessageId ? messages.find(m => m.id === message.quoteMessageId) : null;
  const quoted = message.quotedMessage ?? loadedQuote ?? (message.quotedProviderMessageId ? {
    id: null,
    providerMessageId: message.quotedProviderMessageId,
    direction: null,
    body: null,
    messageType: null,
    mediaMimeType: null,
    mediaFilename: null,
    mediaCaption: null,
    mediaStatus: null,
    mediaWidth: null,
    mediaHeight: null,
  } : null);

  return (
    <article
      className={`message-bubble ${message.direction} ${message.deliveryStatus === 'failed' ? 'failed' : ''}`}
      onDoubleClick={() => onReply(message)}
    >
      <div className="message-actions">
        <button onClick={() => onReply(message)} title="Responder"><SvgIcon name="reply" size={14} /><span>Responder</span></button>
        <button onClick={() => navigator.clipboard?.writeText(message.body)} title="Copiar mensaje"><SvgIcon name="copy" size={14} /><span>Copiar</span></button>
        {media && <a href={mediaUrl(message.id, true)} title="Descargar archivo"><SvgIcon name="download" size={14} /><span>Descargar</span></a>}
      </div>

      {quoted && (
        <div className="quoted-message">
          {quoted.id && quoted.messageType === 'image' && quoted.mediaStatus !== 'failed' && (
            <img src={thumbnailUrl(quoted.id, 240)} alt="Imagen citada" loading="lazy" decoding="async" />
          )}
          <span>
            <b>{quoted.direction === 'incoming' ? 'Cliente' : quoted.direction === 'outgoing' ? 'Vos' : 'Mensaje citado'}</b>
            <small>{quoted.messageType === 'image' ? '📷 Foto' : quoted.messageType === 'audio' ? '🎧 Audio' : quoted.messageType === 'document' ? `📄 ${quoted.mediaFilename || 'Documento'}` : shortText(quoted.body || 'Mensaje original no disponible', 100)}</small>
          </span>
        </div>
      )}

      {media && image && message.mediaStatus !== 'failed' && message.mediaStatus !== 'pending' && (
        <button
          className="image-button"
          onClick={() => onLightbox(thumbnailUrl(message.id, 960), message.mediaFilename || 'Imagen')}
        >
          <span className="image-placeholder" aria-hidden="true" />
          <img
            src={thumbnailUrl(message.id, 480)}
            loading="lazy"
            decoding="async"
            width={message.mediaWidth || undefined}
            height={message.mediaHeight || undefined}
            alt={message.mediaCaption || 'Imagen recibida'}
          />
          <span className="image-label">Ver imagen</span>
        </button>
      )}

      {media && image && message.mediaStatus === 'pending' && (
        <div className="media-state"><span className="spinner" /> Preparando imagen…</div>
      )}

      {media && image && message.mediaStatus === 'failed' && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> No se pudo preparar esta imagen.</div>
      )}

      {media && !image && (
        <div className="file-card">
          {message.messageType === 'audio' ? (
            <audio controls preload="metadata" src={url} />
          ) : (
            <>
              <span className="file-icon">{pdf ? 'PDF' : 'DOC'}</span>
              <span>
                <b>{message.mediaFilename || message.messageType}</b>
                <small>
                  {formatBytes(message.mediaSize)}
                  {message.mediaStatus === 'pending' ? ' · preparando…' : ''}
                </small>
              </span>
              <a className="file-download" href={mediaUrl(message.id, true)}><SvgIcon name="download" size={14} /><span>Descargar</span></a>
            </>
          )}
        </div>
      )}

      {message.body && message.body !== `[Mensaje ${message.messageType} recibido]` && (
        <p className="message-text">{formatBody(message.body)}</p>
      )}

      <time>
        {formatDate(message.createdAt)}
        <span className="delivery">{deliveryStatus(message)}</span>
        {message.deliveryStatus === 'failed' && (
          <button className="retry-link" onClick={() => onRetry(message.id)}>
            Reintentar envío
          </button>
        )}
      </time>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════
   TICKET BANNER (compact, replaces TicketCard)
   ═══════════════════════════════════════════════════════ */

function TicketBanner({
  ticket,
  onClose,
  onOrderLink,
}: {
  ticket: SupportTicket;
  onClose: (t: SupportTicket) => void;
  onOrderLink: (t: SupportTicket) => void;
}) {
  const order = ticket.ticketType === 'order';

  return (
    <div className={`ticket-banner ${order ? 'order' : 'question'}`}>
      <span className="badge">{order ? 'Pedido abierto' : 'Pregunta abierta'}</span>
      <span className="banner-text">
        {order
          ? `Pedido #${ticket.orderId || '—'} recibido`
          : ticket.subject || 'Consulta abierta'}
        {ticket.fallbackError && (
          <span className="ticket-warning-inline"> · {ticket.fallbackError}</span>
        )}
      </span>
      <span className="banner-actions">
        {order && (
          <button className="btn-sm btn-primary" onClick={() => onOrderLink(ticket)}>
            Enviar link y activar bot
          </button>
        )}
        <button className="btn-sm btn-ghost" onClick={() => onClose(ticket)}>
          {order ? 'Finalizar pedido' : 'Finalizar consulta'}
        </button>
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CHAT
   ═══════════════════════════════════════════════════════ */

function Chat({
  detail,
  messages,
  loading,
  error,
  hasOlder,
  newMessages,
  messagesRef,
  onLoadOlder,
  onSend,
  onReply,
  quote,
  clearQuote,
  onLightbox,
  onRetry,
  onTake,
  onRelease,
  onClose,
  onOrderLink,
  onToggleInfo,
  onOpenTemplates,
  onRetryLoad,
  busy,
}: {
  detail: ConversationDetail | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
  hasOlder: boolean;
  newMessages: number;
  messagesRef: React.RefObject<HTMLDivElement | null>;
  onLoadOlder: () => void;
  onSend: (body: string, file: File | null, quoteId: string | null) => Promise<void>;
  onReply: (m: Message) => void;
  quote: Message | null;
  clearQuote: () => void;
  onLightbox: (url: string, name: string) => void;
  onRetry: (id: string) => void;
  onTake: () => void;
  onRelease: () => void;
  onClose: (t: SupportTicket) => void;
  onOrderLink: (t: SupportTicket) => void;
  onToggleInfo: () => void;
  onOpenTemplates: () => void;
  onRetryLoad: () => void;
  busy: boolean;
}) {
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  if (!detail)
    return (
      <section className="chat-empty">
        <h2>Elegí una conversación</h2>
        <p>Seleccioná una conversación para ver el historial y responder.</p>
      </section>
    );

  const contact = detail.contact;
  const withinWindow = Boolean(
    contact.lastIncomingAt &&
      Date.now() - new Date(contact.lastIncomingAt).getTime() < 24 * 60 * 60 * 1000,
  );

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if ((!body.trim() && !file) || sending) return;
    setSending(true);
    try {
      await onSend(body, file, quote?.id || null);
      setBody('');
      setFile(null);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  }

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <section className="chat">
      {/* ── Chat header ── */}
      <header className="chat-head">
        <button
          className="mobile-back"
          onClick={() => document.body.classList.remove('mobile-chat-open')}
        >
          <SvgIcon name="back" size={16} />
          <span>Volver a conversaciones</span>
        </button>
        <Avatar row={contact} />
        <div className="chat-head-info">
          <strong>{contact.name || contact.publicName || 'Sin nombre'}</strong>
          <small className={contact.botPaused ? 'status-paused' : 'status-active'}>
            {contact.botPaused ? 'Atención humana' : 'Bot activo'}
            {' · '}{contact.phone}
          </small>
        </div>
      </header>

      <ConversationControlBar
        contact={contact}
        ticket={detail.openTicket}
        onTake={onTake}
        onRelease={onRelease}
        onClose={onClose}
        onToggleInfo={onToggleInfo}
        busy={busy}
      />

      {/* ── Ticket banner ── */}
      {detail.openTicket && (
        <TicketBanner ticket={detail.openTicket} onClose={onClose} onOrderLink={onOrderLink} />
      )}

      <WindowStatus
        withinWindow={withinWindow}
        newMessages={newMessages}
        messagesRef={messagesRef}
        onTemplates={onOpenTemplates}
        onRespond={() => textarea.current?.focus()}
      />

      {error && (
        <div className="chat-error">
          <span>{error}</span>
          <ActionButton variant="secondary" icon="refresh" onClick={onRetryLoad}>Reintentar carga</ActionButton>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="messages" ref={messagesRef}>
        {hasOlder && (
          <button className="older-link" onClick={onLoadOlder} disabled={loading}>
            {loading ? 'Cargando mensajes anteriores' : 'Cargar mensajes anteriores'}
          </button>
        )}

        {loading && messages.length === 0 && <LoadingState label="Cargando historial" />}

        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            messages={messages}
            onReply={onReply}
            onLightbox={onLightbox}
            onRetry={onRetry}
          />
        ))}

        {!loading && messages.length === 0 && <EmptyState title="Sin mensajes todavía" />}
      </div>

      {/* ── Composer ── */}
      <form
        className={`composer ${!withinWindow ? 'disabled' : ''}`}
        onSubmit={submit}
      >
        <div className="composer-main">
          {quote && (
            <div className="reply-bar">
              <span>
                <b>Respondiendo</b>
                <small>{shortText(quote.body, 100)}</small>
              </span>
              <button type="button" onClick={clearQuote}><SvgIcon name="close" size={15} /><span>Quitar respuesta</span></button>
            </div>
          )}

          {file && (
            <div className="file-bar">
              <span><b>{file.name}</b></span>
              <small>{formatBytes(file.size)}</small>
              <button type="button" onClick={() => setFile(null)}><SvgIcon name="close" size={15} /><span>Quitar archivo</span></button>
            </div>
          )}

          <div className="composer-input">
            <label className="comp-btn" title="Adjuntar archivo">
              <SvgIcon name="attach" size={16} />
              <span>Adjuntar archivo</span>
              <input
                type="file"
                accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
                disabled={!withinWindow}
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </label>

            <div className="emoji-picker">
              <button
                className="comp-btn"
                type="button"
                onClick={() => setEmojiOpen(!emojiOpen)}
                title="Emojis"
              >
                <SvgIcon name="smile" size={16} />
                <span>Emojis</span>
              </button>
              {emojiOpen && (
                <div className="emoji-popup">
                  {['😀', '👍', '✅', '📦', '❤️', '🙏'].map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setBody(v => `${v}${emoji}`);
                        textarea.current?.focus();
                        setEmojiOpen(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <textarea
              ref={textarea}
              value={body}
              onChange={e => setBody(e.target.value)}
              onKeyDown={keyDown}
              disabled={!withinWindow}
              placeholder={withinWindow ? 'Escribí un mensaje' : 'La ventana está cerrada'}
              rows={1}
            />

            <button
              className="send-btn"
              type="submit"
              disabled={!withinWindow || sending || (!body.trim() && !file)}
            >
              <SvgIcon name="send" size={15} />
              <span>{sending ? 'Enviando mensaje' : 'Enviar mensaje'}</span>
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   CONTACT DRAWER
   ═══════════════════════════════════════════════════════ */

function ContactDrawer({
  detail,
  open,
  onClose,
  onSave,
}: {
  detail: ConversationDetail;
  open: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Contact>) => Promise<void>;
}) {
  const contact = detail.contact;
  const [stage, setStage] = useState(contact.pipelineStatus);
  const [labels, setLabels] = useState(contact.labels.join(', '));
  const [notes, setNotes] = useState(contact.notes);
  const [follow, setFollow] = useState(
    contact.followUpAt ? new Date(contact.followUpAt).toISOString().slice(0, 16) : '',
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        pipelineStatus: stage,
        labels: labels
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        notes,
        followUpAt: follow ? new Date(follow).toISOString() : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className={`contact-drawer ${open ? 'open' : ''}`}>
      <div className="drawer-head">
        <div>
          <p className="eyebrow">Ficha comercial</p>
          <h2>{contact.name || contact.publicName || 'Sin nombre'}</h2>
          <span>{contact.phone}</span>
        </div>
        <button className="close-btn text-action" onClick={onClose}><SvgIcon name="close" size={15} /><span>Cerrar ficha</span></button>
      </div>

      <div className="drawer-body">
        <div className="drawer-profile">
          <Avatar row={contact} large />
          <div>
            <strong>{contact.name || 'Sin nombre'}</strong>
            <span>{consentNames[contact.consentStatus]}</span>
          </div>
        </div>

        <label>
          Etapa
          <select value={stage} onChange={e => setStage(e.target.value)}>
            {Object.entries(stages).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>

        <label>
          Seguimiento
          <input
            type="datetime-local"
            value={follow}
            onChange={e => setFollow(e.target.value)}
          />
        </label>

        <label>
          Etiquetas
          <input
            value={labels}
            onChange={e => setLabels(e.target.value)}
            placeholder="mayorista, urgente"
          />
        </label>

        <label>
          Notas
          <textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} />
        </label>

        <button className="button primary full" disabled={saving} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar ficha'}
        </button>

        <div className="facts">
          <div><span>Mensajes</span><b>{detail.messageCount}</b></div>
          <div><span>Última actividad</span><b>{formatDate(contact.lastMessageAt, true)}</b></div>
          <div><span>Último pedido</span><b>{detail.lastOrder ? `#${detail.lastOrder.id}` : '—'}</b></div>
          <div><span>Bot</span><b>{contact.botPaused ? 'Pausado' : 'Activo'}</b></div>
        </div>

        <div className="ticket-history">
          <h3>Historial de tickets</h3>
          {detail.tickets
            .filter(t => t.status === 'closed')
            .slice(0, 6)
            .map(t => (
              <div className="history-item" key={t.id}>
                <span className={`type-badge ${t.ticketType}`}>
                  {t.ticketType === 'order' ? 'Pedido' : 'Pregunta'}
                </span>
                <div>
                  <b>{closureNames[t.closureReason || ''] || 'Cerrado'}</b>
                  <small>{formatDate(t.closedAt, true)}</small>
                </div>
              </div>
            ))}
        </div>
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════
   CLOSE MODAL
   ═══════════════════════════════════════════════════════ */

function CloseModal({
  ticket,
  onCancel,
  onConfirm,
}: {
  ticket: SupportTicket;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const reasons =
    ticket.ticketType === 'order'
      ? [
          ['order_completed', 'Pedido finalizado'],
          ['customer_no_reply', 'Sin respuesta del cliente'],
          ['operator_cancelled', 'Cancelar atención'],
        ]
      : [
          ['question_answered', 'Consulta respondida'],
          ['customer_no_reply', 'Sin respuesta del cliente'],
          ['operator_cancelled', 'Cancelar atención'],
        ];

  const [reason, setReason] = useState(reasons[0][0]);
  const [loading, setLoading] = useState(false);

  const text =
    reason === 'order_completed'
      ? '✅ Tu pedido fue atendido y quedó finalizado. Si necesitás algo más, escribinos nuevamente.'
      : reason === 'question_answered'
        ? '✅ Tu consulta fue atendida y quedó finalizada. Si necesitás algo más, escribinos nuevamente.'
        : reason === 'customer_no_reply'
          ? 'ℹ️ Cerramos esta atención porque no recibimos la información necesaria. Si todavía necesitás ayuda, escribinos nuevamente.'
          : 'ℹ️ Cerramos esta atención. Si necesitás ayuda, escribinos nuevamente.';

  return (
    <div className="modal-backdrop">
      <section className="modal">
        <p className="eyebrow">Cierre explícito</p>
        <h2>Finalizar {ticket.ticketType === 'order' ? 'pedido' : 'consulta'}</h2>
        <p>El tipo del ticket define el texto final.</p>
        <label>
          Motivo
          <select value={reason} onChange={e => setReason(e.target.value)}>
            {reasons.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <div className="message-preview">{text}</div>
        <div className="modal-actions">
          <button className="button secondary" onClick={onCancel}>Cancelar</button>
          <button
            className="button primary"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try { await onConfirm(reason); } finally { setLoading(false); }
            }}
          >
            {loading ? 'Cerrando…' : 'Confirmar cierre'}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   SECONDARY VIEWS (rendered inside the left panel)
   ═══════════════════════════════════════════════════════ */

function DashboardView({ onOpen }: { onOpen: (v: View) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  useEffect(() => { void api<DashboardData>('/api/dashboard').then(setData); }, []);
  const work = data?.work || {};
  const ageSeconds = (value?: string | null) => value ? Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)) : null;
  const providerAge = ageSeconds(data?.provider?.lastActivityAt);
  const backupAge = ageSeconds(data?.backup?.completedAt);
  const archiveAge = ageSeconds(data?.archive?.lastArchivedAt);
  const whatsappState: { label: string; level: 'ok' | 'warn' | 'error' } = data?.transport === 'mock' ? { label: 'Mock QA', level: 'ok' }
    : !data?.cloudReady ? { label: 'Sin credenciales', level: 'error' }
    : providerAge !== null && providerAge <= 86_400 ? { label: 'Actividad reciente', level: 'ok' }
    : { label: 'Sin actividad reciente', level: 'warn' };
  const backupHealthy = data?.backup?.status === 'succeeded' && backupAge !== null && backupAge <= (data?.thresholds?.backupWarningSeconds ?? 90_000);
  const archiveFailureUnrecovered = Boolean(data?.archive?.lastFailedAt)
    && (!data?.archive?.lastArchivedAt || new Date(data.archive.lastFailedAt!).getTime() > new Date(data.archive.lastArchivedAt).getTime());
  const archiveHealthy = Boolean(data?.archive?.enabled)
    && archiveAge !== null
    && archiveAge <= (data?.thresholds?.archiveRpoSeconds ?? 300)
    && !archiveFailureUnrecovered;
  const dot = (level: 'ok' | 'warn' | 'error') => `health-dot${level === 'ok' ? '' : ` ${level}`}`;
  const bytes = (value?: number) => {
    const amount = Number(value ?? 0);
    if (amount < 1024 * 1024) return `${Math.round(amount / 1024)} KB`;
    if (amount < 1024 * 1024 * 1024) return `${(amount / 1024 / 1024).toFixed(1)} MB`;
    return `${(amount / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  return (
    <div className="panel-content">
      <div className="view-body">
        <div className="view-header">
          <p className="eyebrow">Hoy</p>
          <h2>Lo que necesita atención</h2>
          <p>Priorizá conversaciones y pedidos.</p>
        </div>

        <button className="button primary full" onClick={() => onOpen('inbox')}>
          Abrir conversaciones
        </button>

        <div className="metric-grid">
          {([
            ['Sin leer', work.unread || 0, 'conversaciones'],
            ['Nuevas', work.new || 0, 'por atender'],
            ['Vencidos', work.overdueFollowUps || 0, 'seguimientos'],
            ['Pedidos', work.newOrders || 0, 'nuevos'],
          ] as const).map(([label, value, hint]) => (
            <article className="metric" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{hint}</small>
            </article>
          ))}
        </div>

        <div className="health-card">
          <h3>Estado del sistema</h3>
          <div className="health-row">
            <span><i className={dot(whatsappState.level)} />WhatsApp Cloud</span>
            <b>{whatsappState.label}</b>
          </div>
          <div className="health-row">
            <span><i className={dot(data?.worker?.healthy ? 'ok' : 'error')} />Worker</span>
            <b>{data?.worker?.healthy ? 'Activo' : 'Sin latido'}</b>
          </div>
          <div className="health-row">
            <span><i className="health-dot" />Base de datos</span>
            <b>{bytes(data?.database?.bytes)}</b>
          </div>
          <div className="health-row">
            <span><i className={dot(Number(data?.failures?.failedMessages || 0) > 0 ? 'error' : 'ok')} />Envíos fallidos</span>
            <b>{data?.failures?.failedMessages || 0}</b>
          </div>
          <div className="health-row">
            <span><i className={dot((data?.queue?.oldestPendingSeconds || 0) > (data?.thresholds?.queueOldestWarningSeconds || 120) ? 'error' : 'ok')} />Cola pendiente</span>
            <b>{data?.queue?.pending || 0}</b>
          </div>
          <div className="health-row">
            <span><i className={dot((data?.queue?.retrying || 0) > 0 || (data?.queue?.failed || 0) > 0 ? 'warn' : 'ok')} />Reintentos / fallidos</span>
            <b>{data?.queue?.retrying || 0} / {data?.queue?.failed || 0}</b>
          </div>
          <div className="health-row">
            <span><i className={dot(backupHealthy ? 'ok' : 'error')} />Último backup</span>
            <b>{data?.backup?.completedAt ? formatDate(data.backup.completedAt, true) : 'Sin registro'}</b>
          </div>
          <div className="health-row">
            <span><i className={dot(archiveHealthy ? 'ok' : 'error')} />Archivado WAL</span>
            <b>{data?.archive?.enabled ? (data.archive.lastArchivedAt ? `${archiveAge}s` : 'Esperando actividad') : 'Desactivado'}</b>
          </div>
          <div className="health-row">
            <span><i className={dot(!data?.mediaStorage?.healthy ? 'error' : (data?.media?.failed || 0) > 0 ? 'warn' : 'ok')} />Multimedia privada</span>
            <b>{data?.media?.driver || 'local'} · {bytes(data?.media?.bytes)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketsView({ onOpen }: { onOpen: (contactId: string) => void }) {
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [filter, setFilter] = useState({ type: '', status: '', q: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filter.type) params.set('type', filter.type);
    if (filter.status) params.set('status', filter.status);
    if (filter.q) params.set('q', filter.q);
    void api<{ items: SupportTicket[] }>(`/api/tickets?${params}`)
      .then(d => setItems(d.items))
      .finally(() => setLoading(false));
  }, [filter.type, filter.status, filter.q]);

  return (
    <>
      <div className="search-bar">
        <div className="search-wrap">
          <span><SvgIcon name="search" size={16} /></span>
          <input
            placeholder="Buscar ticket"
            value={filter.q}
            onChange={e => setFilter({ ...filter, q: e.target.value })}
          />
        </div>
        <select className="filter-select" value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
          <option value="">Tipo</option>
          <option value="question">Preguntas</option>
          <option value="order">Pedidos</option>
        </select>
        <select className="filter-select" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Estado</option>
          <option value="open">Abiertos</option>
          <option value="responded">Respondidos</option>
          <option value="closed">Cerrados</option>
        </select>
      </div>
      <div className="panel-content">
        {loading ? (
          <LoadingState label="Cargando tickets" />
        ) : (
          <div className="view-list">
            {items.map(t => (
              <button className="view-item" key={t.id} onClick={() => onOpen(t.contactId)}>
                <span className={`type-badge ${t.ticketType}`}>
                  {t.ticketType === 'order' ? 'Pedido' : 'Pregunta'}
                </span>
                <span className="view-item-body">
                  <b>{t.contactName || t.publicName || 'Sin nombre'}</b>
                  <small>{shortText(t.question || t.lastMessage, 60)}</small>
                </span>
                <span className="view-item-meta">
                  {closureNames[t.closureReason || ''] || (t.displayStatus === 'closed' ? 'Cerrado' : 'Abierto')}
                  <br />{formatDate(t.updatedAt || t.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
        {!loading && items.length === 0 && (
          <EmptyState title="No hay tickets" description="Los tickets nuevos aparecerán en esta bandeja." />
        )}
      </div>
    </>
  );
}

function SimpleListView({
  kind,
  onOpen,
}: {
  kind: 'contacts' | 'orders';
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void api<{ items: any[] }>(
      kind === 'contacts' ? '/api/contacts?page=0&limit=50' : '/api/orders?page=0&limit=50',
    )
      .then(r => setData(r.items))
      .finally(() => setLoading(false));
  }, [kind]);

  return (
    <div className="panel-content">
      <div className="view-body">
        <div className="view-header">
          <p className="eyebrow">Gestión</p>
          <h2>{kind === 'contacts' ? 'Contactos' : 'Pedidos'}</h2>
          <p>{kind === 'contacts' ? 'Tu base paginada y editable.' : 'Pedidos recibidos por el bot.'}</p>
        </div>
      </div>

      {loading ? (
        <LoadingState label={kind === 'contacts' ? 'Cargando contactos' : 'Cargando pedidos'} />
      ) : (
        <div className="view-list">
          {data.map(row => (
            <button key={row.id} className="view-item" onClick={() => onOpen(row.contactId || row.id)}>
              <span className="avatar mini">{initials(row)}</span>
              <span className="view-item-body">
                <b>{row.name || row.customerName || `Pedido #${row.id}`}</b>
                <small>{row.phone || row.status}</small>
              </span>
              <span className="view-item-meta">
                {row.detail ? shortText(row.detail, 40) : stages[row.pipelineStatus] || '—'}
                <br />{formatDate(row.lastMessageAt || row.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesView() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => { void api<{ items: any[] }>('/api/templates').then(d => setItems(d.items)); }, []);

  return (
    <div className="panel-content">
      <div className="view-body">
        <div className="view-header">
          <p className="eyebrow">Preparación</p>
          <h2>Plantillas</h2>
          <p>Preparadas para envíos futuros.</p>
        </div>

        {items.map(item => (
          <article className="template-card" key={item.id}>
            <div>
              <span className="type-badge">{item.category}</span>
              <span className="template-status">{item.status}</span>
            </div>
            <h3>{item.metaName}</h3>
            <p>{item.body}</p>
            <small>{item.language} · Envíos bloqueados</small>
          </article>
        ))}

        {items.length === 0 && (
          <EmptyState title="No hay plantillas" description="Las plantillas preparadas aparecerán aquí." />
        )}
      </div>
    </div>
  );
}

const SecondaryViewsModule = lazy(() => import('./SecondaryViews'));

/* ═══════════════════════════════════════════════════════
   APP (main)
   ═══════════════════════════════════════════════════════ */

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [view, setView] = useState<View>('inbox');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('abasto-theme') as Theme) || 'system',
  );
  const [notifications, setNotifications] = useState(
    () => localStorage.getItem('abasto-notifications') !== 'off',
  );

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [newMessages, setNewMessages] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [closeTicket, setCloseTicket] = useState<SupportTicket | null>(null);
  const [quote, setQuote] = useState<Message | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const conversationListRequestRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  // ── Auth ──
  useEffect(() => {
    void api('/api/auth/me')
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
  }, []);

  // ── Theme ──
  useEffect(() => {
    const sys = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (sys.matches ? 'dark' : 'light') : theme;
    };
    apply();
    if (theme === 'system') sys.addEventListener('change', apply);
    localStorage.setItem('abasto-theme', theme);
    return () => sys.removeEventListener('change', apply);
  }, [theme]);

  // ── Notifications pref ──
  useEffect(() => {
    localStorage.setItem('abasto-notifications', notifications ? 'on' : 'off');
  }, [notifications]);

  // ── Load conversations ──
  async function loadConversations(reset = true) {
    const requestId = ++conversationListRequestRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ limit: '40' });
      if (search) params.set('q', search);
      if (filter === 'unread') params.set('unread', 'true');
      else if (filter === 'paused') params.set('botPaused', 'true');
      else if (filter === 'overdue') params.set('followUp', 'overdue');
      else if (filter) params.set('pipeline', filter);
      if (!reset && cursor) params.set('cursor', cursor);
      const result = await api<{ items: ConversationRow[]; nextCursor: string | null }>(
        `/api/conversations?${params}`,
      );
      // A slower polling/SSE response must never restore an older unread count.
      if (requestId !== conversationListRequestRef.current) return;
      setConversations(prev => (reset ? result.items : [...prev, ...result.items]));
      setCursor(result.nextCursor);
    } catch (reason) {
      setListError(reason instanceof Error ? reason.message : 'No se pudieron cargar las conversaciones.');
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    if (authenticated) void loadConversations();
  }, [authenticated, search, filter]);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  // ── SSE global ──
  useEffect(() => {
    if (!authenticated) return;
    const source = new EventSource('/api/stream');
    const refresh = () => { void loadConversations(); };
    const newMsg = (event: Event) => {
      refresh();
      try {
        const contactId = JSON.parse((event as MessageEvent).data || '{}').contactId;
        if (contactId)
          void api<{ items: Message[] }>(`/api/conversations/${contactId}/messages?limit=1`)
            .then(r => { const m = r.items[0]; if (m?.direction === 'incoming') notifyNewMessage(m, contactId); });
      } catch {}
    };
    source.addEventListener('message.created', newMsg);
    source.addEventListener('message.status', refresh);
    source.addEventListener('contact.updated', refresh);
    source.addEventListener('media.ready', refresh);
    return () => source.close();
  }, [authenticated, search, filter, notifications]);

  // ── Select conversation ──
  async function selectConversation(id: string) {
    setView('inbox');
    setSidebarOpen(false);
    setSelectedId(id);
    setInfoOpen(false);
    setQuote(null);
    setMessages([]);
    setBefore(null);
    setMessagesError(null);
    setNewMessages(0);
    document.body.classList.add('mobile-chat-open');
    try {
      const read = await api<Contact>(`/api/conversations/${id}/read`, { method: 'POST' });
      setConversations(prev => prev.map(row => row.id === id ? { ...row, ...read, unreadCount: 0 } : row));
      // Reconcile with the server after marking read. This prevents a stale
      // SSE/poll response from bringing the badge back.
      await loadConversations();
    } catch (reason) {
      setListError(reason instanceof Error ? reason.message : 'No se pudo marcar la conversación como leída.');
    }
  }

  // ── Load detail + messages ──
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let alive = true;
    setMessagesLoading(true);
    setMessagesError(null);
    void Promise.all([
      api<ConversationDetail>(`/api/conversations/${selectedId}`),
      api<{ items: Message[]; nextBefore: string | null }>(`/api/conversations/${selectedId}/messages?limit=15`),
    ]).then(([conv, hist]) => {
      if (!alive) return;
      setDetail(conv);
      setMessages(hist.items);
      messageIdsRef.current = new Set(hist.items.map(m => m.id));
      setBefore(hist.nextBefore);
      requestAnimationFrame(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; });
    }).catch(reason => {
      if (alive) setMessagesError(reason instanceof Error ? reason.message : 'No se pudo cargar el historial.');
    }).finally(() => alive && setMessagesLoading(false));
    return () => { alive = false; };
  }, [selectedId]);

  // ── SSE per-conversation ──
  useEffect(() => {
    if (!selectedId) return;
    const source = new EventSource(`/api/conversations/${selectedId}/stream`);
    const refresh = () => {
      void api<ConversationDetail>(`/api/conversations/${selectedId}`).then(setDetail).catch(() => {});
      void api<{ items: Message[]; nextBefore: string | null }>(`/api/conversations/${selectedId}/messages?limit=15`)
        .then(r => {
          const known = messageIdsRef.current;
          const inc = r.items.filter(m => !known.has(m.id));
          setMessages(r.items);
          messageIdsRef.current = new Set(r.items.map(m => m.id));
          if (inc.length) {
            if (document.hidden) setNewMessages(v => v + inc.length);
            inc.forEach(message => notifyNewMessage(message, selectedId));
          }
        }).catch(reason => setMessagesError(reason instanceof Error ? reason.message : 'No se pudo actualizar el historial.'));
    };
    source.onmessage = refresh;
    source.addEventListener('message.created', refresh);
    source.addEventListener('message.status', refresh);
    source.addEventListener('media.ready', refresh);
    let fallbackPoll: number | null = null;
    source.onopen = () => {
      if (fallbackPoll !== null) window.clearInterval(fallbackPoll);
      fallbackPoll = null;
    };
    source.onerror = () => {
      if (fallbackPoll === null) fallbackPoll = window.setInterval(refresh, 30_000);
    };
    return () => {
      source.close();
      if (fallbackPoll !== null) window.clearInterval(fallbackPoll);
    };
  }, [selectedId, notifications]);

  // ── Notify ──
  function notifyNewMessage(msg: Message, contactId?: string) {
    if (!notifications || msg.direction !== 'incoming') return;
    if (msg.id && notifiedMessageIdsRef.current.has(msg.id)) return;
    if (msg.id) notifiedMessageIdsRef.current.add(msg.id);
    if (contactId && selectedRef.current === contactId && !document.hidden) return;
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted')
      new Notification('Nuevo mensaje · AbastoBot', { body: shortText(msg.body || 'Archivo recibido') });
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 660;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {}
  }

  // ── Load older ──
  async function loadOlder() {
    if (!selectedId || !before) return;
    setMessagesLoading(true);
    try {
      const result = await api<{ items: Message[]; nextBefore: string | null }>(
        `/api/conversations/${selectedId}/messages?limit=15&before=${encodeURIComponent(before)}`,
      );
      const height = messagesRef.current?.scrollHeight || 0;
      setMessages(prev => {
        const merged = [...result.items, ...prev.filter(i => !result.items.some(n => n.id === i.id))];
        messageIdsRef.current = new Set(merged.map(i => i.id));
        return merged;
      });
      setBefore(result.nextBefore);
      requestAnimationFrame(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight - height; });
    } catch (reason) {
      setMessagesError(reason instanceof Error ? reason.message : 'No se pudieron cargar mensajes anteriores.');
    } finally {
      setMessagesLoading(false);
    }
  }

  // ── Send ──
  async function sendMessage(body: string, file: File | null, quoteMessageId: string | null) {
    if (!selectedId) return;
    let asset: any = null;
    if (file) {
      const processed = await optimizeImage(file);
      const form = new FormData();
      form.append('file', processed);
      asset = await api('/api/media', { method: 'POST', body: form });
    }
    await api(`/api/conversations/${selectedId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        body, assetId: asset?.assetId, mediaId: asset?.mediaId,
        mediaType: asset?.mediaType, mediaMimeType: asset?.mimeType,
        mediaFilename: asset?.filename, mediaSize: asset?.size, quoteMessageId,
      }),
    });
    setQuote(null);
    await reloadMessages(true);
  }

  async function reloadMessages(stick = false) {
    if (!selectedId) return;
    const result = await api<{ items: Message[]; nextBefore: string | null }>(`/api/conversations/${selectedId}/messages?limit=15`);
    setMessages(result.items);
    messageIdsRef.current = new Set(result.items.map(m => m.id));
    setBefore(result.nextBefore);
    if (stick) requestAnimationFrame(() => { if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; });
  }

  async function saveContact(patch: Partial<Contact>) {
    if (!selectedId) return;
    const updated = await api<Contact>(`/api/conversations/${selectedId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setDetail(prev => prev ? { ...prev, contact: updated } : prev);
    setConversations(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
  }

  async function takeConversation() {
    if (!selectedId) return;
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const updated = await api<Contact>(`/api/conversations/${selectedId}/take`, { method: 'POST' });
      setDetail(prev => prev ? { ...prev, contact: updated } : prev);
      setConversations(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
    } catch (reason) { window.alert(reason instanceof Error ? reason.message : 'No se pudo tomar la conversación.'); }
    finally { setActionBusy(false); }
  }

  async function releaseConversation() {
    if (!selectedId) return;
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const updated = await api<Contact>(`/api/conversations/${selectedId}/release`, { method: 'POST' });
      setDetail(prev => prev ? { ...prev, contact: updated } : prev);
      setConversations(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
    } catch (reason) { window.alert(reason instanceof Error ? reason.message : 'No se pudo liberar la conversación.'); }
    finally { setActionBusy(false); }
  }

  async function orderLink(ticket: SupportTicket) {
    try {
      await api(`/api/tickets/${ticket.id}/order-link`, { method: 'POST' });
      if (selectedId) {
        const updated = await api<ConversationDetail>(`/api/conversations/${selectedId}`);
        setDetail(updated);
        await reloadMessages(true);
      }
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'No se pudo enviar el link.');
    }
  }

  async function confirmClose(reason: string) {
    if (!closeTicket) return;
    try {
      await api(`/api/tickets/${closeTicket.id}/close`, { method: 'POST', body: JSON.stringify({ reason }) });
      setCloseTicket(null);
      if (selectedId) {
        const updated = await api<ConversationDetail>(`/api/conversations/${selectedId}`);
        setDetail(updated);
        await reloadMessages(true);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo cerrar el ticket.');
      throw error;
    }
  }

  async function retryMessage(id: string) {
    await api(`/api/messages/${id}/retry`, { method: 'POST' });
    await reloadMessages(true);
  }

  function navigate(viewToOpen: View) {
    setView(viewToOpen);
    setSidebarOpen(false);
    if (viewToOpen !== 'inbox') document.body.classList.remove('mobile-chat-open');
  }

  // ── Service Worker ──
  useEffect(() => {
    if (!authenticated) return;
    const reg = 'serviceWorker' in navigator ? navigator.serviceWorker.register('/sw.js') : Promise.resolve();
    void reg;
  }, [authenticated]);

  // ── Render ──
  if (authenticated === null)
    return <div className="boot-screen"><span className="spinner" /> Abriendo bandeja…</div>;

  if (!authenticated)
    return <Login onLogin={() => setAuthenticated(true)} />;

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        onNavigate={navigate}
        unread={conversations.reduce((s, r) => s + (r.unreadCount || 0), 0)}
        sidebarOpen={sidebarOpen}
      />
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} />}

      <main className="main-area">
        <Topbar
          view={view}
          theme={theme}
          setTheme={setTheme}
          notifications={notifications}
          setNotifications={setNotifications}
          onRefresh={() => view === 'inbox' ? void loadConversations() : location.reload()}
          onMenu={() => setSidebarOpen(value => !value)}
        />

        {view === 'inbox' ? (
          <div className={`inbox-shell ${detail && infoOpen ? 'info-visible' : ''}`}>
            <aside className="conversation-pane">
              <ConversationList
                items={conversations}
                selectedId={selectedId}
                loading={listLoading}
                hasMore={Boolean(cursor)}
                error={listError}
                search={searchDraft}
                filter={filter}
                onSearch={setSearchDraft}
                onFilter={setFilter}
                onMore={() => void loadConversations(false)}
                onSelect={id => void selectConversation(id)}
                onRetry={() => void loadConversations()}
              />
            </aside>

            <Chat
              detail={detail}
              messages={messages}
              loading={messagesLoading}
              error={messagesError}
              hasOlder={Boolean(before)}
              newMessages={newMessages}
              messagesRef={messagesRef}
              onLoadOlder={() => void loadOlder()}
              onSend={sendMessage}
              onReply={setQuote}
              quote={quote}
              clearQuote={() => setQuote(null)}
              onLightbox={(url, name) => setLightbox({ url, name })}
              onRetry={id => void retryMessage(id)}
              onTake={() => void takeConversation()}
              onRelease={() => void releaseConversation()}
              onClose={ticket => setCloseTicket(ticket)}
              onOrderLink={ticket => void orderLink(ticket)}
              onToggleInfo={() => setInfoOpen(value => !value)}
              onOpenTemplates={() => navigate('templates')}
              onRetryLoad={() => {
                if (selectedId) {
                  setMessagesError(null);
                  void reloadMessages(true).catch(reason => setMessagesError(reason instanceof Error ? reason.message : 'No se pudo cargar el historial.'));
                }
              }}
              busy={actionBusy}
            />

            {detail ? (
              <ContactDrawer
                detail={detail}
                open={infoOpen}
                onClose={() => setInfoOpen(false)}
                onSave={saveContact}
              />
            ) : (
              <aside className="contact-drawer contact-empty">
                <strong>Ficha comercial</strong>
                <p>Seleccioná una conversación para ver los datos del contacto.</p>
              </aside>
            )}
          </div>
        ) : (
          <section className="main-view">
            <Suspense fallback={<LoadingState label="Abriendo vista" />}>
              <SecondaryViewsModule
                view={view}
                onNavigate={navigate}
                onOpenContact={id => void selectConversation(id)}
              />
            </Suspense>
          </section>
        )}
      </main>

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <button className="text-action" onClick={() => setLightbox(null)}><SvgIcon name="close" size={15} /><span>Cerrar visor</span></button>
          <img src={lightbox.url} alt={lightbox.name} />
        </div>
      )}

      {/* Close modal */}
      {closeTicket && (
        <CloseModal
          ticket={closeTicket}
          onCancel={() => setCloseTicket(null)}
          onConfirm={confirmClose}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   IMAGE OPTIMIZER
   ═══════════════════════════════════════════════════════ */

async function optimizeImage(file: File) {
  if (!file.type.startsWith('image/') || file.size < 1_500_000) return file;
  const bitmap = await createImageBitmap(file);
  const max = 1920;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file;
}
