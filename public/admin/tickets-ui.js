(() => {
  let currentContactId = null;
  let refreshTimer = null;
  let renderedKey = '';
  let ticketPage = 0;

  const esc = value => String(value ?? '').replace(/[&<>\'"`]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '`': '&#96;' }[char]));
  const date = value => value ? new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const labels = { question: 'Pregunta', order: 'Pedido' };
  const statuses = { open: 'Abierto', responded: 'Respondido', closed: 'Cerrado' };
  const reasons = {
    order_completed: 'Pedido finalizado', question_answered: 'Consulta respondida', customer_no_reply: 'Sin respuesta del cliente',
    operator_cancelled: 'Cancelado', fallback_sent: 'Link enviado', no_customer_question: 'Sin pregunta (histórico)',
    no_operator_response: 'Sin respuesta del operador', answered: 'Respondido (histórico)',
  };

  async function request(url, options = {}) {
    const headers = options.body instanceof FormData ? { ...(options.headers || {}) } : { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
    return data;
  }
  function showNotice(message, error = false) {
    const box = document.getElementById('notice');
    if (!box) return;
    box.textContent = message; box.className = `toast${error ? ' error' : ''}`;
    setTimeout(() => box.classList.add('hidden'), 4500);
  }
  function status(ticket) { return ticket.displayStatus || (ticket.status === 'closed' ? 'closed' : ticket.answeredAt ? 'responded' : 'open'); }
  function statusLabel(ticket) { return ticket.ticketType === 'order' && status(ticket) !== 'closed' && !windowOpen(ticket) ? 'Vencido · requiere plantilla' : statuses[status(ticket)]; }
  function closureText(type, reason) {
    if (reason === 'order_completed') return '✅ Tu pedido fue atendido y quedó finalizado. Si necesitás algo más, escribinos nuevamente.';
    if (reason === 'question_answered') return '✅ Tu consulta fue atendida y quedó finalizada. Si necesitás algo más, escribinos nuevamente.';
    if (reason === 'customer_no_reply') return 'ℹ️ Cerramos esta atención porque no recibimos la información necesaria. Si todavía necesitás ayuda, escribinos nuevamente.';
    if (reason === 'operator_cancelled') return 'ℹ️ Cerramos esta atención. Si necesitás ayuda, escribinos nuevamente.';
    return type === 'order' ? 'El pedido será finalizado.' : 'La consulta será finalizada.';
  }
  function openReasons(type) {
    return type === 'order'
      ? [['order_completed', 'Pedido finalizado'], ['customer_no_reply', 'Sin respuesta del cliente'], ['operator_cancelled', 'Cancelar atención']]
      : [['question_answered', 'Consulta respondida'], ['customer_no_reply', 'Sin respuesta del cliente'], ['operator_cancelled', 'Cancelar atención']];
  }
  function windowOpen(ticket) { return ticket.lastIncomingAt && Date.now() - new Date(ticket.lastIncomingAt).getTime() < 24 * 60 * 60 * 1000; }

  const style = document.createElement('style');
  style.textContent = `
  .support-ticket-card{margin:0 16px 16px;padding:14px;border:1px solid #f0c875;border-radius:12px;background:#fff9e8;overflow-wrap:anywhere}.support-ticket-card .ticket-label{color:#946300;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.support-ticket-card h3{margin:5px 0;font-size:14px}.support-ticket-card p{margin:7px 0;line-height:1.4}.support-ticket-card small{color:#8a7651;font-size:10px}.ticket-badge,.ticket-status{display:inline-block;border-radius:99px;padding:4px 8px;font-size:10px;font-weight:850}.ticket-badge.order{color:#995126;background:#ffeadf}.ticket-badge.question{color:#6543a0;background:#efe7fc}.ticket-status.open{color:#946300;background:#fff0c7}.ticket-status.responded{color:#177148;background:#dcf7e8}.ticket-status.closed{color:#64736e;background:#edf2f0}.ticket-status.expired{color:#9a4e18;background:#ffeadf}.ticket-actions{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}.ticket-actions button{font-size:11px}.ticket-history{margin:0 16px 16px;padding:13px;border-top:1px solid #dce9e5}.ticket-history h4{margin:0 0 9px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#688078}.ticket-history-row{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #edf3f0;font-size:11px}.ticket-history-row:last-child{border:0}.ticket-history-row small{display:block;color:#718780;margin-top:3px}.ticket-modal-backdrop{position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:20px;background:#09272399}.ticket-modal{width:min(520px,94vw);background:#fff;border-radius:16px;box-shadow:0 24px 80px #001e1855;padding:20px}.ticket-modal h3{margin:0 0 5px}.ticket-modal p{color:#718780;font-size:12px}.ticket-preview{white-space:pre-wrap;overflow-wrap:anywhere;margin:13px 0;padding:12px;border-radius:10px;background:#f4faf7;border:1px solid #dce9e5;font-size:13px;line-height:1.45}.ticket-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}.ticket-view-toolbar{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin-bottom:14px}.ticket-view-toolbar input{flex:1;min-width:220px}.ticket-view-toolbar select{width:auto;min-width:160px}.ticket-list{border:1px solid #dce9e5;border-radius:14px;background:#fff;overflow:auto;box-shadow:0 14px 38px #17342e0d}.ticket-row{display:grid;grid-template-columns:105px minmax(150px,1fr) minmax(160px,1.5fr) 160px 130px 175px;align-items:center;gap:12px;padding:13px 15px;border-bottom:1px solid #edf3f0}.ticket-row:last-child{border:0}.ticket-row button{font-size:11px}.ticket-row .ticket-main{min-width:0}.ticket-row strong,.ticket-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ticket-row small{color:#718780;margin-top:3px}.ticket-row .ticket-question{overflow-wrap:anywhere;white-space:normal;line-height:1.35}.ticket-row-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}.ticket-count{color:#718780;font-size:12px;margin:0 0 10px}.ticket-empty{padding:35px;text-align:center;color:#718780}.ticket-pagination{display:flex;justify-content:center;align-items:center;gap:12px;padding:15px}.ticket-pipeline{font-size:10px;color:#718780}@media(max-width:1150px){.ticket-row{grid-template-columns:100px minmax(130px,1fr) minmax(140px,1fr) 130px 150px}.ticket-row .ticket-time{display:none}}@media(max-width:800px){.ticket-row{grid-template-columns:1fr;gap:7px}.ticket-row-actions{justify-content:flex-start}.ticket-view-toolbar select{flex:1}.ticket-view-toolbar input{flex-basis:100%}}
  `;
  document.head.appendChild(style);

  function addTicketsView() {
    const nav = document.querySelector('.sidebar nav');
    const main = document.querySelector('.main');
    if (!nav || !main || document.getElementById('ticketsView')) return;
    const button = document.createElement('button');
    button.className = 'nav'; button.dataset.ticketNav = 'true'; button.innerHTML = '<span>◇</span> Tickets <b id="ticketCount">0</b>';
    nav.insertBefore(button, nav.querySelector('[data-view="templates"]') || null);
    const view = document.createElement('section');
    view.id = 'ticketsView'; view.className = 'view';
    view.innerHTML = `<div class="view-toolbar"><div><p class="eyebrow">Atención comercial</p><h2>Tickets</h2><p class="muted">Preguntas y pedidos separados por tipo, estado y motivo.</p></div></div><div class="ticket-view-toolbar"><input id="ticketSearch" placeholder="Buscar contacto, contenido o pedido"><select id="ticketTypeFilter"><option value="">Todos los tipos</option><option value="question">Preguntas</option><option value="order">Pedidos</option></select><select id="ticketStatusFilter"><option value="">Todos los estados</option><option value="open">Abiertos</option><option value="responded">Respondidos</option><option value="closed">Cerrados</option></select><select id="ticketReasonFilter"><option value="">Todos los motivos</option><option value="order_completed">Pedido finalizado</option><option value="question_answered">Consulta respondida</option><option value="customer_no_reply">Sin respuesta</option><option value="operator_cancelled">Cancelado</option><option value="fallback_sent">Link enviado</option></select><button id="clearTicketFilters" class="subtle-button">Limpiar</button></div><p id="ticketCountText" class="ticket-count"></p><div id="ticketList" class="ticket-list"></div><div class="ticket-pagination"><button id="ticketPrev" class="secondary">Anterior</button><span id="ticketPageText"></span><button id="ticketNext" class="secondary">Siguiente</button></div>`;
    main.appendChild(view);
    button.onclick = () => openTicketsView();
    ['ticketSearch', 'ticketTypeFilter', 'ticketStatusFilter', 'ticketReasonFilter'].forEach(id => document.getElementById(id).addEventListener(id === 'ticketSearch' ? 'input' : 'change', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { ticketPage = 0; loadTickets(); }, 240); }));
    document.getElementById('clearTicketFilters').onclick = () => { document.getElementById('ticketSearch').value = ''; document.getElementById('ticketTypeFilter').value = ''; document.getElementById('ticketStatusFilter').value = ''; document.getElementById('ticketReasonFilter').value = ''; ticketPage = 0; loadTickets(); };
    document.getElementById('ticketPrev').onclick = () => { if (ticketPage > 0) { ticketPage--; loadTickets(); } };
    document.getElementById('ticketNext').onclick = () => { ticketPage++; loadTickets(); };
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const open = target?.closest('[data-ticket-open]'); if (open) { openTicketConversation(open.dataset.ticketOpen); return; }
      const close = target?.closest('[data-ticket-close]'); if (close) { void showCloseModal(close.dataset.ticketClose); return; }
      const link = target?.closest('[data-order-link]'); if (link) { void sendOrderLink(link.dataset.orderLink, link); return; }
    });
  }

  async function openTicketsView() {
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'ticketsView'));
    document.querySelectorAll('.nav').forEach(x => x.classList.toggle('active', x.dataset.ticketNav === 'true'));
    const title = document.getElementById('title'); const subtitle = document.getElementById('subtitle'); const breadcrumb = document.getElementById('breadcrumb');
    if (title) title.textContent = 'Tickets'; if (subtitle) subtitle.textContent = 'Preguntas y pedidos con cierre explícito.'; if (breadcrumb) breadcrumb.textContent = 'Tickets';
    await loadTickets();
  }
  function openTicketConversation(contactId) {
    document.querySelector('.nav[data-view="inbox"]')?.click();
    setTimeout(() => window.openConversation?.(contactId), 30);
  }
  async function loadTickets() {
    const list = document.getElementById('ticketList'); if (!list || !document.getElementById('ticketsView').classList.contains('active')) return;
    const params = new URLSearchParams({ page: String(ticketPage), limit: '30' });
    const q = document.getElementById('ticketSearch').value.trim(); const type = document.getElementById('ticketTypeFilter').value; const statusValue = document.getElementById('ticketStatusFilter').value; const reason = document.getElementById('ticketReasonFilter').value;
    if (q) params.set('q', q); if (type) params.set('type', type); if (statusValue) params.set('status', statusValue); if (reason) params.set('closureReason', reason);
    try {
      const data = await request(`/api/tickets?${params}`);
      document.getElementById('ticketCountText').textContent = `${data.total} tickets encontrados`;
      document.getElementById('ticketCount').textContent = data.total;
      document.getElementById('ticketPageText').textContent = `Página ${data.page + 1}`;
      document.getElementById('ticketPrev').disabled = ticketPage === 0; document.getElementById('ticketNext').disabled = (ticketPage + 1) * data.limit >= data.total;
      list.innerHTML = data.items.map(ticket => { const expired = ticket.ticketType === 'order' && status(ticket) !== 'closed' && !windowOpen(ticket); return `<article class="ticket-row"><div><span class="ticket-badge ${ticket.ticketType}">${labels[ticket.ticketType]}</span><span class="ticket-status ${expired ? 'expired' : status(ticket)}">${esc(expired ? 'Vencido · requiere plantilla' : statusLabel(ticket))}</span></div><button class="text-button ticket-main" data-ticket-open="${esc(ticket.contactId)}"><strong>${esc(ticket.contactName || ticket.publicName || 'Sin nombre')}</strong><small>${esc(ticket.phone)}</small></button><div class="ticket-main"><strong class="ticket-question">${esc(ticket.ticketType === 'order' ? `Pedido #${ticket.orderId || '—'}` : ticket.subject)}</strong><small class="ticket-question">${esc(ticket.question || ticket.lastMessage || 'Sin texto adicional')}</small></div><div><span class="ticket-pipeline">${esc(ticket.closureReason ? reasons[ticket.closureReason] || ticket.closureReason : 'Sin motivo')}</span><small>${esc(date(ticket.updatedAt))}</small></div><div class="ticket-time"><strong>${ticket.lastDirection === 'incoming' ? '↓ Cliente' : '↑ Bot / operador'}</strong><small>${esc(date(ticket.lastMessageCreatedAt))}</small></div><div class="ticket-row-actions">${ticket.ticketType === 'order' && status(ticket) !== 'closed' ? `<button class="primary" data-order-link="${esc(ticket.id)}">Enviar link</button>` : ''}${status(ticket) !== 'closed' ? `<button class="secondary" data-ticket-close="${esc(ticket.id)}">${ticket.ticketType === 'order' ? 'Finalizar pedido' : 'Finalizar consulta'}</button>` : ''}<button class="text-button" data-ticket-open="${esc(ticket.contactId)}">Ver chat</button></div></article>`; }).join('') || '<div class="ticket-empty">No hay tickets con estos filtros.</div>';
    } catch (error) { list.innerHTML = `<div class="ticket-empty">${esc(error.message)}<br><button class="secondary" id="retryTickets">Reintentar</button></div>`; document.getElementById('retryTickets').onclick = loadTickets; }
  }

  async function getTicket(id) { return request(`/api/tickets/${encodeURIComponent(id)}`); }
  async function showCloseModal(id) {
    try {
      const ticket = await getTicket(id); const choices = openReasons(ticket.ticketType);
      const backdrop = document.createElement('div'); backdrop.className = 'ticket-modal-backdrop'; backdrop.innerHTML = `<section class="ticket-modal" role="dialog" aria-modal="true"><h3>Finalizar ${labels[ticket.ticketType].toLowerCase()}</h3><p>Elegí el motivo exacto. El tipo del ticket define el texto y no se mezclará con preguntas o pedidos.</p><label>Motivo<select id="closeReason">${choices.map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><div id="closePreview" class="ticket-preview"></div><p id="closeWindowHint"></p><div class="ticket-modal-actions"><button class="secondary" id="cancelClose">Cancelar</button><button class="primary" id="confirmClose">Confirmar cierre</button></div></section>`;
      document.body.appendChild(backdrop);
      const updatePreview = () => { const reason = document.getElementById('closeReason').value; document.getElementById('closePreview').textContent = closureText(ticket.ticketType, reason); document.getElementById('closeWindowHint').textContent = windowOpen(ticket) ? 'Se enviará este mensaje y luego se activará el bot.' : 'La ventana de 24 horas está vencida: se cerrará sin enviar texto libre para evitar un rechazo de WhatsApp.'; };
      document.getElementById('closeReason').onchange = updatePreview; updatePreview();
      document.getElementById('cancelClose').onclick = () => backdrop.remove();
      document.getElementById('confirmClose').onclick = async () => { const button = document.getElementById('confirmClose'); button.disabled = true; button.textContent = 'Cerrando...'; try { const result = await request(`/api/tickets/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ reason: document.getElementById('closeReason').value }) }); backdrop.remove(); showNotice(result.noticeSent ? 'Ticket cerrado y mensaje final enviado.' : 'Ticket cerrado. La ventana vencida impidió enviar texto libre.'); await loadTickets(); window.loadConversationDetail?.(currentContactId); window.loadConversations?.(true, true); } catch (error) { button.disabled = false; button.textContent = 'Confirmar cierre'; showNotice(error.message, true); } };
    } catch (error) { showNotice(error.message, true); }
  }
  async function sendOrderLink(id, button) {
    button.disabled = true; button.textContent = 'Enviando...';
    try { const result = await request(`/api/tickets/${encodeURIComponent(id)}/order-link`, { method: 'POST' }); showNotice(result.viaTemplate ? 'Link enviado con plantilla aprobada y bot activado.' : 'Link enviado y bot activado.'); await loadTickets(); if (currentContactId) { window.loadConversationDetail?.(currentContactId); window.loadLatestMessages?.(true); } }
    catch (error) { button.disabled = false; button.textContent = 'Enviar link'; showNotice(error.message, true); }
  }

  function schedule(delay = 180) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshConversationTicket, delay); }
  async function refreshConversationTicket() {
    const panel = document.getElementById('contactPanel'); if (!currentContactId || !panel) return;
    try {
      const detail = await request(`/api/conversations/${encodeURIComponent(currentContactId)}`); const ticket = detail.openTicket; const key = ticket ? `${ticket.id}:${ticket.ticketType}:${ticket.answeredAt || ''}:${ticket.fallbackError || ''}` : `${currentContactId}:none:${(detail.tickets || []).length}`;
      const scroll = panel.querySelector('.contact-scroll'); if (!scroll) return;
      const existingCard = scroll.querySelector('[data-support-ticket-card]');
      if (key === renderedKey && (ticket ? existingCard : !existingCard)) return;
      scroll.querySelector('[data-support-ticket-card]')?.remove(); scroll.querySelector('[data-ticket-history]')?.remove();
      if (ticket) {
        const card = document.createElement('section'); card.className = 'support-ticket-card'; card.dataset.supportTicketCard = 'true';
        const typeText = ticket.ticketType === 'order' ? `Pedido #${ticket.orderId || 'sin número'} recibido. Revisá la lista en el chat antes de responder.` : (ticket.question || 'Esperando que la persona escriba su pregunta...');
        const expired = ticket.ticketType === 'order' && !windowOpen({ lastIncomingAt: detail.contact.lastIncomingAt });
        card.innerHTML = `<span class="ticket-label">${labels[ticket.ticketType]} abierto</span><h3>${esc(ticket.subject)}</h3><p>${esc(typeText)}</p><span class="ticket-status ${expired ? 'expired' : ticket.answeredAt ? 'responded' : 'open'}">${expired ? 'Vencido · requiere plantilla' : ticket.answeredAt ? 'Respondido' : 'Abierto'}</span><small>Creado ${esc(date(ticket.createdAt))}${ticket.answeredAt ? ` · Respondido ${esc(date(ticket.answeredAt))}` : ''}</small><div class="ticket-actions">${ticket.ticketType === 'order' ? '<button class="primary" data-order-fallback="true">Enviar link y activar bot</button>' : ''}<button class="secondary" data-ticket-close="${esc(ticket.id)}">${ticket.ticketType === 'order' ? 'Finalizar pedido' : 'Finalizar consulta'}</button></div>`;
        scroll.prepend(card);
        const release = document.getElementById('releaseButton');
        if (release) { release.textContent = ticket.ticketType === 'order' ? 'Finalizar pedido' : 'Finalizar consulta'; release.onclick = () => showCloseModal(ticket.id); }
        const actions = document.querySelector('.chat-actions'); if (actions) { actions.querySelector('[data-header-ticket]')?.remove(); const button = document.createElement('button'); button.className = 'secondary'; button.dataset.headerTicket = 'true'; button.textContent = ticket.ticketType === 'order' ? 'Enviar link' : 'Cerrar ticket'; button.onclick = () => ticket.ticketType === 'order' ? sendOrderLinkFromConversation(ticket.id, button) : showCloseModal(ticket.id); actions.appendChild(button); }
      } else document.querySelector('.chat-actions [data-header-ticket]')?.remove();
      const history = (detail.tickets || []).filter(item => item.status === 'closed').slice(0, 5); if (history.length) { const section = document.createElement('section'); section.className = 'ticket-history'; section.dataset.ticketHistory = 'true'; section.innerHTML = `<h4>Historial de tickets</h4>${history.map(item => `<div class="ticket-history-row"><span><b class="ticket-badge ${item.ticketType}">${labels[item.ticketType]}</b> ${esc(item.subject)}</span><span><strong>${esc(reasons[item.closureReason] || item.closureReason || 'Cerrado')}</strong><small>${esc(date(item.closedAt))}</small></span></div>`).join('')}`; scroll.appendChild(section); }
      renderedKey = key;
    } catch {}
  }
  async function sendOrderLinkFromConversation(ticketId, button) { button.disabled = true; button.textContent = 'Enviando...'; try { const result = await request(`/api/tickets/${encodeURIComponent(ticketId)}/order-link`, { method: 'POST' }); showNotice(result.viaTemplate ? 'Link enviado con plantilla aprobada y bot activado.' : 'Link enviado y bot activado.'); await refreshConversationTicket(); window.loadConversationDetail?.(currentContactId); window.loadLatestMessages?.(true); } catch (error) { button.disabled = false; button.textContent = 'Enviar link'; showNotice(error.message, true); } }

  document.addEventListener('click', event => { const target = event.target instanceof Element ? event.target : null; if (target?.closest('[data-order-fallback]')) { const ticketButton = target.closest('[data-ticket-close]'); if (ticketButton) return; const card = target.closest('[data-support-ticket-card]'); void sendOrderLinkFromConversation(card?.querySelector('[data-ticket-close]')?.dataset.ticketClose, target); return; } const selected = target?.closest('#conversationList [data-id], .recent[data-contact], .table-contact[data-contact]'); if (selected) { currentContactId = selected.dataset.id || selected.dataset.contact || null; renderedKey = ''; schedule(350); } if (target?.closest('#releaseButton, #takeButton')) schedule(900); }, true);
  const observer = new MutationObserver(() => { if (currentContactId && document.getElementById('contactPanel')?.querySelector('.contact-scroll')) schedule(250); });
  observer.observe(document.body, { childList: true, subtree: true });
  addTicketsView();
})();
