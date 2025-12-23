const appNode = document.getElementById('app');

const aliasSearchTimers = new Map();
let flashTimer = null;
let lastFocusedAliasInput = null;
let lastFocusedUnitInput = null;

const state = {
  authenticated: false,
  loading: true,
  error: null,
  orders: [],
  selectedOrder: null,
  activeTab: 'orders',
  aliasLoading: false,
  aliasError: null,
  aliases: [],
  aliasSearch: {},
  unitLoading: false,
  unitError: null,
  unitAliases: [],
  unitInputs: {},
  flash: null,
};

const statusLabels = {
  pending_customer: 'Esperando confirmación del cliente',
  submitted: 'Pendiente de aprobación',
  accepted: 'Aceptado',
  canceled: 'Cancelado',
};

const CATALOG_LINKS = [
  {
    label: 'Lista mayorista',
    description: 'Actualizada para clientes mayoristas.',
    url: '/catalogo-mayorista.html',
  },
  {
    label: 'Lista minorista',
    description: 'Pensada para compras por menor.',
    url: '/catalogo-minorista.html',
  },
];

const UNIT_TERMS =
  'cajas?|cajones?|cjs?|cj|c|kgs?|kg|kilos?|kilogramos?|grs?|gramos?|gr|ltrs?|lts?|lt|l|litros?|hormas?|horma|potes?|pote|packs?|pack|paquetes?|paq|sachets?|sachet|displays?|display|barras?|barra|bidones?|bidon|botellas?|botella|docenas?|dz|bandejas?|bandeja|bolsas?|bolsa|piezas?|pieza|unidad(?:es)?|unid(?:ades)?|uni|u';
const UNIT_PREFIX_REGEX = new RegExp(
  String.raw`^\s*(?:\d+(?:[\.,]\d+)?\s*(?:x\s*)?)?(?:de\s+)?(${UNIT_TERMS})(?:\b)?[\s\-\.:]*`,
  'i'
);

function formatAliasTitle(text = '') {
  let cleaned = text.trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/^[\-\*\u2022\u2023\u25cf]+/, '').trim();
  cleaned = cleaned.replace(UNIT_PREFIX_REGEX, '').trim();
  cleaned = cleaned.replace(/^\d+(?:[\.,]\d+)?\s+/, '').trim();
  return cleaned || text.trim();
}

function setState(partial, options = {}) {
  const shouldRender = options.render !== false;
  Object.assign(state, partial);
  if (shouldRender) render();
}

function updateAliasSearchState(aliasKey, partial, options) {
  const current = state.aliasSearch[aliasKey] || { query: '', results: [], loading: false, error: null };
  setState(
    {
      aliasSearch: {
        ...state.aliasSearch,
        [aliasKey]: { ...current, ...partial },
      },
    },
    options
  );
}

function updateUnitInputState(aliasKey, partial, options) {
  const current = state.unitInputs[aliasKey] || { value: '', saving: false, error: null };
  setState(
    {
      unitInputs: {
        ...state.unitInputs,
        [aliasKey]: { ...current, ...partial },
      },
    },
    options
  );
}

function rememberAliasInputFocus(element) {
  if (!(element instanceof HTMLInputElement)) return;
  const key = element.getAttribute('data-alias-key');
  if (!key) return;
  lastFocusedAliasInput = {
    key,
    selectionStart: element.selectionStart ?? element.value.length,
    selectionEnd: element.selectionEnd ?? element.value.length,
  };
}

function restoreAliasInputFocus() {
  if (!lastFocusedAliasInput || !lastFocusedAliasInput.key) return;
  const input = document.querySelector(`input[data-alias-key="${lastFocusedAliasInput.key}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  const start = lastFocusedAliasInput.selectionStart ?? input.value.length;
  const end = lastFocusedAliasInput.selectionEnd ?? start;
  try {
    input.setSelectionRange(start, end);
  } catch (_err) {
    // Ignore issues (e.g. unsupported input types)
  }
}

function rememberUnitInputFocus(element) {
  if (!(element instanceof HTMLInputElement)) return;
  const key = element.getAttribute('data-unit-key');
  if (!key) return;
  lastFocusedUnitInput = {
    key,
    selectionStart: element.selectionStart ?? element.value.length,
    selectionEnd: element.selectionEnd ?? element.value.length,
  };
}

function restoreUnitInputFocus() {
  if (!lastFocusedUnitInput || !lastFocusedUnitInput.key) return;
  const input = document.querySelector(`input[data-unit-key="${lastFocusedUnitInput.key}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  const start = lastFocusedUnitInput.selectionStart ?? input.value.length;
  const end = lastFocusedUnitInput.selectionEnd ?? start;
  try {
    input.setSelectionRange(start, end);
  } catch (_err) {
    // Ignore selection errors
  }
}

function showFlash(message) {
  if (flashTimer) clearTimeout(flashTimer);
  setState({ flash: message });
  flashTimer = setTimeout(() => setState({ flash: null }), 3500);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error inesperado');
  }
  return res.json();
}

async function loadSession() {
  try {
    const data = await fetchJSON('/api/session', { method: 'GET', headers: {} });
    setState({ authenticated: data.authenticated, loading: false, error: null });
    if (data.authenticated) {
      await loadOrders();
    }
  } catch (err) {
    setState({ loading: false, error: err.message });
  }
}

async function loadOrders() {
  try {
    const data = await fetchJSON('/api/orders');
    setState({ orders: data.orders, error: null });
  } catch (err) {
    setState({ error: err.message });
  }
}

async function loadAliases() {
  try {
    setState({ aliasLoading: true, aliasError: null });
    const data = await fetchJSON('/api/aliases/pending');
    setState({ aliases: data.aliases, aliasLoading: false, aliasSearch: {} });
  } catch (err) {
    setState({ aliasLoading: false, aliasError: err.message });
  }
}

async function loadUnitAliases() {
  try {
    setState({ unitLoading: true, unitError: null });
    const data = await fetchJSON('/api/unit-aliases/pending');
    const nextInputs = {};
    for (const unit of data.units) {
      const existing = state.unitInputs[unit.key];
      nextInputs[unit.key] = { value: existing?.value || '', saving: false, error: null };
    }
    setState({ unitAliases: data.units, unitLoading: false, unitInputs: nextInputs });
  } catch (err) {
    setState({ unitLoading: false, unitError: err.message });
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.elements.namedItem('username').value.trim();
  const password = form.elements.namedItem('password').value.trim();
  try {
    await fetchJSON('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setState({ authenticated: true, error: null });
    await loadOrders();
  } catch (err) {
    setState({ error: err.message });
  }
}

async function handleLogout() {
  try {
    await fetchJSON('/api/logout', { method: 'POST', body: JSON.stringify({}) });
    setState({
      authenticated: false,
      orders: [],
      selectedOrder: null,
      activeTab: 'orders',
      aliases: [],
      aliasError: null,
      aliasLoading: false,
      aliasSearch: {},
      unitAliases: [],
      unitError: null,
      unitLoading: false,
      unitInputs: {},
    });
  } catch (err) {
    setState({ error: err.message });
  }
}

async function viewOrder(orderId) {
  try {
    const data = await fetchJSON(`/api/orders/${orderId}`);
    setState({ selectedOrder: data.order, error: null });
  } catch (err) {
    setState({ error: err.message });
  }
}

function closeModal() {
  setState({ selectedOrder: null });
}

function setActiveTab(tab) {
  if (state.activeTab === tab) return;
  setState({ activeTab: tab });
  if (tab === 'aliases') {
    loadAliases();
  } else if (tab === 'units') {
    loadUnitAliases();
  }
}

async function searchAliasProducts(aliasKey, query) {
  const trimmed = query.trim();
  updateAliasSearchState(aliasKey, { query: trimmed }, { render: false });
  if (trimmed.length < 2) {
    updateAliasSearchState(aliasKey, { results: [], loading: false, error: null }, { render: true });
    return;
  }

  updateAliasSearchState(aliasKey, { loading: true, error: null });
  try {
    const params = new URLSearchParams({ q: trimmed });
    const data = await fetchJSON(`/api/products/search?${params.toString()}`, { method: 'GET' });
    updateAliasSearchState(aliasKey, { results: data.results, loading: false, error: null });
  } catch (err) {
    updateAliasSearchState(aliasKey, { results: [], loading: false, error: err.message || 'Error al buscar' });
  }
}

async function assignAlias(aliasKey, productCode, productLabel) {
  try {
    await fetchJSON('/api/aliases/assign', {
      method: 'POST',
      body: JSON.stringify({ aliasKey, productCode }),
    });
    showFlash(`Alias actualizado: ahora coincide con ${productLabel}.`);
    await loadAliases();
  } catch (err) {
    setState({ aliasError: err.message });
  }
}

async function assignUnitAliasAction(aliasKey, canonicalValue, aliasLabel) {
  const normalized = canonicalValue.trim().toLowerCase();
  if (!normalized) {
    updateUnitInputState(aliasKey, { error: 'Elegí una unidad.' });
    return;
  }
  if (!['unidad', 'caja'].includes(normalized)) {
    updateUnitInputState(aliasKey, { error: 'Solo podés elegir unidad o caja.' });
    return;
  }

  updateUnitInputState(aliasKey, { saving: true, error: null });
  try {
    await fetchJSON('/api/unit-aliases/assign', {
      method: 'POST',
      body: JSON.stringify({ aliasKey, canonical: normalized }),
    });
    const label = normalized === 'caja' ? 'Caja' : 'Unidad';
    showFlash(`Unidad actualizada: ${aliasLabel} → ${label}.`);
    await loadUnitAliases();
  } catch (err) {
    updateUnitInputState(aliasKey, { saving: false, error: err.message || 'No se pudo guardar.' });
  }
}

function renderLogin() {
  return `
    <section class="card">
      <h1>Ingresá al panel</h1>
      <p class="muted">Solo personal autorizado.</p>
      <form id="login-form">
        <label>
          Usuario
          <input type="text" name="username" autocomplete="username" required />
        </label>
        <label>
          Contraseña
          <input type="password" name="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Ingresar</button>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      </form>
    </section>
  `;
}

function renderOrdersContent() {
  const catalogSection = `
    <div class="catalog-links">
      <h2>Catálogos de precios</h2>
      <p class="muted">Descargá la versión que necesites para compartir con clientes.</p>
      <ul>
        ${CATALOG_LINKS.map(
          (link) => `
            <li>
              <div>
                <strong>${escapeHtml(link.label)}</strong>
                <p class="muted small">${escapeHtml(link.description)}</p>
              </div>
              <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">Abrir</a>
            </li>
          `
        ).join('')}
      </ul>
    </div>
  `;

  if (state.orders.length === 0) {
    return `${catalogSection}<div class="empty-state">No hay pedidos registrados todavía.</div>`;
  }

  const rows = state.orders
    .map((order) => {
      const createdAt = new Date(order.created_at);
      const statusLabel = statusLabels[order.status] || order.status;
      return `
        <tr class="order-row">
          <td>#${order.id}</td>
          <td>${createdAt.toLocaleDateString()}</td>
          <td>${createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
          <td>${escapeHtml(order.chat_id)}</td>
          <td><span class="status ${order.status}">${escapeHtml(statusLabel)}</span></td>
          <td class="actions">
            <button data-action="detail" data-id="${order.id}">Ver detalles</button>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    ${catalogSection}
    <table class="orders-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Fecha</th>
          <th>Hora</th>
          <th>WhatsApp</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAliasExamples(alias) {
  if (!alias.examples || alias.examples.length === 0) {
    return '';
  }
  return `
    <ul class="alias-examples">
      ${alias.examples
        .map(
          (ex) => `
            <li>
              <div class="alias-example-header">
                <span class="alias-example-order">Pedido #${ex.orderId}</span>
                <span class="muted">${new Date(ex.createdAt).toLocaleString()}</span>
              </div>
              <code>${escapeHtml(ex.rawText)}</code>
              ${
                ex.unitAlias || ex.unitRaw
                  ? `<p class="muted small">Unidad detectada: ${escapeHtml(ex.unitAlias || ex.unitRaw || '')}</p>`
                  : ''
              }
              <details>
                <summary>Ver mensaje completo</summary>
                <pre>${escapeHtml(ex.orderDetail)}</pre>
              </details>
            </li>
          `
        )
        .join('')}
    </ul>
  `;
}

function renderAliasSearchSection(alias) {
  const searchState = state.aliasSearch[alias.key] || { query: '', results: [], loading: false, error: null };
  const results =
    searchState.loading
      ? `<div class="alias-search-status">Buscando productos...</div>`
      : searchState.error
      ? `<div class="error">${escapeHtml(searchState.error)}</div>`
      : searchState.results.length > 0
      ? `
        <ul class="alias-search-results">
          ${searchState.results
            .map((product) => {
              const disabled = !product.codigo;
              const labelParts = [
                product.producto ? escapeHtml(product.producto) : '',
                product.marca ? `<span class="muted">(${escapeHtml(product.marca)})</span>` : '',
              ]
                .filter(Boolean)
                .join(' ');
              const badge = product.codigo
                ? `<span class="badge">#${escapeHtml(product.codigo)}</span>`
                : `<span class="badge badge-muted">Sin código</span>`;
              return `
                <li>
                  <button
                    data-action="assign-alias"
                    data-key="${alias.key}"
                    data-product="${product.codigo ?? ''}"
                    data-product-label="${escapeHtml(product.producto ?? '')}${product.marca ? ' - ' + escapeHtml(product.marca) : ''}"
                    data-alias-label="${escapeHtml(alias.aliasText)}"
                    ${disabled ? 'disabled' : ''}
                  >
                    <span>${labelParts}</span>
                    ${badge}
                  </button>
                </li>
              `;
            })
            .join('')}
        </ul>
      `
      : searchState.query && searchState.query.length >= 2
      ? `<div class="alias-search-status">Sin resultados para “${escapeHtml(searchState.query)}”.</div>`
      : '';

  return `
    <div class="alias-search">
      <label>
        Vincular con producto
        <input
          type="text"
          placeholder="Buscar en el catálogo..."
          value="${escapeHtml(searchState.query || '')}"
          data-alias-key="${alias.key}"
        />
      </label>
      <p class="muted small">Escribí al menos 2 letras para buscar. Solo se pueden asignar productos con código.</p>
      ${results}
    </div>
  `;
}

function renderAliasCard(alias) {
  const displayTitle = formatAliasTitle(alias.aliasText);
  return `
    <article class="alias-card" data-alias-key="${alias.key}">
      <header>
        <h3 title="${escapeHtml(alias.aliasText)}">${escapeHtml(displayTitle)}</h3>
        <div class="alias-meta">
          <span>${alias.occurrences} aparición${alias.occurrences === 1 ? '' : 'es'}</span>
          <span>Última vez: ${new Date(alias.lastSeen).toLocaleString()}</span>
        </div>
        ${
          alias.unitSample?.unitAlias || alias.unitSample?.unitRaw
            ? `<p class="muted small">Unidad más común: ${escapeHtml(
                alias.unitSample.unitAlias || alias.unitSample.unitRaw || ''
              )}</p>`
            : ''
        }
      </header>
      ${renderAliasExamples(alias)}
      ${renderAliasSearchSection(alias)}
    </article>
  `;
}

function renderAliasContent() {
  if (state.aliasLoading) {
    return `<div class="alias-loading">Cargando alias pendientes...</div>`;
  }
  if (state.aliasError) {
    return `<div class="error">${escapeHtml(state.aliasError)}</div>`;
  }
  if (!state.aliases || state.aliases.length === 0) {
    return `<div class="empty-state">Por ahora no hay alias pendientes para entrenar. ¡Buen trabajo!</div>`;
  }
  return `<div class="alias-grid">${state.aliases.map((alias) => renderAliasCard(alias)).join('')}</div>`;
}

function renderUnitExamples(unitAlias) {
  if (!unitAlias.examples || unitAlias.examples.length === 0) {
    return '';
  }
  return `
    <ul class="alias-examples">
      ${unitAlias.examples
        .map(
          (ex) => `
            <li>
              <div class="alias-example-header">
                <span class="alias-example-order">Pedido #${ex.orderId}</span>
                <span class="muted">${new Date(ex.createdAt).toLocaleString()}</span>
              </div>
              <code>${escapeHtml(ex.unitRaw || ex.rawText)}</code>
              <details>
                <summary>Ver mensaje completo</summary>
                <pre>${escapeHtml(ex.orderDetail)}</pre>
              </details>
            </li>
          `
        )
        .join('')}
    </ul>
  `;
}

function renderUnitCard(unitAlias) {
  const inputState = state.unitInputs[unitAlias.key] || { value: '', saving: false, error: null };
  const currentValue = (inputState.value || '').trim();
  const disabledAttr = inputState.saving || !currentValue ? 'disabled' : '';
  return `
    <article class="alias-card" data-unit-key="${unitAlias.key}">
      <header>
        <h3>${escapeHtml(unitAlias.aliasText)}</h3>
        <div class="alias-meta">
          <span>${unitAlias.occurrences} aparición${unitAlias.occurrences === 1 ? '' : 'es'}</span>
          <span>Última vez: ${new Date(unitAlias.lastSeen).toLocaleString()}</span>
        </div>
      </header>
      ${renderUnitExamples(unitAlias)}
      <div class="alias-search">
        <label>
          Unidad estándar
          <select data-unit-key="${unitAlias.key}" ${inputState.saving ? 'disabled' : ''}>
            <option value="">Seleccioná una opción</option>
            <option value="unidad" ${currentValue === 'unidad' ? 'selected' : ''}>Unidad</option>
            <option value="caja" ${currentValue === 'caja' ? 'selected' : ''}>Caja</option>
          </select>
        </label>
        ${inputState.error ? `<p class="error">${escapeHtml(inputState.error)}</p>` : ''}
        <button
          data-action="assign-unit"
          data-key="${unitAlias.key}"
          data-alias-label="${escapeHtml(unitAlias.aliasText)}"
          ${disabledAttr}
        >
          Guardar selección
        </button>
      </div>
    </article>
  `;
}

function renderUnitContent() {
  if (state.unitLoading) {
    return `<div class="alias-loading">Cargando unidades pendientes...</div>`;
  }
  if (state.unitError) {
    return `<div class="error">${escapeHtml(state.unitError)}</div>`;
  }
  if (!state.unitAliases || state.unitAliases.length === 0) {
    return `<div class="empty-state">No hay unidades pendientes por mapear ahora mismo.</div>`;
  }
  return `<div class="alias-grid">${state.unitAliases.map((unit) => renderUnitCard(unit)).join('')}</div>`;
}

function renderModal(order) {
  return `
    <div class="detail-modal" id="detail-modal">
      <div class="content">
        <h2>Pedido #${order.id}</h2>
        <p class="muted">Enviado por ${escapeHtml(order.customer_name || order.chat_id)} el ${new Date(order.created_at).toLocaleString()}</p>
        <pre>${escapeHtml(order.detail)}</pre>
        <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:16px;">
          <button id="modal-close">Cerrar</button>
        </div>
      </div>
    </div>
  `;
}

function renderAuthenticated() {
  const isOrders = state.activeTab === 'orders';
  const isAliases = state.activeTab === 'aliases';
  const isUnits = state.activeTab === 'units';

  let title = 'Pedidos recibidos';
  let subtitle = 'Gestioná los pedidos cargados desde WhatsApp.';
  if (isAliases) {
    title = 'Entrenamiento de alias';
    subtitle = 'Ayudá al bot a entender cómo llaman los clientes a cada producto.';
  } else if (isUnits) {
    title = 'Alias de unidades';
    subtitle = 'Mapeá abreviaturas como “c” o “u” a unidades estándar (caja, unidad, kg, etc).';
  }

  return `
    <section class="card">
      <div class="header">
        <div>
          <h1>${title}</h1>
          <p class="muted">${subtitle}</p>
        </div>
        <div class="header-actions">
          <div class="tab-bar">
            <button data-tab="orders" class="tab ${isOrders ? 'active' : ''}">Pedidos</button>
            <button data-tab="aliases" class="tab ${isAliases ? 'active' : ''}">Alias</button>
            <button data-tab="units" class="tab ${isUnits ? 'active' : ''}">Unidades</button>
          </div>
          <button id="logout-btn">Cerrar sesión</button>
        </div>
      </div>
      ${state.flash ? `<p class="flash">${escapeHtml(state.flash)}</p>` : ''}
      ${isOrders && state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      <div class="tab-content">
        ${isOrders ? renderOrdersContent() : isAliases ? renderAliasContent() : renderUnitContent()}
      </div>
    </section>
    ${isOrders && state.selectedOrder ? renderModal(state.selectedOrder) : ''}
  `;
}

function render() {
  if (state.loading) {
    appNode.innerHTML = `<section class="card"><p>Cargando...</p></section>`;
    return;
  }

  appNode.innerHTML = state.authenticated ? renderAuthenticated() : renderLogin();

  if (!state.authenticated) {
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    return;
  }

  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  document.querySelectorAll('button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const tab = e.currentTarget.getAttribute('data-tab');
      if (tab) setActiveTab(tab);
    });
  });

  if (state.activeTab === 'orders') {
    document.querySelectorAll('button[data-action="detail"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = Number(e.currentTarget.getAttribute('data-id'));
        if (Number.isFinite(id)) viewOrder(id);
      });
    });

    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('detail-modal')?.addEventListener('click', (event) => {
      if (event.target.id === 'detail-modal') {
        closeModal();
      }
    });
  } else if (state.activeTab === 'aliases') {
    document.querySelectorAll('input[data-alias-key]').forEach((input) => {
      input.addEventListener('input', (e) => {
        const target = e.currentTarget;
        if (!(target instanceof HTMLInputElement)) return;
        const key = target.getAttribute('data-alias-key');
        if (!key) return;
        rememberAliasInputFocus(target);
        const value = target.value;
        updateAliasSearchState(key, { query: value }, { render: false });
        if (aliasSearchTimers.has(key)) {
          clearTimeout(aliasSearchTimers.get(key));
        }
        aliasSearchTimers.set(
          key,
          setTimeout(() => {
            searchAliasProducts(key, value);
          }, 300)
        );
      });
      input.addEventListener('focus', (e) => rememberAliasInputFocus(e.currentTarget));
      input.addEventListener('blur', () => {
        lastFocusedAliasInput = null;
      });
    });

    document.querySelectorAll('button[data-action="assign-alias"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const key = e.currentTarget.getAttribute('data-key');
        const product = e.currentTarget.getAttribute('data-product');
        const productLabel = e.currentTarget.getAttribute('data-product-label') || '';
        const aliasLabel = e.currentTarget.getAttribute('data-alias-label') || '';
        if (!key || !product) {
          alert('No se puede asignar este resultado porque no tiene código asociado.');
          return;
        }
        if (
          confirm(
            `¿Vincular "${aliasLabel}" con el producto ${productLabel ? `"${productLabel}"` : `#${product}`}?`
          )
        ) {
          assignAlias(key, product, productLabel || `#${product}`);
        }
      });
    });
    restoreAliasInputFocus();
  } else if (state.activeTab === 'units') {
    document.querySelectorAll('[data-unit-key]').forEach((element) => {
      const handler = (event) => {
        const target = event.currentTarget;
        if (!target) return;
        const key = target.getAttribute('data-unit-key');
        if (!key) return;
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
          rememberUnitInputFocus(target);
          updateUnitInputState(key, { value: target.value, error: null });
        }
      };
      element.addEventListener('input', handler);
      element.addEventListener('change', handler);
      element.addEventListener('focus', (e) => rememberUnitInputFocus(e.currentTarget));
      element.addEventListener('blur', () => {
        lastFocusedUnitInput = null;
      });
    });

    document.querySelectorAll('button[data-action="assign-unit"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const key = e.currentTarget.getAttribute('data-key');
        if (!key) return;
        const aliasLabel = e.currentTarget.getAttribute('data-alias-label') || key;
        const value = state.unitInputs[key]?.value || '';
        assignUnitAliasAction(key, value, aliasLabel);
      });
    });
    restoreUnitInputFocus();
  }

  if (state.activeTab !== 'aliases') {
    lastFocusedAliasInput = null;
  }
  if (state.activeTab !== 'units') {
    lastFocusedUnitInput = null;
  }
}

loadSession();
