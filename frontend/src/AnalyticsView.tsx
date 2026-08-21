import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  Layers,
  MessageCircle,
  MessageSquare,
  Package,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { api, formatDate, formatDateOnly } from './api';
import type {
  AnalyticsPeriodKey,
  BotAnalyticsData,
  SecondaryView,
} from './types';

const MENU_COLORS = ['#10b981', '#06b6d4', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6'];

const stages: Record<string, { label: string; tone: string }> = {
  new: { label: 'Nueva', tone: 'tone-blue' },
  in_attention: { label: 'En atención', tone: 'tone-amber' },
  follow_up: { label: 'Seguimiento', tone: 'tone-purple' },
  order_received: { label: 'Pedido recibido', tone: 'tone-emerald' },
  won: { label: 'Ganada', tone: 'tone-green' },
  lost: { label: 'Perdida', tone: 'tone-rose' },
};

function cleanName(value?: string | null, fallback = 'Sin nombre') {
  const name = String(value || '').trim();
  if (!name || /^Pedido #[0-9a-f-]{16,}$/i.test(name)) return fallback;
  return name;
}

function pageCount(total: number, limit: number) {
  return Math.max(1, Math.ceil(total / limit));
}

function Pager({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (page: number) => void;
}) {
  const pages = pageCount(total, limit);
  const startItem = total === 0 ? 0 : page * limit + 1;
  const endItem = Math.min((page + 1) * limit, total);

  if (total <= limit && page === 0) return null;

  return (
    <footer className="table-footer">
      <div className="table-footer-info">
        <span>
          Mostrando <strong>{startItem}–{endItem}</strong> de <strong>{total.toLocaleString('es-AR')}</strong>
        </span>
      </div>
      <div className="table-footer-controls">
        <button
          className="button secondary sm"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={14} /> Anterior
        </button>
        <span className="page-indicator">
          Página {page + 1} de {pages}
        </span>
        <button
          className="button secondary sm"
          disabled={page + 1 >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Página siguiente"
        >
          Siguiente <ChevronRight size={14} />
        </button>
      </div>
    </footer>
  );
}

/* Custom Chart Tooltip */
function CustomTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="analytics-chart-tooltip">
      <div className="tooltip-header">
        <Calendar size={13} />
        <strong>{formatDateOnly(label)}</strong>
      </div>
      <div className="tooltip-list">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="tooltip-item">
            <span className="tooltip-dot" style={{ backgroundColor: entry.color }} />
            <span className="tooltip-label">{entry.name}:</span>
            <strong className="tooltip-val">{Number(entry.value).toLocaleString('es-AR')}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsView({
  onOpenContact,
  onNavigate,
}: {
  onOpenContact: (id: string) => void;
  onNavigate: (view: SecondaryView | 'inbox') => void;
}) {
  const [period, setPeriod] = useState<AnalyticsPeriodKey>('30d');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [appliedCustom, setAppliedCustom] = useState(false);
  const [data, setData] = useState<BotAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Tabs & Filters
  const [trendView, setTrendView] = useState<'chart_table' | 'chart' | 'table'>('chart_table');
  const [unrecognizedTab, setUnrecognizedTab] = useState<'patterns' | 'recent'>('patterns');
  const [patternFilter, setPatternFilter] = useState('');
  const [patternPage, setPatternPage] = useState(0);
  const [recentUnrecognizedPage, setRecentUnrecognizedPage] = useState(0);
  const [contactsWithoutMenuPage, setContactsWithoutMenuPage] = useState(0);
  const [contactResponseFilter, setContactResponseFilter] = useState<'all' | 'unanswered'>('all');

  // Chart Series Visibility Toggles
  const [seriesVisibility, setSeriesVisibility] = useState({
    incomingMessages: true,
    optionsRecognized: true,
    menuRequested: true,
    unrecognized: true,
    uniqueContacts: true,
  });

  const toggleSeries = (key: keyof typeof seriesVisibility) => {
    setSeriesVisibility(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const load = () => {
    setLoading(true);
    setError('');
    let url = `/api/analytics?period=${period}&limit=100`;
    if (period === 'custom') {
      url += `&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`;
    }
    api<BotAnalyticsData>(url)
      .then(res => {
        setData(res);
        setPatternPage(0);
        setRecentUnrecognizedPage(0);
        setContactsWithoutMenuPage(0);
        setContactResponseFilter('all');
      })
      .catch(e => setError(e instanceof Error ? e.message : 'No se pudieron cargar las analíticas'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (period !== 'custom' || appliedCustom) {
      load();
    }
  }, [period, appliedCustom]);

  const handlePeriodChange = (next: AnalyticsPeriodKey) => {
    setPeriod(next);
    if (next !== 'custom') {
      setAppliedCustom(false);
    }
  };

  const customRangeInvalid = period === 'custom' && Boolean(customFrom && customTo && customFrom > customTo);

  const handleApplyCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (customFrom && customTo) {
      if (customFrom > customTo) {
        setError('El rango de fechas personalizado es inválido. "Desde" debe ser anterior o igual a "Hasta".');
        return;
      }
      setAppliedCustom(true);
      load();
    }
  };

  if (loading && !data) {
    return (
      <div className="view-state analytics-loading-state">
        <div className="state-icon-wrap">
          <span className="spinner large" />
        </div>
        <strong>Cargando métricas de analítica…</strong>
        <p>Analizando eventos de WhatsApp y comportamiento del menú en tiempo real.</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="view-state error">
        <div className="state-icon-wrap error-icon">!</div>
        <strong>No se pudieron cargar las analíticas</strong>
        <p>{error}</p>
        <button className="button primary sm" onClick={load}>
          Reintentar conexión
        </button>
      </div>
    );
  }

  if (!data) return null;

  const summary = data.summary;

  const filteredPatterns = data.unrecognizedMessages.topPatterns.filter(p => {
    if (!patternFilter) return true;
    const term = patternFilter.toLowerCase();
    return p.text.toLowerCase().includes(term) || p.normalizedText.toLowerCase().includes(term);
  });

  const PAGE_SIZE = 10;
  const pagedPatterns = filteredPatterns.slice(patternPage * PAGE_SIZE, (patternPage + 1) * PAGE_SIZE);
  const pagedRecentUnrecognized = data.unrecognizedMessages.items.slice(
    recentUnrecognizedPage * PAGE_SIZE,
    (recentUnrecognizedPage + 1) * PAGE_SIZE,
  );
  const filteredContactsWithoutMenu = data.contactsWithoutMenu.items.filter(
    item => contactResponseFilter === 'all' || item.responseStatus === 'unanswered',
  );
  const pagedContactsWithoutMenu = filteredContactsWithoutMenu.slice(
    contactsWithoutMenuPage * PAGE_SIZE,
    (contactsWithoutMenuPage + 1) * PAGE_SIZE,
  );

  // Pie chart data for menu options
  const pieData = data.menuOptions
    .filter(opt => opt.count > 0)
    .map(opt => ({
      name: `Opción ${opt.number}: ${opt.label}`,
      value: opt.count,
      percentage: opt.percentage,
      uniqueContacts: opt.uniqueContacts,
    }));

  return (
    <div className="analytics-layout animate-fade-in">
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER & CONTROL BAR
          ───────────────────────────────────────────────────────────── */}
      <header className="analytics-header-card">
        <div className="analytics-header-main">
          <div className="analytics-badge-title">
            <div className="analytics-badge-icon">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="analytics-title-row">
                <h2>Analíticas del Asistente Virtual</h2>
                <span className="live-pill">
                  <span className="live-dot" /> En Vivo
                </span>
              </div>
              <p className="analytics-subtitle">
                Monitoreo de comportamiento, flujo de atención y efectividad del menú de WhatsApp.
              </p>
            </div>
          </div>

          <div className="analytics-header-actions">
            {/* Period Segmented Button */}
            <div className="period-segmented-control" role="group" aria-label="Período de análisis">
              <button
                type="button"
                className={`period-seg-btn ${period === '7d' ? 'active' : ''}`}
                onClick={() => handlePeriodChange('7d')}
              >
                7 días
              </button>
              <button
                type="button"
                className={`period-seg-btn ${period === '30d' ? 'active' : ''}`}
                onClick={() => handlePeriodChange('30d')}
              >
                30 días
              </button>
              <button
                type="button"
                className={`period-seg-btn ${period === '90d' ? 'active' : ''}`}
                onClick={() => handlePeriodChange('90d')}
              >
                90 días
              </button>
              <button
                type="button"
                className={`period-seg-btn ${period === 'custom' ? 'active' : ''}`}
                onClick={() => handlePeriodChange('custom')}
              >
                <Calendar size={13} />
                <span>Personalizado</span>
              </button>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              className="button secondary sm refresh-btn"
              onClick={load}
              disabled={loading}
              title="Recargar métricas actualizadas"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Cargando…' : 'Actualizar'}</span>
            </button>
          </div>
        </div>

        {/* Custom Range Drawer */}
        {period === 'custom' && (
          <form className="custom-date-drawer custom-range-form" onSubmit={handleApplyCustom}>
            <div className="date-input-group">
              <label className="date-input-label">
                <span>Desde</span>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={e => setCustomFrom(e.target.value)}
                  required
                />
              </label>
              <span className="date-sep">→</span>
              <label className="date-input-label">
                <span>Hasta</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={e => setCustomTo(e.target.value)}
                  required
                />
              </label>
            </div>
            <div className="drawer-actions">
              <button type="submit" className="button primary sm" disabled={customRangeInvalid || loading}>
                Aplicar rango
              </button>
              {customRangeInvalid && (
                <span className="range-error-text range-error-hint">"Desde" debe ser anterior o igual a "Hasta"</span>
              )}
            </div>
          </form>
        )}

        {/* Coverage Context Ribbon */}
        <div className="analytics-ribbon analytics-coverage-banner">
          <div className="ribbon-left coverage-info">
            <ShieldCheck size={15} className="text-emerald" />
            <span className="ribbon-text coverage-text">
              <strong>{data.period.label}:</strong> {formatDate(data.period.from)} al {formatDate(data.period.to)}.
              {data.coverage.earliestEventAt
                ? ` Registro tracking activo desde ${formatDate(data.coverage.earliestEventAt)}.`
                : ' Tracking de interacciones en vivo.'}
            </span>
          </div>
          <div className="ribbon-right">
            <span className="ribbon-event-badge coverage-badge">
              <Activity size={12} />
              {data.coverage.totalEventsTracked.toLocaleString('es-AR')} eventos registrados
            </span>
          </div>
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────────
          2. FOUR CORE HIGHLIGHT KPI CARDS
          ───────────────────────────────────────────────────────────── */}
      <section className="analytics-kpi-grid" aria-label="Indicadores Clave de Rendimiento">
        {/* Card 1: Contactos Únicos */}
        <article className="stat-card modern-kpi">
          <div className="stat-header">
            <div className="stat-label-wrap">
              <span className="stat-category">Audiencia</span>
              <h4 className="stat-label">Contactos en el período</h4>
            </div>
            <div className="stat-icon-circle bg-blue-subtle text-blue">
              <Users size={19} />
            </div>
          </div>
          <div className="stat-body">
            <div className="stat-main-figure">
              <strong className="stat-value">{summary.totalUniqueContacts.toLocaleString('es-AR')}</strong>
              <span className="stat-unit">personas</span>
            </div>
            <div className="stat-meta-row">
              <span className="meta-pill">
                <MessageSquare size={12} />
                {summary.totalIncomingMessages.toLocaleString('es-AR')} mensajes entrantes recibidos
              </span>
              <span className="meta-sub">
                {summary.totalUniqueContacts > 0
                  ? `~${(summary.totalIncomingMessages / summary.totalUniqueContacts).toFixed(1)} msgs/contacto`
                  : '—'}
              </span>
            </div>
          </div>
          <div className="stat-bottom-bar bg-blue" />
        </article>

        {/* Card 2: Opciones Reconocidas */}
        <article className="stat-card modern-kpi">
          <div className="stat-header">
            <div className="stat-label-wrap">
              <span className="stat-category">Efectividad</span>
              <h4 className="stat-label">Opciones reconocidas</h4>
            </div>
            <div className="stat-icon-circle bg-emerald-subtle text-emerald">
              <CheckCircle2 size={19} />
            </div>
          </div>
          <div className="stat-body">
            <div className="stat-main-figure">
              <strong className="stat-value">{summary.totalMenuOptionsRecognized.toLocaleString('es-AR')}</strong>
              <span className="stat-badge-chip tone-emerald">
                {summary.menuOptionRate}% del total
              </span>
            </div>
            <div className="stat-meta-row">
              <span className="meta-pill">
                <Layers size={12} />
                {summary.totalMenuInteractions.toLocaleString('es-AR')} aperturas de menú
              </span>
              <span className="meta-sub">Opciones 1 al 6</span>
            </div>
          </div>
          <div className="stat-bottom-bar bg-emerald" />
        </article>

        {/* Card 3: Mensajes No Entendidos */}
        <article className="stat-card modern-kpi">
          <div className="stat-header">
            <div className="stat-label-wrap">
              <span className="stat-category">Desvíos & Fugas</span>
              <h4 className="stat-label">Mensajes no entendidos</h4>
            </div>
            <div className="stat-icon-circle bg-rose-subtle text-rose">
              <AlertTriangle size={19} />
            </div>
          </div>
          <div className="stat-body">
            <div className="stat-main-figure">
              <strong className="stat-value text-rose">{summary.totalUnrecognizedMessages.toLocaleString('es-AR')}</strong>
              <span className={`stat-badge-chip ${summary.unrecognizedRate > 15 ? 'tone-rose' : 'tone-gray'}`}>
                {summary.unrecognizedRate}% sin clasificar
              </span>
            </div>
            <div className="stat-meta-row">
              <span className="meta-pill">
                <UserCheck size={12} />
                {data.unrecognizedMessages.uniqueContacts.toLocaleString('es-AR')} contactos
              </span>
              <span className="meta-sub">Consultas fuera de menú</span>
            </div>
          </div>
          <div className="stat-bottom-bar bg-rose" />
        </article>

        {/* Card 4: Contactos Sin Menú */}
        <article className="stat-card modern-kpi">
          <div className="stat-header">
            <div className="stat-label-wrap">
              <span className="stat-category">Comportamiento</span>
              <h4 className="stat-label">Contactos sin menú</h4>
            </div>
            <div className="stat-icon-circle bg-amber-subtle text-amber">
              <HelpCircle size={19} />
            </div>
          </div>
          <div className="stat-body">
            <div className="stat-main-figure">
              <strong className="stat-value">{summary.contactsWithoutMenuCount.toLocaleString('es-AR')}</strong>
              <span className="stat-unit">sin selección</span>
            </div>
            <div className="stat-meta-row">
              <span className="meta-pill text-amber">
                <Clock size={12} />
                {summary.contactsWithoutBotResponseCount.toLocaleString('es-AR')} sin respuesta automática
              </span>
              <span className="meta-sub">
                {summary.contactsWithoutMenuCount - summary.contactsWithoutBotResponseCount} atendidos
              </span>
            </div>
          </div>
          <div className="stat-bottom-bar bg-amber" />
        </article>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          3. FUNNELS & CONVERSIONS ROW
          ───────────────────────────────────────────────────────────── */}
      <section className="analytics-funnel-grid" aria-label="Conversiones y Flujos">
        {/* Funnel 1: Pedidos */}
        <div className="funnel-card modern-funnel-card">
          <div className="funnel-top funnel-header">
            <div className="funnel-title-group">
              <div className="funnel-icon funnel-icon-wrap bg-emerald-subtle text-emerald">
                <Package size={18} />
              </div>
              <div>
                <strong>Flujo de Nuevo Pedido</strong>
                <small className="funnel-desc">Desde selección de opción 4 hasta confirmación de lista</small>
              </div>
            </div>
            <div className="funnel-tag rate-badge tone-emerald">
              {summary.totalOrdersStarted > 0
                ? `${Math.round((summary.totalOrdersSubmitted / summary.totalOrdersStarted) * 100)}% conversión`
                : '0% conversión'}
            </div>
          </div>

          <div className="funnel-pipeline funnel-stats">
            <div className="pipeline-stage funnel-step">
              <span className="stage-num step-label">01 · Pedidos Iniciados</span>
              <div className="stage-info">
                <strong className="stage-val step-val">{summary.totalOrdersStarted.toLocaleString('es-AR')}</strong>
              </div>
            </div>
            <div className="pipeline-connector funnel-arrow">
              <ArrowRight size={16} />
            </div>
            <div className="pipeline-stage active funnel-step">
              <span className="stage-num step-label">02 · Listas Confirmadas</span>
              <div className="stage-info">
                <strong className="stage-val step-val text-emerald">{summary.totalOrdersSubmitted.toLocaleString('es-AR')}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Funnel 2: Asesor Humano */}
        <div className="funnel-card modern-funnel-card">
          <div className="funnel-top funnel-header">
            <div className="funnel-title-group">
              <div className="funnel-icon funnel-icon-wrap bg-blue-subtle text-blue">
                <Users size={18} />
              </div>
              <div>
                <strong>Derivaciones a Asesor Humano</strong>
                <small className="funnel-desc">Clientes que solicitaron asistencia o consulta personalizada</small>
              </div>
            </div>
            <div className="funnel-tag rate-badge tone-blue">
              {summary.totalUniqueContacts > 0
                ? `${Math.round((summary.totalAdvisorRequests / summary.totalUniqueContacts) * 100)}% de contactos`
                : '0%'}
            </div>
          </div>

          <div className="funnel-pipeline funnel-stats">
            <div className="pipeline-stage funnel-step">
              <span className="stage-num step-label">01 · Solicitudes derivadas</span>
              <div className="stage-info">
                <strong className="stage-val step-val text-blue">{summary.totalAdvisorRequests.toLocaleString('es-AR')}</strong>
              </div>
            </div>
            <div className="pipeline-connector funnel-arrow">
              <ArrowRight size={16} />
            </div>
            <div className="pipeline-stage funnel-step">
              <span className="stage-num step-label">02 · Atención Operador</span>
              <div className="stage-info">
                <strong className="stage-val text-muted">Live Chat</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          4. INTERACTIVE ACTIVITY & TREND CHART + DETAILED TABLE
          ───────────────────────────────────────────────────────────── */}
      <section className="analytics-section-card chart-card" aria-label="Actividad diaria del bot">
        <div className="section-card-header">
          <div className="section-title-wrap">
            <div className="section-icon-badge bg-emerald-subtle text-emerald">
              <Activity size={18} />
            </div>
            <div>
              <h3>Actividad diaria del bot</h3>
              <p>Evolución y desglose diario de mensajes recibidos, aperturas de menú, opciones elegidas y desvíos.</p>
            </div>
          </div>

          <div className="section-header-controls">
            <span className="section-counter">
              {data.trend.length} {data.trend.length === 1 ? 'día con actividad' : 'días con actividad'}
            </span>
          </div>
        </div>

        {/* Interactive Chart */}
        <div className="chart-container-wrapper">
          {/* Interactive Series Filters */}
          <div className="chart-series-filters">
            <span className="filters-label">Series:</span>
            <button
              type="button"
              className={`series-toggle-chip ${seriesVisibility.incomingMessages ? 'active' : ''}`}
              style={{ borderColor: '#0ea5e9' }}
              onClick={() => toggleSeries('incomingMessages')}
            >
              <span className="series-dot" style={{ backgroundColor: '#0ea5e9' }} />
              Mensajes Entrantes
            </button>
            <button
              type="button"
              className={`series-toggle-chip ${seriesVisibility.optionsRecognized ? 'active' : ''}`}
              style={{ borderColor: '#10b981' }}
              onClick={() => toggleSeries('optionsRecognized')}
            >
              <span className="series-dot" style={{ backgroundColor: '#10b981' }} />
              Opciones Reconocidas
            </button>
            <button
              type="button"
              className={`series-toggle-chip ${seriesVisibility.menuRequested ? 'active' : ''}`}
              style={{ borderColor: '#6366f1' }}
              onClick={() => toggleSeries('menuRequested')}
            >
              <span className="series-dot" style={{ backgroundColor: '#6366f1' }} />
              Menú Solicitado
            </button>
            <button
              type="button"
              className={`series-toggle-chip ${seriesVisibility.unrecognized ? 'active' : ''}`}
              style={{ borderColor: '#f43f5e' }}
              onClick={() => toggleSeries('unrecognized')}
            >
              <span className="series-dot" style={{ backgroundColor: '#f43f5e' }} />
              No Entendidos
            </button>
            <button
              type="button"
              className={`series-toggle-chip ${seriesVisibility.uniqueContacts ? 'active' : ''}`}
              style={{ borderColor: '#f59e0b' }}
              onClick={() => toggleSeries('uniqueContacts')}
            >
              <span className="series-dot" style={{ backgroundColor: '#f59e0b' }} />
              Contactos Únicos
            </button>
          </div>

          {data.trend.length > 0 && (
            <div className="recharts-responsive-box">
              <ResponsiveContainer width="100%" height={290}>
                <AreaChart data={data.trend} margin={{ top: 15, right: 20, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorIncoming" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorRecognized" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorUnrecognized" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" opacity={0.6} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={val => val.slice(5)}
                    stroke="var(--muted)"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="var(--muted)"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTrendTooltip />} />
                  {seriesVisibility.incomingMessages && (
                    <Area
                      type="monotone"
                      dataKey="incomingMessages"
                      name="Mensajes Entrantes"
                      stroke="#0ea5e9"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorIncoming)"
                    />
                  )}
                  {seriesVisibility.optionsRecognized && (
                    <Area
                      type="monotone"
                      dataKey="optionsRecognized"
                      name="Opciones Reconocidas"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorRecognized)"
                    />
                  )}
                  {seriesVisibility.menuRequested && (
                    <Area
                      type="monotone"
                      dataKey="menuRequested"
                      name="Menú Solicitado"
                      stroke="#6366f1"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      fill="none"
                    />
                  )}
                  {seriesVisibility.unrecognized && (
                    <Area
                      type="monotone"
                      dataKey="unrecognized"
                      name="No Entendidos"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorUnrecognized)"
                    />
                  )}
                  {seriesVisibility.uniqueContacts && (
                    <Area
                      type="monotone"
                      dataKey="uniqueContacts"
                      name="Contactos Únicos"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="none"
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Detailed Trend Table */}
        {data.trend.length === 0 ? (
          <div className="table-empty-notice">
            No se registraron mensajes en el período seleccionado.
          </div>
        ) : (
          <div className="table-responsive">
            <div className="trend-explainer" role="note">
              <strong>Cómo leer esta tabla</strong>
              <span><b>Entrantes</b> = mensajes recibidos.</span>
              <span><b>Menú solicitado</b> = mensajes que pidieron ver las opciones.</span>
              <span><b>Opciones elegidas</b> = clics o respuestas reconocidas.</span>
              <span><b>No entendidos</b> = mensajes que el bot no pudo clasificar.</span>
              <span><b>Contactos únicos</b> = personas distintas, no cantidad de mensajes.</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>Fecha</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Entrantes</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Menú solicitado</th>
                  <th style={{ width: '18%', textAlign: 'right' }}>Opciones elegidas</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>No entendidos</th>
                  <th style={{ width: '16%', textAlign: 'right' }}>Contactos únicos</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map(t => (
                  <tr key={t.date} className="trend-row">
                    <td>
                      <strong className="trend-date">{formatDateOnly(t.date)}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong className="metric-val">{t.incomingMessages.toLocaleString('es-AR')}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="count-tag blue">{t.menuRequested.toLocaleString('es-AR')}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="count-tag emerald">{t.optionsRecognized.toLocaleString('es-AR')}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`count-tag ${t.unrecognized > 0 ? 'rose' : 'gray'}`}>
                        {t.unrecognized.toLocaleString('es-AR')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="metric-sub">{t.uniqueContacts.toLocaleString('es-AR')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────────────
          5. MENU BREAKDOWN & PREFERENCES (PIE + CARDS + TABLE)
          ───────────────────────────────────────────────────────────── */}
      <section className="analytics-section-card" aria-label="Uso de Opciones de Menú">
        <div className="section-card-header">
          <div className="section-title-wrap">
            <div className="section-icon-badge bg-emerald-subtle text-emerald">
              <PieChartIcon size={18} />
            </div>
            <div>
              <h3>Uso de Opciones del Menú</h3>
              <p>Frecuencia de selección y personas únicas para cada una de las 6 opciones del bot.</p>
            </div>
          </div>
          <span className="section-counter">
            {summary.totalMenuOptionsRecognized.toLocaleString('es-AR')} elecciones totales
          </span>
        </div>

        <div className="menu-breakdown-split">
          {/* Left: Donut Chart */}
          <div className="menu-donut-box">
            <h6 className="donut-title">Distribución Relativa</h6>
            {pieData.length === 0 ? (
              <div className="table-empty-notice">Sin elecciones en este período.</div>
            ) : (
              <div className="donut-chart-container">
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={MENU_COLORS[index % MENU_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any, name: any, item: any) => [
                        `${Number(val).toLocaleString('es-AR')} veces (${item.payload.percentage}%)`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center-stat">
                  <strong>{summary.totalMenuOptionsRecognized.toLocaleString('es-AR')}</strong>
                  <span>elecciones</span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Detailed Option Cards */}
          <div className="menu-options-list">
            {data.menuOptions.map((opt, idx) => {
              const color = MENU_COLORS[idx % MENU_COLORS.length];
              return (
                <div key={opt.id} className="option-row menu-option-item-card">
                  <div className="option-item-top">
                    <div className="option-badge-wrap">
                      <span className="option-num-badge" style={{ backgroundColor: color }}>
                        {opt.number}
                      </span>
                      <strong className="option-name">{opt.label}</strong>
                    </div>
                    <div className="option-figures">
                      <strong className="option-count metric-val">{opt.count.toLocaleString('es-AR')}</strong>
                      <span className="option-pct">({opt.percentage}%)</span>
                    </div>
                  </div>

                  <div className="option-progress-track meter-bar-track">
                    <div
                      className="option-progress-fill meter-bar-fill"
                      style={{
                        width: `${Math.max(opt.percentage, 2)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>

                  <div className="option-item-footer">
                    <span className="option-unique metric-sub">
                      <Users size={11} />
                      {opt.uniqueContacts.toLocaleString('es-AR')} personas únicas
                    </span>
                    <span className="meter-pct">{opt.percentage}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          6. DIAGNOSTIC PANEL: UNRECOGNIZED MESSAGES
          ───────────────────────────────────────────────────────────── */}
      <section className="analytics-section-card" aria-label="Mensajes No Entendidos">
        <div className="section-card-header">
          <div className="section-title-wrap">
            <div className="section-icon-badge bg-rose-subtle text-rose">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3>Mensajes No Entendidos</h3>
              <p>Texto original recibido en WhatsApp para detectar consultas frecuentes no cubiertas o intenciones omitidas.</p>
            </div>
          </div>

          <div className="tab-pill-group" role="group" aria-label="Vistas de mensajes no entendidos">
            <button
              type="button"
              className={`tab-pill ${unrecognizedTab === 'patterns' ? 'active' : ''}`}
              onClick={() => setUnrecognizedTab('patterns')}
            >
              Patrones más frecuentes ({data.unrecognizedMessages.topPatterns.length})
            </button>
            <button
              type="button"
              className={`tab-pill ${unrecognizedTab === 'recent' ? 'active' : ''}`}
              onClick={() => setUnrecognizedTab('recent')}
            >
              Últimos mensajes ({data.unrecognizedMessages.items.length})
            </button>
          </div>
        </div>

        {unrecognizedTab === 'patterns' ? (
          <>
            <div className="table-filter-bar">
              <div className="search-wrap compact">
                <Search size={14} className="text-muted" />
                <input
                  type="text"
                  placeholder="Filtrar patrones por palabra…"
                  value={patternFilter}
                  onChange={e => {
                    setPatternFilter(e.target.value);
                    setPatternPage(0);
                  }}
                />
                {patternFilter && (
                  <button
                    type="button"
                    className="clear-search-btn"
                    onClick={() => {
                      setPatternFilter('');
                      setPatternPage(0);
                    }}
                    aria-label="Limpiar búsqueda"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {pagedPatterns.length === 0 ? (
              <div className="table-empty-notice">
                {patternFilter
                  ? 'No se encontraron patrones con ese filtro.'
                  : 'No se registraron mensajes no entendidos en el período.'}
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '48%' }}>Texto / Patrón Recibido</th>
                      <th style={{ width: '16%', textAlign: 'right' }}>Frecuencia</th>
                      <th style={{ width: '16%', textAlign: 'right' }}>Personas</th>
                      <th style={{ width: '20%', textAlign: 'right' }}>Última vez visto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPatterns.map((pat, idx) => (
                      <tr key={`${pat.normalizedText}-${idx}`}>
                        <td>
                          <div className="raw-message-box">
                            <code>{pat.text}</code>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="count-tag rose">
                            {pat.count.toLocaleString('es-AR')} {pat.count === 1 ? 'vez' : 'veces'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="metric-sub">{pat.uniqueContacts.toLocaleString('es-AR')}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="timestamp-text">{formatDate(pat.lastSeenAt, true)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pager
                  page={patternPage}
                  total={filteredPatterns.length}
                  limit={PAGE_SIZE}
                  onPage={setPatternPage}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {pagedRecentUnrecognized.length === 0 ? (
              <div className="table-empty-notice">
                No hay mensajes recientes no entendidos en este período.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '18%' }}>Fecha / Hora</th>
                      <th style={{ width: '25%' }}>Contacto</th>
                      <th style={{ width: '43%' }}>Texto Original Recibido</th>
                      <th style={{ width: '14%', textAlign: 'right' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRecentUnrecognized.map(item => (
                      <tr key={item.id}>
                        <td>
                          <span className="timestamp-text">{formatDate(item.createdAt, true)}</span>
                        </td>
                        <td>
                          <div className="contact-cell">
                            <strong className="contact-name">{cleanName(item.contactName, item.phone)}</strong>
                            <small className="phone-code">{item.phone}</small>
                          </div>
                        </td>
                        <td>
                          <div className="raw-message-box full">
                            <code>{item.rawText || '[Sin texto legible]'}</code>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="button secondary sm action-chat-btn"
                            onClick={() => onOpenContact(item.contactId)}
                            title="Abrir conversación en bandeja"
                          >
                            <MessageCircle size={13} />
                            <span>Ver chat</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pager
                  page={recentUnrecognizedPage}
                  total={data.unrecognizedMessages.items.length}
                  limit={PAGE_SIZE}
                  onPage={setRecentUnrecognizedPage}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────────────
          7. AUDIT PANEL: CONTACTS WITHOUT MENU SELECTION
          ───────────────────────────────────────────────────────────── */}
      <section className="analytics-section-card" aria-label="Contactos Sin Selección de Menú">
        <div className="section-card-header">
          <div className="section-title-wrap">
            <div className="section-icon-badge bg-amber-subtle text-amber">
              <Users size={18} />
            </div>
            <div>
              <h3>Contactos Sin Selección de Menú</h3>
              <p>Clientes con mensajes entrantes que no registran una selección de las opciones 1 a 6. La respuesta se verifica contra mensajes automáticos enviados y confirmados.</p>
            </div>
          </div>

          <div className="tab-pill-group" role="group" aria-label="Filtro de contactos sin menú">
            <button
              type="button"
              className={`tab-pill ${contactResponseFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setContactResponseFilter('all');
                setContactsWithoutMenuPage(0);
              }}
            >
              Todos sin menú ({summary.contactsWithoutMenuCount.toLocaleString('es-AR')})
            </button>
            <button
              type="button"
              className={`tab-pill ${contactResponseFilter === 'unanswered' ? 'active' : ''}`}
              onClick={() => {
                setContactResponseFilter('unanswered');
                setContactsWithoutMenuPage(0);
              }}
            >
              Sin respuesta ({summary.contactsWithoutBotResponseCount.toLocaleString('es-AR')})
            </button>
          </div>
        </div>

        {pagedContactsWithoutMenu.length === 0 ? (
          <div className="table-empty-notice">
            {contactResponseFilter === 'unanswered'
              ? 'No hay contactos sin respuesta automática en el período seleccionado.'
              : 'Todos los clientes que interactuaron en este período seleccionaron al menos una opción del menú.'}
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Contacto</th>
                  <th style={{ width: '18%' }}>Teléfono</th>
                  <th style={{ width: '14%', textAlign: 'center' }}>Mensajes</th>
                  <th style={{ width: '20%' }}>Respuesta del bot</th>
                  <th style={{ width: '20%' }}>Última Actividad</th>
                  <th style={{ width: '10%', textAlign: 'right' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {pagedContactsWithoutMenu.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div className="contact-cell">
                        <strong className="contact-name">{cleanName(c.name || c.publicName, c.phone)}</strong>
                        <span className={`status-badge-sm ${stages[c.pipelineStatus]?.tone || 'tone-gray'}`}>
                          {stages[c.pipelineStatus]?.label || c.pipelineStatus}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="phone-code">{c.phone}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="count-tag blue">{c.messageCount} msgs</span>
                    </td>
                    <td>
                      <div className="response-cell">
                        <span
                          className={`status-badge-sm ${c.responseStatus === 'responded' ? 'tone-emerald' : 'tone-rose'}`}
                        >
                          {c.responseStatus === 'responded' ? 'Respondió' : 'Sin respuesta'}
                        </span>
                        <small>
                          {c.botResponseCount > 0
                            ? `${c.botResponseCount} mensajes automáticos`
                            : 'No hay envío automático confirmado'}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="response-cell">
                        <span className="timestamp-text">{formatDate(c.lastIncomingAt || c.lastMessageAt, true)}</span>
                        {c.lastBotResponseAt && <small>Bot: {formatDate(c.lastBotResponseAt, true)}</small>}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="button secondary sm action-chat-btn"
                        onClick={() => onOpenContact(c.id)}
                        title="Abrir chat para revisar interacción"
                      >
                        <MessageCircle size={13} />
                        <span>Abrir chat</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager
              page={contactsWithoutMenuPage}
              total={filteredContactsWithoutMenu.length}
              limit={PAGE_SIZE}
              onPage={setContactsWithoutMenuPage}
            />
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────────────
          8. DATA VERIFICATION & FOOTER TRANSPARENCY NOTICE
          ───────────────────────────────────────────────────────────── */}
      <footer className="analytics-footer-card">
        <div className="footer-transparency">
          <ShieldCheck size={16} className="text-emerald" />
          <span>
            <strong>Garantía de exactitud de datos:</strong> Todas las métricas se generan en tiempo real a partir de
            eventos persistidos en PostgreSQL (<code>bot_analytics_events</code> y <code>messages</code>). Ningún dato es simulado, estimado ni
            inventado.
          </span>
        </div>
      </footer>
    </div>
  );
}
