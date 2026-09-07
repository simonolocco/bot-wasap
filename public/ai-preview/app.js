'use strict';
const $ = id => document.getElementById(id);
let token = '', draft = null, page = 0, busy = false;
const outcomes = { answered: 'Respondida', clarify: 'Pide una aclaración', handoff: 'Ofrece contacto del asesor', unavailable: 'IA no disponible', paused: 'Asesor atendiendo' };
async function api(url, body, form = false) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'X-Preview-Token': token, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
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
  if (busy || !message.trim()) return;
  busy = true; $('send').disabled = true; $('chat-status').textContent = 'Consultando…'; bubble('user', message); $('message').value = '';
  try {
    const answer = await api('/api/message', { message });
    if (answer.text) bubble('assistant', answer.text);
    showEvidence(answer);
    const errors = { credit: 'OpenRouter no tiene saldo suficiente para esta consulta.', credentials: 'OpenRouter rechazó la clave configurada.', rate_limit: 'OpenRouter limitó las consultas. Probá en unos instantes.', provider: 'No se pudo completar la consulta al modelo. Probá nuevamente.' };
    $('chat-status').textContent = answer.outcome === 'paused' ? 'El bot está pausado para respetar la atención del asesor.' : answer.outcome === 'unavailable' ? errors[answer.errorCode] || errors.provider : '';
  } catch (error) { $('chat-status').textContent = error.message; $('message').value = message; }
  finally { busy = false; $('send').disabled = false; $('message').focus(); }
}
function showCatalog(catalog) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  const ready = catalog.approved && catalog.validFrom <= today && catalog.validUntil >= today;
  $('catalog-badge').textContent = ready ? 'Precios habilitados' : 'Sin precios vigentes';
  $('catalog-badge').classList.toggle('ready', !!ready);
  $('catalog-summary').textContent = `${catalog.products.length} filas · ${catalog.name}. ${ready ? `Vigente hasta ${catalog.validUntil}.` : 'Se pueden consultar referencias, pero no cotizar.'}`;
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
    const saved = await api('/api/catalog', draft); showCatalog(saved);
    $('catalog-status').textContent = approved ? 'Catálogo activado para esta prueba local.' : 'Borrador guardado. Los precios siguen deshabilitados.';
  } catch (error) { $('catalog-status').textContent = error.message; }
  finally { $('activate').disabled = false; $('save-draft').disabled = false; }
}
$('chat-form').addEventListener('submit', event => { event.preventDefault(); send($('message').value); });
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send($('message').value); } });
document.querySelectorAll('.suggestions button').forEach(button => button.addEventListener('click', () => send(button.textContent)));
$('reset').addEventListener('click', async () => { if (busy) return; try { await api('/api/reset', {}); $('messages').replaceChildren(); $('evidence').textContent = 'Nueva conversación. Probá una consulta.'; $('pause').checked = false; $('chat-status').textContent = ''; } catch (e) { $('chat-status').textContent = e.message; } });
$('pause').addEventListener('change', async () => { try { await api('/api/pause', { paused: $('pause').checked }); } catch (e) { $('pause').checked = !$('pause').checked; $('chat-status').textContent = e.message; } });
$('review-open').addEventListener('click', async () => { try { const state = await api('/api/state'); beginReview(state.catalog); $('catalog-status').textContent = ''; $('catalog-dialog').showModal(); } catch (e) { $('chat-status').textContent = e.message; } });
$('review-close').addEventListener('click', () => $('catalog-dialog').close());
$('product-filter').addEventListener('input', () => { page = 0; renderRows(); });
$('prev').addEventListener('click', () => { page--; renderRows(); }); $('next').addEventListener('click', () => { page++; renderRows(); });
$('apply-tier').addEventListener('click', () => { if (!draft || !$('bulk-tier').value) return; draft.products.forEach(row => row.tier = $('bulk-tier').value); $('review-confirm').checked = false; renderRows(); });
for (const id of ['valid-from', 'valid-until']) $(id).addEventListener('change', () => $('review-confirm').checked = false);
$('save-draft').addEventListener('click', () => save(false)); $('activate').addEventListener('click', () => save(true));
$('upload-form').addEventListener('submit', async event => {
  event.preventDefault(); const file = $('catalog-file').files[0]; if (!file) return;
  const form = new FormData(); form.append('file', file); $('import-button').disabled = true; $('catalog-status').textContent = 'Leyendo y comprobando cada página. Puede demorar unos minutos según el tamaño del PDF…';
  try { beginReview(await api('/api/catalog/import', form, true)); $('catalog-status').textContent = 'Borrador importado. Revisá las filas; los precios activos todavía no cambiaron.'; }
  catch (error) { $('catalog-status').textContent = error.message; }
  finally { $('import-button').disabled = false; }
});
(async () => {
  try {
    const state = await api('/api/state'); token = state.token; showCatalog(state.catalog); $('model').textContent = state.model;
    for (const turn of state.history) bubble(turn.role, turn.content);
    $('pause').checked = state.paused;
    for (const fact of Object.values(state.facts)) { const p = document.createElement('p'); p.textContent = `${fact.source}\n${fact.text}`; $('knowledge').append(p); }
    if (!state.configured) $('chat-status').textContent = 'Falta configurar la clave de OpenRouter en .env.local.';
  } catch (error) { $('chat-status').textContent = error.message; $('send').disabled = true; }
})();
