import { useSheetFocus } from './useSheetFocus';
import { useEffect, useMemo, useState } from 'react';
import { api, cachedApi, formatDate, formatDateOnly, initials, invalidateApi } from './api';
import AnalyticsView from './AnalyticsView';
import type {
  AnalyticsPeriodKey,
  BotAnalyticsData,
  Contact,
  ContactWithoutMenuItem,
  DashboardData,
  MenuOptionStat,
  SupportTicket,
  UnrecognizedMessageItem,
  UnrecognizedPattern,
} from './types';

type SecondaryView = 'dashboard' | 'analytics' | 'contacts' | 'orders' | 'tickets' | 'templates';
type Paged<T> = { items: T[]; total: number; page: number; limit: number };

const stages: Record<string, { label: string; tone: string }> = {
  new: { label: 'Nueva', tone: 'tone-blue' },
  in_attention: { label: 'En atención', tone: 'tone-amber' },
  follow_up: { label: 'Seguimiento', tone: 'tone-purple' },
  order_received: { label: 'Pedido recibido', tone: 'tone-emerald' },
  won: { label: 'Ganada', tone: 'tone-green' },
  lost: { label: 'Perdida', tone: 'tone-rose' },
};

const orderStates: Record<string, { label: string; tone: string }> = {
  pending_customer: { label: 'Esperando cliente', tone: 'tone-amber' },
  submitted: { label: 'Enviado', tone: 'tone-blue' },
  accepted: { label: 'Aceptado', tone: 'tone-emerald' },
  canceled: { label: 'Cancelado', tone: 'tone-rose' },
};

const closureNames: Record<string, string> = {
  order_completed: 'Pedido finalizado',
  question_answered: 'Consulta respondida',
  customer_no_reply: 'Sin respuesta',
  operator_cancelled: 'Cancelado',
  fallback_sent: 'Link enviado',
  answered: 'Respondido',
};

function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function cleanName(value?: string | null, fallback = 'Sin nombre') {
  const name = String(value || '').trim();
  if (!name || /^Pedido #[0-9a-f-]{16,}$/i.test(name)) return fallback;
  return name;
}

function pageCount(total: number, limit: number) {
  return Math.max(1, Math.ceil(total / limit));
}

/* ═══════════════════════════════════════════════════════
   SVG ICONS HELPER
   ═══════════════════════════════════════════════════════ */
function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  switch (name) {
    case 'search':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      );
    case 'filter':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      );
    case 'download':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case 'plus':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'chat':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case 'copy':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case 'check':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'trash':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
        </svg>
      );
    case 'package':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
      );
    case 'help':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'users':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'clock':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'server':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
      );
    case 'analytics':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="13" width="4" height="8" rx="1" /><rect x="10" y="8" width="4" height="13" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" />
        </svg>
      );
    case 'calendar':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case 'alert-triangle':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case 'trending-up':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
        </svg>
      );
    case 'phone':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case 'refresh':
      return (
        <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      );
    default:
      return null;
  }
}

/* ═══════════════════════════════════════════════════════
   PAGINATION
   ═══════════════════════════════════════════════════════ */
function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (page: number) => void }) {
  const pages = pageCount(total, limit);
  const startItem = total === 0 ? 0 : page * limit + 1;
  const endItem = Math.min((page + 1) * limit, total);

  return (
    <footer className="table-footer">
      <div className="table-footer-info">
        <span>Mostrando <strong>{startItem}–{endItem}</strong> de <strong>{total.toLocaleString('es-AR')}</strong> registros</span>
      </div>
      <div className="table-footer-controls">
        <button className="button secondary sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          ← Anterior
        </button>
        <span className="page-indicator">Página {page + 1} de {pages}</span>
        <button className="button secondary sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Siguiente →
        </button>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════
   STATE HANDLERS
   ═══════════════════════════════════════════════════════ */
function ViewState({ loading, error, empty, onRetry }: { loading: boolean; error: string; empty: boolean; onRetry: () => void }) {
  if (loading) {
    return (
      <div className="view-state">
        <div className="state-icon-wrap">
          <span className="spinner large" />
        </div>
        <strong>Cargando información comercial…</strong>
        <p>Obteniendo los registros actualizados en tiempo real.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="view-state error">
        <div className="state-icon-wrap error-icon">!</div>
        <strong>No se pudo cargar la vista</strong>
        <p>{error}</p>
        <button className="button primary sm" onClick={onRetry}>Reintentar conexión</button>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="view-state">
        <div className="state-icon-wrap">
          <Icon name="search" size={24} />
        </div>
        <strong>No se encontraron resultados</strong>
        <p>Probá ajustando el término de búsqueda o cambiando los filtros seleccionados.</p>
      </div>
    );
  }
  return null;
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD (RESUMEN)
   ═══════════════════════════════════════════════════════ */
function Dashboard({ onNavigate }: { onNavigate: (view: SecondaryView | 'inbox') => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    void cachedApi<DashboardData>('/api/dashboard', 15_000)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Error desconocido'));
  };

  useEffect(load, []);

  if (!data) return <ViewState loading={!error} error={error} empty={false} onRetry={load} />;

  const work = data.work || {};
  const totalContacts = Number(data.stats?.total ?? 0);
  const healthy = Boolean(data.worker?.healthy && !Number(data.failures?.failedMessages || 0) && !data.queue?.failed);

  return (
    <div className="dashboard-layout">
      {/* Hero Welcome Banner */}
      <section className="dashboard-hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="pulse-dot" /> Operación Comercial en Vivo
          </div>
          <h2>Panel de Control & Actividad Comercial</h2>
          <p>Supervisión en tiempo real de consultas, pedidos de WhatsApp y salud operativa de AbastoBot.</p>
        </div>
        <div className="hero-actions">
          <button className="button primary hero-btn" onClick={() => onNavigate('inbox')}>
            <Icon name="chat" size={16} />
            <span>Ir a Conversaciones</span>
            {Number(work.unread || 0) > 0 && <span className="hero-pill">{work.unread}</span>}
          </button>
        </div>
      </section>

      {/* KPI Cards Grid */}
      <section className="dashboard-metrics" aria-label="Métricas Principales">
        <article className="stat-card" onClick={() => onNavigate('inbox')}>
          <div className="stat-header">
            <span className="stat-label">Conversaciones sin leer</span>
            <span className="stat-icon-wrap emerald"><Icon name="chat" size={18} /></span>
          </div>
          <div className="stat-body">
            <strong className="stat-value">{Number(work.unread || 0).toLocaleString('es-AR')}</strong>
            <span className="stat-hint">
              {Number(work.unread || 0) > 0 ? '⚠️ Requieren atención del equipo' : '✓ Todas respondidas al día'}
            </span>
          </div>
          <div className="stat-footer">
            <span>Abrir bandeja</span>
            <Icon name="arrow-right" size={13} />
          </div>
        </article>

        <article className="stat-card" onClick={() => onNavigate('contacts')}>
          <div className="stat-header">
            <span className="stat-label">Base de Contactos</span>
            <span className="stat-icon-wrap blue"><Icon name="users" size={18} /></span>
          </div>
          <div className="stat-body">
            <strong className="stat-value">{totalContacts.toLocaleString('es-AR')}</strong>
            <span className="stat-hint">{data.stats?.optedIn ? `${data.stats.optedIn} clientes consentidos` : 'Clientes registrados en CRM'}</span>
          </div>
          <div className="stat-footer">
            <span>Ver contactos</span>
            <Icon name="arrow-right" size={13} />
          </div>
        </article>

        <article className="stat-card" onClick={() => onNavigate('contacts')}>
          <div className="stat-header">
            <span className="stat-label">Seguimientos Vencidos</span>
            <span className="stat-icon-wrap amber"><Icon name="clock" size={18} /></span>
          </div>
          <div className="stat-body">
            <strong className="stat-value">{Number(work.overdueFollowUps || 0).toLocaleString('es-AR')}</strong>
            <span className="stat-hint">
              {Number(work.overdueFollowUps || 0) > 0 ? 'Recordatorios comerciales pendientes' : 'Sin seguimientos vencidos'}
            </span>
          </div>
          <div className="stat-footer">
            <span>Gestionar pipeline</span>
            <Icon name="arrow-right" size={13} />
          </div>
        </article>

        <article className="stat-card" onClick={() => onNavigate('orders')}>
          <div className="stat-header">
            <span className="stat-label">Pedidos Recibidos</span>
            <span className="stat-icon-wrap orange"><Icon name="package" size={18} /></span>
          </div>
          <div className="stat-body">
            <strong className="stat-value">{Number(work.newOrders || 0).toLocaleString('es-AR')}</strong>
            <span className="stat-hint">Registrados en la plataforma</span>
          </div>
          <div className="stat-footer">
            <span>Revisar pedidos</span>
            <Icon name="arrow-right" size={13} />
          </div>
        </article>
      </section>

      {/* Operations & System Split Section */}
      <div className="dashboard-split">
        {/* Operations Attention Card */}
        <section className="dash-card operations-card">
          <div className="dash-card-header">
            <div>
              <span className="section-kicker">Flujo de Trabajo</span>
              <h3>Prioridades de Atención Comercial</h3>
            </div>
            <span className="card-badge">Resumen</span>
          </div>
          <div className="operations-list">
            <div className="op-item" onClick={() => onNavigate('inbox')}>
              <div className="op-bullet emerald" />
              <div className="op-info">
                <strong>Mensajes Nuevos Sin Responder</strong>
                <span>Clientes esperando respuesta en la bandeja oficial.</span>
              </div>
              <span className="op-count">{work.unread || 0}</span>
            </div>

            <div className="op-item" onClick={() => onNavigate('tickets')}>
              <div className="op-bullet blue" />
              <div className="op-info">
                <strong>Consultas / Tickets Activos</strong>
                <span>Tickets de soporte y preguntas comerciales en curso.</span>
              </div>
              <span className="op-action-link">Ver tickets →</span>
            </div>

            <div className="op-item" onClick={() => onNavigate('orders')}>
              <div className="op-bullet orange" />
              <div className="op-info">
                <strong>Pedidos en Preparación / Enviados</strong>
                <span>Seguimiento de pedidos tomados automáticamente por WhatsApp.</span>
              </div>
              <span className="op-action-link">Ver lista →</span>
            </div>
          </div>
        </section>

        {/* Infrastructure & Services Card */}
        <section className="dash-card system-health-card">
          <div className="dash-card-header">
            <div>
              <span className="section-kicker">Infraestructura Hostinger VPS</span>
              <h3>Estado de Servicios & Conexiones</h3>
            </div>
            <span className={`status-pill ${healthy ? 'ok' : 'warn'}`}>
              <i /> {healthy ? 'Operativo' : 'Requiere Revisión'}
            </span>
          </div>

          <div className="system-nodes-grid">
            <div className="node-item">
              <div className="node-top">
                <span className="node-dot green" />
                <span className="node-title">WhatsApp Cloud</span>
              </div>
              <strong className="node-value">{data.cloudReady ? 'Conectado (Meta API)' : 'Sin credenciales'}</strong>
              <small className="node-sub">Transporte oficial activo</small>
            </div>

            <div className="node-item">
              <div className="node-top">
                <span className={`node-dot ${data.worker?.healthy ? 'green' : 'amber'}`} />
                <span className="node-title">Worker Asíncrono</span>
              </div>
              <strong className="node-value">{data.worker?.healthy ? 'Saludable & Activo' : 'Sin latido'}</strong>
              <small className="node-sub">Colas y mensajería en segundo plano</small>
            </div>

            <div className="node-item">
              <div className="node-top">
                <span className="node-dot blue" />
                <span className="node-title">Cola de Envíos</span>
              </div>
              <strong className="node-value">{data.queue?.pending || 0} pendientes</strong>
              <small className="node-sub">Procesando: {data.queue?.processing || 0}</small>
            </div>

            <div className="node-item">
              <div className="node-top">
                <span className={`node-dot ${Number(data.failures?.failedMessages || 0) === 0 ? 'green' : 'rose'}`} />
                <span className="node-title">Tasa de Errores</span>
              </div>
              <strong className="node-value">{Number(data.failures?.failedMessages || 0) + Number(data.queue?.failed || 0)} fallidos</strong>
              <small className="node-sub">Monitoreo continuo de webhooks</small>
            </div>

            <div className="node-item">
              <div className="node-top">
                <span className={`node-dot ${data.mediaStorage?.healthy ? 'green' : 'amber'}`} />
                <span className="node-title">Multimedia (R2 / S3)</span>
              </div>
              <strong className="node-value">{data.mediaStorage?.healthy ? 'Disponible' : 'Con error'}</strong>
              <small className="node-sub">Almacenamiento Cloudflare R2</small>
            </div>

            <div className="node-item">
              <div className="node-top">
                <span className="node-dot green" />
                <span className="node-title">Backups & WAL-G</span>
              </div>
              <strong className="node-value">{data.backup?.completedAt ? formatDate(data.backup.completedAt, true) : 'Sincronizado'}</strong>
              <small className="node-sub">Replicación física continua</small>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ANALYTICS (ANALÍTICAS DE COMPORTAMIENTO DEL BOT)
   ═══════════════════════════════════════════════════════ */
function Analytics({
  onOpenContact,
  onNavigate,
}: {
  onOpenContact: (id: string) => void;
  onNavigate: (view: SecondaryView | 'inbox', options?: { analyticsNoMenuFilter?: { from: string; to: string } | null }) => void;
}) {
  return <AnalyticsView onOpenContact={onOpenContact} onNavigate={onNavigate} />;
}

/* ═══════════════════════════════════════════════════════
   TICKETS VIEW
   ═══════════════════════════════════════════════════════ */
function Tickets({ onOpen }: { onOpen: (id: string) => void }) {
  const limit = 25;
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<Paged<SupportTicket> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const debounced = useDebounced(search);
  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (debounced) p.set('q', debounced);
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    return `/api/tickets?${p}`;
  }, [page, debounced, type, status]);

  const load = () => {
    setLoading(true);
    setError('');
    void cachedApi<Paged<SupportTicket>>(url)
      .then(setResult)
      .catch(e => setError(e instanceof Error ? e.message : 'Error desconocido'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [url]);
  useEffect(() => setPage(0), [debounced, type, status]);

  return (
    <div className="data-page">
      {/* Control Toolbar */}
      <div className="view-toolbar">
        <div className="toolbar-search-wrap">
          <Icon name="search" size={16} className="search-icon" />
          <input
            className="toolbar-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por cliente, consulta o teléfono..."
            aria-label="Buscar tickets"
          />
          {search && (
            <button className="clear-btn" onClick={() => setSearch('')} title="Limpiar búsqueda">×</button>
          )}
        </div>

        <div className="toolbar-filters">
          <div className="select-wrap">
            <select value={type} onChange={e => setType(e.target.value)} aria-label="Tipo de ticket">
              <option value="">Todos los tipos</option>
              <option value="question">Preguntas</option>
              <option value="order">Pedidos</option>
            </select>
          </div>

          <div className="select-wrap">
            <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado del ticket">
              <option value="">Todos los estados</option>
              <option value="open">Abiertos</option>
              <option value="responded">Respondidos</option>
              <option value="closed">Cerrados</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="data-card">
        <ViewState loading={loading} error={error} empty={!loading && !error && !result?.items.length} onRetry={load} />

        {!loading && result?.items.length ? (
          <>
            <div className="table-responsive">
              <table className="modern-table ticket-table-grid">
                <thead>
                  <tr>
                    <th style={{ width: '130px' }}>Tipo</th>
                    <th>Contacto & Consulta</th>
                    <th style={{ width: '180px' }}>Estado</th>
                    <th style={{ width: '170px' }}>Actualizado</th>
                    <th style={{ width: '110px', textAlign: 'right' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map(ticket => {
                    const isOrder = ticket.ticketType === 'order';
                    const cName = cleanName(ticket.contactName || ticket.publicName, ticket.phone || 'Sin nombre');
                    const displayStatusText = closureNames[ticket.closureReason || ''] || (ticket.displayStatus === 'closed' ? 'Cerrado' : ticket.displayStatus === 'responded' ? 'Respondido' : 'Abierto');
                    const statusTone = ticket.displayStatus === 'closed' ? 'neutral' : ticket.displayStatus === 'responded' ? 'emerald' : 'amber';

                    return (
                      <tr key={ticket.id} className="interactive-row" onClick={() => onOpen(ticket.contactId)}>
                        <td data-label="Tipo">
                          <span className={`chip-badge ${isOrder ? 'chip-orange' : 'chip-purple'}`}>
                            <Icon name={isOrder ? 'package' : 'help'} size={12} />
                            <span>{isOrder ? 'Pedido' : 'Pregunta'}</span>
                          </span>
                        </td>
                        <td data-label="Contacto y consulta">
                          <div className="cell-primary">
                            <strong className="cell-title">{cName}</strong>
                            <p className="cell-subtitle">{ticket.question || ticket.lastMessage || 'Sin mensaje de consulta'}</p>
                            {ticket.phone && <small className="cell-extra">{ticket.phone}</small>}
                          </div>
                        </td>
                        <td data-label="Estado">
                          <span className={`chip-badge chip-${statusTone}`}>
                            <span className="dot" />
                            <span>{displayStatusText}</span>
                          </span>
                        </td>
                        <td data-label="Actualizado">
                          <time className="cell-time">{formatDate(ticket.updatedAt || ticket.createdAt, true)}</time>
                        </td>
                        <td data-label="Acciones" style={{ textAlign: 'right' }}>
                          <button
                            className="button secondary sm action-cell-btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(ticket.contactId);
                            }}
                          >
                            <span>Atender</span>
                            <Icon name="arrow-right" size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={result.total} limit={limit} onPage={setPage} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CONTACTS (CRM VIEW)
   ═══════════════════════════════════════════════════════ */
function Contacts({ onOpen }: { onOpen: (id: string) => void }) {
  const inquiryOptions = [
    ['horarios', 'Horarios', 'chip-emerald'], ['direccion', 'Dirección', 'tone-blue'],
    ['lista_precio', 'Precios', 'chip-purple'], ['hacer_pedido', 'Nuevo Pedido', 'chip-amber'],
    ['asesor', 'Asesor Humano', 'chip-rose'], ['preguntas_frecuentes', 'Preguntas frecuentes', 'chip-purple'],
    ['no_reconocidas', 'No reconocidas', 'chip-neutral'],
  ];
  const [inquiry, setInquiry] = useState('');
  const limit = 25;
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [consent, setConsent] = useState('');
  const [result, setResult] = useState<Paged<Contact> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const debounced = useDebounced(search);
  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (debounced) p.set('q', debounced);
    if (consent) p.set('consent', consent);
    if (inquiry) p.set('inquiry', inquiry);
    return `/api/contacts?${p}`;
  }, [page, debounced, consent, inquiry]);

  const exportUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('q', debounced);
    if (consent) p.set('consent', consent);
    if (inquiry) p.set('inquiry', inquiry);
    return `/api/contacts/export?${p}`;
  }, [debounced, consent, inquiry]);

  const load = () => {
    setLoading(true);
    setError('');
    void cachedApi<Paged<Contact>>(url)
      .then(setResult)
      .catch(e => setError(e instanceof Error ? e.message : 'Error desconocido'))
      .finally(() => setLoading(false));
  };

  async function removeContact(contact: Contact) {
    const label = cleanName(contact.name || contact.publicName, contact.phone);
    if (!window.confirm(`¿Estás seguro de borrar a ${label}? También se eliminará su historial del panel. Esta acción no se puede deshacer.`)) return;
    setDeleting(contact.id);
    setError('');
    try {
      await api(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: 'DELETE' });
      invalidateApi('/api/contacts');
      if (result?.items.length === 1 && page > 0) setPage(current => current - 1);
      else load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo borrar el contacto.');
    } finally {
      setDeleting(null);
    }
  }

  useEffect(load, [url]);
  useEffect(() => setPage(0), [debounced, consent, inquiry]);

  return (
    <div className="data-page">
      {/* Control Toolbar */}
      <div className="view-toolbar">
        <div className="toolbar-search-wrap">
          <Icon name="search" size={16} className="search-icon" />
          <input
            className="toolbar-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, teléfono o etiqueta..."
            aria-label="Buscar contactos"
          />
          {search && (
            <button className="clear-btn" onClick={() => setSearch('')} title="Limpiar búsqueda">×</button>
          )}
        </div>

        <div className="toolbar-filters">
          <div className="select-wrap">
            <select value={inquiry} onChange={e => setInquiry(e.target.value)} aria-label="Tipo de consulta">
              <option value="">Todos los tipos de consulta</option>
              {inquiryOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className="select-wrap">
            <select value={consent} onChange={e => setConsent(e.target.value)} aria-label="Consentimiento">
              <option value="">Todo consentimiento</option>
              <option value="opted_in">Consentidos (Opt-in)</option>
              <option value="unknown">Sin confirmar</option>
              <option value="opted_out">Excluidos (Opt-out)</option>
            </select>
          </div>

          <a className="button secondary" href={exportUrl} download="contactos-abastobot.csv">
            <Icon name="download" size={14} />
            <span>Exportar CSV</span>
          </a>

          <button className="button primary" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={14} />
            <span>Nuevo Contacto</span>
          </button>
        </div>
      </div>

      <p className="muted">Consultas del historial registrado. Un contacto puede tener varios tipos de consulta.</p>
      {/* Main Table Card */}
      <div className="data-card">
        <ViewState loading={loading} error={error} empty={!loading && !error && !result?.items.length} onRetry={load} />

        {!loading && result?.items.length ? (
          <>
            <div className="table-responsive">
              <table className="modern-table contact-table-grid">
                <thead>
                  <tr>
                    <th>Cliente / Contacto</th>
                    <th>Tipos de consulta</th>
                    <th style={{ width: '170px' }}>Pipeline</th>
                    <th style={{ width: '160px' }}>Modo Bot</th>
                    <th style={{ width: '200px' }}>Etiquetas</th>
                    <th style={{ width: '160px' }}>Última Actividad</th>
                    <th style={{ width: '120px', textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map(contact => {
                    const cName = cleanName(contact.name || contact.publicName, contact.phone);
                    const stageConfig = stages[contact.pipelineStatus] || { label: 'Nueva', tone: 'tone-blue' };

                    return (
                      <tr key={contact.id} className="interactive-row" onClick={() => onOpen(contact.id)}>
                        <td data-label="Cliente">
                          <div className="contact-meta-cell">
                            <span className="avatar mini-avatar">{initials(contact)}</span>
                            <div className="cell-primary">
                              <strong className="cell-title">{cName}</strong>
                              <small className="cell-subtitle mono-phone">{contact.phone}</small>
                            </div>
                          </div>
                        </td>
                        <td data-label="Tipos de consulta">
                          <div className="tags-container">
                            {contact.inquiryTypes?.length ? inquiryOptions.filter(([id]) => contact.inquiryTypes?.includes(id)).map(([id, label, tone]) => {
                              const rawCount = contact.inquiryCounts?.[id];
                              const count = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1;
                              return (
                                <span
                                  key={id}
                                  className={`chip-badge ${tone}`}
                                  title={count > 1 ? `${label}: consultado ${count} veces` : label}
                                >
                                  <span>{label}</span>
                                  {count > 1 && (
                                    <span className="chip-count" aria-label={`Consultado ${count} veces`}>
                                      ×{count}
                                    </span>
                                  )}
                                </span>
                              );
                            }) : <span className="tag-empty">Sin consultas registradas</span>}
                          </div>
                        </td>
                        <td data-label="Etapa comercial">
                          <span className={`chip-badge ${stageConfig.tone}`}>
                            <span className="dot" />
                            <span>{stageConfig.label}</span>
                          </span>
                        </td>
                        <td data-label="Atención">
                          <span className={`chip-badge ${contact.botPaused ? 'chip-amber' : 'chip-emerald'}`}>
                            <span>{contact.botPaused ? '👤 Atención humana' : '🤖 Bot activo'}</span>
                          </span>
                        </td>
                        <td data-label="Etiquetas">
                          <div className="tags-container">
                            {contact.labels?.length ? (
                              contact.labels.slice(0, 3).map(label => (
                                <span className="tag-pill" key={label}>{label}</span>
                              ))
                            ) : (
                              <span className="tag-empty">Sin etiquetas</span>
                            )}
                          </div>
                        </td>
                        <td data-label="Última actividad">
                          <time className="cell-time">{formatDate(contact.lastMessageAt, true)}</time>
                        </td>
                        <td data-label="Acciones" style={{ textAlign: 'right' }}>
                          <div className="row-actions-group" onClick={e => e.stopPropagation()}>
                            <button
                              className="button secondary sm icon-only"
                              title="Abrir chat"
                              onClick={() => onOpen(contact.id)}
                            >
                              <Icon name="chat" size={13} />
                            </button>
                            <button
                              className="button secondary sm icon-only danger-hover"
                              title="Borrar contacto"
                              disabled={deleting === contact.id}
                              onClick={() => void removeContact(contact)}
                            >
                              <Icon name="trash" size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={result.total} limit={limit} onPage={setPage} />
          </>
        ) : null}
      </div>

      {showCreate && (
        <ContactCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={contact => {
            setShowCreate(false);
            void load();
            onOpen(contact.id);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ORDERS (PEDIDOS VIEW)
   ═══════════════════════════════════════════════════════ */
type OrderItem = { name?: string; product?: string; quantity?: number | string; price?: number | string };
type OrderRow = {
  id: number;
  contactId: string | null;
  customerName: string;
  detail: string;
  items?: OrderItem[];
  grandTotal?: number | string;
  status: string;
  accepted?: boolean;
  acceptedAt?: string | null;
  createdAt: string;
  phone: string;
};

function Orders({ onOpenContact }: { onOpenContact?: (id: string) => void }) {
  const limit = 25;
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<Paged<OrderRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<OrderRow | null>(null);

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) p.set('status', status);
    return `/api/orders?${p}`;
  }, [page, status]);

  const load = () => {
    setLoading(true);
    setError('');
    void cachedApi<Paged<OrderRow>>(url)
      .then(setResult)
      .catch(e => setError(e instanceof Error ? e.message : 'Error desconocido'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [url]);
  useEffect(() => setPage(0), [status]);

  return (
    <div className="data-page">
      {/* Control Toolbar */}
      <div className="view-toolbar">
        <div className="status-tab-bar">
          {[
            { id: '', label: 'Todos los pedidos' },
            { id: 'submitted', label: 'Enviados' },
            { id: 'accepted', label: 'Aceptados' },
            { id: 'pending_customer', label: 'Esperando cliente' },
            { id: 'canceled', label: 'Cancelados' },
          ].map(tab => (
            <button
              key={tab.id}
              className={`status-tab ${status === tab.id ? 'active' : ''}`}
              onClick={() => setStatus(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table Card */}
      <div className="data-card">
        <ViewState loading={loading} error={error} empty={!loading && !error && !result?.items.length} onRetry={load} />

        {!loading && result?.items.length ? (
          <>
            <div className="table-responsive">
              <table className="modern-table order-table-grid">
                <thead>
                  <tr>
                    <th style={{ width: '100px' }}>Pedido</th>
                    <th style={{ width: '220px' }}>Cliente</th>
                    <th>Detalle de Productos</th>
                    <th style={{ width: '160px' }}>Monto Total</th>
                    <th style={{ width: '170px' }}>Estado</th>
                    <th style={{ width: '160px' }}>Fecha</th>
                    <th style={{ width: '110px', textAlign: 'right' }}>Ficha</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map(order => {
                    const cName = cleanName(order.customerName, order.phone);
                    const stateConfig = orderStates[order.status] || { label: order.status, tone: 'tone-blue' };
                    const totalNum = Number(order.grandTotal || 0);

                    return (
                      <tr key={order.id} className="interactive-row" onClick={() => setSelected(order)}>
                        <td data-label="Pedido">
                          <span className="order-tag-id">#{order.id}</span>
                        </td>
                        <td data-label="Cliente">
                          <div className="cell-primary">
                            <strong className="cell-title">{cName}</strong>
                            <small className="cell-subtitle mono-phone">{order.phone}</small>
                          </div>
                        </td>
                        <td data-label="Productos">
                          <div className="order-detail-snippet">
                            {order.detail || 'Sin detalle de productos especificado.'}
                          </div>
                        </td>
                        <td data-label="Monto total">
                          <strong className="order-total-highlight">
                            {totalNum > 0 ? totalNum.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' }) : '—'}
                          </strong>
                        </td>
                        <td data-label="Estado">
                          <span className={`chip-badge ${stateConfig.tone}`}>
                            <span className="dot" />
                            <span>{stateConfig.label}</span>
                          </span>
                        </td>
                        <td data-label="Fecha">
                          <time className="cell-time">{formatDate(order.createdAt, true)}</time>
                        </td>
                        <td data-label="Acciones" style={{ textAlign: 'right' }}>
                          <button
                            className="button secondary sm action-cell-btn"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(order);
                            }}
                          >
                            <span>Ver orden</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} total={result.total} limit={limit} onPage={setPage} />
          </>
        ) : null}
      </div>

      {selected && (
        <OrderModal
          order={selected}
          onClose={() => setSelected(null)}
          onOpenChat={order => {
            if (order.contactId && onOpenContact) {
              setSelected(null);
              onOpenContact(order.contactId);
            }
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ORDER DETAIL MODAL
   ═══════════════════════════════════════════════════════ */
function OrderModal({
  order,
  onClose,
  onOpenChat,
}: {
  order: OrderRow;
  onClose: () => void;
  onOpenChat?: (order: OrderRow) => void;
}) {
  const modalRef = useSheetFocus(true, onClose);

  const total = Number(order.grandTotal || 0);
  const stateConfig = orderStates[order.status] || { label: order.status, tone: 'tone-blue' };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={modalRef} className="modal-sheet order-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
        {/* Sheet Header */}
        <header className="sheet-header">
          <div className="sheet-header-left">
            <div className="order-id-badge">
              <Icon name="package" size={16} />
              <span>Pedido #{order.id}</span>
            </div>
            <h2 id="order-modal-title">{cleanName(order.customerName, order.phone || 'Sin nombre')}</h2>
            <p className="mono-phone">{order.phone || 'Sin número de teléfono'}</p>
          </div>
          <button className="sheet-close-btn" aria-label="Cerrar detalle" onClick={onClose}>×</button>
        </header>

        {/* Status & Summary Badges */}
        <div className="sheet-summary-grid">
          <div className="summary-item">
            <span className="summary-label">Estado de la Orden</span>
            <span className={`chip-badge ${stateConfig.tone}`}>
              <span className="dot" />
              <span>{stateConfig.label}</span>
            </span>
          </div>

          <div className="summary-item">
            <span className="summary-label">Fecha de Recepción</span>
            <strong className="summary-value">{formatDate(order.createdAt, true)}</strong>
          </div>

          {order.acceptedAt && (
            <div className="summary-item">
              <span className="summary-label">Fecha de Aceptación</span>
              <strong className="summary-value">{formatDate(order.acceptedAt, true)}</strong>
            </div>
          )}

          {total > 0 && (
            <div className="summary-item grand-total-item">
              <span className="summary-label">Monto Total</span>
              <strong className="summary-total-amount">
                {total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}
              </strong>
            </div>
          )}
        </div>

        {/* Itemized Products List */}
        {order.items?.length ? (
          <div className="sheet-section">
            <span className="sheet-section-title">Detalle de Productos</span>
            <div className="order-items-table-wrap">
              <table className="order-items-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th style={{ width: '90px', textAlign: 'center' }}>Cantidad</th>
                    <th style={{ width: '120px', textAlign: 'right' }}>Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, index) => (
                    <tr key={index}>
                      <td>
                        <strong>{item.name || item.product || `Producto ${index + 1}`}</strong>
                      </td>
                      <td data-label="Cantidad" style={{ textAlign: 'center' }}>
                        <span className="qty-badge">{item.quantity ?? 1}</span>
                      </td>
                      <td data-label="Precio" style={{ textAlign: 'right' }}>
                        <span className="price-tag">{item.price ? `${item.price}` : '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Full Text / Notes from Customer */}
        <div className="sheet-section">
          <span className="sheet-section-title">Transcripción / Mensaje del Pedido</span>
          <div className="order-detail-box">
            {order.detail || 'Sin detalles informados en la orden.'}
          </div>
        </div>

        {/* Footer Actions */}
        <footer className="sheet-footer">
          {order.contactId && onOpenChat && (
            <button className="button secondary" onClick={() => onOpenChat(order)}>
              <Icon name="chat" size={14} />
              <span>Abrir Conversación</span>
            </button>
          )}
          <button className="button primary" onClick={onClose}>
            Entendido, cerrar
          </button>
        </footer>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   TEMPLATES (PLANTILLAS VIEW)
   ═══════════════════════════════════════════════════════ */
type TemplateRow = { id: string; metaName: string; language: string; category: string; body: string; status: string };

function Templates() {
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    void cachedApi<{ items: TemplateRow[] }>('/api/templates')
      .then(r => setItems(r.items))
      .catch(e => setError(e instanceof Error ? e.message : 'Error desconocido'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  function copyTemplate(item: TemplateRow) {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(item.body);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  return (
    <div className="data-page">
      {/* Notice Banner */}
      <div className="templates-banner">
        <div className="banner-left">
          <div className="wa-official-icon">
            <Icon name="chat" size={20} />
          </div>
          <div>
            <strong>Plantillas Oficiales de WhatsApp Cloud API</strong>
            <p>
              Mensajes homologados por Meta para iniciar conversaciones o responder clientes fuera de la ventana de 24 horas.
            </p>
          </div>
        </div>
      </div>

      <ViewState loading={loading} error={error} empty={!loading && !error && !items.length} onRetry={load} />

      {!loading && items.length ? (
        <div className="templates-grid">
          {items.map(item => (
            <article className="template-card-modern" key={item.id}>
              <div className="template-top">
                <div className="template-badges">
                  <span className="category-pill">{item.category || 'UTILITY'}</span>
                  <span className="lang-pill">{item.language}</span>
                </div>
                <span className="template-status-pill ok">
                  <Icon name="check" size={12} />
                  <span>{item.status || 'APPROVED'}</span>
                </span>
              </div>

              <div className="template-name-bar">
                <strong>{item.metaName}</strong>
              </div>

              {/* Message Bubble Preview */}
              <div className="template-preview-bubble">
                <p>{item.body}</p>
                <div className="bubble-tail" />
              </div>

              <div className="template-card-footer">
                <button
                  className="button secondary sm copy-template-btn"
                  onClick={() => copyTemplate(item)}
                >
                  <Icon name={copiedId === item.id ? 'check' : 'copy'} size={13} />
                  <span>{copiedId === item.id ? '¡Copiado!' : 'Copiar texto'}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   CONTACT CREATE MODAL
   ═══════════════════════════════════════════════════════ */
function ContactCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (contact: Contact) => void }) {
  const modalRef = useSheetFocus(true, onClose);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const contact = await api<Contact>('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({ phone, name }),
      });
      onCreated(contact);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el contacto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={modalRef} className="modal-sheet contact-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
        <header className="sheet-header">
          <div className="sheet-header-left">
            <span className="section-kicker">Base Comercial CRM</span>
            <h2 id="contact-modal-title">Nuevo Contacto</h2>
            <p>Registrá un nuevo cliente con su número de WhatsApp para iniciar conversaciones.</p>
          </div>
          <button className="sheet-close-btn" aria-label="Cerrar modal" onClick={onClose}>×</button>
        </header>

        <form onSubmit={submit} className="sheet-form">
          <div className="form-group">
            <label htmlFor="contact-phone">Número de WhatsApp (con código de país)</label>
            <input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={event => setPhone(event.target.value)}
              placeholder="Ej: 5493512345678"
            />
            <small className="form-helper">Formato internacional: 549 + código de área + número.</small>
          </div>

          <div className="form-group">
            <label htmlFor="contact-name">Nombre Comercial o del Cliente</label>
            <input
              id="contact-name"
              required
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Ej: Distribuidora Los Hermanos"
            />
          </div>

          {error && <div className="form-error-banner">{error}</div>}

          <footer className="sheet-footer">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? 'Guardando contacto…' : 'Guardar y Abrir'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN EXPORT
   ═══════════════════════════════════════════════════════ */
export default function SecondaryViews({
  view,
  onNavigate,
  onOpenContact,
}: {
  view: SecondaryView;
  onNavigate: (view: SecondaryView | 'inbox', options?: { analyticsNoMenuFilter?: { from: string; to: string } | null }) => void;
  onOpenContact: (id: string) => void;
}) {
  if (view === 'dashboard') return <Dashboard onNavigate={onNavigate} />;
  if (view === 'analytics') return <Analytics onOpenContact={onOpenContact} onNavigate={onNavigate} />;
  if (view === 'tickets') return <Tickets onOpen={onOpenContact} />;
  if (view === 'contacts') return <Contacts onOpen={onOpenContact} />;
  if (view === 'orders') return <Orders onOpenContact={onOpenContact} />;
  return <Templates />;
}
