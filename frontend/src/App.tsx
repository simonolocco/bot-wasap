import { useSheetFocus } from './useSheetFocus';
import { FormEvent, Fragment, KeyboardEvent, Suspense, lazy, useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, formatDate, initials, mediaUrl, shortText, thumbnailUrl } from './api';
import type {
  Contact,
  ConversationDetail,
  ConversationRow,
  ConversationStats,
  DashboardData,
  Message,
  SupportTicket,
} from './types';
import './styles.css';

type View = 'inbox' | 'dashboard' | 'analytics' | 'contacts' | 'orders' | 'tickets' | 'templates';
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
  | 'analytics'
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
  | 'check'
  | 'moreHorizontal';

function SvgIcon({ name, size = 17 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    analytics: <><rect x="3" y="13" width="4" height="8" rx="1" /><rect x="10" y="8" width="4" height="13" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></>,
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
    moreHorizontal: <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
  };
  return <svg className="svg-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const viewTitles: Record<View, [string, string]> = {
  dashboard: ['Resumen', 'Trabajo pendiente y actividad comercial.'],
  analytics: ['Analíticas', 'Comportamiento del bot, uso de menús y mensajes no entendidos.'],
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
  onToggle,
}: {
  view: View;
  onNavigate: (view: View) => void;
  unread: number;
  sidebarOpen: boolean;
  onToggle: () => void;
}) {
  const navigationRef = useSheetFocus(sidebarOpen, onToggle, true);
  const items: Array<[View, IconName, string]> = [
    ['dashboard', 'dashboard', 'Resumen'],
    ['analytics', 'analytics', 'Analíticas'],
    ['inbox', 'chat', 'Conversaciones'],
    ['tickets', 'ticket', 'Tickets'],
    ['contacts', 'contact', 'Contactos'],
    ['orders', 'order', 'Pedidos'],
    ['templates', 'template', 'Plantillas'],
  ];
  return (
    <aside ref={navigationRef} className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand-block">
        <span>ABASTOBOT</span>
        <strong>Bandeja comercial</strong>
      </div>
      <div className="mobile-nav-heading"><strong>Secciones</strong><button type="button" aria-label="Cerrar menú" onClick={onToggle}><SvgIcon name="close" /></button></div>
      <nav id="all-sections" className="sidebar-nav" aria-label="Navegación principal">
        {items.map(([id, icon, label]) => (
          <button key={id} aria-label={label} title={label} aria-current={view === id ? 'page' : undefined} className={`sidebar-link ${view === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
            <SvgIcon name={icon} />
            <span>{label}</span>
            {id === 'inbox' && unread > 0 && <b>{unread}</b>}
          </button>
        ))}
      </nav>
      <nav className="mobile-primary-nav" aria-label="Accesos principales">
        {items.filter(([id]) => ['inbox', 'tickets', 'contacts', 'orders'].includes(id)).map(([id, icon, label]) => (
          <button type="button" key={id} aria-label={label} aria-current={view === id ? 'page' : undefined} className={`mobile-nav-link ${view === id ? 'active' : ''}`} onClick={() => onNavigate(id)}>
            <SvgIcon name={icon} size={20} /><span>{id === 'inbox' ? 'Chats' : label}</span>
            {id === 'inbox' && unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
          </button>
        ))}
        <button type="button" className={`mobile-nav-link ${['dashboard', 'analytics', 'templates'].includes(view) ? 'active' : ''}`} aria-label="Más secciones" aria-expanded={sidebarOpen} aria-controls="all-sections" onClick={onToggle}><SvgIcon name="moreHorizontal" size={20} /><span>Más</span></button>
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsId = useId();
  useEffect(() => setSettingsOpen(false), [view]);
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
      <button type="button" className="topbar-settings-toggle text-action" aria-label="Configuración" aria-expanded={settingsOpen} aria-controls={settingsId} onClick={() => setSettingsOpen(!settingsOpen)}><SvgIcon name="moreHorizontal" /></button>
      <div id={settingsId} className={`topbar-actions ${settingsOpen ? 'expanded' : ''}`} onKeyDown={e => { if (e.key === 'Escape') { setSettingsOpen(false); (document.getElementById(settingsId)?.previousElementSibling as HTMLButtonElement | null)?.focus(); } }}>
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
        <button className="text-action mobile-logout" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }}><SvgIcon name="logout" /><span>Cerrar sesión</span></button>
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
  stats,
  markAllBusy,
  search,
  filter,
  onSearch,
  onFilter,
  onMarkAllRead,
  onSelect,
  onRetry,
}: {
  items: ConversationRow[];
  selectedId: string | null;
  loading: boolean;
  stats: ConversationStats | null;
  markAllBusy: boolean;
  search: string;
  filter: string;
  onSearch: (v: string) => void;
  onFilter: (v: string) => void;
  onMarkAllRead: () => void;
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
            aria-label="Buscar conversaciones"
          />
        </div>
        <select
          className="filter-select"
          aria-label="Filtrar conversaciones"
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
          <option value="tickets">Tickets abiertos</option>
        </select>
      </div>

      <div className="conversation-summary" aria-label="Resumen global de conversaciones">
        <div className="conversation-summary-grid">
          <div className="conversation-metric">
            <span>Conversaciones</span>
            <strong>{stats?.totalConversations ?? '—'}</strong>
          </div>
          <button
            type="button"
            className={`conversation-metric clickable ${filter === 'unread' ? 'active' : ''}`}
            onClick={() => onFilter(filter === 'unread' ? '' : 'unread')}
          >
            <span>Sin leer</span>
            <strong>{stats?.unreadConversations ?? '—'}</strong>
            <small>{stats?.unreadMessages ?? '—'} mensajes</small>
          </button>
          <div className="conversation-metric">
            <span>Mensajes totales</span>
            <strong>{stats?.totalMessages ?? '—'}</strong>
          </div>
          <button
            type="button"
            className={`conversation-metric clickable ${filter === 'tickets' ? 'active' : ''}`}
            onClick={() => onFilter(filter === 'tickets' ? '' : 'tickets')}
          >
            <span>Tickets abiertos</span>
            <strong>{stats?.openTickets ?? '—'}</strong>
          </button>
        </div>
        <button
          type="button"
          className="mark-all-read"
          disabled={markAllBusy || !stats?.unreadMessages}
          onClick={onMarkAllRead}
        >
          {markAllBusy && <span className="spinner small" />}
          {markAllBusy ? 'Marcando…' : 'Marcar todo como leído'}
        </button>
      </div>

      <div className="panel-content">
        <div className="list-count">
          {items.length}
          {' '}conversaciones {loading ? '· cargando todas' : ''}
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
                {item.unreadCount > 0 && <b className="unread-badge">{item.unreadCount}</b>}
              </span>
            </button>
          ))}
        </div>

        {error && <ErrorState title={error} onRetry={onRetry} />}

        {!error && !loading && items.length === 0 && (
          <EmptyState title="No hay conversaciones" description="Probá cambiar los filtros o iniciar una búsqueda." />
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

const CHAT_TIME_ZONE = 'America/Argentina/Cordoba';

function chatDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftChatDate(key: string, days: number) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatChatDateLabel(value: string) {
  const key = chatDateKey(value);
  const today = chatDateKey(new Date());
  if (key === today) return 'Hoy';
  if (key === shiftChatDate(today, -1)) return 'Ayer';
  return new Date(value).toLocaleDateString('es-AR', { dateStyle: 'medium', timeZone: CHAT_TIME_ZONE });
}

function formatChatTime(value: string) {
  return new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: CHAT_TIME_ZONE });
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => {
    const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return byDate || a.id.localeCompare(b.id);
  });
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

function fallbackMessageBody(messageType: string) {
  const labels: Record<string, string> = {
    reaction: 'Reacción recibida',
    location: '📍 Ubicación compartida',
    contacts: '👤 Contacto compartido',
    order: '🛒 Pedido recibido',
    button: 'Respuesta de botón recibida',
    interactive: 'Respuesta interactiva recibida',
    system: 'Mensaje del sistema de WhatsApp',
    unknown: 'Mensaje de WhatsApp no compatible',
  };
  return labels[messageType] || `Mensaje de WhatsApp (${messageType || 'tipo desconocido'})`;
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
  const [copied, setCopied] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!actionsVisible) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    function positionMenu() {
      if (!trigger || !menu) return;
      const anchor = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const bounds = menu.getBoundingClientRect();
      setMenuPosition({
        left: Math.max(left + 8, Math.min(anchor.left, left + width - bounds.width - 8)),
        top: Math.max(top + 8, Math.min(anchor.bottom + bounds.height + 8 <= top + height ? anchor.bottom + 4 : anchor.top - bounds.height - 4, top + height - bounds.height - 8)),
      });
    }
    const dismiss = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node) && !trigger.contains(event.target as Node)) setActionsVisible(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setActionsVisible(false); trigger.focus(); }
    };
    positionMenu();
    menu.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    window.visualViewport?.addEventListener('resize', positionMenu);
    window.visualViewport?.addEventListener('scroll', positionMenu);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      window.visualViewport?.removeEventListener('resize', positionMenu);
      window.visualViewport?.removeEventListener('scroll', positionMenu);
    };
  }, [actionsVisible]);
  const media = Boolean(
    message.mediaAssetId ||
      message.mediaId ||
      ['image', 'sticker', 'video', 'document', 'audio'].includes(message.messageType),
  );
  const url = mediaUrl(message.id);
  const image = message.messageType === 'image' || message.messageType === 'sticker';
  const video = message.messageType === 'video';
  const mediaReady = message.mediaStatus === 'ready';
  const placeholderBody = `[Mensaje ${message.messageType} recibido]`;
  const storedBody = message.body && message.body !== placeholderBody ? message.body : message.mediaCaption || '';
  const displayBody = storedBody || (!media ? fallbackMessageBody(message.messageType) : '');
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

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const text = displayBody || message.body || '';
    if (!text) return;
    if (!navigator.clipboard) {
      // Fallback for non-secure contexts
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Silently ignore copy failure
      }
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // Silently ignore clipboard rejection
    });
  }

  return (
    <article
      className={`message-bubble ${message.direction} ${message.deliveryStatus === 'failed' ? 'failed' : ''} ${actionsVisible ? 'actions-visible' : ''}`}
      data-message-id={message.id}
      data-message-type={message.messageType}
      onDoubleClick={() => onReply(message)}
    >
      <button
        type="button"
        className="message-actions-trigger"
        ref={triggerRef}
        aria-controls={actionsVisible ? menuId : undefined}
        aria-expanded={actionsVisible}
        aria-label="Opciones de mensaje"
        onClick={() => setActionsVisible(!actionsVisible)}
      >
        <SvgIcon name="moreHorizontal" size={16} />
      </button>
      {actionsVisible && createPortal(<div id={menuId} ref={menuRef} className="message-actions message-actions-floating" role="group" aria-label="Acciones del mensaje" style={menuPosition} onClick={e => e.stopPropagation()}>
        <button type="button" onClick={() => { onReply(message); setActionsVisible(false); }} title="Responder"><SvgIcon name="reply" size={14} /><span>Responder</span></button>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copiado' : 'Copiar mensaje'}
          className={copied ? 'action-copied' : ''}
          aria-live="polite"
          aria-label={copied ? 'Mensaje copiado' : 'Copiar mensaje'}
        >
          <SvgIcon name={copied ? 'check' : 'copy'} size={14} />
          <span>{copied ? 'Copiado' : 'Copiar'}</span>
        </button>
        {media && <a href={mediaUrl(message.id, true)} title="Descargar archivo"><SvgIcon name="download" size={14} /><span>Descargar</span></a>}
      </div>, document.body)}

      {quoted && (
        <div className="quoted-message">
          {quoted.id && (quoted.messageType === 'image' || quoted.messageType === 'sticker') && quoted.mediaStatus !== 'failed' && (
            <img src={thumbnailUrl(quoted.id, 240)} alt="Imagen citada" loading="lazy" decoding="async" />
          )}
          <span>
            <b>{quoted.direction === 'incoming' ? 'Cliente' : quoted.direction === 'outgoing' ? 'Vos' : 'Mensaje citado'}</b>
            <small>{quoted.messageType === 'image' ? '📷 Foto' : quoted.messageType === 'sticker' ? '🏷️ Sticker' : quoted.messageType === 'video' ? '🎬 Video' : quoted.messageType === 'audio' ? '🎧 Audio' : quoted.messageType === 'document' ? `📄 ${quoted.mediaFilename || 'Documento'}` : shortText(quoted.body || 'Mensaje original no disponible', 100)}</small>
          </span>
        </div>
      )}

      {media && image && message.mediaStatus !== 'failed' && message.mediaStatus !== 'pending' && (
        <button
          className="image-button"
          onClick={() => onLightbox(thumbnailUrl(message.id, 960), message.mediaFilename || (message.messageType === 'sticker' ? 'Sticker' : 'Imagen'))}
        >
          <span className="image-placeholder" aria-hidden="true" />
          <img
            src={thumbnailUrl(message.id, 480)}
            loading="lazy"
            decoding="async"
            width={message.mediaWidth || undefined}
            height={message.mediaHeight || undefined}
            alt={message.mediaCaption || (message.messageType === 'sticker' ? 'Sticker recibido' : 'Imagen recibida')}
          />
          <span className="image-label">{message.messageType === 'sticker' ? 'Ver sticker' : 'Ver imagen'}</span>
        </button>
      )}

      {media && image && message.mediaStatus === 'pending' && (
        <div className="media-state"><span className="spinner" /> Preparando {message.messageType === 'sticker' ? 'sticker' : 'imagen'}…</div>
      )}

      {media && image && message.mediaStatus === 'failed' && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> No se pudo preparar este {message.messageType === 'sticker' ? 'sticker' : 'imagen'}.</div>
      )}

      {media && image && !message.mediaStatus && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> {message.messageType === 'sticker' ? 'Sticker' : 'Imagen'} no disponible. Podés revisar el mensaje desde WhatsApp.</div>
      )}

      {media && video && message.mediaStatus === 'pending' && (
        <div className="media-state"><span className="spinner" /> Preparando video…</div>
      )}

      {media && video && message.mediaStatus === 'failed' && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> No se pudo preparar este video.</div>
      )}

      {media && video && mediaReady && (
        <div className="video-card">
          <video controls preload="metadata" src={url} aria-label={message.mediaCaption || 'Video recibido'} />
          <a className="file-download" href={mediaUrl(message.id, true)}><SvgIcon name="download" size={14} /><span>Descargar video</span></a>
        </div>
      )}

      {media && video && !message.mediaStatus && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> Video no disponible. Podés revisar el mensaje desde WhatsApp.</div>
      )}

      {media && !image && !video && message.mediaStatus === 'pending' && (
        <div className="media-state"><span className="spinner" /> Preparando {message.messageType === 'audio' ? 'audio' : 'archivo'}…</div>
      )}

      {media && !image && !video && message.mediaStatus === 'failed' && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> No se pudo preparar este {message.messageType === 'audio' ? 'audio' : 'archivo'}.</div>
      )}

      {media && !image && !video && !message.mediaStatus && (
        <div className="media-state error"><SvgIcon name="info" size={15} /> Contenido no disponible. Podés revisar el mensaje desde WhatsApp.</div>
      )}

      {media && !image && !video && mediaReady && (
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

      {displayBody && (
        <p className="message-text">{formatBody(displayBody)}</p>
      )}

      <time>
        {formatChatTime(message.createdAt)}
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
          <button className="action-button primary" onClick={() => onOrderLink(ticket)}>
            Enviar link y activar bot
          </button>
        )}
        <button className="action-button secondary" onClick={() => onClose(ticket)}>
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
  newMessages,
  messagesRef,
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
  newMessages: number;
  messagesRef: React.RefObject<HTMLDivElement | null>;
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
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsId = useId();
  useEffect(() => setControlsOpen(false), [detail?.contact.id]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (quote) textarea.current?.focus(); }, [quote]);

  if (!detail) {
    if (loading) {
      return (
        <section className="chat">
          <header className="chat-head">
            <button
              type="button"
              className="mobile-back"
              onClick={() => document.body.classList.remove('mobile-chat-open')}
            >
              <SvgIcon name="back" size={16} />
              <span>Volver a conversaciones</span>
            </button>
            <div className="chat-head-info">
              <strong>Cargando conversación…</strong>
            </div>
          </header>
          <div className="messages">
            <LoadingState label="Cargando historial" />
          </div>
        </section>
      );
    }
    if (error) {
      return (
        <section className="chat">
          <header className="chat-head">
            <button
              type="button"
              className="mobile-back"
              onClick={() => document.body.classList.remove('mobile-chat-open')}
            >
              <SvgIcon name="back" size={16} />
              <span>Volver a conversaciones</span>
            </button>
            <div className="chat-head-info">
              <strong>Error al cargar</strong>
            </div>
          </header>
          <div className="chat-error">
            <span>{error}</span>
            <ActionButton variant="secondary" icon="refresh" onClick={onRetryLoad}>Reintentar carga</ActionButton>
          </div>
        </section>
      );
    }
    return (
      <section className="chat-empty">
        <h2>Elegí una conversación</h2>
        <p>Seleccioná una conversación para ver el historial y responder.</p>
      </section>
    );
  }

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
          type="button"
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

      <div className="chat-control-disclosure" onKeyDown={e => { if (e.key === 'Escape') { setControlsOpen(false); e.currentTarget.querySelector<HTMLButtonElement>('.chat-controls-toggle')?.focus(); } }}>
      <button type="button" className="chat-controls-toggle action-button secondary" aria-controls={controlsId} aria-expanded={controlsOpen} onClick={() => setControlsOpen(!controlsOpen)}><SvgIcon name="moreHorizontal" /><span>Acciones y estado{!withinWindow ? ' · Ventana vencida' : detail.openTicket ? ' · Ticket abierto' : ''}</span></button>
      <div id={controlsId} className={`chat-control-panel ${controlsOpen ? 'expanded' : ''}`}>
      <ConversationControlBar
        contact={contact}
        ticket={detail.openTicket}
        onTake={onTake}
        onRelease={onRelease}
        onClose={ticket => { setControlsOpen(false); onClose(ticket); }}
        onToggleInfo={() => { setControlsOpen(false); onToggleInfo(); }}
        busy={busy}
      />

      {/* ── Ticket banner ── */}
      {detail.openTicket && (
        <TicketBanner ticket={detail.openTicket} onClose={ticket => { setControlsOpen(false); onClose(ticket); }} onOrderLink={ticket => { setControlsOpen(false); onOrderLink(ticket); }} />
      )}

      <WindowStatus
        withinWindow={withinWindow}
        newMessages={newMessages}
        messagesRef={messagesRef}
        onTemplates={() => { setControlsOpen(false); onOpenTemplates(); }}
        onRespond={() => { setControlsOpen(false); textarea.current?.focus(); }}
      />

      </div>
      </div>

      {error && (
        <div className="chat-error">
          <span>{error}</span>
          <ActionButton variant="secondary" icon="refresh" onClick={onRetryLoad}>Reintentar carga</ActionButton>
        </div>
      )}

      {/* ── Messages ── */}
      <div className="messages" ref={messagesRef}>
        {loading && messages.length === 0 && <LoadingState label="Cargando historial" />}

        {messages.map((msg, index) => {
          const dateChanged = index === 0 || chatDateKey(messages[index - 1].createdAt) !== chatDateKey(msg.createdAt);
          return (
            <Fragment key={msg.id}>
              {dateChanged && (
                <div className="message-date-separator" role="separator" aria-label={`Mensajes del ${formatChatDateLabel(msg.createdAt)}`}>
                  <span>{formatChatDateLabel(msg.createdAt)}</span>
                </div>
              )}
              <MessageBubble
                message={msg}
                messages={messages}
                onReply={onReply}
                onLightbox={onLightbox}
                onRetry={onRetry}
              />
            </Fragment>
          );
        })}

        {!loading && messages.length === 0 && <EmptyState title="Sin mensajes todavía" />}
      </div>

      {/* ── Composer ── */}
      <form
        className={`composer ${!withinWindow ? 'disabled' : ''}`}
        onSubmit={submit}
      >
        <div className="composer-main">
          {quote && (
            <div className="reply-bar" role="note" aria-label="Respondiendo a un mensaje">
              <div className="reply-bar__label">
                <SvgIcon name="reply" size={13} />
                <div className="reply-bar__text">
                  <b>Respondiendo</b>
                  <span>{shortText(quote.body || (quote.messageType ? `[${quote.messageType}]` : 'Mensaje original'), 80)}</span>
                </div>
              </div>
              <button
                type="button"
                className="reply-bar__dismiss"
                onClick={clearQuote}
                title="Quitar respuesta"
                aria-label="Quitar respuesta"
              >
                <SvgIcon name="close" size={14} />
                <span>Quitar</span>
              </button>
            </div>
          )}

          {file && (
            <div className="file-bar" role="note" aria-label="Archivo adjunto seleccionado">
              <div className="file-bar__info">
                <b>{file.name}</b>
                <span>{formatBytes(file.size)}</span>
              </div>
              <button
                type="button"
                className="reply-bar__dismiss"
                onClick={() => setFile(null)}
                title="Quitar archivo"
                aria-label="Quitar archivo adjunto"
              >
                <SvgIcon name="close" size={14} />
                <span>Quitar</span>
              </button>
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
              aria-label={sending ? 'Enviando mensaje' : 'Enviar mensaje'}
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
  const drawerRef = useSheetFocus(open, onClose, true);
  const contact = detail.contact;
  const [name, setName] = useState(contact.name || contact.publicName || '');
  const [stage, setStage] = useState(contact.pipelineStatus);
  const [labels, setLabels] = useState((contact.labels || []).join(', '));
  const [notes, setNotes] = useState(contact.notes);
  const [follow, setFollow] = useState(
    contact.followUpAt ? new Date(contact.followUpAt).toISOString().slice(0, 16) : '',
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        name,
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
    <aside ref={drawerRef} aria-label="Ficha comercial" className={`contact-drawer ${open ? 'open' : ''}`}>
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
          Nombre comercial
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del cliente" />
        </label>


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
          {(detail.tickets || [])
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
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      prev?.focus();
    };
  }, [onCancel]);

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
      <section
        ref={modalRef}
        tabIndex={-1}
        className="modal-sheet close-modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-modal-title"
      >
        <div className="modal-scroll-area">
          <p className="eyebrow">Cierre explícito</p>
          <h2 id="close-modal-title">Finalizar {ticket.ticketType === 'order' ? 'pedido' : 'consulta'}</h2>
          <p>El tipo del ticket define el texto final.</p>
          <label className="modal-label">
            Motivo
            <select className="modal-select" value={reason} onChange={e => setReason(e.target.value)}>
              {reasons.map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <div className="message-preview">{text}</div>
        </div>
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
  const totalContacts = Number(data?.stats?.total ?? 0);
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
            ['Contactos', totalContacts, 'registrados'],
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
  const [conversationStats, setConversationStats] = useState<ConversationStats | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [markAllReadBusy, setMarkAllReadBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filter, setFilter] = useState('');
  // analyticsNoMenuFilter: when set, the conversation list is filtered to contacts
  // who had incoming messages in that period but never selected a menu option.
  const [analyticsNoMenuFilter, setAnalyticsNoMenuFilter] = useState<{ from: string; to: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
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

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--visual-height', `${height}px`);
      document.documentElement.style.setProperty('--visual-top', `${viewport?.offsetTop ?? 0}px`);
      document.body.classList.toggle('keyboard-open', window.innerHeight - height > 120 && /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || ''));
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      document.body.classList.remove('keyboard-open');
      document.documentElement.style.removeProperty('--visual-height');
      document.documentElement.style.removeProperty('--visual-top');
    };
  }, []);

  // ── Auth ──
  useEffect(() => {
    void api('/api/auth/me')
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
    return () => {
      document.body.classList.remove('mobile-chat-open');
    };
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
  async function loadConversations() {
    const requestId = ++conversationListRequestRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const statsPromise = api<ConversationStats>('/api/conversations/stats').catch(() => null);
      const collected: ConversationRow[] = [];
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      let nextCursor: string | null = null;

      do {
        const params = new URLSearchParams({ limit: '100' });
        if (search) params.set('q', search);
        if (filter === 'unread') params.set('unread', 'true');
        else if (filter === 'paused') params.set('botPaused', 'true');
        else if (filter === 'overdue') params.set('followUp', 'overdue');
        else if (filter === 'tickets') params.set('ticket', 'open');
        else if (filter) params.set('pipeline', filter);
        if (analyticsNoMenuFilter) {
          params.set('analyticsNoMenuFrom', analyticsNoMenuFilter.from);
          params.set('analyticsNoMenuTo', analyticsNoMenuFilter.to);
        }
        if (nextCursor) params.set('cursor', nextCursor);

        const result = await api<{ items: ConversationRow[]; nextCursor: string | null }>(
          `/api/conversations?${params}`,
        );
        // A slower polling/SSE response must never restore older rows or badges.
        if (requestId !== conversationListRequestRef.current) return;
        for (const row of result.items) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            collected.push(row);
          }
        }
        setConversations([...collected]);
        nextCursor = result.nextCursor;
        if (nextCursor) {
          if (seenCursors.has(nextCursor)) throw new Error('La lista devolvió una página repetida.');
          seenCursors.add(nextCursor);
        }
      } while (nextCursor);

      const stats = await statsPromise;
      if (requestId === conversationListRequestRef.current && stats) setConversationStats(stats);
    } catch (reason) {
      if (requestId === conversationListRequestRef.current)
        setListError(reason instanceof Error ? reason.message : 'No se pudieron cargar las conversaciones.');
    } finally {
      if (requestId === conversationListRequestRef.current) setListLoading(false);
    }
  }

  async function markAllRead() {
    if (markAllReadBusy || !conversationStats?.unreadMessages) return;
    setMarkAllReadBusy(true);
    setListError(null);
    try {
      const result = await api<{
        contactsUpdated: number;
        messagesMarkedRead: number;
        stats: ConversationStats;
      }>('/api/conversations/read-all', { method: 'POST' });
      setConversationStats(result.stats);
      setConversations(prev => filter === 'unread' ? [] : prev.map(row => ({ ...row, unreadCount: 0 })));
      await loadConversations();
    } catch (reason) {
      setListError(reason instanceof Error ? reason.message : 'No se pudieron marcar las conversaciones como leídas.');
    } finally {
      setMarkAllReadBusy(false);
    }
  }

  useEffect(() => {
    if (authenticated) void loadConversations();
  }, [authenticated, search, filter, analyticsNoMenuFilter]);

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
  }, [authenticated, search, filter, analyticsNoMenuFilter, notifications]);

  // ── Select conversation ──
  async function selectConversation(id: string) {
    setView('inbox');
    setSidebarOpen(false);
    setSelectedId(id);
    setInfoOpen(false);
    setQuote(null);
    setMessages([]);
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
    const detailPromise = api<ConversationDetail>(`/api/conversations/${selectedId}`).then(conv => {
      if (alive) setDetail(conv);
    });
    const historyPromise = (async () => {
      let allMessages: Message[] = [];
      let nextBefore: string | null = null;
      const seenCursors = new Set<string>();
      do {
        const suffix: string = nextBefore ? `&before=${encodeURIComponent(nextBefore)}` : '';
        const history: { items: Message[]; nextBefore: string | null } = await api<{ items: Message[]; nextBefore: string | null }>(
          `/api/conversations/${selectedId}/messages?limit=100${suffix}`,
        );
        if (!alive) return;
        allMessages = mergeMessages(history.items, allMessages);
        setMessages(previous => {
          const merged = mergeMessages(allMessages, previous);
          messageIdsRef.current = new Set(merged.map(message => message.id));
          return merged;
        });
        nextBefore = history.nextBefore;
        if (nextBefore) {
          if (seenCursors.has(nextBefore)) throw new Error('El historial devolvió una página repetida.');
          seenCursors.add(nextBefore);
        }
      } while (nextBefore);
      requestAnimationFrame(() => {
        if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      });
    })();
    void Promise.all([detailPromise, historyPromise]).catch(reason => {
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
          setMessages(previous => {
            const merged = mergeMessages(previous, r.items);
            messageIdsRef.current = new Set(merged.map(message => message.id));
            return merged;
          });
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
        mediaFilename: asset?.filename, mediaSize: asset?.size,
        caption: asset && asset.mediaType !== 'audio' ? body.trim() : undefined,
        quoteMessageId,
      }),
    });
    setQuote(null);
    await reloadMessages(true);
  }

  async function reloadMessages(stick = false) {
    if (!selectedId) return;
    const result = await api<{ items: Message[]; nextBefore: string | null }>(`/api/conversations/${selectedId}/messages?limit=100`);
    setMessages(previous => {
      const merged = mergeMessages(previous, result.items);
      messageIdsRef.current = new Set(merged.map(message => message.id));
      return merged;
    });
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

  function navigate(viewToOpen: View, options?: { analyticsNoMenuFilter?: { from: string; to: string } | null }) {
    // Apply analytics filter when navigating to inbox from analytics KPI
    if (options?.analyticsNoMenuFilter !== undefined) {
      setAnalyticsNoMenuFilter(options.analyticsNoMenuFilter);
    } else if (viewToOpen === 'inbox') {
      // Clear analytics filter when navigating to inbox normally (no filter options passed)
      setAnalyticsNoMenuFilter(null);
    }
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
        unread={conversationStats?.unreadMessages ?? conversations.reduce((s, r) => s + (r.unreadCount || 0), 0)}
        sidebarOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(value => !value)}
      />
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Cerrar navegación" onClick={() => setSidebarOpen(false)} />}

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
              {analyticsNoMenuFilter && (
                <div className="analytics-filter-banner" role="status">
                  <span className="analytics-filter-banner-text">
                    🔍 Contactos sin menú · {analyticsNoMenuFilter.from.slice(0, 10)} → {analyticsNoMenuFilter.to.slice(0, 10)}
                  </span>
                  <button
                    type="button"
                    className="analytics-filter-banner-clear"
                    onClick={() => setAnalyticsNoMenuFilter(null)}
                    aria-label="Quitar filtro de analíticas"
                  >
                    ✕ Quitar filtro
                  </button>
                </div>
              )}
              <ConversationList
                items={conversations}
                selectedId={selectedId}
                loading={listLoading}
                stats={conversationStats}
                markAllBusy={markAllReadBusy}
                error={listError}
                search={searchDraft}
                filter={filter}
                onSearch={setSearchDraft}
                onFilter={setFilter}
                onMarkAllRead={() => void markAllRead()}
                onSelect={id => void selectConversation(id)}
                onRetry={() => void loadConversations()}
              />
            </aside>

            <Chat
              detail={detail}
              messages={messages}
              loading={messagesLoading}
              error={messagesError}
              newMessages={newMessages}
              messagesRef={messagesRef}
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
