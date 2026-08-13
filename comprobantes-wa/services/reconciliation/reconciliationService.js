import XLSX from 'xlsx';
import { getAllReconciliations, saveReconciliation } from '../database/reconciliationDb.js';
import { getAllReceipts } from '../database/dbService.js';
import { isMercadoFrescosReceipt, RECIPIENT_ACCOUNT_MERCADO_FRESCOS } from '../receipts/recipientService.js';
const RECONCILIATION_ACCOUNT_ABASTO = 'abasto';
export function normalizeReconciliationAccount(account) {
    return account === RECIPIENT_ACCOUNT_MERCADO_FRESCOS
        ? RECIPIENT_ACCOUNT_MERCADO_FRESCOS
        : RECONCILIATION_ACCOUNT_ABASTO;
}
export function filterReceiptsForAccount(receipts = [], account = RECONCILIATION_ACCOUNT_ABASTO) {
    const normalizedAccount = normalizeReconciliationAccount(account);
    const includeMercadoFrescos = normalizedAccount === RECIPIENT_ACCOUNT_MERCADO_FRESCOS;
    return receipts.filter(receipt => isMercadoFrescosReceipt(receipt) === includeMercadoFrescos);
}

/**
 * Keeps operator-edited notes attached to the canonical bank movement list
 * before a reconciliation is persisted or reprocessed.
 */
export function mergeBankMovementNotes(bankMovements = [], unclaimedBankMovements = []) {
    const notesById = new Map();
    for (const movement of unclaimedBankMovements || []) {
        if (!movement || movement.id === undefined || movement.id === null) continue;
        const hasCustomNote = Object.prototype.hasOwnProperty.call(movement, 'customNote');
        const hasLegacyNote = Object.prototype.hasOwnProperty.call(movement, 'note');
        if (hasCustomNote || hasLegacyNote) {
            const note = hasCustomNote ? movement.customNote : movement.note;
            notesById.set(String(movement.id), typeof note === 'string' ? note.trim() : '');
        }
    }

    return (bankMovements || []).map((movement) => {
        const id = movement?.id;
        if (id === undefined || id === null || !notesById.has(String(id))) return movement;
        const note = notesById.get(String(id));
        return { ...movement, customNote: note, note };
    });
}

/**
 * Parses a Homebanking Excel file (.xls or .xlsx) and reconciles it against WhatsApp receipts.
 * Normalizes dates and filters both receipts and bank movements by optional date range.
 * 
 * @param {Buffer|string} fileInput Buffer or file path of the uploaded homebanking file
 * @param {Array} receipts List of receipt objects from database
 * @param {Object} options Options object { startDate, endDate, name, fileName }
 * @returns {Object} Structured reconciliation audit
 */
export function reconcileHomebanking(fileInput, receipts = [], options = {}) {
    const { startDate, endDate, name, fileName, account = RECONCILIATION_ACCOUNT_ABASTO } = options;

    let workbook;
    if (Buffer.isBuffer(fileInput)) {
        workbook = XLSX.read(fileInput, { type: 'buffer', cellDates: true });
    } else {
        workbook = XLSX.readFile(fileInput, { cellDates: true });
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

    // 1. Detect header row & column mapping
    let headerRowIndex = -1;
    let fechaCol = -1;
    let refCol = -1;
    let conceptCol = -1;
    let amountCol = -1;
    let creditCol = -1;

    for (let r = 0; r < Math.min(rawRows.length, 50); r++) {
        const row = rawRows[r] || [];
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');

        if (rowStr.includes('fecha') || rowStr.includes('f.') || rowStr.includes('importe') || rowStr.includes('monto') || rowStr.includes('credito') || rowStr.includes('crédito') || rowStr.includes('saldo') || rowStr.includes('haber')) {
            row.forEach((cellVal, cIndex) => {
                const cellText = String(cellVal || '').trim().toLowerCase();
                if (!cellText) return;

                if (cellText.includes('fecha') || cellText.includes('f. proceso') || cellText.includes('f. valor') || cellText.includes('f.mov') || cellText.includes('día') || cellText.includes('dia')) {
                    if (fechaCol === -1) fechaCol = cIndex;
                }
                if (cellText.includes('credito') || cellText.includes('crédito') || cellText.includes('haber') || cellText.includes('ingreso') || cellText.includes('entradas')) {
                    creditCol = cIndex;
                }
                if (cellText.includes('importe') || cellText.includes('monto') || cellText.includes('saldo') || cellText.includes('valor')) {
                    if (amountCol === -1) amountCol = cIndex;
                }
                if (cellText.includes('referencia') || cellText.includes('comprobante') || cellText.includes('nro') || cellText.includes('n°') || cellText.includes('operacion') || cellText.includes('operación') || cellText.includes('ref') || cellText.includes('transaccion')) {
                    if (refCol === -1) refCol = cIndex;
                }
                if (cellText.includes('concepto') || cellText.includes('descripc') || cellText.includes('detalle') || cellText.includes('leyenda')) {
                    conceptCol = cIndex; // High priority: actual concept/description
                } else if ((cellText.includes('causal') || cellText.includes('movimiento') || cellText.includes('observaciones')) && conceptCol === -1) {
                    conceptCol = cIndex; // Low priority: causal code or observations
                }
            });

            if (fechaCol !== -1 || amountCol !== -1 || creditCol !== -1) {
                headerRowIndex = r;
                break;
            }
        }
    }

    if (creditCol !== -1) amountCol = creditCol;

    const dataStartRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;

    // Smart Content-based Auto-Detection Fallback
    if (fechaCol === -1 || amountCol === -1 || refCol === -1) {
        for (let i = dataStartRow; i < Math.min(rawRows.length, dataStartRow + 15); i++) {
            const row = rawRows[i] || [];
            row.forEach((val, colIdx) => {
                if (val === null || val === undefined) return;
                const str = String(val).trim();
                if (!str) return;

                if (fechaCol === -1 && (parseBankDate(val) !== 'Sin fecha' || /\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}/.test(str))) {
                    fechaCol = colIdx;
                }
                if (amountCol === -1 && parseAmountVal(val) !== null && parseAmountVal(val) > 0) {
                    amountCol = colIdx;
                }
                if (refCol === -1 && /^\d{6,}$/.test(str)) {
                    refCol = colIdx;
                }
                if (conceptCol === -1 && str.length > 5 && isNaN(Number(str))) {
                    conceptCol = colIdx;
                }
            });
        }
    }

    if (fechaCol === -1) fechaCol = 0;
    if (amountCol === -1) amountCol = rawRows[dataStartRow] ? rawRows[dataStartRow].length - 1 : 1;
    if (refCol === -1) refCol = fechaCol === 0 ? 1 : 0;
    if (conceptCol === -1) conceptCol = refCol === 1 ? 2 : 1;

    // 2. Parse bank movements
    const rawBankMovements = [];

    for (let i = dataStartRow; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const rawDate = row[fechaCol];
        const rawRef = row[refCol] ? String(row[refCol]).trim() : '';
        const rawConcept = row[conceptCol] ? String(row[conceptCol]).trim() : '';
        const rawAmount = row[amountCol];

        const parsedAmount = parseAmountVal(rawAmount);
        if (parsedAmount === null || parsedAmount <= 0) continue;

        const parsedDate = parseBankDate(rawDate);

        // Extract CUIT from rawConcept (ends with a hyphen and 11 digits, or just contains 11 digits)
        let cuitVal = '';
        if (rawConcept) {
            const match = rawConcept.match(/-?\s*(\d{11})\s*$/);
            if (match) {
                cuitVal = match[1];
            } else {
                const anyMatch = rawConcept.match(/\b\d{11}\b/);
                if (anyMatch) {
                    cuitVal = anyMatch[0];
                }
            }
        }

        rawBankMovements.push({
            id: `bank_${i}_${Date.now()}`,
            rowIndex: i + 1,
            fecha: parsedDate,
            referencia: rawRef,
            concepto: rawConcept,
            cuit: cuitVal,
            importe: parsedAmount,
            rawRow: row,
            matchedReceiptId: null
        });
    }

    // Filter bank movements by date range if specified (before matching)
    let bankMovements = rawBankMovements;
    if (startDate || endDate) {
        bankMovements = rawBankMovements.filter(b => {
            const normBankDate = normalizeDateStr(b.fecha);
            if (!normBankDate) return true;
            if (startDate && normBankDate < startDate) return false;
            if (endDate && normBankDate > endDate) return false;
            return true;
        });
    }

    return matchReceiptsWithMovements(bankMovements, receipts, {
        startDate,
        endDate,
        name,
        fileName,
        account
    });
}

/**
 * Matches a list of bank movements against a list of receipts.
 * 
 * @param {Array} bankMovements List of bank movement objects
 * @param {Array} receipts List of receipt objects
 * @param {Object} options Options object { startDate, endDate, name, fileName, createdAt, id }
 * @returns {Object} Structured reconciliation audit
 */
export function matchReceiptsWithMovements(bankMovements, receipts = [], options = {}) {
    let { startDate, endDate, name, fileName, account = RECONCILIATION_ACCOUNT_ABASTO, createdAt, id, manualOverrides = { receipts: {}, bankMovements: {} } } = options;
    account = normalizeReconciliationAccount(account);

    // Auto-infer date range from bank movements if not explicitly provided
    if (!startDate && !endDate && bankMovements && bankMovements.length > 0) {
        const dates = bankMovements
            .map(b => normalizeDateStr(b.fecha))
            .filter(Boolean)
            .sort();
        if (dates.length > 0) {
            startDate = dates[0];
            endDate = dates[dates.length - 1];
            console.log(`[Reconciliation] Auto-inferred date range from bank movements: ${startDate} to ${endDate}`);
        }
    }

    const overrides = {
        receipts: (manualOverrides && manualOverrides.receipts) || {},
        bankMovements: (manualOverrides && manualOverrides.bankMovements) || {}
    };

    // Reset matchedReceiptId on bank movements and ensure every movement has an id
    const bankMovementsCopy = bankMovements.map((b, index) => ({
        ...b,
        id: b.id || `bank_${index}_${Date.now()}`,
        matchedReceiptId: null
    }));

    // Reconciliation uses the date printed on the receipt. The editable
    // operational/extraction date (fecha) only controls dashboard totals.
    // OCR failures and partial extractions remain visible in the dashboard, but
    // cannot be treated as payment evidence during bank reconciliation.
    let filteredReceipts = receipts.filter(r => r.status === 'completed');
    if (startDate || endDate) {
        filteredReceipts = filteredReceipts.filter(r => {
            const normFecha = normalizeDateStr(r.fecha_comprobante) || normalizeDateStr(r.fecha);
            const normCreated = normalizeDateStr(r.createdAt);

            if (normFecha) {
                return (!startDate || normFecha >= startDate) && (!endDate || normFecha <= endDate);
            }
            return normCreated && (!startDate || normCreated >= startDate) && (!endDate || normCreated <= endDate);
        });
    }

    // Filter bank movements by date range if specified
    let filteredBankMovements = bankMovementsCopy;
    if (startDate || endDate) {
        filteredBankMovements = bankMovementsCopy.filter(b => {
            const normBankDate = normalizeDateStr(b.fecha);
            if (!normBankDate) return true;
            if (startDate && normBankDate < startDate) return false;
            if (endDate && normBankDate > endDate) return false;
            return true;
        });
    }

    const verifiedReceipts = [];
    const unverifiedReceipts = [];
    const duplicateReceipts = [];

    let totalVerifiedAmount = 0;
    let totalUnverifiedAmount = 0;

    filteredReceipts.forEach(receipt => {
        const montoVal = typeof receipt.monto === 'number' ? receipt.monto : (parseFloat(receipt.monto) || 0);
        
        if (receipt.isDuplicate || (receipt.repeatCount && receipt.repeatCount > 1)) {
            duplicateReceipts.push(receipt);
        }

        // Apply manual override if present
        const override = overrides.receipts[receipt.id];
        if (override && override.status === 'MANUAL_VERIFICADO') {
            const reconciledItem = {
                ...receipt,
                reconciliationStatus: 'MANUAL_VERIFICADO',
                reconciliationLabel: '🟢 Acreditado Manualmente',
                reconciliationReason: override.note || 'Verificado manualmente por el operador.',
                bankMatch: null
            };
            verifiedReceipts.push(reconciledItem);
            totalVerifiedAmount += montoVal;
            return; // Skip normal bank match checking
        }

        const receiptDateNorm = normalizeDateStr(receipt.fecha_comprobante) ||
            normalizeDateStr(receipt.fecha) ||
            normalizeDateStr(receipt.createdAt);
        const amountCandidates = filteredBankMovements.filter(b => {
            if (b.matchedReceiptId) return false;
            if (Math.abs(b.importe - montoVal) >= 0.01) return false;

            return true;
        });
        const candidateBankItems = amountCandidates.filter(b => {

            const bankDateNorm = normalizeDateStr(b.fecha);
            if (receiptDateNorm && bankDateNorm) {
                return receiptDateNorm === bankDateNorm;
            }
            return true;
        });

        let matchedBankItem = null;
        let status = 'NO_ENCONTRADO';
        let statusLabel = '🔴 No Acreditado';
        let matchReason = null;

        const operationNumber = String(receipt.nro_operacion || '').trim();
        const referenceCandidates = operationNumber
            ? amountCandidates.filter(b => `${b.referencia || ''} ${b.concepto || ''}`.includes(operationNumber))
            : [];

        if (referenceCandidates.length === 1) {
            matchedBankItem = referenceCandidates[0];
            matchedBankItem.matchedReceiptId = receipt.id;
            status = 'VERIFICADO';
            statusLabel = 'Acreditado en Banco (Ref. Exacta)';
            matchReason = `Coincidencia por N° de Ref: ${operationNumber}`;
        } else if (candidateBankItems.length === 1) {
            matchedBankItem = candidateBankItems[0];
            matchedBankItem.matchedReceiptId = receipt.id;
            status = 'VERIFICADO';
            statusLabel = '🟢 Acreditado en Banco';
            matchReason = `Acreditación confirmada en Homebanking ($${montoVal.toLocaleString('es-AR')})`;
        } else if (candidateBankItems.length > 1) {
            let exactRefMatch = null;
            if (receipt.nro_operacion) {
                exactRefMatch = candidateBankItems.find(b => 
                    String(b.referencia || '').includes(String(receipt.nro_operacion)) ||
                    String(b.concepto || '').includes(String(receipt.nro_operacion))
                );
            }

            if (exactRefMatch) {
                matchedBankItem = exactRefMatch;
                matchedBankItem.matchedReceiptId = receipt.id;
                status = 'VERIFICADO';
                statusLabel = '🟢 Acreditado en Banco (Ref. Exacta)';
                matchReason = `Coincidencia por N° de Ref: ${receipt.nro_operacion}`;
            } else {
                matchedBankItem = candidateBankItems[0];
                matchedBankItem.matchedReceiptId = receipt.id;
                status = 'VERIFICADO';
                statusLabel = '🟢 Acreditado en Banco (Por Monto)';
                matchReason = `Coincidencia por monto exacto ($${montoVal.toLocaleString('es-AR')})`;
            }
        } else if (amountCandidates.length === 1) {
            // The bank may expose process date while the receipt has value date.
            matchedBankItem = amountCandidates[0];
            matchedBankItem.matchedReceiptId = receipt.id;
            status = 'VERIFICADO';
            statusLabel = 'Acreditado en Banco (Importe Único)';
            matchReason = `Coincidencia por importe único ($${montoVal.toLocaleString('es-AR')}); fecha bancaria: ${matchedBankItem.fecha}`;
        } else {
            status = 'NO_ENCONTRADO';
            statusLabel = '🔴 No Encontrado en Banco';
            matchReason = `No figura ninguna acreditación de $${montoVal.toLocaleString('es-AR')} en el extracto bancario.`;
        }

        const reconciledItem = {
            ...receipt,
            reconciliationStatus: status,
            reconciliationLabel: statusLabel,
            reconciliationReason: matchReason,
            bankMatch: matchedBankItem ? {
                fecha: matchedBankItem.fecha,
                referencia: matchedBankItem.referencia,
                concepto: matchedBankItem.concepto,
                importe: matchedBankItem.importe
            } : null
        };

        if (status === 'VERIFICADO') {
            verifiedReceipts.push(reconciledItem);
            totalVerifiedAmount += montoVal;
        } else {
            unverifiedReceipts.push(reconciledItem);
            totalUnverifiedAmount += montoVal;
        }
    });

    // Sort verifiedReceipts so MANUAL_VERIFICADO appears first
    verifiedReceipts.sort((a, b) => {
        if (a.reconciliationStatus === 'MANUAL_VERIFICADO' && b.reconciliationStatus !== 'MANUAL_VERIFICADO') return -1;
        if (a.reconciliationStatus !== 'MANUAL_VERIFICADO' && b.reconciliationStatus === 'MANUAL_VERIFICADO') return 1;
        return 0;
    });

    const unclaimedBankMovements = filteredBankMovements.filter(b => !b.matchedReceiptId);
    
    // Process unclaimed bank movements to apply manual overrides (resolutions)
    const processedUnclaimed = unclaimedBankMovements.map((b, index) => {
        const fallbackId = b.id || `bank_unclaimed_${index}`;
        const override = overrides.bankMovements[fallbackId];
        const note = Object.prototype.hasOwnProperty.call(b, 'customNote')
            ? (typeof b.customNote === 'string' ? b.customNote : '')
            : (typeof b.note === 'string' ? b.note : '');
        if (override && override.status === 'RESOLVED') {
            return {
                ...b,
                id: fallbackId,
                customNote: note,
                note,
                resolved: true,
                resolutionNote: override.note || 'Marcado como resuelto.'
            };
        }
        return {
            ...b,
            id: fallbackId,
            customNote: note,
            note
        };
    });

    const unresolvedCount = processedUnclaimed.filter(b => !b.resolved).length;
    const unresolvedAmount = processedUnclaimed.filter(b => !b.resolved).reduce((acc, b) => acc + b.importe, 0);

    const totalReceiptsAmount = filteredReceipts.reduce((acc, r) => acc + (parseFloat(r.monto) || 0), 0);

    return {
        id: id || `recon_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        account,
        name: name || `Conciliación ${new Date().toLocaleDateString('es-AR')}`,
        fileName: fileName || 'Extracto.xlsx',
        createdAt: createdAt || new Date().toISOString(),
        dateRange: { startDate: startDate || null, endDate: endDate || null },
        summary: {
            totalReceipts: filteredReceipts.length,
            totalReceiptsAmount,
            verifiedCount: verifiedReceipts.length,
            verifiedAmount: totalVerifiedAmount,
            unverifiedCount: unverifiedReceipts.length,
            unverifiedAmount: totalUnverifiedAmount,
            unclaimedBankCount: unresolvedCount,
            unclaimedBankAmount: unresolvedAmount,
            duplicateCount: duplicateReceipts.length,
            totalBankMovements: filteredBankMovements.length
        },
        verifiedReceipts,
        unverifiedReceipts,
        unclaimedBankMovements: processedUnclaimed,
        duplicateReceipts,
        bankMovements: bankMovementsCopy,
        manualOverrides: overrides
    };
}

let autoReprocessTimeout = null;

export function triggerAutoReprocess(io) {
    // Automatic background reprocessing disabled by user request.
    // Replaced with manual "Actualizar Cruce" button in the UI.
}

/**
 * Internal helper to query recent reconciliations and reprocess their matches.
 */
async function autoReprocessRecentReconciliations(io) {
    console.log('[Auto-Reconciliation] Checking for updates in recent reconciliations...');
    
    // 1. Get all reconciliations
    const reconciliations = await getAllReconciliations();
    if (reconciliations.length === 0) return;

    // 2. Filter for recent reconciliations (created in the last 15 days)
    const fifteenDaysAgo = new Date();
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

    const recentReconciliations = reconciliations.filter(recon => {
        if (!recon.createdAt) return false;
        const created = new Date(recon.createdAt);
        return created >= fifteenDaysAgo;
    });

    if (recentReconciliations.length === 0) {
        console.log('[Auto-Reconciliation] No recent reconciliations found to update.');
        return;
    }

    // 3. Get all receipts from database
    const allReceipts = await getAllReceipts();

    // 4. Reprocess each recent reconciliation
    for (const recon of recentReconciliations) {
        let bankMovements = recon.bankMovements || [];
        
        // Backward compatibility: Reconstruct bankMovements if they are missing
        if (bankMovements.length === 0) {
            const matched = (recon.verifiedReceipts || [])
                .map(r => r.bankMatch)
                .filter(Boolean)
                .map((bm, index) => ({
                    id: `reconstructed_bank_m_${index}_${recon.id}`,
                    fecha: bm.fecha,
                    referencia: bm.referencia,
                    concepto: bm.concepto,
                    importe: bm.importe,
                    matchedReceiptId: null
                }));
            const unclaimed = (recon.unclaimedBankMovements || []).map(bm => ({
                ...bm,
                matchedReceiptId: null
            }));
            bankMovements = [...matched, ...unclaimed];
        }

        if (bankMovements.length === 0) {
            continue;
        }

        const newAudit = matchReceiptsWithMovements(bankMovements, filterReceiptsForAccount(allReceipts, recon.account), {
            startDate: recon.dateRange?.startDate,
            endDate: recon.dateRange?.endDate,
            name: recon.name,
            fileName: recon.fileName,
            createdAt: recon.createdAt,
            id: recon.id,
            account: recon.account,
            manualOverrides: recon.manualOverrides
        });

        // Check if anything changed by comparing summary counts/amounts
        const oldSum = recon.summary || {};
        const newSum = newAudit.summary || {};

        const hasChanged =
            oldSum.verifiedCount !== newSum.verifiedCount ||
            oldSum.unverifiedCount !== newSum.unverifiedCount ||
            oldSum.unclaimedBankCount !== newSum.unclaimedBankCount ||
            oldSum.duplicateCount !== newSum.duplicateCount;

        if (hasChanged) {
            console.log(`[Auto-Reconciliation] UPDATED "${recon.name}" (${recon.id}): verified ${oldSum.verifiedCount || 0} -> ${newSum.verifiedCount || 0}`);
            
            // Save to database
            await saveReconciliation(newAudit);

            // Broadcast update via Socket.io
            if (io) {
                io.emit('reconciliation_updated', newAudit);
            }
        }
    }
}

function normalizeDateStr(dateVal) {
    if (!dateVal) return null;
    let str = String(dateVal).trim();
    if (str.includes('T')) str = str.split('T')[0];
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
        let y = parts[0];
        let m = parts[1];
        let d = parts[2];
        
        if (parts[2].length === 2 || parts[2].length === 4) {
            y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
            const p0 = parseInt(parts[0], 10);
            const p1 = parseInt(parts[1], 10);
            if (p0 <= 12 && p1 > 12) {
                m = String(p0).padStart(2, '0');
                d = String(p1).padStart(2, '0');
            } else {
                d = String(p0).padStart(2, '0');
                m = String(p1).padStart(2, '0');
            }
        } else if (parts[0].length === 2 || parts[0].length === 4) {
            y = parts[0].length === 2 ? '20' + parts[0] : parts[0];
            m = String(parts[1]).padStart(2, '0');
            d = String(parts[2]).padStart(2, '0');
        }
        return `${y}-${m}-${d}`;
    }
    return str;
}

function parseAmountVal(val) {
    if (typeof val === 'number') return isNaN(val) ? null : val;
    if (!val) return null;
    let str = String(val).replace(/[^0-9.,-]/g, '').trim();
    if (!str) return null;

    if (str.includes(',') && str.includes('.')) {
        if (str.indexOf(',') < str.indexOf('.')) {
            str = str.replace(/,/g, '');
        } else {
            str = str.replace(/\./g, '').replace(',', '.');
        }
    } else if (str.includes(',')) {
        const parts = str.split(',');
        if (parts[1] && parts[1].length === 2) {
            str = str.replace(',', '.');
        } else {
            str = str.replace(/,/g, '');
        }
    } else if (str.includes('.')) {
        const parts = str.split('.');
        if (parts.length > 2) {
            str = str.replace(/\./g, '');
        } else if (parts[1] && parts[1].length === 3) {
            str = str.replace(/\./g, '');
        }
    }

    const num = parseFloat(str);
    return isNaN(num) ? null : num;
}

function parseBankDate(val) {
    if (!val) return 'Sin fecha';
    if (typeof val === 'number') {
        const dateObj = XLSX.SSF.parse_date_code(val);
        if (dateObj) {
            const yyyy = dateObj.y;
            const mm = String(dateObj.m).padStart(2, '0');
            const dd = String(dateObj.d).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
    }
    const text = String(val).trim();
    // This bank export uses US-style dates (M/D/YY): 8/5/26 means
    // 2026-08-05. Receipt dates continue to use the normal AR parser.
    const shortBankDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (shortBankDate) {
        const [, month, day, year] = shortBankDate;
        return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return normalizeDateStr(val) || text;
}
