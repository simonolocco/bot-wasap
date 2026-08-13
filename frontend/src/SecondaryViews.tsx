import { useEffect, useMemo, useState } from 'react';
import { cachedApi, formatDate, initials } from './api';
import type { Contact, DashboardData, SupportTicket } from './types';

type SecondaryView = 'dashboard' | 'contacts' | 'orders' | 'tickets' | 'templates';
type Paged<T> = { items: T[]; total: number; page: number; limit: number };

const stages: Record<string, string> = {
  new: 'Nueva', in_attention: 'En atención', follow_up: 'Seguimiento',
  order_received: 'Pedido recibido', won: 'Ganada', lost: 'Perdida',
};

const orderStates: Record<string, string> = {
  pending_customer: 'Esperando cliente', submitted: 'Enviado', canceled: 'Cancelado', accepted: 'Aceptado',
};

const closureNames: Record<string, string> = {
  order_completed: 'Pedido finalizado', question_answered: 'Consulta respondida',
  customer_no_reply: 'Sin respuesta', operator_cancelled: 'Cancelado', fallback_sent: 'Link enviado', answered: 'Respondido',
};

function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(id); }, [value, delay]);
  return debounced;
}

function cleanName(value?: string | null, fallback = 'Sin nombre') {
  const name = String(value || '').trim();
  if (!name || /^Pedido #[0-9a-f-]{16,}$/i.test(name)) return fallback;
  return name;
}

function pageCount(total: number, limit: number) { return Math.max(1, Math.ceil(total / limit)); }

function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (page: number) => void }) {
  const pages = pageCount(total, limit);
  return (
    <footer className="table-footer">
      <span>{total.toLocaleString('es-AR')} resultados</span>
      <div>
        <button className="button secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</button>
        <span>Página {page + 1} de {pages}</span>
        <button className="button secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Siguiente</button>
      </div>
    </footer>
  );
}

function ViewState({ loading, error, empty, onRetry }: { loading: boolean; error: string; empty: boolean; onRetry: () => void }) {
  if (loading) return <div className="view-state"><span className="spinner" /><strong>Cargando información…</strong></div>;
  if (error) return <div className="view-state error"><strong>No se pudo cargar</strong><p>{error}</p><button className="button secondary" onClick={onRetry}>Reintentar</button></div>;
  if (empty) return <div className="view-state"><strong>No hay resultados</strong><p>Probá cambiando la búsqueda o los filtros.</p></div>;
  return null;
}

function Dashboard({ onNavigate }: { onNavigate: (view: SecondaryView | 'inbox') => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const load = () => { setError(''); void cachedApi<DashboardData>('/api/dashboard', 15_000).then(setData).catch(e => setError(e instanceof Error ? e.message : 'Error desconocido')); };
  useEffect(load, []);
  if (!data) return <ViewState loading={!error} error={error} empty={false} onRetry={load} />;
  const work = data.work || {};
  const healthy = data.worker?.healthy && !Number(data.failures?.failedMessages || 0) && !data.queue?.failed;
  return (
    <div className="dashboard-grid">
      <section className="hero-card">
        <div><span className="section-kicker">Prioridades de hoy</span><h2>Tu operación, en una mirada</h2><p>Entrá directo a lo que necesita atención.</p></div>
        <button className="button primary" onClick={() => onNavigate('inbox')}>Abrir conversaciones</button>
      </section>
      <section className="metric-grid" aria-label="Métricas comerciales">
        {[
          ['Sin leer', work.unread || 0, 'conversaciones', 'inbox'],
          ['Nuevas', work.new || 0, 'por atender', 'contacts'],
          ['Seguimientos', work.overdueFollowUps || 0, 'vencidos', 'contacts'],
          ['Pedidos', work.newOrders || 0, 'nuevos', 'orders'],
        ].map(([label, value, hint, destination]) => (
          <button className="metric" key={label} onClick={() => onNavigate(destination as SecondaryView | 'inbox')}>
            <span>{label}</span><strong>{value}</strong><small>{hint}</small>
          </button>
        ))}
      </section>
      <section className="system-card">
        <div className="section-heading"><div><span className="section-kicker">Infraestructura</span><h3>Estado del sistema</h3></div><span className={`health-pill ${healthy ? 'ok' : 'warn'}`}><i />{healthy ? 'Operativo' : 'Revisar'}</span></div>
        <div className="health-grid">
          <article><span>WhatsApp</span><strong>{data.cloudReady ? 'Configurado' : 'Sin credenciales'}</strong></article>
          <article><span>Worker</span><strong>{data.worker?.healthy ? 'Activo' : 'Sin latido'}</strong></article>
          <article><span>Cola</span><strong>{data.queue?.pending || 0} pendientes</strong></article>
          <article><span>Fallidos</span><strong>{Number(data.failures?.failedMessages || 0) + Number(data.queue?.failed || 0)}</strong></article>
          <article><span>Multimedia</span><strong>{data.mediaStorage?.healthy ? 'Disponible' : 'Con error'}</strong></article>
          <article><span>Último backup</span><strong>{data.backup?.completedAt ? formatDate(data.backup.completedAt, true) : 'Sin registro'}</strong></article>
        </div>
      </section>
    </div>
  );
}

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
  const url = useMemo(() => { const p = new URLSearchParams({ page: String(page), limit: String(limit) }); if (debounced) p.set('q', debounced); if (type) p.set('type', type); if (status) p.set('status', status); return `/api/tickets?${p}`; }, [page, debounced, type, status]);
  const load = () => { setLoading(true); setError(''); void cachedApi<Paged<SupportTicket>>(url).then(setResult).catch(e => setError(e instanceof Error ? e.message : 'Error desconocido')).finally(() => setLoading(false)); };
  useEffect(load, [url]);
  useEffect(() => setPage(0), [debounced, type, status]);
  return <DataSurface title="Tickets" subtitle="Consultas y pedidos que requieren seguimiento" search={search} onSearch={setSearch} filters={<><select value={type} onChange={e => setType(e.target.value)} aria-label="Tipo de ticket"><option value="">Todos los tipos</option><option value="question">Preguntas</option><option value="order">Pedidos</option></select><select value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado del ticket"><option value="">Todos los estados</option><option value="open">Abiertos</option><option value="responded">Respondidos</option><option value="closed">Cerrados</option></select></>}>
    <ViewState loading={loading} error={error} empty={!loading && !error && !result?.items.length} onRetry={load} />
    {!loading && result?.items.length ? <><div className="data-table ticket-table"><div className="table-head"><span>Tipo</span><span>Contacto y mensaje</span><span>Estado</span><span>Actualizado</span></div>{result.items.map(ticket => <button className="table-row" key={ticket.id} onClick={() => onOpen(ticket.contactId)}><span><b className={`type-badge ${ticket.ticketType}`}>{ticket.ticketType === 'order' ? 'Pedido' : 'Pregunta'}</b></span><span className="primary-cell"><b>{cleanName(ticket.contactName || ticket.publicName, ticket.phone || 'Sin nombre')}</b><small>{ticket.question || ticket.lastMessage || 'Sin mensaje'}</small></span><span><b>{closureNames[ticket.closureReason || ''] || (ticket.displayStatus === 'closed' ? 'Cerrado' : ticket.displayStatus === 'responded' ? 'Respondido' : 'Abierto')}</b></span><time>{formatDate(ticket.updatedAt || ticket.createdAt, true)}</time></button>)}</div><Pager page={page} total={result.total} limit={limit} onPage={setPage} /></> : null}
  </DataSurface>;
}

function Contacts({ onOpen }: { onOpen: (id: string) => void }) {
  const limit = 25;
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [consent, setConsent] = useState('');
  const [result, setResult] = useState<Paged<Contact> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const debounced = useDebounced(search);
  const url = useMemo(() => { const p = new URLSearchParams({ page: String(page), limit: String(limit) }); if (debounced) p.set('q', debounced); if (consent) p.set('consent', consent); return `/api/contacts?${p}`; }, [page, debounced, consent]);
  const load = () => { setLoading(true); setError(''); void cachedApi<Paged<Contact>>(url).then(setResult).catch(e => setError(e instanceof Error ? e.message : 'Error desconocido')).finally(() => setLoading(false)); };
  useEffect(load, [url]); useEffect(() => setPage(0), [debounced, consent]);
  return <DataSurface title="Contactos" subtitle="Base comercial, actividad y estado de atención" search={search} onSearch={setSearch} filters={<select value={consent} onChange={e => setConsent(e.target.value)} aria-label="Consentimiento"><option value="">Todo consentimiento</option><option value="opted_in">Consentidos</option><option value="unknown">Sin confirmar</option><option value="opted_out">Excluidos</option></select>}>
    <ViewState loading={loading} error={error} empty={!loading && !error && !result?.items.length} onRetry={load} />
    {!loading && result?.items.length ? <><div className="data-table contact-table"><div className="table-head"><span>Contacto</span><span>Estado</span><span>Etiquetas</span><span>Última actividad</span></div>{result.items.map(contact => <button className="table-row" key={contact.id} onClick={() => onOpen(contact.id)}><span className="contact-cell"><i className="avatar mini">{initials(contact)}</i><span className="primary-cell"><b>{cleanName(contact.name || contact.publicName, contact.phone)}</b><small>{contact.phone}</small></span></span><span><b>{stages[contact.pipelineStatus] || 'Nueva'}</b><small>{contact.botPaused ? 'Atención humana' : 'Bot activo'}</small></span><span className="tag-cell">{contact.labels?.length ? contact.labels.slice(0, 2).map(label => <i key={label}>{label}</i>) : <small>Sin etiquetas</small>}</span><time>{formatDate(contact.lastMessageAt, true)}</time></button>)}</div><Pager page={page} total={result.total} limit={limit} onPage={setPage} /></> : null}
  </DataSurface>;
}

type OrderItem = { name?: string; product?: string; quantity?: number | string; price?: number | string };
type OrderRow = { id: number; contactId: string | null; customerName: string; detail: string; items?: OrderItem[]; grandTotal?: number | string; status: string; accepted?: boolean; acceptedAt?: string | null; createdAt: string; phone: string };
function Orders() {
  const limit = 25; const [page, setPage] = useState(0); const [status, setStatus] = useState('');
  const [result, setResult] = useState<Paged<OrderRow> | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [selected, setSelected] = useState<OrderRow | null>(null);
  const url = useMemo(() => { const p = new URLSearchParams({ page: String(page), limit: String(limit) }); if (status) p.set('status', status); return `/api/orders?${p}`; }, [page, status]);
  const load = () => { setLoading(true); setError(''); void cachedApi<Paged<OrderRow>>(url).then(setResult).catch(e => setError(e instanceof Error ? e.message : 'Error desconocido')).finally(() => setLoading(false)); };
  useEffect(load, [url]); useEffect(() => setPage(0), [status]);
  return <DataSurface title="Pedidos" subtitle="Seguimiento de pedidos recibidos por el bot" filters={<select value={status} onChange={e => setStatus(e.target.value)} aria-label="Estado del pedido"><option value="">Todos los estados</option><option value="pending_customer">Esperando cliente</option><option value="submitted">Enviados</option><option value="accepted">Aceptados</option><option value="canceled">Cancelados</option></select>}>
    <ViewState loading={loading} error={error} empty={!loading && !error && !result?.items.length} onRetry={load} />
    {!loading && result?.items.length ? <><div className="data-table order-table"><div className="table-head"><span>Pedido</span><span>Cliente</span><span>Detalle</span><span>Estado</span><span>Recibido</span></div>{result.items.map(order => <button className="table-row" key={order.id} onClick={() => setSelected(order)}><span><b>#{order.id}</b></span><span className="primary-cell"><b>{cleanName(order.customerName, order.phone)}</b><small>{order.phone}</small></span><span className="detail-cell">{order.detail || 'Sin detalle'}</span><span><b className={`order-state ${order.status}`}>{orderStates[order.status] || order.status}</b></span><time>{formatDate(order.createdAt, true)}</time></button>)}</div><Pager page={page} total={result.total} limit={limit} onPage={setPage} /></> : null}
    {selected && <OrderModal order={selected} onClose={() => setSelected(null)} />}
  </DataSurface>;
}

function OrderModal({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  useEffect(() => { const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  const total = Number(order.grandTotal || 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal order-modal" role="dialog" aria-modal="true" aria-labelledby="order-modal-title">
      <header className="order-modal-head"><div><span className="section-kicker">Pedido #{order.id}</span><h2 id="order-modal-title">{cleanName(order.customerName, order.phone || 'Sin nombre')}</h2><p>{order.phone || 'Sin tel\u00e9fono'}</p></div><button className="close-btn" aria-label="Cerrar detalle del pedido" onClick={onClose}>{'\u00d7'}</button></header>
      <div className="order-summary"><div><span>Estado</span><b className={`order-state ${order.status}`}>{orderStates[order.status] || order.status}</b></div><div><span>Recibido</span><b>{formatDate(order.createdAt, true)}</b></div>{order.acceptedAt && <div><span>Aceptado</span><b>{formatDate(order.acceptedAt, true)}</b></div>}{total > 0 && <div><span>Total</span><b>{total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</b></div>}</div>
      <div className="order-detail"><span>Detalle del pedido</span><p>{order.detail || 'Sin detalle informado.'}</p></div>
      {order.items?.length ? <div className="order-items"><span>Productos</span>{order.items.map((item, index) => <article key={index}><b>{item.name || item.product || `Producto ${index + 1}`}</b>{item.quantity != null && <small>Cantidad: {item.quantity}</small>}{item.price != null && <small>Precio: {item.price}</small>}</article>)}</div> : null}
      <footer className="modal-actions"><button className="button primary" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}

type TemplateRow = { id: string; metaName: string; language: string; category: string; body: string; status: string };
function Templates() {
  const [items, setItems] = useState<TemplateRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = () => { setLoading(true); setError(''); void cachedApi<{ items: TemplateRow[] }>('/api/templates').then(r => setItems(r.items)).catch(e => setError(e instanceof Error ? e.message : 'Error desconocido')).finally(() => setLoading(false)); };
  useEffect(load, []);
  return <DataSurface title="Plantillas" subtitle="Mensajes aprobados para iniciar conversaciones">
    <ViewState loading={loading} error={error} empty={!loading && !error && !items.length} onRetry={load} />
    {!loading && items.length ? <div className="template-grid">{items.map(item => <article className="template-card" key={item.id}><header><b>{item.metaName}</b><span className="status-chip">{item.status}</span></header><p>{item.body}</p><footer><span>{item.category}</span><span>{item.language}</span></footer></article>)}</div> : null}
  </DataSurface>;
}

function DataSurface({ title, subtitle, search, onSearch, filters, children }: { title: string; subtitle: string; search?: string; onSearch?: (value: string) => void; filters?: React.ReactNode; children: React.ReactNode }) {
  return <div className="data-surface"><header className="surface-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{(onSearch || filters) && <div className="surface-tools">{onSearch && <label className="surface-search"><span aria-hidden="true">⌕</span><input value={search} onChange={e => onSearch(e.target.value)} placeholder={`Buscar en ${title.toLowerCase()}`} aria-label={`Buscar en ${title}`} /></label>}{filters}</div>}</header><div className="surface-content">{children}</div></div>;
}

export default function SecondaryViews({ view, onNavigate, onOpenContact }: { view: SecondaryView; onNavigate: (view: SecondaryView | 'inbox') => void; onOpenContact: (id: string) => void }) {
  if (view === 'dashboard') return <Dashboard onNavigate={onNavigate} />;
  if (view === 'tickets') return <Tickets onOpen={onOpenContact} />;
  if (view === 'contacts') return <Contacts onOpen={onOpenContact} />;
  if (view === 'orders') return <Orders />;
  return <Templates />;
}
