'use strict';
const $ = id => document.getElementById(id);
let token = '', draft = null, page = 0, busy = false, initialized = false;
let previewSession = '', activeCatalog = null, catalogStorage = 'server';
let savedAnswers = [];
let uploadLimitMb = 8;
try { previewSession = sessionStorage.getItem('abasto-preview-session') || ''; } catch { /* Storage may be disabled. */ }
try {
  const stored = JSON.parse(localStorage.getItem('abasto-preview-answers-v1') || '[]');
  if (Array.isArray(stored)) savedAnswers = stored
    .filter(item => item && typeof item.question === 'string' && typeof item.answer === 'string' && item.question.trim() && item.answer.trim())
    .slice(-120)
    .map((item, index) => ({ id: item.id || `saved-${index}-${Date.now()}`, active: item.active !== false, manual: item.manual === true, updatedAt: item.updatedAt || '', question: item.question.trim(), answer: item.answer.trim() }));
} catch { /* The preview still works when browser storage is disabled. */ }
const outcomes = { answered: 'Respondida', clarify: 'Pide una aclaración', handoff: 'Ofrece contacto del asesor', unavailable: 'IA no disponible', paused: 'Asesor atendiendo', silence: 'Silencio deliberado' };
function normalizeSavedQuestion(value) { return String(value || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function persistSavedAnswers() {
  try { localStorage.setItem('abasto-preview-answers-v1', JSON.stringify(savedAnswers.slice(-120))); } catch { /* Keep the current tab usable. */ }
}
function renderSavedAnswers() {
  const container = $('saved-answers');
  if (!container) return;
  container.replaceChildren();
  const activeCount = savedAnswers.filter(entry => entry.active !== false).length;
  $('answers-badge').textContent = String(activeCount);
  if (!savedAnswers.length) { const empty = document.createElement('p'); empty.id = 'answers-empty'; empty.className = 'muted'; empty.textContent = 'Todavía no hay respuestas guardadas.'; container.append(empty); return; }
  for (const entry of [...savedAnswers].reverse()) {
    const card = document.createElement('article'); card.className = 'saved-answer';
    const questionLabel = document.createElement('label'); questionLabel.textContent = 'Pregunta guardada';
    const question = document.createElement('input'); question.type = 'text'; question.value = entry.question; question.readOnly = true; question.title = 'La pregunta se usa para encontrar coincidencias exactas.'; questionLabel.append(question); card.append(questionLabel);
    const answerLabel = document.createElement('label'); answerLabel.textContent = 'Respuesta que usará la IA';
    const answer = document.createElement('textarea'); answer.rows = 4; answer.value = entry.answer; answerLabel.append(answer); card.append(answerLabel);
    const controls = document.createElement('div'); controls.className = 'saved-answer-controls';
    const toggleLabel = document.createElement('label'); toggleLabel.className = 'saved-toggle'; const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = entry.active !== false; toggleLabel.append(toggle, document.createTextNode(' Usar esta respuesta')); controls.append(toggleLabel);
    const saveButton = document.createElement('button'); saveButton.type = 'button'; saveButton.className = 'secondary'; saveButton.textContent = 'Guardar cambio';
    saveButton.addEventListener('click', () => { entry.answer = answer.value.trim(); if (!entry.answer) { $('chat-status').textContent = 'La respuesta no puede quedar vacía.'; answer.focus(); return; } entry.active = toggle.checked; entry.manual = true; entry.updatedAt = new Date().toISOString(); persistSavedAnswers(); renderSavedAnswers(); $('chat-status').textContent = 'Respuesta personalizada guardada.'; });
    controls.append(saveButton);
    const removeButton = document.createElement('button'); removeButton.type = 'button'; removeButton.className = 'link-button'; removeButton.textContent = 'Eliminar';
    removeButton.addEventListener('click', () => { savedAnswers = savedAnswers.filter(candidate => candidate.id !== entry.id); persistSavedAnswers(); renderSavedAnswers(); $('chat-status').textContent = 'Respuesta eliminada; la próxima consulta volverá a usar la IA.'; });
    controls.append(removeButton); card.append(controls); container.append(card);
    toggle.addEventListener('change', () => { entry.active = toggle.checked; persistSavedAnswers(); $('answers-badge').textContent = String(savedAnswers.filter(item => item.active !== false).length); });
  }
}
function rememberAnswer(questionText, answer) {
  if (!questionText.trim() || !answer?.text || ['unavailable', 'paused', 'silence'].includes(answer.outcome)) return;
  const normalized = normalizeSavedQuestion(questionText);
  const existing = savedAnswers.find(entry => normalizeSavedQuestion(entry.question) === normalized);
  if (existing) { if (!existing.manual) existing.answer = answer.text; existing.updatedAt = new Date().toISOString(); }
  else savedAnswers.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, question: questionText.trim(), answer: answer.text, active: true, manual: false, updatedAt: new Date().toISOString() });
  savedAnswers = savedAnswers.slice(-120); persistSavedAnswers(); renderSavedAnswers();
}
async function api(url, body, form = false, retriedAfterExpiry = false) {
  if (body !== undefined) {
    if (form) body.set('previewSession', previewSession);
    else body = { ...body, previewSession, ...(url === '/api/message' ? { previewAnswers: savedAnswers.filter(entry => entry.active !== false).map(entry => ({ question: entry.question, answer: entry.answer })), ...(catalogStorage === 'browser' && activeCatalog ? { previewCatalog: activeCatalog } : {}) } : {}) };
  }
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'X-Preview-Token': token, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (data.previewSession) { previewSession = data.previewSession; try { sessionStorage.setItem('abasto-preview-session', previewSession); } catch { /* Current conversation remains usable. */ } }
  if (data.token) token = data.token;
  // Hosted sessions are signed and may expire while a tab remains open. Start
  // a fresh signed session and retry the user's request once, instead of
  // leaving the UI permanently stuck with an obsolete token.
  if (response.status === 403 && data.code === 'SESSION_EXPIRED' && !retriedAfterExpiry) {
    previewSession = ''; token = '';
    try { sessionStorage.removeItem('abasto-preview-session'); } catch { /* Continue with in-memory state. */ }
    await api('/api/state');
    return api(url, body, form, true);
  }
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}
function bubble(role, text) {
  $('messages').querySelector('.welcome')?.remove();
  const node = document.createElement('div'); node.className = `bubble ${role}`; node.textContent = text;
  $('messages').append(node); $('messages').scrollTop = $('messages').scrollHeight;
}
function showEvidence(answer) {
  $('evidence').replaceChildren();
  const result = document.createElement('p'); result.className = 'result'; result.textContent = outcomes[answer.outcome]; $('evidence').append(result);
  const detail = document.createElement('p'); detail.className = 'caption'; detail.textContent = answer.model ? `${(answer.elapsedMs / 1000).toFixed(1)} s · ${answer.tokens} tokens · ${answer.model}` : 'Respuesta del flujo local'; $('evidence').append(detail);
  const list = document.createElement('ul');
  for (const source of answer.sources) { const li = document.createElement('li'); li.textContent = source; list.append(li); }
  $('evidence').append(list);
}
async function send(message) {
  if (!initialized || busy || !message.trim()) return;
  busy = true; $('send').disabled = true; $('chat-status').textContent = 'Consultando…'; bubble('user', message); $('message').value = '';
  $('pause').disabled = true;
  try {
    const answer = await api('/api/message', { message });
    if (answer.text) bubble('assistant', answer.text);
    showEvidence(answer);
    rememberAnswer(message, answer);
    const errors = { credit: 'OpenRouter no tiene saldo suficiente para esta consulta.', credentials: 'OpenRouter rechazó la clave configurada.', daily_limit: 'Se agotó la cuota diaria de los modelos gratuitos. Hace falta esperar la renovación de la cuota o configurar un modelo con saldo.', rate_limit: 'OpenRouter limitó las consultas. Probá en unos instantes.', timeout: 'El modelo tardó demasiado en responder. Podés volver a intentar la consulta.', provider: 'No se pudo completar la consulta al modelo. Probá nuevamente.' };
    $('chat-status').textContent = answer.outcome === 'paused' ? 'El bot está pausado para respetar la atención del asesor.' : answer.outcome === 'unavailable' ? errors[answer.errorCode] || errors.provider : '';
  } catch (error) { $('chat-status').textContent = error.message; $('message').value = message; }
  finally { busy = false; $('send').disabled = false; $('pause').disabled = false; $('message').focus(); }
}
function showCatalog(catalog) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const ready = catalog.approved && catalog.validFrom <= today && catalog.validUntil >= today;
  $('catalog-badge').textContent = ready ? 'Precios habilitados' : 'Sin precios vigentes';
  $('catalog-badge').classList.toggle('ready', !!ready);
  $('catalog-summary').textContent = `${catalog.products.length} filas · ${catalog.name}. ${ready ? `Vigente hasta ${catalog.validUntil}.` : 'Se pueden consultar referencias, pero no cotizar.'}${catalogStorage === 'browser' ? ' Los cambios se guardan sólo en este navegador para la prueba.' : ''}`;
}
function beginReview(catalog) {
  draft = structuredClone(catalog); page = 0; $('review-confirm').checked = false; $('product-filter').value = '';
  $('valid-from').value = draft.validFrom || ''; $('valid-until').value = draft.validUntil || ''; renderRows();
}
function inputCell(row, key, type = 'text') {
  const input = document.createElement('input'); input.type = type; input.value = row[key] ?? ''; input.setAttribute('aria-label', `${key} de ${row.name}`);
  if (type === 'number') { input.step = '0.01'; input.min = '0.01'; }
  input.addEventListener('input', () => { row[key] = type === 'number' ? input.value ? Number(input.value) : null : input.value; $('review-confirm').checked = false; });
  return input;
}
function selectCell(row, key, options) {
  const select = document.createElement('select'); select.setAttribute('aria-label', `${key} de ${row.name}`);
  for (const value of options) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'sin_confirmar' ? 'Sin confirmar' : value; select.append(option); }
  select.value = row[key]; select.addEventListener('change', () => { row[key] = select.value; $('review-confirm').checked = false; }); return select;
}
function renderRows() {
  if (!draft) return;
  const filter = $('product-filter').value.toLocaleLowerCase();
  const rows = draft.products.filter(row => `${row.name} ${row.brand}`.toLocaleLowerCase().includes(filter));
  const pages = Math.max(1, Math.ceil(rows.length / 20)); page = Math.min(page, pages - 1);
  $('catalog-rows').replaceChildren();
  for (const row of rows.slice(page * 20, (page + 1) * 20)) {
    const tr = document.createElement('tr');
    for (const label of ['Producto y marca', 'Precio ARS', 'Por', 'Lista', 'Presentación y condición', 'Fuente']) { const td = document.createElement('td'); td.dataset.label = label; tr.append(td); }
    tr.children[0].append(inputCell(row, 'name'), inputCell(row, 'brand'));
    tr.children[1].append(inputCell(row, 'price', 'number'));
    tr.children[2].append(selectCell(row, 'unit', ['sin_confirmar', 'kg', 'unidad', 'caja', 'horma', 'pack', 'litro']));
    tr.children[3].append(selectCell(row, 'tier', ['sin_confirmar', 'mayorista', 'minorista']));
    tr.children[4].append(inputCell(row, 'presentation'), inputCell(row, 'conditions'));
    tr.children[5].textContent = row.source; $('catalog-rows').append(tr);
  }
  $('review-count').textContent = `${rows.length} filas encontradas de ${draft.products.length} · ${draft.name}`;
  $('page-number').textContent = `${page + 1} / ${pages}`; $('prev').disabled = page === 0; $('next').disabled = page + 1 >= pages;
}
async function save(approved) {
  if (!draft) return;
  if (approved && !$('review-confirm').checked) { $('catalog-status').textContent = 'Confirmá la revisión del documento original antes de activar.'; return; }
  $('activate').disabled = true; $('save-draft').disabled = true;
  try {
    draft.validFrom = $('valid-from').value || null; draft.validUntil = $('valid-until').value || null; draft.approved = approved;
    const saved = await api('/api/catalog', draft);
    delete saved.previewSession; delete saved.token;
    if (catalogStorage === 'browser') {
      try { localStorage.setItem('abasto-preview-catalog', JSON.stringify(saved)); }
      catch { throw new Error('El navegador no permitió guardar el catálogo. Habilitá el almacenamiento y volvé a intentar.'); }
    }
    activeCatalog = saved; showCatalog(saved);
    $('catalog-status').textContent = approved ? `Catálogo activado para la prueba${catalogStorage === 'browser' ? ' y guardado sólo en este navegador' : ' local'}.` : 'Borrador guardado. Los precios siguen deshabilitados.';
  } catch (error) { $('catalog-status').textContent = error.message; }
  finally { $('activate').disabled = false; $('save-draft').disabled = false; }
}
$('chat-form').addEventListener('submit', event => { event.preventDefault(); send($('message').value); });
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($('message').value); } });
document.querySelectorAll('.suggestions button').forEach(button => button.addEventListener('click', () => send(button.textContent)));
$('reset').addEventListener('click', async () => { if (busy) return; try { await api('/api/reset', {}); $('messages').replaceChildren(); $('evidence').textContent = 'Nueva conversación. Probá una consulta.'; $('pause').checked = false; $('chat-status').textContent = ''; } catch (e) { $('chat-status').textContent = e.message; } });
$('pause').addEventListener('change', async () => { try { await api('/api/pause', { paused: $('pause').checked }); } catch (e) { $('pause').checked = !$('pause').checked; $('chat-status').textContent = e.message; } });
$('review-open').addEventListener('click', async () => { try { const state = await api('/api/state', {}); beginReview(catalogStorage === 'browser' ? activeCatalog || state.catalog : state.catalog); $('catalog-status').textContent = ''; $('catalog-dialog').showModal(); } catch (e) { $('chat-status').textContent = e.message; } });
$('review-close').addEventListener('click', () => $('catalog-dialog').close());
$('product-filter').addEventListener('input', () => { page = 0; renderRows(); });
$('prev').addEventListener('click', () => { page--; renderRows(); }); $('next').addEventListener('click', () => { page++; renderRows(); });
$('apply-tier').addEventListener('click', () => { if (!draft || !$('bulk-tier').value) return; draft.products.forEach(row => row.tier = $('bulk-tier').value); $('review-confirm').checked = false; renderRows(); });
for (const id of ['valid-from', 'valid-until']) $(id).addEventListener('change', () => $('review-confirm').checked = false);
$('save-draft').addEventListener('click', () => save(false)); $('activate').addEventListener('click', () => save(true));
$('upload-form').addEventListener('submit', async event => {
  event.preventDefault(); const file = $('catalog-file').files[0]; if (!file) return;
  if (file.size > uploadLimitMb * 1024 * 1024) { $('catalog-status').textContent = `El archivo supera ${uploadLimitMb} MB. Dividilo o usá el Excel original.`; return; }
  const form = new FormData(); form.append('file', file); $('import-button').disabled = true; $('catalog-status').textContent = 'Leyendo y comprobando cada página. Puede demorar unos minutos según el tamaño del PDF…';
  try {
    const imported = await api('/api/catalog/import', form, true);
    for (let index = 1; index < (imported.pageCount || 1); index++) {
      $('catalog-status').textContent = `Leyendo página ${index + 1} de ${imported.pageCount}… El catálogo activo todavía no cambia.`;
      form.set('page', String(index));
      const part = await api('/api/catalog/import', form, true);
      imported.products.push(...part.products);
      if (part.validFrom && (!imported.validFrom || part.validFrom > imported.validFrom)) imported.validFrom = part.validFrom;
      if (part.validUntil && (!imported.validUntil || part.validUntil < imported.validUntil)) imported.validUntil = part.validUntil;
    }
    delete imported.pageCount;
    beginReview(imported); $('catalog-status').textContent = 'Borrador importado. Revisá las filas; los precios activos todavía no cambiaron.';
  }
  catch (error) { $('catalog-status').textContent = error.message; }
  finally { $('import-button').disabled = false; }
});
(async () => {
  $('send').disabled = true;
  try {
    // GET boots local cookie sessions; POST restores signed Vercel conversations.
    const savedSession = previewSession;
    let state = await api('/api/state');
    if (state.catalogStorage === 'browser') {
      // The boot response is fresh, so keep the saved conversation separately below.
      previewSession = savedSession;
      try { state = await api('/api/state', {}); }
      catch { previewSession = ''; state = await api('/api/state', {}); }
    }
    token = state.token; catalogStorage = state.catalogStorage; activeCatalog = state.catalog;
    uploadLimitMb = state.uploadLimitMb || 8;
    $('catalog-file').parentElement.firstChild.textContent = `PDF o Excel (hasta ${uploadLimitMb} MB)`;
    if (catalogStorage === 'browser') {
      try { const saved = JSON.parse(localStorage.getItem('abasto-preview-catalog') || 'null'); if (saved && Array.isArray(saved.products) && saved.version === 1) activeCatalog = saved; } catch { /* Fall back to the packaged catalog. */ }
    }
    showCatalog(activeCatalog); $('model').textContent = state.model; renderSavedAnswers();
    for (const turn of state.history) bubble(turn.role, turn.content);
    $('pause').checked = state.paused;
    for (const fact of Object.values(state.facts)) { const p = document.createElement('p'); p.textContent = `${fact.source}\n${fact.text}`; $('knowledge').append(p); }
    if (!state.configured) $('chat-status').textContent = 'Falta configurar la clave de OpenRouter en el servidor de prueba.';
    initialized = true;
    $('send').disabled = false;
  } catch (error) { $('chat-status').textContent = error.message; $('send').disabled = true; }
})();
