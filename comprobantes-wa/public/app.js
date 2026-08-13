document.addEventListener('DOMContentLoaded', () => {
    // --- PWA INSTALLATION ---
    // Chrome/Android supplies this event once the app passes its installability checks.
    // iOS deliberately does not expose it; users install from Safari's Share menu.
    let deferredInstallPrompt = null;
    const btnInstallApp = document.getElementById('btnInstallApp');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    function showInstallHelp() {
        const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isAndroid = /android/i.test(navigator.userAgent);
        if (isIos) {
            alert('Para instalarla en iPhone: tocá Compartir en Safari y elegí “Agregar a pantalla de inicio”.');
        } else if (isAndroid) {
            alert('Abrí el menú ⋮ de Chrome y elegí “Instalar app” o “Agregar a pantalla principal”.');
        } else {
            alert('Para instalarla, abrí el menú de tu navegador y elegí “Instalar app” o “Agregar a pantalla de inicio”.');
        }
    }

    if (btnInstallApp && isStandalone) {
        btnInstallApp.hidden = true;
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.warn('No se pudo registrar el modo app:', err);
            });
        });
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (btnInstallApp) btnInstallApp.hidden = false;
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (btnInstallApp) btnInstallApp.hidden = true;
        showToast('App instalada correctamente.', 'success');
    });

    if (btnInstallApp) {
        btnInstallApp.addEventListener('click', async () => {
            if (!deferredInstallPrompt) {
                showInstallHelp();
                return;
            }

            try {
                await deferredInstallPrompt.prompt();
                const choice = await deferredInstallPrompt.userChoice;
                if (choice?.outcome === 'accepted') {
                    showToast('Instalación confirmada. La app aparecerá en tu inicio.', 'success');
                }
            } catch (err) {
                console.warn('El navegador no pudo abrir el instalador:', err);
                showInstallHelp();
            } finally {
                deferredInstallPrompt = null;
                btnInstallApp.hidden = true;
            }
        });
    }

    // --- GLOBAL STATE & DOM ELEMENTS ---
    let receiptsData = [];
    let selectedReceipt = null;
    const todayString = new Date().toLocaleDateString('sv'); // sv format: YYYY-MM-DD
    let currentFilter = { days: null, startDate: null, endDate: null, search: '', fecha: todayString };
    let activeStatusFilter = 'all';
    let activeLocalFilter = 'all';
    let searchDebounce = null;
    let statusUpdateDebounce = null; // Debounce for rapid status_update events
    let appConfig = {
        local1Numbers: [],
        local1Names: [],
        recipientAlias: '',
        mercadoFrescosBranches: []
    }; // loaded from /api/config
    const MERCADO_FRESCOS_ACCOUNT = 'mercado_frescos';
    const DEFAULT_MERCADO_FRESCOS_BRANCHES = [
        { id: 'mercado_frescos_merlo', label: 'Merlo', senderNumber: '3516161274', icon: 'fa-store' },
        { id: 'mercado_frescos_villa_dolores', label: 'Villa Dolores', senderNumber: '3516161285', icon: 'fa-store' },
        { id: 'mercado_frescos_mina_clavero', label: 'Mina Clavero', senderNumber: '3512327471', icon: 'fa-store' },
        { id: 'mercado_frescos_repartos', label: 'Repartos', senderNumber: null, icon: 'fa-truck' }
    ];
    let activeReceiptAccount = 'abasto';
    let pendingHistoryNavigation = null;
    let receiptsFetchSequence = 0;


    // View Navigation Tabs
    const navTabs = document.querySelectorAll('.nav-tab');
    const appViews = document.querySelectorAll('.app-view');

    // Toast Container
    const toastContainer = document.getElementById('toastContainer');

    // Latest receipts view
    const latestReceiptsList = document.getElementById('latestReceiptsList');
    let latestReceipts = [];

    // DOM Elements - Receipts View
    const connectionStatusPill = document.getElementById('connectionStatusPill');
    const connectionStatusText = document.getElementById('connectionStatusText');
    const targetGroupBadge = document.getElementById('targetGroupBadge');
    const targetGroupName = document.getElementById('targetGroupName');
    
    const kpiLocal1Amount = document.getElementById('kpiLocal1Amount');
    const kpiLocal1Count  = document.getElementById('kpiLocal1Count');
    const kpiLocal2Amount = document.getElementById('kpiLocal2Amount');
    const kpiLocal2Count  = document.getElementById('kpiLocal2Count');
    const abastoLocal1Kpi = document.getElementById('abastoLocal1Kpi');
    const abastoLocal2Kpi = document.getElementById('abastoLocal2Kpi');
    const mercadoFrescosKpis = document.getElementById('mercadoFrescosKpis');
    const kpiTotalCount   = document.getElementById('kpiTotalCount');
    const kpiFilterRange  = document.getElementById('kpiFilterRange');
    
    const btnFilterToday = document.getElementById('btnFilterToday');
    const btnFilterYesterday = document.getElementById('btnFilterYesterday');
    const inputFilterSingleDate = document.getElementById('inputFilterSingleDate');
    const inputStartDate = document.getElementById('inputStartDate');
    const inputEndDate = document.getElementById('inputEndDate');
    const btnApplyCustomDates = document.getElementById('btnApplyCustomDates');
    const inputSearch = document.getElementById('inputSearch');

    const viewHistory = document.getElementById('viewHistory');
    const btnRefreshHistory = document.getElementById('btnRefreshHistory');
    const historyGrid = document.getElementById('historyGrid');
    const historyAccountFilterBtns = document.querySelectorAll('.history-account-filter');
    let historyAccount = 'abasto';
    let historyDays = [];
    
    const btnExportExcel = document.getElementById('btnExportExcel');
    const btnOpenUploadModal = document.getElementById('btnOpenUploadModal');
    const btnClearAllReceipts = document.getElementById('btnClearAllReceipts');
    const btnOpenQrModal = document.getElementById('btnOpenQrModal');
    
    const tableCountBadge = document.getElementById('tableCountBadge');
    const receiptsTableBody = document.getElementById('receiptsTableBody');
    const statusPillBtns = document.querySelectorAll('.status-pill');

    const countPillAll = document.getElementById('countPillAll');
    const countPillCompleted = document.getElementById('countPillCompleted');
    const countPillDuplicate = document.getElementById('countPillDuplicate');
    const countPillPossibleDuplicate = document.getElementById('countPillPossibleDuplicate');
    const countPillNotes = document.getElementById('countPillNotes');
    const localFilterGroup = document.getElementById('localFilterGroup');
    
    // Modals
    const qrModal = document.getElementById('qrModal');
    const btnCloseQrModal = document.getElementById('btnCloseQrModal');
    const qrLoadingSpinner = document.getElementById('qrLoadingSpinner');
    const qrImage = document.getElementById('qrImage');
    const qrSuccessState = document.getElementById('qrSuccessState');
    
    const detailsModal = document.getElementById('detailsModal');
    const btnCloseDetailsModal = document.getElementById('btnCloseDetailsModal');
    const modalImagePreview = document.getElementById('modalImagePreview');
    const modalPdfPreview = document.getElementById('modalPdfPreview');
    const modalPdfIframe = document.getElementById('modalPdfIframe');
    const modalPdfLink = document.getElementById('modalPdfLink');
    const modalFechaInput = document.getElementById('modalFechaInput');
    const modalFechaComprobanteInput = document.getElementById('modalFechaComprobanteInput');
    const btnSaveFechaModal = document.getElementById('btnSaveFechaModal');
    const btnSaveFechaComprobanteModal = document.getElementById('btnSaveFechaComprobanteModal');
    const modalHoraInput = document.getElementById('modalHoraInput');
    const btnSaveHoraModal = document.getElementById('btnSaveHoraModal');
    const modalMontoInput = document.getElementById('modalMontoInput');
    const btnSaveMontoModal = document.getElementById('btnSaveMontoModal');
    const modalLocalSelect = document.getElementById('modalLocalSelect');
    const btnSaveLocalModal = document.getElementById('btnSaveLocalModal');
    const modalNroOp = document.getElementById('modalNroOp');
    const modalEmisor = document.getElementById('modalEmisor');
    const modalTipo = document.getElementById('modalTipo');
    const modalSender = document.getElementById('modalSender');
    const modalFilename = document.getElementById('modalFilename');
    const modalRawText = document.getElementById('modalRawText');
    const modalNotes = document.getElementById('modalNotes');
    const btnSaveNoteModal = document.getElementById('btnSaveNoteModal');
    const modalDuplicateAlert = document.getElementById('modalDuplicateAlert');
    const modalDuplicateText = document.getElementById('modalDuplicateText');
    const btnReprocessModal = document.getElementById('btnReprocessModal');

    function getMercadoFrescosBranches() {
        return Array.isArray(appConfig.mercadoFrescosBranches) && appConfig.mercadoFrescosBranches.length > 0
            ? appConfig.mercadoFrescosBranches
            : DEFAULT_MERCADO_FRESCOS_BRANCHES;
    }

    function getLocalFilterButtons() {
        return localFilterGroup
            ? localFilterGroup.querySelectorAll('.local-filter-pill')
            : [];
    }

    function syncLocalFilterButtons() {
        getLocalFilterButtons().forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-local-filter') === activeLocalFilter);
        });
    }

    function populateLocalFilterOptions() {
        if (!localFilterGroup) return;

        const isMercadoFrescos = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT;
        const options = isMercadoFrescos
            ? [
                { value: 'all', label: 'Todos' },
                ...getMercadoFrescosBranches().map(branch => ({
                    value: branch.id,
                    label: branch.label
                })),
                { value: 'mercado_frescos_sin_asignar', label: 'Sin asignar' }
            ]
            : [
                { value: 'all', label: 'Todos' },
                { value: 'local1', label: 'Local Cba' },
                { value: 'local2', label: 'Repartos' }
            ];

        if (!options.some(option => option.value === activeLocalFilter)) {
            activeLocalFilter = 'all';
        }

        localFilterGroup.innerHTML = `
            <span class="local-filter-label">Local:</span>
            ${options.map(option => `
                <button class="local-filter-pill${option.value === activeLocalFilter ? ' active' : ''}"
                        data-local-filter="${option.value}" type="button">${escapeHtml(option.label)}</button>
            `).join('')}
        `;
        syncLocalFilterButtons();
    }

    function isMercadoFrescosLocal(local) {
        const value = String(local || '');
        return value === MERCADO_FRESCOS_ACCOUNT || value.startsWith(`${MERCADO_FRESCOS_ACCOUNT}_`);
    }

    function getMercadoFrescosBranchForReceipt(receipt) {
        const direct = getMercadoFrescosBranches().find(branch => branch.id === receipt?.local);
        if (direct) return direct;

        // Legacy Mercado rows did not have a branch. We can still recover the
        // three known sender-based branches when the sender number is present.
        const senderDigits = String(receipt?.sender || '').replace(/\D/g, '');
        return getMercadoFrescosBranches().find(branch =>
            branch.senderNumber && senderDigits.endsWith(branch.senderNumber)
        ) || null;
    }

    function getMercadoFrescosBranchId(receipt) {
        return getMercadoFrescosBranchForReceipt(receipt)?.id || 'mercado_frescos_sin_asignar';
    }
    
    const uploadModal = document.getElementById('uploadModal');
    const btnCloseUploadModal = document.getElementById('btnCloseUploadModal');
    const uploadForm = document.getElementById('uploadForm');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    const noPhotoModal = document.getElementById('noPhotoModal');
    const btnOpenNoPhotoModal = document.getElementById('btnOpenNoPhotoModal');
    const btnCloseNoPhotoModal = document.getElementById('btnCloseNoPhotoModal');
    const noPhotoForm = document.getElementById('noPhotoForm');
    const noPhotoFecha = document.getElementById('noPhotoFecha');
    const noPhotoHora = document.getElementById('noPhotoHora');
    const noPhotoMonto = document.getElementById('noPhotoMonto');
    const noPhotoLocal = document.getElementById('noPhotoLocal');
    const noPhotoEmisor = document.getElementById('noPhotoEmisor');
    const noPhotoTipo = document.getElementById('noPhotoTipo');
    const noPhotoOperacion = document.getElementById('noPhotoOperacion');
    const noPhotoConcepto = document.getElementById('noPhotoConcepto');
    const noPhotoNota = document.getElementById('noPhotoNota');
    const noPhotoAccountHint = document.getElementById('noPhotoAccountHint');
    const modalNoPhotoPreview = document.getElementById('modalNoPhotoPreview');

    // DOM Elements - Reconciliation View
    let savedReconciliations = [];
    let currentAudit = null;
    let analyzedReport = null;
    let currentSubtab = 'verified';

    const inputAuditName = document.getElementById('inputAuditName');
    const reconAccountSelect = document.getElementById('reconAccount');
    const reconStartDate = document.getElementById('reconStartDate');
    const reconEndDate = document.getElementById('reconEndDate');
    const reconcileDropZone = document.getElementById('reconcileDropZone');
    const reconcileFileInput = document.getElementById('reconcileFileInput');
    const reconcileFileNameDisplay = document.getElementById('reconcileFileNameDisplay');
    const btnSaveCurrentAudit = document.getElementById('btnSaveCurrentAudit');
    const savedReconciliationsList = document.getElementById('savedReconciliationsList');
    
    const reconEmptyState = document.getElementById('reconEmptyState');
    const reconAuditDashboard = document.getElementById('reconAuditDashboard');
    const reconAuditTitle = document.getElementById('reconAuditTitle');
    const reconAuditMeta = document.getElementById('reconAuditMeta');
    const btnDeleteAudit = document.getElementById('btnDeleteAudit');
    const btnRecalculateAudit = document.getElementById('btnRecalculateAudit');
    const reconMatchPercentText = document.getElementById('reconMatchPercentText');
    const reconMatchProgressFill = document.getElementById('reconMatchProgressFill');

    const recKpiVerified = document.getElementById('recKpiVerified');
    const recKpiVerifiedCount = document.getElementById('recKpiVerifiedCount');
    const recKpiUnverified = document.getElementById('recKpiUnverified');
    const recKpiUnverifiedCount = document.getElementById('recKpiUnverifiedCount');
    const recKpiUnclaimed = document.getElementById('recKpiUnclaimed');
    const recKpiUnclaimedCount = document.getElementById('recKpiUnclaimedCount');
    const recKpiDuplicates = document.getElementById('recKpiDuplicates');

    const subtabBtns = document.querySelectorAll('.subtab-btn');
    const reconTableHeader = document.getElementById('reconTableHeader');
    const reconTableBody = document.getElementById('reconTableBody');

    // --- TOAST SYSTEM ---
    function showToast(message, type = 'info') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const iconMap = {
            success: 'fa-circle-check',
            error: 'fa-circle-xmark',
            warning: 'fa-triangle-exclamation',
            info: 'fa-circle-info'
        };

        toast.innerHTML = `<i class="fa-solid ${iconMap[type] || iconMap.info}"></i> <span>${escapeHtml(message)}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // --- LATEST RECEIPTS ---
    function formatLatestDate(value) {
        if (!value) return 'Sin dato';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    }

    function isPdfReceipt(receipt) {
        return typeof receipt?.filename === 'string' && receipt.filename.toLowerCase().endsWith('.pdf');
    }

    function getReceiptPreviewUrl(receipt) {
        if (!receipt?.id) return '';
        return receipt.thumbnailUrl || `/api/receipts/${encodeURIComponent(receipt.id)}/thumbnail`;
    }

    function getReceiptMediaUrl(receipt) {
        return receipt?.filename ? `/media/${encodeURIComponent(receipt.filename)}` : '';
    }

    function setDuplicatePreview(elementId, receipt) {
        const current = document.getElementById(elementId);
        if (!current) return;

        if (isPdfReceipt(receipt)) {
            if (current.tagName !== 'DIV') {
                const pdfPreview = document.createElement('div');
                pdfPreview.id = elementId;
                pdfPreview.className = 'thumb-pdf-preview';
                pdfPreview.style.cssText = 'width: 85px; height: 110px; border-radius: 8px; cursor: pointer;';
                pdfPreview.innerHTML = '<i class="fa-solid fa-file-pdf"></i><span>PDF</span>';
                current.replaceWith(pdfPreview);
            }
            const pdfElement = document.getElementById(elementId);
            pdfElement.title = 'Abrir PDF';
            pdfElement.onclick = () => window.openDetailsModal(receipt.id);
            return;
        }

        let image = current;
        if (current.tagName !== 'IMG') {
            image = document.createElement('img');
            image.id = elementId;
            image.style.cssText = 'width: 85px; height: 110px; object-fit: cover; cursor: zoom-in; display: block;';
            current.replaceWith(image);
        }
        image.src = getReceiptPreviewUrl(receipt);
        image.alt = 'Vista previa del comprobante';
        image.title = 'Ver en pantalla completa';
        image.onclick = () => window.openLightbox(getReceiptMediaUrl(receipt));
    }

    function getLatestLocalLabel(receipt) {
        if (isMercadoFrescosLocal(receipt?.local)) {
            const branch = getMercadoFrescosBranchForReceipt(receipt);
            return branch ? `Mercado de Frescos - ${branch.label}` : 'Mercado de Frescos - Sin asignar';
        }
        return receipt?.local === 'local2' ? 'Abasto del Campo - Repartos' : 'Abasto del Campo - Local Cba';
    }

    function latestReceiptNeedsReview(receipt) {
        const amount = Number(receipt?.monto);
        return receipt?.status !== 'completed' || !receipt?.fecha || !receipt?.hora || !Number.isFinite(amount) || amount <= 0;
    }

    function getLatestStatusLabel(receipt) {
        if (receipt?.status === 'filtered') return 'Fuera del cruce';
        if (receipt?.status === 'error') return 'Error de OCR';
        if (latestReceiptNeedsReview(receipt)) return 'Revisar datos';
        if (receipt?.repeatCount > 1) return `Repetido (${receipt.repeatCount})`;
        return 'Procesado';
    }

    function getLatestTimestamp(receipt) {
        const timestamp = Date.parse(receipt?.createdAt || receipt?.updatedAt || '');
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function renderLatestReceipts() {
        if (!latestReceiptsList) return;
        if (latestReceipts.length === 0) {
            latestReceiptsList.innerHTML = '<div class="latest-receipts-empty"><i class="fa-solid fa-inbox"></i><p>Todavía no hay comprobantes recibidos.</p></div>';
            return;
        }

        latestReceiptsList.innerHTML = latestReceipts.map(receipt => {
            const needsReview = latestReceiptNeedsReview(receipt);
            const receiptDate = [receipt.fecha, receipt.hora].filter(Boolean).join(' ') || 'No detectada';
            const amount = Number(receipt.monto);
            const amountLabel = Number.isFinite(amount) && amount > 0
                ? `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`
                : 'Monto no detectado';
            const statusLabel = getLatestStatusLabel(receipt);
            const statusClass = needsReview ? 'warning-badge' : 'completed';
            const hasPhoto = Boolean(receipt.filename);
            const isPdf = isPdfReceipt(receipt);
            const thumbnailUrl = hasPhoto ? getReceiptPreviewUrl(receipt) : '';
            const photoMarkup = isPdf
                ? `<div class="thumb-pdf-preview" title="Vista previa PDF"><i class="fa-solid fa-file-pdf"></i><span>PDF</span></div>`
                : hasPhoto
                ? `<img src="${thumbnailUrl}" alt="Foto del comprobante" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="latest-receipt-photo-placeholder" style="display: none;"><i class="fa-solid fa-file-circle-question"></i><span>Sin vista previa</span></div>`
                : '<div class="latest-receipt-photo-placeholder"><i class="fa-solid fa-image"></i><span>Sin foto</span></div>';

            return `
                <article class="latest-receipt-item ${needsReview ? 'needs-review' : ''}">
                    <div class="latest-receipt-photo">${photoMarkup}</div>
                    <div class="latest-receipt-content">
                        <div class="latest-receipt-heading">
                            <div>
                                <span class="latest-receipt-local">${escapeHtml(getLatestLocalLabel(receipt))}</span>
                                <h3>${escapeHtml(receipt.destinatario || 'Destinatario no detectado')}</h3>
                            </div>
                            <div class="latest-receipt-heading-right">
                                <strong class="latest-receipt-amount">${escapeHtml(amountLabel)}</strong>
                                <span class="badge-status ${statusClass}">${escapeHtml(statusLabel)}</span>
                            </div>
                        </div>
                        <div class="latest-receipt-meta">
                            <span><strong>Fecha del comprobante:</strong> ${escapeHtml(receiptDate)}</span>
                            <span><strong>Recibido por WhatsApp:</strong> ${escapeHtml(formatLatestDate(receipt.createdAt))}</span>
                            <span><strong>Emisor:</strong> ${escapeHtml(receipt.emisor || 'No detectado')}</span>
                            <span><strong>Operación:</strong> ${escapeHtml(receipt.nro_operacion || 'No detectada')}</span>
                            <span><strong>Remitente:</strong> ${escapeHtml(receipt.sender || 'No detectado')}</span>
                            ${receipt.tipo_comprobante ? `<span><strong>Tipo:</strong> ${escapeHtml(receipt.tipo_comprobante)}</span>` : ''}
                            ${receipt.concepto ? `<span><strong>Concepto:</strong> ${escapeHtml(receipt.concepto)}</span>` : ''}
                            ${receipt.repeatCount > 1 ? `<span><strong>Veces recibido:</strong> ${escapeHtml(String(receipt.repeatCount))}</span>` : ''}
                        </div>
                    </div>
                </article>`;
        }).join('');
    }

    function upsertLatestReceipt(receipt, shouldRender = true) {
        if (!receipt?.id) return;
        const existingIndex = latestReceipts.findIndex(item => item.id === receipt.id);
        if (existingIndex !== -1) {
            latestReceipts[existingIndex] = { ...latestReceipts[existingIndex], ...receipt };
        } else {
            latestReceipts.push({ ...receipt });
        }
        latestReceipts.sort((a, b) => getLatestTimestamp(b) - getLatestTimestamp(a));
        latestReceipts = latestReceipts.slice(0, 100);
        if (shouldRender) renderLatestReceipts();
    }

    async function fetchLatestReceipts() {
        try {
            const response = await fetch('/api/receipts/latest?limit=100');
            if (!response.ok) throw new Error('No se pudieron cargar los últimos comprobantes');
            const incoming = await response.json();
            latestReceipts = Array.isArray(incoming)
                ? incoming.sort((a, b) => getLatestTimestamp(b) - getLatestTimestamp(a)).slice(0, 100)
                : [];
            renderLatestReceipts();
        } catch (err) {
            console.warn('Could not refresh latest receipts:', err);
            if (latestReceiptsList) {
                latestReceiptsList.innerHTML = '<div class="latest-receipts-empty"><i class="fa-solid fa-triangle-exclamation"></i><p>No se pudieron cargar los últimos comprobantes.</p></div>';
            }
        }
    }

    fetchLatestReceipts();

    // --- NAVIGATION TABS SWITCHING ---
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            navTabs.forEach(t => t.classList.remove('active'));
            appViews.forEach(v => {
                v.classList.remove('active');
                v.style.display = 'none';
            });

            tab.classList.add('active');
            const targetViewId = tab.getAttribute('data-view');
            const requestedAccount = tab.getAttribute('data-account') || 'abasto';
            const pendingDay = targetViewId === 'viewReceipts' ? pendingHistoryNavigation : null;
            if (pendingDay) pendingHistoryNavigation = null;
            const targetView = document.getElementById(targetViewId);
            if (targetView) {
                targetView.classList.add('active');
                targetView.style.display = 'flex';
            }

            // Update top bar page title
            const topPageTitle = document.getElementById('topPageTitle');
            if (topPageTitle) {
                if (targetViewId === 'viewReceipts') {
                    activeReceiptAccount = requestedAccount;
                    resetReceiptFiltersForAccount();
                    if (pendingDay) {
                        currentFilter.fecha = pendingDay.fecha;
                        currentFilter.days = null;
                        currentFilter.startDate = null;
                        currentFilter.endDate = null;
                        if (inputFilterSingleDate) {
                            inputFilterSingleDate.value = pendingDay.fecha === 'Sin fecha' ? '' : pendingDay.fecha;
                        }
                        if (btnFilterToday) btnFilterToday.classList.toggle('active', pendingDay.fecha === todayString);
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        if (btnFilterYesterday) {
                            btnFilterYesterday.classList.toggle('active', pendingDay.fecha === yesterday.toLocaleDateString('sv'));
                        }
                    }
                    updateReceiptAccountUI();
                    topPageTitle.textContent = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT
                        ? 'Mercado de Frescos'
                        : 'Abasto del Campo';
                } else if (targetViewId === 'viewHistory') {
                    topPageTitle.textContent = 'Historial de Jornadas';
                } else if (targetViewId === 'viewLatestReceipts') {
                    topPageTitle.textContent = 'Últimos comprobantes';
                } else if (targetViewId === 'viewReconciliation') {
                    topPageTitle.textContent = 'Conciliación Bancaria';
                    if (reconAccountSelect) {
                        reconAccountSelect.value = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT
                            ? MERCADO_FRESCOS_ACCOUNT
                            : 'abasto';
                    }
                }
            }

            // Close sidebar overlay on mobile after clicking a link
            const dashboardSidebar = document.getElementById('dashboardSidebar');
            if (dashboardSidebar && window.innerWidth <= 768) {
                dashboardSidebar.classList.remove('mobile-active');
            }

            if (targetViewId === 'viewReconciliation') {
                fetchSavedReconciliations();
            } else if (targetViewId === 'viewHistory') {
                fetchDailyStats();
            } else if (targetViewId === 'viewLatestReceipts') {
                fetchLatestReceipts();
            } else if (targetViewId === 'viewReceipts') {
                fetchReceipts();
            }
        });
    });

    // --- SIDEBAR TOGGLE INTERACTIVE LOGIC ---
    const btnToggleSidebar = document.getElementById('btnToggleSidebar');
    const btnToggleSidebarMobile = document.getElementById('btnToggleSidebarMobile');
    const dashboardWrapper = document.getElementById('dashboardWrapper');
    const dashboardSidebar = document.getElementById('dashboardSidebar');

    // Load sidebar preference from localStorage
    if (localStorage.getItem('sidebar-collapsed') === 'true' && window.innerWidth > 768) {
        if (dashboardWrapper) dashboardWrapper.classList.add('sidebar-collapsed');
    }

    if (btnToggleSidebar) {
        btnToggleSidebar.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent immediate close from document click listener
            if (window.innerWidth <= 768) {
                // On mobile, toggle the overlay drawer sidebar
                if (dashboardSidebar) dashboardSidebar.classList.toggle('mobile-active');
            } else {
                // On desktop, toggle collapse/expand state
                if (dashboardWrapper) {
                    dashboardWrapper.classList.toggle('sidebar-collapsed');
                    localStorage.setItem('sidebar-collapsed', dashboardWrapper.classList.contains('sidebar-collapsed'));
                }
            }
        });
    }

    if (btnToggleSidebarMobile) {
        btnToggleSidebarMobile.addEventListener('click', () => {
            if (dashboardSidebar) {
                dashboardSidebar.classList.remove('mobile-active');
            }
        });
    }

    // Close sidebar when clicking outside of it on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && dashboardSidebar && dashboardSidebar.classList.contains('mobile-active')) {
            const clickedInsideSidebar = dashboardSidebar.contains(e.target);
            const clickedToggleBtn = btnToggleSidebar && btnToggleSidebar.contains(e.target);
            if (!clickedInsideSidebar && !clickedToggleBtn) {
                dashboardSidebar.classList.remove('mobile-active');
            }
        }
    });

    // --- SOCKET.IO CONNECTION ---
    const socket = io({ addTrailingSlash: false });

    socket.on('connect', () => {
        console.log('Connected to socket server');
    });

    socket.on('status_update', (statusInfo) => {
        // Debounce rapid status updates (e.g. during reconnection loops)
        clearTimeout(statusUpdateDebounce);
        statusUpdateDebounce = setTimeout(() => {
            updateConnectionStatusUI(statusInfo);
        }, 600);
    });

    socket.on('receipt_processing', (tempReceipt) => {
        upsertReceiptItem(tempReceipt);
        renderTableAndKPIs();
        showToast(`Analizando nuevo comprobante de ${tempReceipt.sender || 'WhatsApp'}...`, 'info');
    });

    socket.on('receipt_processed', (processedReceipt) => {
        upsertReceiptItem(processedReceipt);
        renderTableAndKPIs();
        upsertLatestReceipt(processedReceipt);

        if (processedReceipt.repeatCount && processedReceipt.repeatCount > 1) {
            showToast(`⚠️ Comprobante de $${(processedReceipt.monto||0).toLocaleString('es-AR')} repetido (${processedReceipt.repeatCount} veces)`, 'warning');
        } else {
            showToast(`✓ Comprobante por $${(processedReceipt.monto||0).toLocaleString('es-AR')} verificado`, 'success');
        }
    });

    socket.on('receipt_deleted', ({ id }) => {
        receiptsData = receiptsData.filter(r => r.id !== id);
        renderTableAndKPIs();
        showToast('Comprobante eliminado', 'info');
    });

    socket.on('receipts_cleared', () => {
        receiptsData = [];
        renderTableAndKPIs();
        showToast('Base de datos de comprobantes limpiada', 'info');
    });

    socket.on('reconciliation_updated', (updatedRecon) => {
        const idx = savedReconciliations.findIndex(r => r.id === updatedRecon.id);
        if (idx !== -1) {
            savedReconciliations[idx] = updatedRecon;
        } else {
            savedReconciliations.unshift(updatedRecon);
        }
        
        renderSavedReconciliationsList();

        if (currentAudit && currentAudit.id === updatedRecon.id) {
            currentAudit = updatedRecon;
            renderAuditDashboard();
            showToast(`Conciliación "${updatedRecon.name}" actualizada automáticamente`, 'success');
        }
    });

    // --- API FETCH FUNCTIONS ---
    async function fetchReceipts() {
        const requestId = ++receiptsFetchSequence;
        const requestAccount = activeReceiptAccount;
        const query = new URLSearchParams();
        if (currentFilter.fecha) query.append('fecha', currentFilter.fecha);
        if (currentFilter.days) query.append('days', currentFilter.days);
        if (currentFilter.startDate) query.append('startDate', currentFilter.startDate);
        if (currentFilter.endDate) query.append('endDate', currentFilter.endDate);
        if (currentFilter.search) query.append('search', currentFilter.search);
        query.append('account', activeReceiptAccount);

        // Update range label in the UI
        if (kpiFilterRange) {
            if (currentFilter.fecha) {
                kpiFilterRange.textContent = currentFilter.fecha === todayString ? 'Hoy' : currentFilter.fecha;
            } else if (currentFilter.startDate && currentFilter.endDate) {
                kpiFilterRange.textContent = `${currentFilter.startDate} a ${currentFilter.endDate}`;
            } else if (currentFilter.startDate) {
                kpiFilterRange.textContent = `Desde ${currentFilter.startDate}`;
            } else if (currentFilter.endDate) {
                kpiFilterRange.textContent = `Hasta ${currentFilter.endDate}`;
            } else {
                kpiFilterRange.textContent = 'Histórico Completo';
            }
        }

        try {
            const res = await fetch(`/api/receipts?${query.toString()}`);
            if (res.ok) {
                const nextReceipts = await res.json();
                // A slower previous request (for example the default "Hoy"
                // query triggered while switching tabs) must never overwrite
                // the day/account the operator selected afterwards.
                if (requestId !== receiptsFetchSequence || requestAccount !== activeReceiptAccount) return;
                receiptsData = nextReceipts;
                renderTableAndKPIs();
            }
        } catch (err) {
            console.error('Error fetching receipts:', err);
        }
    }

    async function fetchDailyStats() {
        if (historyGrid) {
            historyGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <p>Cargando historial de jornadas...</p>
                </div>
            `;
        }
        try {
            const res = await fetch('/api/receipts/days');
            if (res.ok) {
                historyDays = await res.json();
                renderDailyStats(historyDays);
            }
        } catch (err) {
            console.error('Error fetching daily stats:', err);
            if (historyGrid) {
                historyGrid.innerHTML = `
                    <div class="empty-state">
                        <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
                        <p>Error al cargar el historial. Reintenta de nuevo.</p>
                    </div>
                `;
            }
        }
    }

    function renderDailyStats(days) {
        if (!historyGrid) return;
        if (!days || days.length === 0) {
            historyGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-calendar-xmark"></i>
                    <p>No hay jornadas registradas aún.</p>
                </div>
            `;
            return;
        }

        const accountConfig = {
            abasto: {
                label: 'Abasto del Campo',
                totalField: 'abasto_monto',
                countField: 'abasto_count',
                notesField: 'abasto_has_notes',
                duplicatesField: 'abasto_has_duplicates'
            },
            mercado_frescos: {
                label: 'Mercado de Frescos',
                totalField: 'mercado_frescos_monto',
                countField: 'mercado_frescos_count',
                notesField: 'mercado_frescos_has_notes',
                duplicatesField: 'mercado_frescos_has_duplicates'
            },
            combined: {
                label: 'Ambos',
                totalField: 'total_monto',
                countField: 'total_count',
                notesField: 'has_notes',
                duplicatesField: 'has_duplicates'
            }
        };
        const selectedConfig = accountConfig[historyAccount] || accountConfig.abasto;
        const visibleDays = (days || []).filter(day => Number(day[selectedConfig.countField] || 0) > 0);
        if (visibleDays.length === 0) {
            historyGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-calendar-xmark"></i>
                    <p>No hay jornadas registradas para ${selectedConfig.label}.</p>
                </div>
            `;
            return;
        }

        const formatDayLabel = (fechaStr) => {
            if (fechaStr === todayString) return 'Hoy (Nueva Jornada)';
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (fechaStr === yesterday.toLocaleDateString('sv')) return 'Ayer';
            
            const parts = fechaStr.split('-');
            if (parts.length === 3) {
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            return fechaStr;
        };

        const formatAmount = (amount, fractionDigits = 2) => Number(amount || 0).toLocaleString('es-AR', {
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits
        });

        const renderBreakdown = (day) => {
            if (historyAccount === 'mercado_frescos') {
                const branchCards = getMercadoFrescosBranches().map(branch => `
                    <div class="breakdown-col mercado-frescos-breakdown">
                        <span class="loc-name"><i class="fa-solid ${branch.icon || 'fa-store'}"></i> ${escapeHtml(branch.label)}</span>
                        <span class="loc-val">$${formatAmount(day[`${branch.id}_monto`], 0)}</span>
                        <span class="loc-count">${day[`${branch.id}_count`] || 0} comp.</span>
                    </div>
                `);
                const unassignedCount = Number(day.mercado_frescos_sin_asignar_count || 0);
                if (unassignedCount > 0) {
                    branchCards.push(`
                        <div class="breakdown-col account-info-breakdown">
                            <span class="loc-name"><i class="fa-solid fa-question"></i> Sin asignar</span>
                            <span class="loc-val">$${formatAmount(day.mercado_frescos_sin_asignar_monto, 0)}</span>
                            <span class="loc-count">${unassignedCount} comp.</span>
                        </div>
                    `);
                }
                return branchCards.join('');
            }
            if (historyAccount === 'combined') {
                return `
                    <div class="breakdown-col local1">
                        <span class="loc-name"><i class="fa-solid fa-store"></i> Abasto del Campo</span>
                        <span class="loc-val">$${formatAmount(day.abasto_monto, 0)}</span>
                        <span class="loc-count">${day.abasto_count || 0} comp.</span>
                    </div>
                    <div class="breakdown-col mercado-frescos-breakdown">
                        <span class="loc-name"><i class="fa-solid fa-lemon"></i> Mercado de Frescos</span>
                        <span class="loc-val">$${formatAmount(day.mercado_frescos_monto, 0)}</span>
                        <span class="loc-count">${day.mercado_frescos_count || 0} comp.</span>
                    </div>
                `;
            }
            return `
                <div class="breakdown-col local1">
                    <span class="loc-name"><i class="fa-solid fa-store"></i> Local Cba</span>
                    <span class="loc-val">$${formatAmount(day.local1_monto, 0)}</span>
                    <span class="loc-count">${day.local1_count || 0} comp.</span>
                </div>
                <div class="breakdown-col local2">
                    <span class="loc-name"><i class="fa-solid fa-truck"></i> Repartos</span>
                    <span class="loc-val">$${formatAmount(day.local2_monto, 0)}</span>
                    <span class="loc-count">${day.local2_count || 0} comp.</span>
                </div>
            `;
        };

        const cardsHtml = visibleDays.map(day => {
            const isTodayCard = day.fecha === todayString;
            const isUndatedCard = day.fecha === 'Sin fecha';
            const totalAmount = day[selectedConfig.totalField] || 0;
            const totalCount = day[selectedConfig.countField] || 0;
            const hasNotes = Boolean(day[selectedConfig.notesField]);
            const hasDuplicates = Boolean(day[selectedConfig.duplicatesField]);
            const detailClick = historyAccount === 'combined'
                ? ''
                : `onclick="goToDay('${day.fecha}', '${historyAccount}')"`;
            return `
                <div class="history-day-card ${isTodayCard ? 'today-card' : ''} ${historyAccount === 'combined' ? 'summary-only' : ''}" ${detailClick}>
                    <div class="card-header-bar">
                        <span class="card-date"><i class="fa-regular fa-calendar-check"></i> ${formatDayLabel(day.fecha)}</span>
                        <div class="card-status-badges">
                            ${hasNotes ? '<span class="history-badge note-badge" title="Tiene observaciones"><i class="fa-solid fa-comment-dots"></i> Observaciones</span>' : ''}
                            ${hasDuplicates ? '<span class="history-badge dup-badge" title="Tiene duplicados"><i class="fa-solid fa-triangle-exclamation"></i> Duplicados</span>' : ''}
                        </div>
                    </div>
                    <div class="card-main-body">
                        <div class="total-row">
                            <span class="total-label">Total ${selectedConfig.label}</span>
                            <span class="total-val">$${formatAmount(totalAmount)}</span>
                        </div>
                        <div class="count-badge">${totalCount} comprobantes procesados</div>
                        <div class="breakdown-grid">
                            ${renderBreakdown(day)}
                        </div>
                    </div>
                    <div class="card-actions-row" onclick="event.stopPropagation()">
                        ${isUndatedCard ? '<span class="history-badge" title="Abrí la tarjeta y asigná una fecha a cada comprobante."><i class="fa-solid fa-calendar-plus"></i> Asignar fechas</span>' : ''}
                        <button class="btn-action-sm btn-excel-sm" ${isUndatedCard ? 'style="display:none"' : ''} onclick="exportDayExcel('${day.fecha}', '${historyAccount}')">
                            <i class="fa-solid fa-file-excel"></i> Exportar Excel
                        </button>
                        <button class="btn-action-sm btn-recon-sm" ${isUndatedCard || historyAccount === 'combined' ? 'style="display:none"' : ''} onclick="goToReconciliationForDay('${day.fecha}', '${historyAccount}')">
                            <i class="fa-solid fa-scale-balanced"></i> Conciliar Día
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        historyGrid.innerHTML = cardsHtml;
    }

    // Attach callbacks to window so inline onclick attributes work correctly
    window.goToDay = (fecha, account = 'abasto') => {
        if (account === 'combined') {
            showToast('El resumen combinado no tiene un listado único. Elegí Abasto o Mercado para ver los comprobantes.', 'info');
            return;
        }
        pendingHistoryNavigation = { fecha, account };
        const tabReceipts = document.getElementById(account === MERCADO_FRESCOS_ACCOUNT
            ? 'tabBtnMercadoFrescos'
            : 'tabBtnReceipts');
        if (tabReceipts) tabReceipts.click();
        else pendingHistoryNavigation = null;
    };

    window.exportDayExcel = (fecha, account = 'abasto') => {
        const params = new URLSearchParams({ fecha });
        if (account === MERCADO_FRESCOS_ACCOUNT || account === 'combined') {
            params.set('account', account);
        }
        window.location.href = `/api/export-excel?${params.toString()}`;
    };

    window.goToReconciliationForDay = async (fecha, account = 'abasto') => {
        // The history card is grouped by operational/extraction date. Resolve
        // its receipts first so reconciliation is preset with their original
        // receipt-date range instead of accidentally using the extraction day.
        let reconciliationDates = [];
        try {
            const params = new URLSearchParams({ fecha });
            if (account === MERCADO_FRESCOS_ACCOUNT) params.set('account', account);
            const response = await fetch(`/api/receipts?${params.toString()}`);
            if (response.ok) {
                const dayReceipts = await response.json();
                reconciliationDates = dayReceipts
                    .map(receipt => receipt.fecha_comprobante || receipt.fecha)
                    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')))
                    .sort();
            }
        } catch (error) {
            console.warn('No se pudo resolver el rango original para conciliación:', error);
        }
        const reconciliationStart = reconciliationDates[0] || fecha;
        const reconciliationEnd = reconciliationDates[reconciliationDates.length - 1] || fecha;
        if (reconStartDate) reconStartDate.value = reconciliationStart === 'Sin fecha' ? '' : reconciliationStart;
        if (reconEndDate) reconEndDate.value = reconciliationEnd === 'Sin fecha' ? '' : reconciliationEnd;
        if (inputAuditName) inputAuditName.value = `Jornada ${fecha}`;
        if (reconAccountSelect) reconAccountSelect.value = account === MERCADO_FRESCOS_ACCOUNT ? MERCADO_FRESCOS_ACCOUNT : 'abasto';

        const tabReconciliation = document.getElementById('tabBtnReconciliation');
        if (tabReconciliation) tabReconciliation.click();
        if (reconAccountSelect) reconAccountSelect.value = account === MERCADO_FRESCOS_ACCOUNT ? MERCADO_FRESCOS_ACCOUNT : 'abasto';
    };

    if (btnRefreshHistory) {
        btnRefreshHistory.addEventListener('click', () => {
            fetchDailyStats();
        });
    }

    historyAccountFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            historyAccount = btn.dataset.historyAccount || 'abasto';
            historyAccountFilterBtns.forEach(filterBtn => {
                const isActive = filterBtn === btn;
                filterBtn.classList.toggle('active', isActive);
                filterBtn.setAttribute('aria-selected', String(isActive));
            });
            renderDailyStats(historyDays);
        });
    });

    function upsertReceiptItem(item) {
        const itemAccount = isMercadoFrescosLocal(item?.local) ? MERCADO_FRESCOS_ACCOUNT : 'abasto';
        if (itemAccount !== activeReceiptAccount) {
            // A processing placeholder is created before OCR knows the
            // destination. Remove it when the final account is known.
            receiptsData = receiptsData.filter(r => r.id !== item.id && r.filename !== item.filename);
            renderTableAndKPIs();
            return;
        }
        if (item.replacedTempId) {
            receiptsData = receiptsData.filter(r => r.id !== item.replacedTempId);
        }

        const idx = receiptsData.findIndex(r => r.id === item.id || (r.filename && r.filename === item.filename));
        if (idx !== -1) {
            receiptsData[idx] = { ...receiptsData[idx], ...item };
        } else {
            receiptsData.unshift(item);
        }
    }

    // --- UI RENDER FUNCTIONS ---
    function updateConnectionStatusUI(statusInfo) {
        const { status, qrCodeUrl, targetGroup } = statusInfo;

        connectionStatusPill.className = `connection-status-pill ${status}`;

        if (status === 'open') {
            connectionStatusText.textContent = '🟢 Conectado';
            qrLoadingSpinner.style.display = 'none';
            qrImage.style.display = 'none';
            qrSuccessState.style.display = 'block';
        } else if (status === 'connecting') {
            connectionStatusText.textContent = '🟡 Conectando...';
            qrSuccessState.style.display = 'none';
            qrImage.style.display = 'none';
            qrLoadingSpinner.style.display = 'block';
        } else if (status === 'qr') {
            connectionStatusText.textContent = '📱 Escanear QR';
            qrSuccessState.style.display = 'none';
            if (qrCodeUrl) {
                qrLoadingSpinner.style.display = 'none';
                qrImage.src = qrCodeUrl;
                qrImage.style.display = 'block';
            } else {
                qrLoadingSpinner.style.display = 'block';
                qrImage.style.display = 'none';
            }
        } else {
            connectionStatusText.textContent = '🔴 Desconectado';
            qrSuccessState.style.display = 'none';
            qrImage.style.display = 'none';
            qrLoadingSpinner.style.display = 'block';
        }

        if (targetGroup && targetGroup.name) {
            targetGroupName.textContent = targetGroup.name;
        } else {
            targetGroupName.textContent = 'Buscando grupo...';
        }
    }

    function isLocal1Sender(receipt) {
        // Check receipt.local field first (set by new bot logic)
        if (receipt.local === 'local1') return true;
        if (receipt.local === 'local2') return false;

        // Manual uploads should default to Local Cba (local1)
        if (!receipt.sender || receipt.sender.includes('Carga Manual') || (receipt.filename && receipt.filename.includes('manual'))) {
            return true;
        }

        // Fallback: appConfig.local1Names and local1Numbers are the ones for Local Cba (local1)
        let isLocalCba = false;
        if (appConfig.local1Names.length > 0 && receipt.sender) {
            isLocalCba = appConfig.local1Names.some(name => receipt.sender.includes(name));
        }
        if (!isLocalCba && appConfig.local1Numbers.length > 0 && receipt.sender) {
            isLocalCba = appConfig.local1Numbers.some(num => receipt.sender.includes(num));
        }
        return isLocalCba; // If it's Local Cba, it goes to local1 (true), else local2 (false)
    }

    function renderMercadoFrescosKpis(branchStats) {
        if (!mercadoFrescosKpis) return;
        if (activeReceiptAccount !== MERCADO_FRESCOS_ACCOUNT) {
            mercadoFrescosKpis.style.display = 'none';
            mercadoFrescosKpis.innerHTML = '';
            return;
        }

        const formatAmount = amount => Number(amount || 0).toLocaleString('es-AR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        const cards = getMercadoFrescosBranches().map((branch, index) => {
            const stats = branchStats[branch.id] || { amount: 0, count: 0 };
            const isRepartos = branch.id === 'mercado_frescos_repartos';
            const accent = isRepartos ? '#a855f7' : ['#10b981', '#3b82f6', '#f59e0b'][index] || '#10b981';
            return `
                <div class="kpi-card mercado-frescos-kpi" style="background: linear-gradient(135deg, ${accent}22, rgba(15,23,42,0.2)); border-color: ${accent}66;">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, ${accent}, ${accent}bb);"><i class="fa-solid ${branch.icon || 'fa-store'}"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">${escapeHtml(branch.label)}</span>
                        <h2 class="kpi-value">$${formatAmount(stats.amount)}</h2>
                        <small class="kpi-sub" style="color: #94a3b8; font-size: 12px;">${stats.count} comprobantes</small>
                    </div>
                </div>
            `;
        });

        const unassigned = branchStats.mercado_frescos_sin_asignar;
        if (unassigned && unassigned.count > 0) {
            cards.push(`
                <div class="kpi-card mercado-frescos-kpi" style="background: rgba(100,116,139,0.12); border-color: rgba(100,116,139,0.5);">
                    <div class="kpi-icon" style="background: linear-gradient(135deg, #64748b, #475569);"><i class="fa-solid fa-question"></i></div>
                    <div class="kpi-info">
                        <span class="kpi-label">Sin asignar</span>
                        <h2 class="kpi-value">$${formatAmount(unassigned.amount)}</h2>
                        <small class="kpi-sub" style="color: #94a3b8; font-size: 12px;">${unassigned.count} comprobantes</small>
                    </div>
                </div>
            `);
        }

        mercadoFrescosKpis.innerHTML = cards.join('');
        mercadoFrescosKpis.style.display = 'grid';
    }

    function renderTableAndKPIs() {
        let local1Amount = 0, local1Count = 0;
        let local2Amount = 0, local2Count = 0;
        const mercadoBranchStats = {};
        let count = 0;

        let completedCount = 0;
        let duplicateCount = 0;
        let notesCount = 0;

        let possibleDuplicateCount = 0;

        updateReceiptAccountUI();

        receiptsData.forEach(r => {
            const monto = typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0;
            const hasDateAndAmount = Boolean(r.fecha) && monto > 0;

            // A missing hour only means the receipt still needs review for
            // reconciliation. If it already has date and amount, it must
            // still contribute to the daily totals and local breakdowns.
            if (hasDateAndAmount && !r.isDuplicate && r.status !== 'filtered') {
                count++;
                if (r.status === 'completed') completedCount++;
                if (activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT) {
                    const branchId = getMercadoFrescosBranchId(r);
                    if (!mercadoBranchStats[branchId]) mercadoBranchStats[branchId] = { amount: 0, count: 0 };
                    mercadoBranchStats[branchId].amount += monto;
                    mercadoBranchStats[branchId].count++;
                } else if (isLocal1Sender(r)) {
                    local1Amount += monto;
                    local1Count++;
                } else {
                    local2Amount += monto;
                    local2Count++;
                }
            }
            if (r.isDuplicate || (r.repeatCount && r.repeatCount > 1)) duplicateCount++;
            if (r.duplicateReason && r.duplicateReason.startsWith('POSIBLE_DUPLICADO:')) possibleDuplicateCount++;
            if (r.notas && r.notas.trim() !== '') notesCount++;
        });

        renderMercadoFrescosKpis(mercadoBranchStats);

        if (countPillAll) countPillAll.textContent = receiptsData.length.toString();
        if (countPillCompleted) countPillCompleted.textContent = completedCount.toString();
        if (countPillDuplicate) countPillDuplicate.textContent = duplicateCount.toString();
        if (countPillPossibleDuplicate) countPillPossibleDuplicate.textContent = possibleDuplicateCount.toString();
        if (countPillNotes) countPillNotes.textContent = notesCount.toString();

        let visibleReceipts = receiptsData;
        if (activeStatusFilter === 'completed') {
            visibleReceipts = receiptsData.filter(r => r.status === 'completed' && !r.isDuplicate);
        } else if (activeStatusFilter === 'duplicate') {
            visibleReceipts = receiptsData.filter(r => r.isDuplicate || (r.repeatCount && r.repeatCount > 1));
        } else if (activeStatusFilter === 'possible_duplicate') {
            visibleReceipts = receiptsData.filter(r => r.duplicateReason && r.duplicateReason.startsWith('POSIBLE_DUPLICADO:'));
        } else if (activeStatusFilter === 'notes') {
            visibleReceipts = receiptsData.filter(r => r.notas && r.notas.trim() !== '');
        }

        if (activeLocalFilter !== 'all') {
            visibleReceipts = visibleReceipts.filter(r => {
                if (activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT) {
                    return getMercadoFrescosBranchId(r) === activeLocalFilter;
                }
                return activeLocalFilter === 'local1' ? isLocal1Sender(r) : !isLocal1Sender(r);
            });
        }

        if (!visibleReceipts || visibleReceipts.length === 0) {
            receiptsTableBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="9">
                        <div class="empty-state">
                            <i class="fa-solid fa-folder-open"></i>
                            <p>No se encontraron comprobantes para el filtro seleccionado.</p>
                        </div>
                    </td>
                </tr>
            `;
            if (kpiLocal1Amount) kpiLocal1Amount.textContent = `$${local1Amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (kpiLocal1Count)  kpiLocal1Count.textContent  = `${local1Count} comprobantes`;
            if (kpiLocal2Amount) kpiLocal2Amount.textContent = `$${local2Amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (kpiLocal2Count)  kpiLocal2Count.textContent  = `${local2Count} comprobantes`;
            kpiTotalCount.textContent = count.toString();
            tableCountBadge.textContent = `Mostrando 0 de ${receiptsData.length} comprobantes`;
            return;
        }

        const rowsHtml = visibleReceipts.map(r => {
            const montoVal = typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0;
            const formattedMonto = `$${montoVal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const formattedFecha = r.fecha || 'Sin fecha';
            const formattedFechaComprobante = r.fecha_comprobante || r.fecha || 'Sin fecha';
            const formattedHora = r.hora ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 2px; font-weight: 500; display: flex; align-items: center; gap: 3px;"><i class="fa-regular fa-clock" style="font-size: 10px;"></i> ${r.hora}</div>` : '';
            const hasMedia = Boolean(r.filename || r.thumbnailBase64);
            const mediaUrl = hasMedia ? `/media/${encodeURIComponent(r.filename)}` : '';
            
            const needsDate = r.status === 'missing_date' || (!r.fecha && r.status === 'error');
            const missingTimingLabel = r.status === 'missing_date' && r.fecha && !r.hora ? 'Falta hora' : 'Sin fecha';
            let statusBadge = r.status === 'completed'
                ? `<span class="badge-status completed"><i class="fa-solid fa-check"></i> Éxito</span>`
                : r.status === 'processing'
                ? `<span class="badge-status processing"><i class="fa-solid fa-spinner fa-spin"></i> Procesando...</span>`
                : r.status === 'filtered'
                ? `<span class="badge-status filtered-badge"><i class="fa-solid fa-filter"></i> Fuera del cruce</span>`
                : needsDate
                ? `<span class="badge-status warning-badge" title="Completá fecha y hora para incluirlo en la conciliación."><i class="fa-solid fa-calendar-xmark"></i> ${missingTimingLabel}</span>`
                : `<span class="badge-status error"><i class="fa-solid fa-triangle-exclamation"></i> Error</span>`;

            const isPossibleDuplicate = r.duplicateReason && r.duplicateReason.startsWith('POSIBLE_DUPLICADO:');

            if (r.repeatCount && r.repeatCount > 1) {
                statusBadge += ` <span class="badge-status duplicate-badge" title="${r.duplicateReason || 'Repetido'}"><i class="fa-solid fa-triangle-exclamation"></i> REPETIDO (${r.repeatCount} veces)</span>`;
            } else if (r.isDuplicate) {
                statusBadge += ` <span class="badge-status duplicate-badge" title="${r.duplicateReason || 'Repetido'}"><i class="fa-solid fa-triangle-exclamation"></i> REPETIDO</span>`;
            } else if (isPossibleDuplicate) {
                statusBadge += ` <span class="badge-status warning-badge" style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.35); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;" title="Posible duplicado (mismo monto, fecha y emisor, sin Nro de Operación)"><i class="fa-solid fa-triangle-exclamation"></i> POSIBLE DUPLICADO</span>`;
            }

            const noteDisplay = (r.notas && r.notas.trim() !== '')
                ? `<button class="btn-note-view" onclick="openNoteModal('${r.id}', event)" title="Ver nota completa"><i class="fa-solid fa-comment-dots"></i> <span>Ver Nota</span></button>`
                : `<button class="btn-note-add" onclick="openNoteModal('${r.id}', event)" title="Agregar observación"><i class="fa-solid fa-plus"></i> <span>Nota</span></button>`;

            const isPdf = hasMedia && typeof r.filename === 'string' && r.filename.toLowerCase().endsWith('.pdf');
            const thumbnailUrl = r.thumbnailUrl || `/api/receipts/${encodeURIComponent(r.id)}/thumbnail`;
            const imgSrc = r.thumbnailBase64 || thumbnailUrl;
            const thumbHtml = !hasMedia
                ? '<div class="thumb-no-photo" onclick="event.stopPropagation(); openDetailsModal(&quot;' + r.id + '&quot;)" title="Comprobante agregado sin foto"><i class="fa-solid fa-file-circle-plus"></i></div>'
                : isPdf
                ? `<div class="thumb-pdf-preview" onclick="event.stopPropagation(); openDetailsModal('${r.id}')" title="Ver PDF"><i class="fa-solid fa-file-pdf"></i> <span>PDF</span></div>`
                : `
                <div class="thumb-preview-container" style="position: relative; width: 42px; height: 42px; display: inline-block;">
                    <img src="${imgSrc}" class="thumb-preview" alt="Comprobante" loading="lazy"
                         onclick="event.stopPropagation(); openLightbox('${mediaUrl}', event)" 
                         title="Clic para ver foto en HD"
                         onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div class="thumb-placeholder" 
                         onclick="event.stopPropagation(); openDetailsModal('${r.id}')" 
                         style="display: none; width: 42px; height: 42px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: #94a3b8; align-items: center; justify-content: center; font-size: 16px; cursor: pointer;">
                        <i class="fa-solid fa-image"></i>
                    </div>
                </div>
                `;

            const assignedLocalVal = r.local || (isLocal1Sender(r) ? 'local1' : 'local2');
            const mercadoBranch = getMercadoFrescosBranchForReceipt(r);
            const localBadge = isMercadoFrescosLocal(r.local)
                ? `<span class="badge-status mercado-frescos-badge"><i class="fa-solid ${mercadoBranch?.icon || 'fa-lemon'}"></i> ${escapeHtml(mercadoBranch?.label || 'Sin asignar')}</span>`
                : assignedLocalVal === 'local1'
                ? `<span class="badge-status" style="background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-store"></i> Local Cba</span>`
                : `<span class="badge-status" style="background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-truck"></i> Repartos</span>`;

            return `
                <tr data-id="${r.id}" class="${r.isDuplicate ? 'row-duplicate' : ''}" onclick="openDetailsModal('${r.id}')" style="cursor: pointer;">
                    <td class="fecha-cell">
                        <div>${formattedFecha}</div>
                        ${formattedHora}
                    </td>
                    <td class="fecha-cell">${formattedFechaComprobante}</td>
                    <td class="monto-cell">${formattedMonto}</td>
                    <td>${thumbHtml}</td>
                    <td><span class="code-val op-id">${escapeHtml(r.nro_operacion || '-')}</span></td>
                    <td>${escapeHtml(r.emisor || '-')}</td>
                    <td>${localBadge}</td>
                    <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString() + ' ' + new Date(r.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                    <td>
                        <div class="status-col-box">
                            ${statusBadge}
                            ${noteDisplay}
                        </div>
                    </td>
                    <td class="text-right" onclick="event.stopPropagation()">
                        <div style="display: inline-grid; grid-template-columns: repeat(2, 30px); gap: 4px; justify-content: flex-end; align-items: center;">
                            <button class="btn-icon" onclick="openDetailsModal('${r.id}')" title="Ver Detalle"><i class="fa-solid fa-eye"></i></button>
                            ${(r.repeatCount > 1 || r.isDuplicate || (r.duplicateReason && r.duplicateReason.startsWith('POSIBLE_DUPLICADO:'))) ? `
                                <button class="btn-icon" onclick="clearSingleDuplicate('${r.id}', event)" title="Quitar alerta de duplicado" style="color: #ef4444; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.35);"><i class="fa-solid fa-bell"></i></button>
                            ` : '<div></div>'}
                            ${hasMedia ? '<button class="btn-icon" onclick="reprocessReceipt(&quot;' + r.id + '&quot;)" title="Reprocesar IA"><i class="fa-solid fa-rotate-right"></i></button>' : '<div></div>'}
                            <button class="btn-icon delete" onclick="deleteReceiptRecord('${r.id}')" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        receiptsTableBody.innerHTML = rowsHtml;

        if (kpiLocal1Amount) kpiLocal1Amount.textContent = `$${local1Amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (kpiLocal1Count)  kpiLocal1Count.textContent  = `${local1Count} comprobantes`;
        if (kpiLocal2Amount) kpiLocal2Amount.textContent = `$${local2Amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (kpiLocal2Count)  kpiLocal2Count.textContent  = `${local2Count} comprobantes`;
        kpiTotalCount.textContent = count.toString();
        tableCountBadge.textContent = `Mostrando ${visibleReceipts.length} de ${receiptsData.length} comprobantes`;
    }

    function resetReceiptFiltersForAccount() {
        // Both accounts open on today's jornada. The account only changes
        // which records are returned; it must not disable the date filter.
        currentFilter = { days: null, startDate: null, endDate: null, search: '', fecha: todayString };
        activeStatusFilter = 'all';
        activeLocalFilter = 'all';
        statusPillBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-status-filter') === 'all'));
        populateLocalFilterOptions();
        if (inputFilterSingleDate) inputFilterSingleDate.value = '';
        if (inputStartDate) inputStartDate.value = '';
        if (inputEndDate) inputEndDate.value = '';
        if (btnFilterToday) btnFilterToday.classList.add('active');
        if (btnFilterYesterday) btnFilterYesterday.classList.remove('active');
    }

    function updateReceiptAccountUI() {
        const isMercadoFrescos = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT;
        const local1Label = document.getElementById('kpiLocal1Label');
        const local2Label = document.getElementById('kpiLocal2Label');
        const totalLabel = document.getElementById('kpiTotalLabel');
        const tableTitle = document.getElementById('receiptsTableTitle');

        if (abastoLocal1Kpi) abastoLocal1Kpi.style.display = isMercadoFrescos ? 'none' : '';
        if (abastoLocal2Kpi) abastoLocal2Kpi.style.display = isMercadoFrescos ? 'none' : '';
        if (localFilterGroup) localFilterGroup.style.display = 'flex';

        if (local1Label) local1Label.textContent = isMercadoFrescos ? '🍋 Mercado de Frescos' : '🏪 Local Cba (Filtrado)';
        if (local2Label) local2Label.textContent = '🚚 Repartos (Filtrado)';
        if (totalLabel) totalLabel.textContent = isMercadoFrescos ? 'Comprobantes de Mercado de Frescos' : 'Comprobantes Procesados';
        if (tableTitle) tableTitle.innerHTML = isMercadoFrescos
            ? '<i class="fa-solid fa-lemon"></i> Comprobantes de Mercado de Frescos'
            : '<i class="fa-solid fa-table-list"></i> Comprobantes Detectados';
    }

    // Status Pill Filter Buttons
    statusPillBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            statusPillBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeStatusFilter = btn.getAttribute('data-status-filter');
            renderTableAndKPIs();
        });
    });

    if (localFilterGroup) {
        localFilterGroup.addEventListener('click', (event) => {
            const btn = event.target.closest?.('.local-filter-pill');
            if (!btn) return;
            activeLocalFilter = btn.getAttribute('data-local-filter') || 'all';
            syncLocalFilterButtons();
            renderTableAndKPIs();
        });
    }

    // --- FILTERS AND CONTROLS ---
    if (btnFilterToday) {
        btnFilterToday.addEventListener('click', () => {
            btnFilterToday.classList.add('active');
            if (btnFilterYesterday) btnFilterYesterday.classList.remove('active');
            if (inputFilterSingleDate) inputFilterSingleDate.value = '';
            
            inputStartDate.value = '';
            inputEndDate.value = '';

            currentFilter.fecha = todayString;
            currentFilter.days = null;
            currentFilter.startDate = null;
            currentFilter.endDate = null;

            fetchReceipts();
        });
    }

    if (btnFilterYesterday) {
        btnFilterYesterday.addEventListener('click', () => {
            btnFilterYesterday.classList.add('active');
            if (btnFilterToday) btnFilterToday.classList.remove('active');
            if (inputFilterSingleDate) inputFilterSingleDate.value = '';
            
            inputStartDate.value = '';
            inputEndDate.value = '';

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            currentFilter.fecha = yesterday.toLocaleDateString('sv');
            currentFilter.days = null;
            currentFilter.startDate = null;
            currentFilter.endDate = null;

            fetchReceipts();
        });
    }

    if (inputFilterSingleDate) {
        inputFilterSingleDate.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;

            if (btnFilterToday) btnFilterToday.classList.remove('active');
            if (btnFilterYesterday) btnFilterYesterday.classList.remove('active');
            
            inputStartDate.value = '';
            inputEndDate.value = '';

            currentFilter.fecha = val;
            currentFilter.days = null;
            currentFilter.startDate = null;
            currentFilter.endDate = null;

            fetchReceipts();
        });
    }

    if (btnApplyCustomDates) {
        btnApplyCustomDates.addEventListener('click', () => {
            const start = inputStartDate.value;
            const end = inputEndDate.value;

            if (!start && !end) return;

            if (btnFilterToday) btnFilterToday.classList.remove('active');
            if (btnFilterYesterday) btnFilterYesterday.classList.remove('active');
            if (inputFilterSingleDate) inputFilterSingleDate.value = '';

            currentFilter.fecha = null;
            currentFilter.days = null;
            currentFilter.startDate = start || null;
            currentFilter.endDate = end || null;

            fetchReceipts();
        });
    }

    inputSearch.addEventListener('input', (e) => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            currentFilter.search = e.target.value.trim();
            fetchReceipts();
        }, 300);
    });

    btnExportExcel.addEventListener('click', () => {
        const query = new URLSearchParams();
        if (currentFilter.fecha) query.append('fecha', currentFilter.fecha);
        if (currentFilter.days) query.append('days', currentFilter.days);
        if (currentFilter.startDate) query.append('startDate', currentFilter.startDate);
        if (currentFilter.endDate) query.append('endDate', currentFilter.endDate);
        if (currentFilter.search) query.append('search', currentFilter.search);
        if (activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT) query.append('account', MERCADO_FRESCOS_ACCOUNT);

        window.location.href = `/api/export-excel?${query.toString()}`;
    });

    // --- MODALS & HEADER ACTIONS HANDLING ---
    const btnDisconnectWa = document.getElementById('btnDisconnectWa');
    const btnReconnectWa = document.getElementById('btnReconnectWa');

    if (btnDisconnectWa) {
        btnDisconnectWa.addEventListener('click', async () => {
            if (!confirm('¿Estás seguro de desconectar WhatsApp Web? Se eliminará la sesión actual para poder escanear un nuevo QR.')) return;
            showToast('Desconectando de WhatsApp...', 'info');
            try {
                const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
                if (res.ok) {
                    showToast('WhatsApp desconectado. Escanea el código QR.', 'warning');
                    qrModal.classList.add('active');
                }
            } catch (err) {
                console.error('Disconnect error:', err);
            }
        });
    }

    if (btnReconnectWa) {
        btnReconnectWa.addEventListener('click', async () => {
            showToast('Generando nuevo código QR...', 'info');
            try {
                const res = await fetch('/api/whatsapp/reconnect', { method: 'POST' });
                if (res.ok) {
                    qrModal.classList.add('active');
                }
            } catch (err) {
                console.error('Reconnect error:', err);
            }
        });
    }

    btnOpenQrModal.addEventListener('click', () => qrModal.classList.add('active'));
    btnCloseQrModal.addEventListener('click', () => qrModal.classList.remove('active'));

    btnCloseDetailsModal.addEventListener('click', () => {
        detailsModal.classList.remove('active');
        if (modalPdfIframe) modalPdfIframe.src = '';
        if (modalImagePreview) modalImagePreview.src = '';
    });

    // Close details modal on backdrop click
    if (detailsModal) {
        detailsModal.addEventListener('click', (e) => {
            if (e.target === detailsModal) {
                detailsModal.classList.remove('active');
                if (modalPdfIframe) modalPdfIframe.src = '';
                if (modalImagePreview) modalImagePreview.src = '';
            }
        });
    }

    // Mobile Close Button inside actions bar
    const btnMobileCloseModal = document.getElementById('btnMobileCloseModal');
    if (btnMobileCloseModal) {
        btnMobileCloseModal.addEventListener('click', () => {
            detailsModal.classList.remove('active');
            if (modalPdfIframe) modalPdfIframe.src = '';
            if (modalImagePreview) modalImagePreview.src = '';
        });
    }

    btnOpenUploadModal.addEventListener('click', () => uploadModal.classList.add('active'));
    btnCloseUploadModal.addEventListener('click', () => uploadModal.classList.remove('active'));

    // --- FULLSCREEN LIGHTBOX IMAGE VIEWER ---
    const lightboxModal = document.getElementById('lightboxModal');
    const btnCloseLightbox = document.getElementById('btnCloseLightbox');
    const lightboxImage = document.getElementById('lightboxImage');
    const lightboxOpenLink = document.getElementById('lightboxOpenLink');

    window.openLightbox = function(imageUrl, event) {
        if (event) event.stopPropagation();
        if (!imageUrl) return;
        if (lightboxImage) lightboxImage.src = imageUrl;
        if (lightboxOpenLink) lightboxOpenLink.href = imageUrl;
        if (lightboxModal) lightboxModal.style.display = 'flex';
    };

    function closeLightbox() {
        if (lightboxModal) lightboxModal.style.display = 'none';
        if (lightboxImage) lightboxImage.src = '';
    }

    if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', closeLightbox);
    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal || e.target === btnCloseLightbox) {
                closeLightbox();
            }
        });
    }

    if (modalImagePreview) {
        modalImagePreview.addEventListener('click', () => {
            if (selectedReceipt) {
                if (isPdfReceipt(selectedReceipt)) {
                    window.openDetailsModal(selectedReceipt.id);
                } else {
                    openLightbox(getReceiptMediaUrl(selectedReceipt));
                }
            } else if (modalImagePreview.src) {
                openLightbox(modalImagePreview.src);
            }
        });
    }

    function populateLocalSelect(receipt) {
        if (!modalLocalSelect) return;
        const marketReceipt = isMercadoFrescosLocal(receipt?.local);
        const options = marketReceipt
            ? [
                ...getMercadoFrescosBranches().map(branch => ({
                    value: branch.id,
                    label: `Mercado de Frescos - ${branch.label}`
                })),
                ...(receipt.local === MERCADO_FRESCOS_ACCOUNT
                    ? [{ value: MERCADO_FRESCOS_ACCOUNT, label: 'Mercado de Frescos - Sin asignar' }]
                    : []),
                ...(receipt.local === 'mercado_frescos_sin_asignar'
                    ? [{ value: 'mercado_frescos_sin_asignar', label: 'Mercado de Frescos - Sin asignar' }]
                    : [])
            ]
            : [
                { value: 'local1', label: 'Local Cba' },
                { value: 'local2', label: 'Repartos' }
            ];

        modalLocalSelect.innerHTML = options.map(option =>
            `<option value="${option.value}">${escapeHtml(option.label)}</option>`
        ).join('');
        modalLocalSelect.value = receipt.local || (isLocal1Sender(receipt) ? 'local1' : 'local2');
    }

    // Details Modal Populator
    window.openDetailsModal = (id) => {
        const receipt = receiptsData.find(r => r.id === id);
        if (!receipt) return;

        selectedReceipt = receipt;
        const hasMedia = Boolean(receipt.filename || receipt.thumbnailBase64);
        const isPdf = hasMedia && isPdfReceipt(receipt);
        const previewUrl = getReceiptPreviewUrl(receipt);

        // Clean up any previous image error warning
        const warning = document.getElementById('previewMissingWarning');
        if (warning) warning.remove();

        if (modalNoPhotoPreview) modalNoPhotoPreview.style.display = 'none';
        if (!hasMedia) {
            modalImagePreview.style.display = 'none';
            modalImagePreview.src = '';
            modalPdfPreview.style.display = 'none';
            modalPdfIframe.src = '';
            if (modalNoPhotoPreview) modalNoPhotoPreview.style.display = 'flex';
        } else if (isPdf) {
            modalImagePreview.style.display = 'none';
            modalImagePreview.src = '';
            modalPdfPreview.style.display = 'flex';
            // Use the authenticated preview endpoint so the PDF can still be
            // opened from its database cache when the media file is missing.
            const pdfVersion = encodeURIComponent(receipt.updatedAt || receipt.createdAt || receipt.id);
            const versionedPreviewUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}v=${pdfVersion}`;
            modalPdfIframe.src = versionedPreviewUrl + '#toolbar=0&navpanes=0';
            modalPdfLink.href = versionedPreviewUrl;
        } else {
            modalPdfPreview.style.display = 'none';
            modalPdfIframe.src = '';
            modalImagePreview.style.display = 'block';

            // Add dynamic error handler for image not found (Render ephemeral disk deletion)
            modalImagePreview.onerror = () => {
                modalImagePreview.onerror = null;
                modalImagePreview.style.display = 'none';
                
                const container = document.getElementById('modalPreviewContainer');
                if (container && !document.getElementById('previewMissingWarning')) {
                    const warningDiv = document.createElement('div');
                    warningDiv.id = 'previewMissingWarning';
                    warningDiv.style.cssText = 'width: 100%; height: 350px; background: rgba(15,23,42,0.6); border: 1px dashed rgba(239,68,68,0.3); border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #94a3b8; padding: 20px; text-align: center;';
                    warningDiv.innerHTML = `
                        <i class="fa-solid fa-triangle-exclamation fa-2xl" style="color: #f87171;"></i>
                        <div style="font-size: 14px; font-weight: 700; color: #f8fafc;">Archivo no disponible</div>
                        <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.4; max-width: 250px;">El archivo físico de la imagen ya no existe en el disco local de Render por un deploy reciente. La información del comprobante sigue guardada en Supabase.</p>
                    `;
                    container.appendChild(warningDiv);
                }
            };

            modalImagePreview.src = receipt.thumbnailUrl || `/api/receipts/${encodeURIComponent(receipt.id)}/thumbnail`;
        }

        const isPossibleDuplicate = receipt.duplicateReason && receipt.duplicateReason.startsWith('POSIBLE_DUPLICADO:');
        const modalPossibleDuplicateBanner = document.getElementById('modalPossibleDuplicateBanner');

        if ((receipt.isDuplicate || (receipt.repeatCount && receipt.repeatCount > 1)) && !isPossibleDuplicate) {
            modalDuplicateAlert.style.display = 'flex';
            const countStr = receipt.repeatCount ? ` (Enviado ${receipt.repeatCount} veces)` : '';
            modalDuplicateText.textContent = `⚠️ COMPROBANTE REPETIDO${countStr} - ${receipt.duplicateReason || 'Mismo N° de Operación en el sistema'}`;
            if (modalPossibleDuplicateBanner) modalPossibleDuplicateBanner.style.display = 'none';
        } else {
            modalDuplicateAlert.style.display = 'none';
            
            if (isPossibleDuplicate && modalPossibleDuplicateBanner) {
                const candidateId = receipt.duplicateReason.split(':')[1];
                const candidate = receiptsData.find(r => r.id === candidateId);
                
                if (candidate) {
                    modalPossibleDuplicateBanner.style.display = 'flex';
                    
                    // Populate current receipt previews
                    setDuplicatePreview('compAPreview', receipt);
                    document.getElementById('compAMonto').textContent = `$${(parseFloat(receipt.monto)||0).toLocaleString('es-AR')}`;
                    document.getElementById('compAFecha').textContent = (receipt.fecha || '-') + (receipt.hora ? ' ' + receipt.hora : '');
                    
                    // Populate candidate receipt previews
                    setDuplicatePreview('compBPreview', candidate);
                    document.getElementById('compBMonto').textContent = `$${(parseFloat(candidate.monto)||0).toLocaleString('es-AR')}`;
                    document.getElementById('compBFecha').textContent = (candidate.fecha || '-') + (candidate.hora ? ' ' + candidate.hora : '');
                    
                    // Add link to go to original details modal easily
                    const rightColInfo = document.getElementById('compBPreview').nextElementSibling;
                    if (rightColInfo) {
                        rightColInfo.innerHTML = `
                            <strong>Monto:</strong> $${(parseFloat(candidate.monto)||0).toLocaleString('es-AR')}<br>
                            <strong>Fecha:</strong> ${(candidate.fecha || '-') + (candidate.hora ? ' ' + candidate.hora : '')}<br>
                            <a href="#" onclick="event.preventDefault(); window.openDetailsModal('${candidate.id}')" style="color: #60a5fa; text-decoration: underline; font-weight: 500; font-size: 11px;">Ver original &rarr;</a>
                        `;
                    }
                } else {
                    modalPossibleDuplicateBanner.style.display = 'none';
                }
            } else {
                if (modalPossibleDuplicateBanner) modalPossibleDuplicateBanner.style.display = 'none';
            }
        }

        // Populate editable date & time inputs
        if (modalFechaInput) modalFechaInput.value = receipt.fecha || '';
        if (modalFechaComprobanteInput) modalFechaComprobanteInput.value = receipt.fecha_comprobante || receipt.fecha || '';
        if (modalHoraInput) modalHoraInput.value = receipt.hora || '';
        
        // Populate editable monto input
        if (modalMontoInput) {
            const montoVal = typeof receipt.monto === 'number' ? receipt.monto : parseFloat(receipt.monto) || 0;
            modalMontoInput.value = montoVal;
        }

        // Populate the physical-local selector according to the account.
        populateLocalSelect(receipt);
        
        modalNroOp.textContent = receipt.nro_operacion || 'No detectado';
        modalEmisor.textContent = receipt.emisor || '-';
        modalTipo.textContent = receipt.tipo_comprobante || '-';
        modalSender.textContent = receipt.sender || '-';
        
        // Populate file name header (removing visual clutter from long names in text)
        const displayFilename = receipt.filename || 'Sin foto - carga manual';
        modalFilename.innerHTML = `<span>Archivo:</span> ${escapeHtml(displayFilename)}`;
        modalFilename.title = displayFilename; // Show full filename on hover

        modalNotes.value = receipt.notas || '';
        modalRawText.value = receipt.rawText || '';
        if (btnReprocessModal) btnReprocessModal.style.display = hasMedia ? '' : 'none';

        // Reset details modal tabs to Notes by default
        const tabNotesBtn = document.getElementById('btnTabNotes');
        const tabRawTextBtn = document.getElementById('btnTabRawText');
        const paneNotesEl = document.getElementById('paneNotes');
        const paneRawTextEl = document.getElementById('paneRawText');
        if (tabNotesBtn && tabRawTextBtn && paneNotesEl && paneRawTextEl) {
            tabNotesBtn.classList.add('active');
            tabRawTextBtn.classList.remove('active');
            paneNotesEl.classList.add('active');
            paneRawTextEl.classList.remove('active');
        }

        detailsModal.classList.add('active');
    };

    // --- DETAILS MODAL TABS EVENT LISTENERS ---
    const tabNotesBtn = document.getElementById('btnTabNotes');
    const tabRawTextBtn = document.getElementById('btnTabRawText');
    const paneNotesEl = document.getElementById('paneNotes');
    const paneRawTextEl = document.getElementById('paneRawText');

    if (tabNotesBtn && tabRawTextBtn && paneNotesEl && paneRawTextEl) {
        tabNotesBtn.addEventListener('click', () => {
            tabNotesBtn.classList.add('active');
            tabRawTextBtn.classList.remove('active');
            paneNotesEl.classList.add('active');
            paneRawTextEl.classList.remove('active');
        });

        tabRawTextBtn.addEventListener('click', () => {
            tabRawTextBtn.classList.add('active');
            tabNotesBtn.classList.remove('active');
            paneRawTextEl.classList.add('active');
            paneNotesEl.classList.remove('active');
        });
    }

    // Save hora from modal
    if (btnSaveHoraModal) {
        btnSaveHoraModal.addEventListener('click', async () => {
            if (!selectedReceipt) return;
            const hora = modalHoraInput ? modalHoraInput.value : '';
            btnSaveHoraModal.disabled = true;
            const originalHtml = btnSaveHoraModal.innerHTML;
            btnSaveHoraModal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const res = await fetch(`/api/receipts/${selectedReceipt.id}/hora`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hora: hora || null })
                });
                if (res.ok) {
                    const updated = await res.json();
                    // Re-fetch the active day/range so a cutoff adjustment
                    // (20:00 or later) moves the receipt to the next day in
                    // the current view immediately.
                    selectedReceipt = updated;
                    await fetchReceipts();
                    showToast('✓ Hora actualizada correctamente', 'success');
                } else {
                    const err = await res.json();
                    showToast(`Error: ${err.error || 'No se pudo guardar'}`, 'error');
                }
            } catch (err) {
                console.error('Save hora error:', err);
                showToast('Error al guardar la hora', 'error');
            } finally {
                btnSaveHoraModal.disabled = false;
                btnSaveHoraModal.innerHTML = originalHtml;
            }
        });
    }

    // Save date from modal
    if (btnSaveFechaModal) {
        btnSaveFechaModal.addEventListener('click', async () => {
            if (!selectedReceipt) return;
            const fecha = modalFechaInput ? modalFechaInput.value : '';
            if (!fecha) return;
            btnSaveFechaModal.disabled = true;
            const originalHtml = btnSaveFechaModal.innerHTML;
            btnSaveFechaModal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const res = await fetch(`/api/receipts/${selectedReceipt.id}/fecha`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fecha })
                });
                if (res.ok) {
                    const updated = await res.json();
                    selectedReceipt = updated;
                    await fetchReceipts();
                    showToast('✓ Fecha actualizada correctamente', 'success');
                } else {
                    const err = await res.json();
                    showToast(`Error: ${err.error || 'No se pudo guardar'}`, 'error');
                }
            } catch (err) {
                console.error('Save fecha error:', err);
                showToast('Error al guardar la fecha', 'error');
            } finally {
                btnSaveFechaModal.disabled = false;
                btnSaveFechaModal.innerHTML = originalHtml;
            }
        });
    }

    // Save fecha_comprobante from modal
    if (btnSaveFechaComprobanteModal) {
        btnSaveFechaComprobanteModal.addEventListener('click', async () => {
            if (!selectedReceipt) return;
            const fechaComp = modalFechaComprobanteInput ? modalFechaComprobanteInput.value : '';
            if (!fechaComp) return;
            btnSaveFechaComprobanteModal.disabled = true;
            const originalHtml = btnSaveFechaComprobanteModal.innerHTML;
            btnSaveFechaComprobanteModal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const res = await fetch(`/api/receipts/${selectedReceipt.id}/fecha-comprobante`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fecha_comprobante: fechaComp })
                });
                if (res.ok) {
                    const updated = await res.json();
                    selectedReceipt = updated;
                    await fetchReceipts();
                    showToast('✓ Fecha del comprobante actualizada', 'success');
                } else {
                    const err = await res.json();
                    showToast(`Error: ${err.error || 'No se pudo guardar'}`, 'error');
                }
            } catch (err) {
                console.error('Save fecha_comprobante error:', err);
                showToast('Error al guardar la fecha del comprobante', 'error');
            } finally {
                btnSaveFechaComprobanteModal.disabled = false;
                btnSaveFechaComprobanteModal.innerHTML = originalHtml;
            }
        });
    }

    // Save monto from modal
    if (btnSaveMontoModal) {
        btnSaveMontoModal.addEventListener('click', async () => {
            if (!selectedReceipt) return;
            const montoVal = modalMontoInput ? parseFloat(modalMontoInput.value) : 0;
            if (isNaN(montoVal) || montoVal < 0) {
                showToast('Monto inválido', 'error');
                return;
            }
            btnSaveMontoModal.disabled = true;
            const originalHtml = btnSaveMontoModal.innerHTML;
            btnSaveMontoModal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const res = await fetch(`/api/receipts/${selectedReceipt.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ monto: montoVal })
                });
                if (res.ok) {
                    const updated = await res.json();
                    upsertReceiptItem(updated);
                    renderTableAndKPIs();
                    showToast('✓ Monto actualizado correctamente', 'success');
                } else {
                    const err = await res.json();
                    showToast(`Error: ${err.error || 'No se pudo guardar'}`, 'error');
                }
            } catch (err) {
                console.error('Save monto error:', err);
                showToast('Error al guardar el monto', 'error');
            } finally {
                btnSaveMontoModal.disabled = false;
                btnSaveMontoModal.innerHTML = originalHtml;
            }
        });
    }

    // Save local from modal
    if (btnSaveLocalModal) {
        btnSaveLocalModal.addEventListener('click', async () => {
            if (!selectedReceipt) return;
            const localVal = modalLocalSelect ? modalLocalSelect.value : '';
            if (!localVal) return;
            btnSaveLocalModal.disabled = true;
            const originalHtml = btnSaveLocalModal.innerHTML;
            btnSaveLocalModal.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const res = await fetch(`/api/receipts/${selectedReceipt.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ local: localVal })
                });
                if (res.ok) {
                    const updated = await res.json();
                    upsertReceiptItem(updated);
                    renderTableAndKPIs();
                    showToast('✓ Local actualizado correctamente', 'success');
                } else {
                    const err = await res.json();
                    showToast(`Error: ${err.error || 'No se pudo guardar'}`, 'error');
                }
            } catch (err) {
                console.error('Save local error:', err);
                showToast('Error al guardar el local', 'error');
            } finally {
                btnSaveLocalModal.disabled = false;
                btnSaveLocalModal.innerHTML = originalHtml;
            }
        });
    }

    btnSaveNoteModal.addEventListener('click', async () => {
        if (!selectedReceipt) return;
        const note = modalNotes.value.trim();
        try {
            const res = await fetch(`/api/receipts/${selectedReceipt.id}/note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note })
            });
            if (res.ok) {
                const updated = await res.json();
                upsertReceiptItem(updated);
                renderTableAndKPIs();
                showToast('Nota guardada correctamente', 'success');
            }
        } catch (err) {
            console.error('Save note error:', err);
        }
    });

    // --- DEDICATED NOTE MODAL LOGIC ---
    let selectedReceiptForNote = null;
    const noteModal = document.getElementById('noteModal');
    const btnCloseNoteModal = document.getElementById('btnCloseNoteModal');
    const btnCancelNoteModal = document.getElementById('btnCancelNoteModal');
    const noteModalSub = document.getElementById('noteModalSub');
    const noteModalText = document.getElementById('noteModalText');
    const btnSaveNoteFromModal = document.getElementById('btnSaveNoteFromModal');

    window.openNoteModal = function(id, event) {
        if (event) event.stopPropagation();
        const receipt = receiptsData.find(r => r.id === id);
        if (!receipt) return;
        selectedReceiptForNote = receipt;

        if (noteModalSub) {
            const montoVal = typeof receipt.monto === 'number' ? receipt.monto : parseFloat(receipt.monto) || 0;
            noteModalSub.textContent = `${receipt.emisor || 'Comprobante'} • $${montoVal.toLocaleString('es-AR', { minimumFractionDigits: 2 })} • N° Op: ${receipt.nro_operacion || 's/n'}`;
        }
        if (noteModalText) {
            noteModalText.value = receipt.notas || '';
        }
        if (noteModal) {
            noteModal.classList.add('active');
            setTimeout(() => {
                if (noteModalText) noteModalText.focus();
            }, 100);
        }
    };

    window.closeNoteModal = function() {
        if (noteModal) noteModal.classList.remove('active');
        selectedReceiptForNote = null;
    };

    if (btnCloseNoteModal) btnCloseNoteModal.addEventListener('click', window.closeNoteModal);
    if (btnCancelNoteModal) btnCancelNoteModal.addEventListener('click', window.closeNoteModal);
    if (noteModal) {
        noteModal.addEventListener('click', (e) => {
            if (e.target === noteModal) window.closeNoteModal();
        });
    }

    if (btnSaveNoteFromModal) {
        btnSaveNoteFromModal.addEventListener('click', async () => {
            if (!selectedReceiptForNote) return;
            const newNote = noteModalText.value.trim();
            try {
                const res = await fetch(`/api/receipts/${selectedReceiptForNote.id}/note`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: newNote })
                });

                if (res.ok) {
                    const updated = await res.json();
                    upsertReceiptItem(updated);
                    renderTableAndKPIs();
                    showToast('Nota actualizada correctamente', 'success');
                    window.closeNoteModal();
                } else {
                    showToast('Error al guardar la nota', 'error');
                }
            } catch (err) {
                console.error('Save note error:', err);
                showToast('Error de red al guardar la nota', 'error');
            }
        });
    }

    btnReprocessModal.addEventListener('click', () => {
        if (selectedReceipt) {
            reprocessReceipt(selectedReceipt.id);
            detailsModal.classList.remove('active');
        }
    });

    const btnConfirmOpDuplicate = document.getElementById('btnConfirmOpDuplicate');
    const btnDismissOpDuplicate = document.getElementById('btnDismissOpDuplicate');

    if (btnConfirmOpDuplicate) {
        btnConfirmOpDuplicate.addEventListener('click', async () => {
            if (!selectedReceipt) return;
            
            const isPossibleDuplicate = selectedReceipt.duplicateReason && selectedReceipt.duplicateReason.startsWith('POSIBLE_DUPLICADO:');
            if (!isPossibleDuplicate) return;

            const candidateId = selectedReceipt.duplicateReason.split(':')[1];
            const candidate = receiptsData.find(r => r.id === candidateId);
            if (!candidate) return;

            const originalHtml = btnConfirmOpDuplicate.innerHTML;
            btnConfirmOpDuplicate.disabled = true;
            btnConfirmOpDuplicate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

            try {
                // PATCH current selected receipt as duplicate, and the candidate as original (but marked REPETIDO)
                const [res1, res2] = await Promise.all([
                    fetch(`/api/receipts/${selectedReceipt.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            isDuplicate: true,
                            duplicateReason: `Duplicado Confirmado por Operador (Par con ${candidate.id})`
                        })
                    }),
                    fetch(`/api/receipts/${candidate.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            isDuplicate: false,
                            repeatCount: 2,
                            duplicateReason: `Comprobante original (Duplicado ${selectedReceipt.id} archivado)`
                        })
                    })
                ]);

                if (res1.ok && res2.ok) {
                    const updated1 = await res1.json();
                    const updated2 = await res2.json();
                    upsertReceiptItem(updated1);
                    upsertReceiptItem(updated2);
                    renderTableAndKPIs();
                    detailsModal.classList.remove('active');
                    showToast('✓ Comprobante marcado como duplicado', 'success');
                } else {
                    showToast('Error al actualizar los comprobantes', 'error');
                }
            } catch (err) {
                console.error('Confirm duplicate error:', err);
                showToast('Error de red al marcar como duplicado', 'error');
            } finally {
                btnConfirmOpDuplicate.disabled = false;
                btnConfirmOpDuplicate.innerHTML = originalHtml;
            }
        });
    }

    if (btnDismissOpDuplicate) {
        btnDismissOpDuplicate.addEventListener('click', async () => {
            if (!selectedReceipt) return;

            const isPossibleDuplicate = selectedReceipt.duplicateReason && selectedReceipt.duplicateReason.startsWith('POSIBLE_DUPLICADO:');
            if (!isPossibleDuplicate) return;

            const candidateId = selectedReceipt.duplicateReason.split(':')[1];
            const candidate = receiptsData.find(r => r.id === candidateId);
            if (!candidate) return;

            const originalHtml = btnDismissOpDuplicate.innerHTML;
            btnDismissOpDuplicate.disabled = true;
            btnDismissOpDuplicate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

            try {
                // PATCH both to be normal non-duplicate receipts
                const [res1, res2] = await Promise.all([
                    fetch(`/api/receipts/${selectedReceipt.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            isDuplicate: false,
                            duplicateReason: 'CONFIRMADO_NO_DUPLICADO'
                        })
                    }),
                    fetch(`/api/receipts/${candidate.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            isDuplicate: false,
                            duplicateReason: 'CONFIRMADO_NO_DUPLICADO'
                        })
                    })
                ]);

                if (res1.ok && res2.ok) {
                    const updated1 = await res1.json();
                    const updated2 = await res2.json();
                    upsertReceiptItem(updated1);
                    upsertReceiptItem(updated2);
                    renderTableAndKPIs();
                    detailsModal.classList.remove('active');
                    showToast('✓ Comprobantes verificados como originales', 'success');
                } else {
                    showToast('Error al actualizar los comprobantes', 'error');
                }
            } catch (err) {
                console.error('Dismiss duplicate error:', err);
                showToast('Error de red al verificar comprobantes', 'error');
            } finally {
                btnDismissOpDuplicate.disabled = false;
                btnDismissOpDuplicate.innerHTML = originalHtml;
            }
        });
    }

    window.reprocessReceipt = async (id) => {
        const receipt = receiptsData.find(r => r.id === id);
        if (receipt && !receipt.filename && !receipt.thumbnailBase64) {
            showToast('Este comprobante fue agregado sin foto y no se puede reprocesar con IA.', 'info');
            return;
        }
        if (receipt) {
            receipt.status = 'processing';
            renderTableAndKPIs();
            showToast('Reprocesando con IA Vision...', 'info');
        }
        try {
            const res = await fetch(`/api/reprocess/${id}`, { method: 'POST' });
            if (res.ok) {
                const updated = await res.json();
                upsertReceiptItem(updated);
                renderTableAndKPIs();
                showToast('Reprocesamiento completado', 'success');
            }
        } catch (err) {
            console.error('Reprocess error:', err);
        }
    };

    window.deleteReceiptRecord = async (id) => {
        if (!confirm('¿Estás seguro de eliminar este comprobante?')) return;
        try {
            await fetch(`/api/receipts/${id}`, { method: 'DELETE' });
            receiptsData = receiptsData.filter(r => r.id !== id);
            renderTableAndKPIs();
            showToast('Comprobante eliminado', 'info');
        } catch (err) {
            console.error('Delete error:', err);
        }
    };

    // Clear All Receipts
    if (btnClearAllReceipts) {
        btnClearAllReceipts.addEventListener('click', async () => {
            const sectionLabel = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT ? 'Mercado de Frescos' : 'Abasto del Campo';
            if (!confirm(`⚠️ ¿Estás seguro de que deseas eliminar TODOS los comprobantes de ${sectionLabel}?\n\nEsta acción no se puede deshacer.`)) return;

            try {
                const clearQuery = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT ? '?account=mercado_frescos' : '';
                const res = await fetch(`/api/receipts-all${clearQuery}`, { method: 'DELETE' });
                if (res.ok) {
                    receiptsData = [];
                    renderTableAndKPIs();
                    showToast(`Se eliminaron los comprobantes de ${sectionLabel}`, 'info');
                }
            } catch (err) {
                console.error('Clear all error:', err);
            }
        });
    }

    // Clear Duplicate Receipts
    const btnClearDuplicates = document.getElementById('btnClearDuplicates');
    if (btnClearDuplicates) {
        btnClearDuplicates.addEventListener('click', async () => {
            const sectionLabel = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT ? 'Mercado de Frescos' : 'Abasto del Campo';
            if (!confirm(`⚠️ ¿Estás seguro de que deseas eliminar automáticamente los comprobantes DUPLICADOS de ${sectionLabel}?\n\nSe conservará únicamente el original de cada operación.`)) return;

            btnClearDuplicates.disabled = true;
            const originalHtml = btnClearDuplicates.innerHTML;
            btnClearDuplicates.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';

            try {
                const duplicateQuery = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT ? '?account=mercado_frescos' : '';
                const res = await fetch(`/api/receipts-duplicates${duplicateQuery}`, { method: 'DELETE' });
                if (res.ok) {
                    const data = await res.json();
                    const removed = Number(data.deletedCount) || 0;
                    const restored = Number(data.clearedCount) || 0;
                    const summary = [
                        removed ? `${removed} copia${removed === 1 ? '' : 's'} eliminada${removed === 1 ? '' : 's'}` : '',
                        restored ? `${restored} original${restored === 1 ? '' : 'es'} restaurado${restored === 1 ? '' : 's'}` : ''
                    ].filter(Boolean).join(' y ');
                    showToast(summary ? `✓ Duplicados limpiados: ${summary}` : 'No había duplicados para limpiar', 'success');
                    fetchReceipts();
                    if (typeof fetchDailyStats === 'function') fetchDailyStats();
                } else {
                    showToast('Error al eliminar duplicados', 'error');
                }
            } catch (err) {
                console.error('Clear duplicates error:', err);
                showToast('Error de red al borrar duplicados', 'error');
            } finally {
                btnClearDuplicates.disabled = false;
                btnClearDuplicates.innerHTML = originalHtml;
            }
        });
    }

    // Upload Manual
    dropZone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            fileNameDisplay.textContent = `Archivo seleccionado: ${e.target.files[0].name}`;
        }
    });

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!fileInput.files || fileInput.files.length === 0) return;

        const formData = new FormData();
        formData.append('receiptImage', fileInput.files[0]);
        // Manual uploads made from the Mercado de Frescos section belong to
        // its Repartos branch, since they do not have a WhatsApp sender number.
        formData.append('account', activeReceiptAccount);

        uploadModal.classList.remove('active');
        showToast('Subiendo e identificando comprobante...', 'info');

        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const newReceipt = await res.json();
                upsertReceiptItem(newReceipt);
                renderTableAndKPIs();
                showToast('Comprobante subido y procesado con éxito', 'success');
            }
        } catch (err) {
            console.error('Upload error:', err);
        }
    });

    function populateNoPhotoLocalSelect() {
        if (!noPhotoLocal) return;
        const isMarket = activeReceiptAccount === MERCADO_FRESCOS_ACCOUNT;
        const options = isMarket
            ? getMercadoFrescosBranches().map(branch => ({
                value: branch.id,
                label: 'Mercado de Frescos - ' + branch.label
            }))
            : [
                { value: 'local1', label: 'Local Cba' },
                { value: 'local2', label: 'Repartos' }
            ];
        noPhotoLocal.innerHTML = options.map(option =>
            '<option value="' + option.value + '">' + escapeHtml(option.label) + '</option>'
        ).join('');
        if (noPhotoAccountHint) {
            noPhotoAccountHint.textContent = isMarket
                ? 'Se agregará a Mercado de Frescos. Elegí la sucursal correspondiente.'
                : 'Se agregará a Abasto del Campo. Elegí el local correspondiente.';
        }
    }

    function closeNoPhotoModal() {
        if (noPhotoModal) noPhotoModal.classList.remove('active');
    }

    if (btnOpenNoPhotoModal) {
        btnOpenNoPhotoModal.addEventListener('click', () => {
            populateNoPhotoLocalSelect();
            if (noPhotoFecha && !noPhotoFecha.value) noPhotoFecha.value = todayString;
            if (noPhotoModal) noPhotoModal.classList.add('active');
        });
    }
    if (btnCloseNoPhotoModal) btnCloseNoPhotoModal.addEventListener('click', closeNoPhotoModal);
    if (noPhotoModal) {
        noPhotoModal.addEventListener('click', (event) => {
            if (event.target === noPhotoModal) closeNoPhotoModal();
        });
    }

    if (noPhotoForm) {
        noPhotoForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const monto = Number(noPhotoMonto?.value || 0);
            if (!noPhotoFecha?.value || !Number.isFinite(monto) || monto <= 0 || !noPhotoLocal?.value) {
                showToast('Completá fecha, monto y local.', 'warning');
                return;
            }

            const submitButton = noPhotoForm.querySelector('button[type="submit"]');
            const originalHtml = submitButton?.innerHTML || '';
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
            }

            try {
                const res = await fetch('/api/receipts/manual', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account: activeReceiptAccount,
                        fecha: noPhotoFecha.value,
                        hora: noPhotoHora?.value || null,
                        monto,
                        local: noPhotoLocal.value,
                        emisor: noPhotoEmisor?.value.trim() || '',
                        tipo_comprobante: noPhotoTipo?.value || 'Transferencia',
                        nro_operacion: noPhotoOperacion?.value.trim() || '',
                        concepto: noPhotoConcepto?.value.trim() || '',
                        notas: noPhotoNota?.value.trim() || ''
                    })
                });

                const result = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(result.error || 'No se pudo guardar el comprobante');
                }

                closeNoPhotoModal();
                noPhotoForm.reset();
                if (noPhotoFecha) noPhotoFecha.value = todayString;
                upsertReceiptItem(result);
                renderTableAndKPIs();
                showToast('Comprobante agregado correctamente.', 'success');
            } catch (error) {
                console.error('Manual no-photo receipt error:', error);
                showToast(error.message || 'No se pudo agregar el comprobante.', 'error');
            } finally {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.innerHTML = originalHtml;
                }
            }
        });
    }

    // --- HOMEBANKING RECONCILIATION VIEW LOGIC ---
    async function fetchSavedReconciliations() {
        try {
            const res = await fetch('/api/reconciliations');
            if (res.ok) {
                savedReconciliations = await res.json();
                renderSavedReconciliationsList();
            }
        } catch (err) {
            console.error('Fetch reconciliations error:', err);
        }
    }

    function renderSavedReconciliationsList() {
        if (!savedReconciliations || savedReconciliations.length === 0) {
            savedReconciliationsList.innerHTML = `<div class="empty-history">No hay auditorías guardadas aún.</div>`;
            return;
        }

        savedReconciliationsList.innerHTML = savedReconciliations.map(audit => {
            let dateStr = 'Sin fecha';
            if (audit.createdAt) {
                const d = new Date(audit.createdAt);
                dateStr = isNaN(d.getTime()) ? String(audit.createdAt) : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            }
            const isSelected = currentAudit && currentAudit.id === audit.id;
            const accountLabel = audit.account === MERCADO_FRESCOS_ACCOUNT ? 'Mercado de Frescos' : 'Abasto del Campo';

            return `
                <div class="history-item ${isSelected ? 'active' : ''}" onclick="selectAudit('${audit.id}')">
                    <div class="history-item-header">
                        <strong>${escapeHtml(audit.name || 'Auditoría')}</strong>
                        <span class="badge-verif">${audit.summary?.verifiedCount || 0} verif.</span>
                    </div>
                    <div class="history-item-meta">
                        <span><i class="fa-solid fa-clock"></i> ${dateStr}</span>
                        <span><i class="fa-solid fa-building-columns"></i> ${accountLabel}</span>
                        <span>$${(audit.summary?.verifiedAmount || 0).toLocaleString('es-AR')}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    window.selectAudit = (id) => {
        const audit = savedReconciliations.find(a => a.id === id);
        if (audit) {
            currentAudit = audit;
            analyzedReport = null;
            if (reconAccountSelect) reconAccountSelect.value = audit.account === MERCADO_FRESCOS_ACCOUNT ? MERCADO_FRESCOS_ACCOUNT : 'abasto';
            btnSaveCurrentAudit.style.display = 'none';
            renderSavedReconciliationsList();
            renderAuditDashboard();
        }
    };

    function renderAuditDashboard() {
        if (!currentAudit) {
            reconEmptyState.style.display = 'flex';
            reconAuditDashboard.style.display = 'none';
            return;
        }

        reconEmptyState.style.display = 'none';
        reconAuditDashboard.style.display = 'block';

        // Toggle action buttons: hide if it's a newly uploaded unsaved audit (analyzedReport)
        const isSaved = !analyzedReport && currentAudit && currentAudit.id && !currentAudit.id.startsWith('temp_');
        if (btnRecalculateAudit) btnRecalculateAudit.style.display = isSaved ? 'flex' : 'none';
        if (btnDeleteAudit) btnDeleteAudit.style.display = isSaved ? 'flex' : 'none';

        const { summary, name, fileName, createdAt } = currentAudit;
        
        let dateStr = 'Sin fecha';
        if (createdAt) {
            const d = new Date(createdAt);
            dateStr = isNaN(d.getTime()) ? String(createdAt) : d.toLocaleString('es-AR');
        }

        reconAuditTitle.textContent = name || 'Conciliación Bancaria';
        reconAuditMeta.textContent = `Extracto: ${fileName || 'Excel'} • Auditado: ${dateStr}`;

        // Match Percentage calculation
        const total = summary?.totalReceipts || 0;
        const verified = summary?.verifiedCount || 0;
        const matchPercent = total > 0 ? ((verified / total) * 100).toFixed(1) : '0.0';

        if (reconMatchPercentText) reconMatchPercentText.textContent = `${matchPercent}%`;
        if (reconMatchProgressFill) reconMatchProgressFill.style.width = `${matchPercent}%`;

        recKpiVerified.textContent = `$${(summary?.verifiedAmount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
        recKpiVerifiedCount.textContent = `${summary?.verifiedCount || 0} comprobantes`;

        recKpiUnverified.textContent = `$${(summary?.unverifiedAmount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
        recKpiUnverifiedCount.textContent = `${summary?.unverifiedCount || 0} sin acreditar`;

        recKpiUnclaimed.textContent = `$${(summary?.unclaimedBankAmount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
        recKpiUnclaimedCount.textContent = `${summary?.unclaimedBankCount || 0} depósitos huérfanos`;

        recKpiDuplicates.textContent = (summary?.duplicateCount || 0).toString();

        const autoVerifiedCount = (currentAudit.verifiedReceipts || []).filter(r => r.reconciliationStatus !== 'MANUAL_VERIFICADO').length;
        const unverifiedCount = (currentAudit.unverifiedReceipts || []).length;
        const activeUnclaimedCount = (currentAudit.unclaimedBankMovements || []).filter(b => !b.resolved).length;
        const manualResolvedCount = (currentAudit.verifiedReceipts || []).filter(r => r.reconciliationStatus === 'MANUAL_VERIFICADO').length +
                                    (currentAudit.unclaimedBankMovements || []).filter(b => b.resolved).length;
        const duplicateCount = (currentAudit.duplicateReceipts || []).length;

        document.getElementById('subtabCountVerified').textContent = autoVerifiedCount;
        document.getElementById('subtabCountUnverified').textContent = unverifiedCount;
        document.getElementById('subtabCountUnclaimed').textContent = activeUnclaimedCount;
        document.getElementById('subtabCountResolved').textContent = manualResolvedCount;
        document.getElementById('subtabCountDuplicates').textContent = duplicateCount;

        renderAuditSubtabTable();
    }

    subtabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            subtabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSubtab = btn.getAttribute('data-subtab');
            renderAuditSubtabTable();
        });
    });



    function renderReconThumbHtml(r) {
        const isPdf = typeof r.filename === 'string' && r.filename.toLowerCase().endsWith('.pdf');
        if (isPdf) {
            return `<div class="thumb-pdf-preview" onclick="openDetailsModal('${r.id}')" title="Ver PDF"><i class="fa-solid fa-file-pdf"></i> <span>PDF</span></div>`;
        }
        
        // Try to get base64 thumbnail from main receiptsData cache
        const fullReceipt = receiptsData.find(item => item.id === r.id);
        const imgSrc = (fullReceipt && (fullReceipt.thumbnailBase64 || fullReceipt.thumbnailUrl)) || r.thumbnailBase64 || r.thumbnailUrl;
        if (imgSrc) {
            return `<img src="${imgSrc}" class="thumb-preview" alt="Comprobante" loading="lazy" onclick="openDetailsModal('${r.id}')">`;
        }
        
        const mediaUrl = `/media/${encodeURIComponent(r.filename)}`;
        return `
            <div class="thumb-preview-container" style="position: relative; width: 48px; height: 48px; display: inline-block;">
                <img src="${mediaUrl}" class="thumb-preview" alt="Comprobante" loading="lazy"
                     onclick="openDetailsModal('${r.id}')" 
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="thumb-placeholder" 
                     onclick="openDetailsModal('${r.id}')" 
                     style="display: none; width: 48px; height: 48px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: #94a3b8; align-items: center; justify-content: center; font-size: 18px; cursor: pointer;">
                    <i class="fa-solid fa-image"></i>
                </div>
            </div>
        `;
    }

    function renderAuditSubtabTable() {
        if (!currentAudit) return;

        const tableEl = document.querySelector('.reconcile-table');

        if (currentSubtab === 'verified') {
            if (tableEl) tableEl.className = 'receipts-table reconcile-table verified-layout';
            reconTableHeader.innerHTML = `
                <tr>
                    <th>Fecha Comprobante</th>
                    <th>Monto ($)</th>
                    <th>Comprobante</th>
                    <th>N° Operación</th>
                    <th>Emisor</th>
                    <th>Recepción</th>
                    <th>Estado</th>
                    <th>Coincidencia Homebanking</th>
                    <th>Acciones</th>
                </tr>
            `;
            const list = (currentAudit.verifiedReceipts || []).filter(r => r.reconciliationStatus !== 'MANUAL_VERIFICADO');
            if (list.length === 0) {
                reconTableBody.innerHTML = `<tr><td colspan="9" class="text-center">No hay comprobantes verificados automáticamente en esta auditoría.</td></tr>`;
            } else {
                reconTableBody.innerHTML = list.map(r => {
                    const thumbHtml = renderReconThumbHtml(r);

                    const matchInfo = `<strong>Fecha:</strong> ${r.bankMatch?.fecha || '-'} | <strong>Ref:</strong> ${r.bankMatch?.referencia || '-'}<br><small>${r.bankMatch?.concepto || ''}</small>`;

                    return `
                        <tr>
                            <td class="fecha-cell">${r.fecha_comprobante || r.fecha || 'Sin fecha'}</td>
                            <td class="monto-cell">$${(parseFloat(r.monto)||0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                            <td>${thumbHtml}</td>
                            <td><span class="code-val op-id">${r.nro_operacion || '-'}</span></td>
                            <td>${r.emisor || '-'}</td>
                            <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString() + ' ' + new Date(r.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                            <td><span class="badge-status completed"><i class="fa-solid fa-circle-check"></i> ${r.reconciliationLabel || 'Acreditado'}</span></td>
                            <td><div class="bank-match-info">${matchInfo}</div></td>
                            <td class="text-right">-</td>
                        </tr>
                    `;
                }).join('');
            }
        } else if (currentSubtab === 'unverified') {
            if (tableEl) tableEl.className = 'receipts-table reconcile-table unverified-layout';
            reconTableHeader.innerHTML = `
                <tr>
                    <th>Fecha Comprobante</th>
                    <th>Monto ($)</th>
                    <th>Comprobante</th>
                    <th>N° Operación</th>
                    <th>Emisor</th>
                    <th>Recepción</th>
                    <th>Estado</th>
                    <th>Detalle de Auditoría</th>
                    <th>Acciones</th>
                </tr>
            `;
            const list = currentAudit.unverifiedReceipts || [];
            if (list.length === 0) {
                reconTableBody.innerHTML = `<tr><td colspan="9" class="text-center">¡Excelente! No hay comprobantes sin acreditar.</td></tr>`;
            } else {
                reconTableBody.innerHTML = list.map(r => {
                    const thumbHtml = renderReconThumbHtml(r);

                    return `
                        <tr class="row-danger">
                            <td class="fecha-cell">${r.fecha_comprobante || r.fecha || 'Sin fecha'}</td>
                            <td class="monto-cell text-danger">$${(parseFloat(r.monto)||0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                            <td>${thumbHtml}</td>
                            <td><span class="code-val op-id">${r.nro_operacion || '-'}</span></td>
                            <td>${r.emisor || '-'}</td>
                            <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString() + ' ' + new Date(r.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                            <td><span class="badge-status error"><i class="fa-solid fa-circle-xmark"></i> ${r.reconciliationLabel || 'No Acreditado'}</span></td>
                            <td><span class="text-dim">${r.reconciliationReason || 'No figura en extracto'}</span></td>
                            <td class="text-right">
                                <button class="btn-action-sm btn-recon-sm" onclick="openResolveReceiptModal('${r.id}')" title="Acreditar Manualmente"><i class="fa-solid fa-clipboard-check"></i> Resolver</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        } else if (currentSubtab === 'unclaimed') {
            if (tableEl) tableEl.className = 'receipts-table reconcile-table unclaimed-layout';
            reconTableHeader.innerHTML = `
                <tr>
                    <th>Fecha Banco</th>
                    <th>Importe</th>
                    <th>Referencia</th>
                    <th>Nota / Cliente</th>
                    <th>CUIT</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                </tr>
            `;
            const list = (currentAudit.unclaimedBankMovements || []).filter(b => !b.resolved);

            if (list.length === 0) {
                reconTableBody.innerHTML = `<tr><td colspan="7" class="text-center">No hay depósitos bancarios huérfanos sin reclamar.</td></tr>`;
            } else {
                reconTableBody.innerHTML = list.map(b => {
                    const noteVal = b.customNote || b.note || '';
                    const savedNoteHtml = noteVal
                        ? `<div class="bank-note-status saved"><i class="fa-solid fa-check"></i> Guardada</div>`
                        : `<div class="bank-note-status"><i class="fa-regular fa-pen-to-square"></i> Opcional · se guarda al salir</div>`;
                    return `
                        <tr class="row-warning" data-bank-id="${b.id}">
                            <td>${escapeHtml(b.fecha || '-')}</td>
                            <td class="monto-cell text-warning">$${(parseFloat(b.importe)||0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                            <td><span class="code-val">${escapeHtml(b.referencia || '-')}</span></td>
                            <td class="bank-note-cell">
                                <div class="bank-note-editor">
                                <input class="bank-note-input" type="text"
                                       data-id="${b.id}"
                                       value="${escapeHtml(noteVal)}" 
                                       placeholder="Escribir datos del cliente..." 
                                       onchange="window.updateUnclaimedBankNote('${b.id}', this.value)"
                                       onkeydown="if(event.key==='Enter') this.blur();"
                                       aria-label="Nota del depósito bancario" />
                                ${savedNoteHtml}
                                <small class="bank-note-concept" title="${escapeHtml(b.concepto || '')}">Conc: ${escapeHtml(b.concepto || '-')}</small>
                                </div>
                            </td>
                            <td><span class="code-val">${escapeHtml(b.cuit || '-')}</span></td>
                            <td><span class="badge-status warning-badge"><i class="fa-solid fa-building-columns"></i> Sin Comprobante</span></td>
                            <td class="text-right">
                                <button class="btn-action-sm btn-recon-sm" onclick="openResolveBankMovementModal('${b.id}')" title="Marcar como Resuelto"><i class="fa-solid fa-clipboard-check"></i> Resolver</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        } else if (currentSubtab === 'resolved-tab') {
            if (tableEl) tableEl.className = 'receipts-table reconcile-table resolved-layout';
            reconTableHeader.innerHTML = `
                <tr>
                    <th>Tipo</th>
                    <th>Fecha Comprobante</th>
                    <th>Monto ($)</th>
                    <th>Referencia / N° Op</th>
                    <th>Detalle / Emisor</th>
                    <th>Nota de Resolución</th>
                    <th>Acciones</th>
                </tr>
            `;
            
            const manualReceipts = (currentAudit.verifiedReceipts || [])
                .filter(r => r.reconciliationStatus === 'MANUAL_VERIFICADO')
                .map(r => ({
                    type: 'receipt',
                    id: r.id,
                    fecha: r.fecha_comprobante || r.fecha || 'Sin fecha',
                    monto: r.monto,
                    referencia: r.nro_operacion || '-',
                    detalle: r.emisor || '-',
                    nota: r.reconciliationReason || 'Verificado manualmente por el operador.'
                }));

            const resolvedMvmts = (currentAudit.unclaimedBankMovements || [])
                .filter(b => b.resolved)
                .map(b => ({
                    type: 'bankMovement',
                    id: b.id,
                    fecha: b.fecha,
                    monto: b.importe,
                    referencia: b.referencia || '-',
                    detalle: b.concepto || '-',
                    nota: b.resolutionNote || 'Marcado como resuelto.'
                }));

            const list = [...manualReceipts, ...resolvedMvmts];

            if (list.length === 0) {
                reconTableBody.innerHTML = `<tr><td colspan="7" class="text-center">No hay depósitos ni comprobantes resueltos manualmente.</td></tr>`;
            } else {
                reconTableBody.innerHTML = list.map(item => {
                    const isReceipt = item.type === 'receipt';
                    
                    const badgeHtml = isReceipt
                        ? `<span class="badge-status completed" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);"><i class="fa-solid fa-receipt"></i> Comprobante</span>`
                        : `<span class="badge-status resolved-badge"><i class="fa-solid fa-building-columns"></i> Depósito</span>`;

                    const actionHtml = isReceipt
                        ? `<button class="btn-action-sm undo-btn" onclick="undoReceiptOverride('${item.id}')" title="Deshacer ajuste manual"><i class="fa-solid fa-undo"></i> Deshacer</button>`
                        : `<button class="btn-action-sm undo-btn" onclick="undoBankMovementOverride('${item.id}')" title="Deshacer ajuste manual"><i class="fa-solid fa-undo"></i> Deshacer</button>`;

                    const trClass = isReceipt ? 'row-resolved-receipt' : 'row-resolved-movement';

                    return `
                        <tr class="${trClass}" style="opacity: 0.85;">
                            <td>${badgeHtml}</td>
                            <td class="fecha-cell">${item.fecha}</td>
                            <td class="monto-cell">$${(parseFloat(item.monto)||0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                            <td><span class="code-val">${item.referencia}</span></td>
                            <td class="detalle-cell">${item.detalle}</td>
                            <td class="nota-cell"><span style="color: #38bdf8; font-weight: 500;"><i class="fa-solid fa-comment-dots"></i> ${escapeHtml(item.nota)}</span></td>
                            <td class="text-right">${actionHtml}</td>
                        </tr>
                    `;
                }).join('');
            }
        } else if (currentSubtab === 'duplicates') {
            if (tableEl) tableEl.className = 'receipts-table reconcile-table duplicates-layout';
            reconTableHeader.innerHTML = `
                <tr>
                    <th>Fecha Comprobante</th>
                    <th>Monto ($)</th>
                    <th>Comprobante</th>
                    <th>N° Operación</th>
                    <th>Emisor</th>
                    <th>Recepción</th>
                    <th>Estado Repetido</th>
                </tr>
            `;
            const list = currentAudit.duplicateReceipts || [];
            if (list.length === 0) {
                reconTableBody.innerHTML = `<tr><td colspan="7" class="text-center">No hay comprobantes duplicados en este período.</td></tr>`;
            } else {
                reconTableBody.innerHTML = list.map(r => {
                    const thumbHtml = renderReconThumbHtml(r);

                    return `
                        <tr class="row-duplicate">
                            <td class="fecha-cell">${r.fecha_comprobante || r.fecha || 'Sin fecha'}</td>
                            <td class="monto-cell">$${(parseFloat(r.monto)||0).toLocaleString('es-AR', {minimumFractionDigits: 2})}</td>
                            <td>${thumbHtml}</td>
                            <td><span class="code-val op-id">${r.nro_operacion || '-'}</span></td>
                            <td>${r.emisor || '-'}</td>
                            <td>${r.createdAt ? new Date(r.createdAt).toLocaleDateString() + ' ' + new Date(r.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                            <td><span class="badge-status duplicate-badge"><i class="fa-solid fa-triangle-exclamation"></i> REPETIDO (${r.repeatCount || 2} veces)</span></td>
                        </tr>
                    `;
                }).join('');
            }
        }
    }

    // New Audit Upload Event
    reconcileDropZone.addEventListener('click', () => reconcileFileInput.click());

    reconcileFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            const name = inputAuditName.value.trim() || `Conciliación ${new Date().toLocaleDateString('es-AR')}`;
            reconcileFileNameDisplay.textContent = `Archivo: ${file.name}`;
            runHomebankingReconciliation(file, name);
        }
    });

    async function runHomebankingReconciliation(file, name) {
        const formData = new FormData();
        formData.append('excelFile', file);

        const query = new URLSearchParams();
        const start = reconStartDate.value;
        const end = reconEndDate.value;
        if (start) query.append('startDate', start);
        if (end) query.append('endDate', end);
        if (name) query.append('name', name);
        if (reconAccountSelect?.value) query.append('account', reconAccountSelect.value);

        reconcileFileNameDisplay.textContent = `⏳ Analizando extracto "${file.name}"...`;

        try {
            const res = await fetch(`/api/reconcile-excel?${query.toString()}`, {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                analyzedReport = await res.json();
                analyzedReport.fileName = file.name;
                analyzedReport.name = name || analyzedReport.name || `Conciliación ${new Date().toLocaleDateString('es-AR')}`;
                currentAudit = analyzedReport;

                renderAuditDashboard();
                btnSaveCurrentAudit.style.display = 'flex';
                reconcileFileNameDisplay.textContent = `✓ Análisis completado. Presiona "Guardar Auditoría" para conservarla.`;
                showToast(`Análisis bancario completado para ${file.name}`, 'success');
            } else {
                const errData = await res.json();
                alert(`Error en conciliación: ${errData.error || 'No se pudo procesar el archivo Excel.'}`);
            }
        } catch (err) {
            console.error('Reconcile fetch error:', err);
            alert('Error al conectar con el servidor para la conciliación.');
        }
    }

    if (btnSaveCurrentAudit) {
        btnSaveCurrentAudit.addEventListener('click', async () => {
            const auditToSave = analyzedReport || currentAudit;
            if (!auditToSave) {
                alert('No hay ninguna auditoría analizada para guardar.');
                return;
            }

            const customName = (inputAuditName && inputAuditName.value.trim()) || auditToSave.name || `Conciliación ${new Date().toLocaleDateString('es-AR')}`;
            auditToSave.name = customName;

            const originalHtml = btnSaveCurrentAudit.innerHTML;
            btnSaveCurrentAudit.disabled = true;
            btnSaveCurrentAudit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando...`;

            try {
                const res = await fetch('/api/reconciliations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(auditToSave)
                });

                if (res.ok) {
                    const saved = await res.json();
                    currentAudit = saved;
                    analyzedReport = null;
                    btnSaveCurrentAudit.style.display = 'none';
                    await fetchSavedReconciliations();
                    renderAuditDashboard();
                    reconcileFileNameDisplay.textContent = `✓ Auditoría "${saved.name}" guardada con éxito.`;
                    showToast(`Auditoría "${saved.name}" guardada en el historial`, 'success');
                } else {
                    const errData = await res.json().catch(() => ({}));
                    alert(`Error al guardar auditoría: ${errData.error || 'El servidor devolvió un error.'}`);
                }
            } catch (err) {
                console.error('Save audit error:', err);
                alert('Error al conectar con el servidor para guardar la auditoría.');
            } finally {
                btnSaveCurrentAudit.disabled = false;
                btnSaveCurrentAudit.innerHTML = originalHtml;
            }
        });
    }

    if (btnRecalculateAudit) {
        btnRecalculateAudit.addEventListener('click', async () => {
            if (!currentAudit) return;

            const originalHtml = btnRecalculateAudit.innerHTML;
            btnRecalculateAudit.disabled = true;
            btnRecalculateAudit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Actualizando...`;
            showToast('Actualizando cruce de comprobantes...', 'info');

            try {
                const res = await fetch(`/api/reconciliations/${currentAudit.id}/reprocess`, {
                    method: 'POST'
                });

                if (res.ok) {
                    const updated = await res.json();
                    currentAudit = updated;

                    // Update in savedReconciliations
                    const idx = savedReconciliations.findIndex(r => r.id === updated.id);
                    if (idx !== -1) {
                        savedReconciliations[idx] = updated;
                    }

                    renderSavedReconciliationsList();
                    renderAuditDashboard();
                    showToast('✓ Cruce actualizado con éxito', 'success');
                } else {
                    const errData = await res.json().catch(() => ({}));
                    showToast(errData.error || 'Error al actualizar la conciliación', 'error');
                }
            } catch (err) {
                console.error('Error recalculating audit:', err);
                showToast('Error de red al actualizar conciliación', 'error');
            } finally {
                btnRecalculateAudit.disabled = false;
                btnRecalculateAudit.innerHTML = originalHtml;
            }
        });
    }

    if (btnDeleteAudit) {
        btnDeleteAudit.addEventListener('click', async () => {
            if (!currentAudit) return;
            if (!confirm(`¿Eliminar la auditoría "${currentAudit.name}"?`)) return;

            try {
                const res = await fetch(`/api/reconciliations/${currentAudit.id}`, { method: 'DELETE' });
                if (res.ok) {
                    currentAudit = null;
                    analyzedReport = null;
                    btnSaveCurrentAudit.style.display = 'none';
                    fetchSavedReconciliations();
                    renderAuditDashboard();
                    showToast('Auditoría eliminada', 'info');
                }
            } catch (err) {
                console.error('Delete audit error:', err);
            }
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // --- MANUAL RESOLUTION MODAL LOGIC ---
    const resolutionModal = document.getElementById('resolutionModal');
    const btnCloseResolutionModal = document.getElementById('btnCloseResolutionModal');
    const btnCancelResolutionModal = document.getElementById('btnCancelResolutionModal');
    const resolutionModalTitle = document.getElementById('resolutionModalTitle');
    const resolutionModalSub = document.getElementById('resolutionModalSub');
    const resolutionModalText = document.getElementById('resolutionModalText');
    const btnConfirmResolution = document.getElementById('btnConfirmResolution');

    let resolveTargetType = null;
    let resolveTargetId = null;

    window.openResolveReceiptModal = (id) => {
        resolveTargetType = 'receipt';
        resolveTargetId = id;
        
        const list = currentAudit.unverifiedReceipts || [];
        const receipt = list.find(r => r.id === id);
        
        resolutionModalTitle.textContent = 'Ajuste Manual: Comprobante';
        if (receipt) {
            const montoVal = typeof receipt.monto === 'number' ? receipt.monto : parseFloat(receipt.monto) || 0;
            resolutionModalSub.textContent = `${receipt.emisor || 'Comprobante'} • $${montoVal.toLocaleString('es-AR')} • N° Op: ${receipt.nro_operacion || 's/n'}`;
        } else {
            resolutionModalSub.textContent = `ID Comprobante: ${id}`;
        }
        resolutionModalText.value = '';
        resolutionModal.classList.add('active');
        setTimeout(() => {
            resolutionModalText.focus();
        }, 100);
    };

    window.openResolveBankMovementModal = (id) => {
        resolveTargetType = 'bankMovement';
        resolveTargetId = id;
        
        const list = currentAudit.unclaimedBankMovements || [];
        const mvmt = list.find(b => b.id === id);
        
        resolutionModalTitle.textContent = 'Resolver Depósito Bancario';
        if (mvmt) {
            const amountVal = typeof mvmt.importe === 'number' ? mvmt.importe : parseFloat(mvmt.importe) || 0;
            resolutionModalSub.textContent = `Depósito: $${amountVal.toLocaleString('es-AR')} • Ref: ${mvmt.referencia || 's/n'} • Detalle: ${mvmt.concepto || '-'}`;
        } else {
            resolutionModalSub.textContent = `ID Movimiento: ${id}`;
        }
        resolutionModalText.value = '';
        resolutionModal.classList.add('active');
        setTimeout(() => {
            resolutionModalText.focus();
        }, 100);
    };

    function closeResolutionModal() {
        resolutionModal.classList.remove('active');
        resolveTargetType = null;
        resolveTargetId = null;
    }

    if (btnCloseResolutionModal) btnCloseResolutionModal.addEventListener('click', closeResolutionModal);
    if (btnCancelResolutionModal) btnCancelResolutionModal.addEventListener('click', closeResolutionModal);
    if (resolutionModal) {
        resolutionModal.addEventListener('click', (e) => {
            if (e.target === resolutionModal) closeResolutionModal();
        });
    }
    
    if (btnConfirmResolution) {
        btnConfirmResolution.addEventListener('click', async () => {
            if (!currentAudit) return;
            if (!resolveTargetType || !resolveTargetId) return;

            const note = resolutionModalText.value.trim();
            if (!note) {
                alert('Por favor ingresa una nota explicativa para el ajuste.');
                return;
            }

            if (!currentAudit.manualOverrides) {
                currentAudit.manualOverrides = { receipts: {}, bankMovements: {} };
            }
            if (!currentAudit.manualOverrides.receipts) currentAudit.manualOverrides.receipts = {};
            if (!currentAudit.manualOverrides.bankMovements) currentAudit.manualOverrides.bankMovements = {};

            if (resolveTargetType === 'receipt') {
                currentAudit.manualOverrides.receipts[resolveTargetId] = {
                    status: 'MANUAL_VERIFICADO',
                    note: note
                };
            } else if (resolveTargetType === 'bankMovement') {
                currentAudit.manualOverrides.bankMovements[resolveTargetId] = {
                    status: 'RESOLVED',
                    note: note
                };
            }

            closeResolutionModal();
            await saveAndReprocessAudit();
        });
    }

    window.undoReceiptOverride = async (id) => {
        if (!currentAudit || !currentAudit.manualOverrides || !currentAudit.manualOverrides.receipts) return;
        delete currentAudit.manualOverrides.receipts[id];
        await saveAndReprocessAudit();
    };

    window.undoBankMovementOverride = async (id) => {
        if (!currentAudit || !currentAudit.manualOverrides || !currentAudit.manualOverrides.bankMovements) return;
        delete currentAudit.manualOverrides.bankMovements[id];
        await saveAndReprocessAudit();
    };

    window.updateUnclaimedBankNote = async (movementId, noteValue) => {
        if (!currentAudit) return;

        const normalizedNote = typeof noteValue === 'string' ? noteValue.trim() : '';

        if (currentAudit.unclaimedBankMovements) {
            const mvmt = currentAudit.unclaimedBankMovements.find(b => String(b.id) === String(movementId));
            if (mvmt) {
                mvmt.customNote = normalizedNote;
                mvmt.note = normalizedNote;
            }
        }

        // bankMovements is the canonical source used by the server when it
        // re-runs the reconciliation. Keep it in sync with the visible row.
        if (currentAudit.bankMovements) {
            const mvmt = currentAudit.bankMovements.find(b => String(b.id) === String(movementId));
            if (mvmt) {
                mvmt.customNote = normalizedNote;
                mvmt.note = normalizedNote;
            }
        }

        if (currentAudit.data && currentAudit.data.unclaimedBankMovements) {
            const mvmt = currentAudit.data.unclaimedBankMovements.find(b => String(b.id) === String(movementId));
            if (mvmt) {
                mvmt.customNote = normalizedNote;
                mvmt.note = normalizedNote;
            }
        }

        if (currentAudit.id && !currentAudit.id.startsWith('temp_')) {
            try {
                const res = await fetch('/api/reconciliations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentAudit)
                });
                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || 'No se pudo guardar la nota');
                }

                const saved = await res.json();
                currentAudit = saved;
                const idx = savedReconciliations.findIndex(r => r.id === saved.id);
                if (idx !== -1) savedReconciliations[idx] = saved;
                renderSavedReconciliationsList();
                renderAuditDashboard();
                showToast('✓ Nota guardada correctamente', 'success');
            } catch (err) {
                console.error('Error saving bank movement note:', err);
                showToast(`Error al guardar la nota: ${err.message}`, 'error');
            }
        }
    };

    async function saveAndReprocessAudit() {
        showToast('Aplicando ajuste manual...', 'info');

        try {
            const res = await fetch('/api/reconciliations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentAudit)
            });

            if (res.ok) {
                const saved = await res.json();
                currentAudit = saved;
                
                const idx = savedReconciliations.findIndex(r => r.id === saved.id);
                if (idx !== -1) {
                    savedReconciliations[idx] = saved;
                }
                
                renderSavedReconciliationsList();
                renderAuditDashboard();
                showToast('✓ Ajuste guardado correctamente', 'success');
            } else {
                showToast('Error al guardar el ajuste', 'error');
            }
        } catch (err) {
            console.error('Error saving adjustments:', err);
            showToast('Error de red al guardar el ajuste', 'error');
        }
    }

    // Initial load
    (async () => {
        try {
            const configRes = await fetch('/api/config');
            if (configRes.ok) {
                appConfig = await configRes.json();
            }
        } catch (e) {
            console.warn('Could not fetch app config:', e);
        }
        // Fetch receipts after config is loaded so isLocal1Sender works correctly
        fetchReceipts();
    })();

    // Fetch initial WhatsApp status on page load
    (async () => {
        try {
            const res = await fetch('/api/whatsapp/status');
            if (res.ok) {
                const statusInfo = await res.json();
                updateConnectionStatusUI(statusInfo);
            }
        } catch (e) {
            console.warn('Could not fetch initial WhatsApp status:', e);
        }
    })();
});

// Clear duplicate marker for a single receipt
window.clearSingleDuplicate = async (id, event) => {
    if (event) event.stopPropagation();
    try {
        const res = await fetch(`/api/receipts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                isDuplicate: false,
                repeatCount: 1,
                duplicateReason: ''
            })
        });
        if (res.ok) {
            showToast('✓ Alerta de duplicado removida de este comprobante', 'success');
            fetchReceipts();
            if (typeof fetchDailyStats === 'function') fetchDailyStats();
        } else {
            showToast('Error al remover marca de duplicado', 'error');
        }
    } catch (err) {
        console.error('Error clearing duplicate flag:', err);
        showToast('Error de conexión', 'error');
    }
};
