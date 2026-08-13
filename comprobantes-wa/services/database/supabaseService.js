import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import {
    isMercadoFrescosLocal,
    MERCADO_FRESCOS_BRANCHES,
    MERCADO_FRESCOS_UNASSIGNED_LOCAL,
    getMercadoFrescosBranchForSender
} from '../receipts/recipientService.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bcuvjyzlnhvsicwptizy.supabase.co';
// Never provide a credential fallback here. A committed service-role key grants
// unrestricted access to the database and must only exist in the deployment env.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

let supabase = null;

export function getSupabase() {
    if (!supabase) {
        if (!SUPABASE_KEY) {
            throw new Error('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) is not configured.');
        }
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: false }
        });
    }
    return supabase;
}

// --- RECEIPTS OPERATIONS ---

export async function supabaseGetAllReceipts({ fecha, account, id, includeThumbnail = false } = {}) {
    const sb = getSupabase();
    const listColumns = [
        'id', 'fecha', 'fecha_comprobante', 'hora', 'monto', 'moneda', 'emisor', 'destinatario',
        'local', 'tipo_comprobante', 'concepto', 'nro_operacion', 'sender',
        'filename', 'filePath', 'status', 'notas', 'isDuplicate', 'repeatCount',
        'duplicateReason', 'rawText', 'createdAt', 'updatedAt'
    ].join(',');
    const selectColumns = includeThumbnail ? '*' : listColumns;

    // When a narrow filter is applied (single day / single id) the result set
    // is small enough for a single round-trip. Skip pagination to keep latency
    // low for the dashboard.
    const isNarrowQuery = Boolean(fecha || id);

    // Helper: build a base query with all shared filters applied.
    const buildQuery = () => {
        let q = sb.from('receipts').select(selectColumns);
        if (fecha) {
            q = fecha === 'Sin fecha' ? q.is('fecha', null) : q.eq('fecha', fecha);
        }
        if (id) {
            q = q.eq('id', id);
        }
        if (account === 'mercado_frescos') {
            q = q.like('local', 'mercado_frescos%');
        }
        return q;
    };

    if (isNarrowQuery) {
        // Single-page fetch for narrow filters (dashboard day view, single id).
        const { data, error } = await buildQuery().order('createdAt', { ascending: false });
        if (error) {
            console.error('Error reading receipts from Supabase:', error.message);
            throw error;
        }
        return (data || []).map(r => ({
            ...r,
            monto: typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0,
            isDuplicate: Boolean(r.isDuplicate)
        }));
    }

    // Paginated fetch for full-table scans (reconciliation, stats, export).
    // Supabase free-tier has a statement timeout (~8 s). Splitting into pages
    // of 1 000 rows keeps each round-trip well under the limit.
    const PAGE_SIZE = 1000;
    let allRows = [];
    let from = 0;
    let keepGoing = true;

    while (keepGoing) {
        const { data, error } = await buildQuery()
            .order('createdAt', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);

        if (error) {
            console.error(`Error reading receipts from Supabase (page from=${from}):`, error.message);
            throw error;
        }

        const rows = data || [];
        allRows = allRows.concat(rows);
        if (rows.length < PAGE_SIZE) {
            keepGoing = false;
        } else {
            from += PAGE_SIZE;
        }
    }

    return allRows.map(r => ({
        ...r,
        monto: typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0,
        isDuplicate: Boolean(r.isDuplicate)
    }));
}

export async function supabaseGetDailyStats() {
    const sb = getSupabase();
    // Fetch all receipts and aggregate by fecha client-side
    // (Supabase free tier doesn't support GROUP BY via PostgREST easily)
    const { data, error } = await sb
        .from('receipts')
        .select('fecha, monto, local, sender, isDuplicate, notas, status, nro_operacion, repeatCount, duplicateReason')
        .order('fecha', { ascending: false });

    if (error) {
        console.error('Error reading daily stats from Supabase:', error.message);
        return [];
    }

    // Consolidate duplicates by operation number before aggregating totals
    const mapByOp = new Map();
    const consolidatedList = [];

    // Group oldest first to keep original record stats
    [...(data || [])].reverse().forEach(r => {
        const operationNumber = r.nro_operacion ? String(r.nro_operacion).trim() : null;
        const opKey = operationNumber ? `${r.local || 'legacy'}::${operationNumber}` : null;
        if (opKey && opKey !== '' && opKey !== 'null') {
            if (mapByOp.has(opKey)) {
                const existing = mapByOp.get(opKey);
                existing.repeatCount = (existing.repeatCount || 1) + 1;
                // The oldest row is the original: it must keep counting once.
                existing.isDuplicate = false;
            } else {
                // A repeated operation is an alert on the original, not a
                // duplicate row that should be excluded from totals.
                r.isDuplicate = false;
                r.repeatCount = r.repeatCount || 1;
                mapByOp.set(opKey, r);
                consolidatedList.push(r);
            }
        } else {
            consolidatedList.push(r);
        }
    });

    const dayMap = new Map();
    for (const r of consolidatedList) {
        const key = (r.fecha || '').slice(0, 10) || 'Sin fecha';
        if (!dayMap.has(key)) {
            dayMap.set(key, {
                fecha: key,
                total_monto: 0,
                total_count: 0,
                abasto_monto: 0,
                abasto_count: 0,
                mercado_frescos_monto: 0,
                mercado_frescos_count: 0,
                local1_monto: 0,
                local1_count: 0,
                local2_monto: 0,
                local2_count: 0,
                has_notes: false,
                has_duplicates: false,
                abasto_has_notes: false,
                abasto_has_duplicates: false,
                mercado_frescos_has_notes: false,
                mercado_frescos_has_duplicates: false,
            });
            const initializedDay = dayMap.get(key);
            for (const branch of MERCADO_FRESCOS_BRANCHES) {
                initializedDay[`${branch.id}_monto`] = 0;
                initializedDay[`${branch.id}_count`] = 0;
            }
            initializedDay[`${MERCADO_FRESCOS_UNASSIGNED_LOCAL}_monto`] = 0;
            initializedDay[`${MERCADO_FRESCOS_UNASSIGNED_LOCAL}_count`] = 0;
        }
        const day = dayMap.get(key);
        const monto = typeof r.monto === 'number' ? r.monto : parseFloat(r.monto) || 0;
        const isMarket = isMercadoFrescosLocal(r.local);
        const hasDuplicate = Boolean(
            r.isDuplicate ||
            (r.repeatCount && r.repeatCount > 1) ||
            String(r.duplicateReason || '').startsWith('POSIBLE_DUPLICADO')
        );
        day.total_monto += monto;
        day.total_count += 1;
        if (isMarket) {
            day.mercado_frescos_monto += monto;
            day.mercado_frescos_count += 1;
            const branchId = MERCADO_FRESCOS_BRANCHES.some(branch => branch.id === r.local)
                ? r.local
                : getMercadoFrescosBranchForSender(r.sender)?.id || MERCADO_FRESCOS_UNASSIGNED_LOCAL;
            day[`${branchId}_monto`] += monto;
            day[`${branchId}_count`] += 1;
            if (r.notas) day.mercado_frescos_has_notes = true;
            if (hasDuplicate) day.mercado_frescos_has_duplicates = true;
        } else {
            day.abasto_monto += monto;
            day.abasto_count += 1;
            if (r.local === 'local1') {
                day.local1_monto += monto;
                day.local1_count += 1;
            } else {
                day.local2_monto += monto;
                day.local2_count += 1;
            }
            if (r.notas) day.abasto_has_notes = true;
            if (hasDuplicate) day.abasto_has_duplicates = true;
        }
        if (r.notas) day.has_notes = true;
        if (hasDuplicate) day.has_duplicates = true;
    }

    return Array.from(dayMap.values());
}

function determineLocal(receipt) {
    if (!receipt.sender || receipt.sender.includes('Carga Manual') || (receipt.filename && receipt.filename.includes('manual'))) {
        return 'local1';
    }
    const nameToCheck = (receipt.sender || '') + (receipt.filename || '');
    if (nameToCheck.toLowerCase().includes('reparto')) {
        return 'local2';
    }
    return 'local1';
}

export async function supabaseSaveReceipt(receiptData) {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const operationNumber = receiptData.nro_operacion ? String(receiptData.nro_operacion).trim() : '';
    const receiptLocal = receiptData.local || determineLocal(receiptData);

    // Keep one canonical row per operation number, as SQLite already does.
    // This also protects against WhatsApp reconnect/history-sync replays.
    let existing = null;
    if (operationNumber) {
        const { data, error } = await sb
            .from('receipts')
            .select('*')
            .eq('nro_operacion', operationNumber)
            .eq('local', receiptLocal)
            .order('createdAt', { ascending: true })
            .limit(1);
        if (error) throw new Error(`Error checking duplicate receipt: ${error.message}`);
        existing = data && data[0] ? data[0] : null;
    }

    // Retry-safe fallback for messages without an operation number. A failed
    // download/OCR attempt can be retried with the same filename; reuse the
    // existing row instead of creating one error row per retry.
    if (!existing && receiptData.filename) {
        const { data, error } = await sb
            .from('receipts')
            .select('*')
            .eq('filename', receiptData.filename)
            .order('createdAt', { ascending: true })
            .limit(1);
        if (error) throw new Error(`Error checking receipt filename: ${error.message}`);
        existing = data && data[0] ? data[0] : null;
    }

    const isOperationDuplicate = Boolean(
        operationNumber &&
        existing &&
        String(existing.nro_operacion || '').trim() === operationNumber &&
        existing.id !== receiptData.id
    );
    const canonicalId = existing ? existing.id : (receiptData.id || `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

    const row = {
        id: canonicalId,
        fecha: receiptData.fecha || existing?.fecha || null,
        fecha_comprobante: receiptData.fecha_comprobante !== undefined
            ? receiptData.fecha_comprobante
            : (existing?.fecha_comprobante || receiptData.fecha || existing?.fecha || null),
        hora: receiptData.hora !== undefined ? receiptData.hora : (existing?.hora || null),
        monto: typeof receiptData.monto === 'number' ? receiptData.monto : (parseFloat(receiptData.monto) || existing?.monto || 0),
        moneda: receiptData.moneda || existing?.moneda || 'ARS',
        emisor: receiptData.emisor || existing?.emisor || '',
        destinatario: receiptData.destinatario || existing?.destinatario || null,
        local: receiptData.local || existing?.local || receiptLocal,
        tipo_comprobante: receiptData.tipo_comprobante || existing?.tipo_comprobante || '',
        concepto: receiptData.concepto || existing?.concepto || '',
        nro_operacion: operationNumber || existing?.nro_operacion || '',
        sender: receiptData.sender || existing?.sender || 'Desconocido',
        filename: existing?.filename || receiptData.filename || '',
        filePath: existing?.filePath || receiptData.filePath || '',
        thumbnailBase64: existing?.thumbnailBase64 || receiptData.thumbnailBase64 || '',
        status: receiptData.status || existing?.status || 'completed',
        notas: receiptData.notas || existing?.notas || '',
        // A repeated operation updates the original row. Do not flag that
        // original as a duplicate or it disappears from operational totals.
        isDuplicate: Boolean(receiptData.isDuplicate || (!isOperationDuplicate && existing?.isDuplicate)),
        repeatCount: isOperationDuplicate ? (existing.repeatCount || 1) + 1 : (receiptData.repeatCount || existing?.repeatCount || 1),
        duplicateReason: isOperationDuplicate
            ? `Comprobante enviado ${(existing.repeatCount || 1) + 1} veces (N° Op: ${operationNumber})`
            : (receiptData.duplicateReason || existing?.duplicateReason || ''),
        rawText: receiptData.rawText || existing?.rawText || '',
        createdAt: existing?.createdAt || receiptData.createdAt || now,
        updatedAt: now
    };

    const { data, error } = await sb
        .from('receipts')
        .upsert(row, { onConflict: 'id' })
        .select();

    if (error) {
        console.error('Error saving receipt to Supabase:', error.message);
        throw new Error(`No se pudo guardar el comprobante en Supabase: ${error.message}`);
    }

    return data && data[0] ? { ...data[0], isDuplicate: Boolean(data[0].isDuplicate) } : row;
}

export async function supabaseClearAllReceipts(account = 'abasto') {
    const sb = getSupabase();
    let query = sb.from('receipts').delete().neq('id', '___non_existent___');
    query = account === 'mercado_frescos'
        ? query.like('local', 'mercado_frescos%')
        : query.or('local.not.like.mercado_frescos%,local.is.null');
    const { error } = await query;
    if (error) {
        console.error('Error clearing receipts in Supabase:', error.message);
        return false;
    }
    return true;
}

export async function supabaseUpdateReceiptNote(id, note) {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await sb
        .from('receipts')
        .update({ notas: note || '', updatedAt: now })
        .eq('id', id)
        .select();

    if (error || !data || data.length === 0) {
        console.error('Error updating note in Supabase:', error?.message);
        return null;
    }
    return { ...data[0], isDuplicate: Boolean(data[0].isDuplicate) };
}

export async function supabaseUpdateReceiptDate(id, fecha) {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { data: currentRows, error: currentError } = await sb
        .from('receipts')
        .select('fecha, fecha_comprobante')
        .eq('id', id)
        .limit(1);
    if (currentError || !currentRows || currentRows.length === 0) {
        console.error('Error reading receipt before updating fecha in Supabase:', currentError?.message);
        return null;
    }
    const current = currentRows[0];
    const { data, error } = await sb
        .from('receipts')
        .update({
            fecha: fecha || null,
            fecha_comprobante: current.fecha_comprobante || current.fecha || fecha || null,
            updatedAt: now
        })
        .eq('id', id)
        .select();

    if (error || !data || data.length === 0) {
        console.error('Error updating fecha in Supabase:', error?.message);
        return null;
    }
    return { ...data[0], isDuplicate: Boolean(data[0].isDuplicate) };
}

export async function supabaseUpdateReceiptFechaComprobante(id, fechaComprobante) {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await sb
        .from('receipts')
        .update({
            fecha_comprobante: fechaComprobante || null,
            updatedAt: now
        })
        .eq('id', id)
        .select();

    if (error || !data || data.length === 0) {
        console.error('Error updating fecha_comprobante in Supabase:', error?.message);
        return null;
    }
    return { ...data[0], isDuplicate: Boolean(data[0].isDuplicate) };
}


export async function supabaseUpdateReceiptFields(id, fields) {
    const sb = getSupabase();
    const now = new Date().toISOString();
    const { data, error } = await sb
        .from('receipts')
        .update({ ...fields, updatedAt: now })
        .eq('id', id)
        .select();

    if (error || !data || data.length === 0) {
        console.error('Error updating fields in Supabase:', error?.message);
        return null;
    }
    return { ...data[0], isDuplicate: Boolean(data[0].isDuplicate) };
}

export async function supabaseDeleteReceipt(id) {
    const sb = getSupabase();
    const { error } = await sb.from('receipts').delete().eq('id', id);
    if (error) {
        console.error('Error deleting receipt in Supabase:', error.message);
        return false;
    }
    return true;
}

export async function supabaseDeleteDuplicateReceipts(account = 'abasto') {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('receipts')
        .select('id, local, nro_operacion, createdAt, isDuplicate, repeatCount, duplicateReason')
        .order('createdAt', { ascending: true });

    if (error) {
        console.error('Error fetching receipts for duplicates check in Supabase:', error.message);
        return { deletedCount: 0, clearedCount: 0 };
    }

    const originalsByOperation = new Map();
    const idsToDelete = [];
    const idsToNormalize = new Set();

    (data || [])
        .filter(r => account === 'mercado_frescos'
            ? isMercadoFrescosLocal(r.local)
            : !isMercadoFrescosLocal(r.local))
        .forEach(r => {
            const opKey = r.nro_operacion
                ? `${r.local || 'legacy'}::${String(r.nro_operacion).trim()}`
                : null;
            if (opKey && opKey !== '' && opKey !== 'null') {
                if (originalsByOperation.has(opKey)) {
                    idsToDelete.push(r.id);
                } else {
                    originalsByOperation.set(opKey, r);
                    if (r.isDuplicate || (r.repeatCount && r.repeatCount > 1)) idsToNormalize.add(r.id);
                }
            } else if (r.isDuplicate && String(r.duplicateReason || '').startsWith('Duplicado Confirmado por Operador')) {
                // This is the extra row from a manually confirmed possible duplicate.
                idsToDelete.push(r.id);
            } else if (r.repeatCount && r.repeatCount > 1) {
                // Its manually-confirmed counterpart is being removed; retain the
                // original but remove the stale repeat marker.
                idsToNormalize.add(r.id);
            } else {
                // Keep the row untouched when it has no duplicate marker.
            }
        });

    if (idsToDelete.length > 0) {
        const { error: delErr } = await sb
            .from('receipts')
            .delete()
            .in('id', idsToDelete);
        if (delErr) {
            console.error('Error deleting duplicates in Supabase:', delErr.message);
            return 0;
        }
    }

    if (idsToNormalize.size > 0) {
        const { error: updateErr } = await sb
            .from('receipts')
            .update({ isDuplicate: false, repeatCount: 1, duplicateReason: '' })
            .in('id', [...idsToNormalize]);
        if (updateErr) {
            console.error('Error clearing duplicate markers in Supabase:', updateErr.message);
            return { deletedCount: idsToDelete.length, clearedCount: 0 };
        }
    }

    return { deletedCount: idsToDelete.length, clearedCount: idsToNormalize.size };
}

// --- RECONCILIATIONS OPERATIONS ---

export async function supabaseGetAllReconciliations() {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('reconciliations')
        .select('*')
        .order('createdAt', { ascending: false });

    if (error) {
        console.error('Error getting reconciliations from Supabase:', error.message);
        return [];
    }

    return (data || []).map(r => {
        let dataObj = typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {});
        let summaryObj = typeof r.summary === 'string' ? JSON.parse(r.summary || '{}') : (r.summary || {});
        return {
            id: r.id,
            name: r.name,
            fileName: r.fileName,
            createdAt: r.createdAt,
            summary: summaryObj,
            ...dataObj
        };
    });
}

export async function supabaseGetReconciliationById(id) {
    const sb = getSupabase();
    const { data, error } = await sb
        .from('reconciliations')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !data) {
        console.error('Error getting reconciliation by id from Supabase:', error?.message);
        return null;
    }

    let dataObj = typeof data.data === 'string' ? JSON.parse(data.data || '{}') : (data.data || {});
    let summaryObj = typeof data.summary === 'string' ? JSON.parse(data.summary || '{}') : (data.summary || {});
    return {
        id: data.id,
        name: data.name,
        fileName: data.fileName,
        createdAt: data.createdAt,
        summary: summaryObj,
        ...dataObj
    };
}

export async function supabaseSaveReconciliation(auditData) {
    const sb = getSupabase();
    const cleanReceipt = (r) => {
        if (!r) return r;
        const copy = { ...r };
        delete copy.thumbnailBase64;
        return copy;
    };

    const newAudit = {
        id: auditData.id || `recon_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        account: auditData.account || 'abasto',
        name: auditData.name || `Conciliación ${new Date().toLocaleDateString('es-AR')}`,
        fileName: auditData.fileName || 'Extracto.xlsx',
        createdAt: auditData.createdAt || new Date().toISOString(),
        summary: auditData.summary || {},
        verifiedReceipts: (auditData.verifiedReceipts || []).map(cleanReceipt),
        unverifiedReceipts: (auditData.unverifiedReceipts || []).map(cleanReceipt),
        unclaimedBankMovements: auditData.unclaimedBankMovements || [],
        duplicateReceipts: (auditData.duplicateReceipts || []).map(cleanReceipt),
        bankMovements: auditData.bankMovements || [],
        manualOverrides: auditData.manualOverrides || { receipts: {}, bankMovements: {} }
    };

    const row = {
        id: newAudit.id,
        name: newAudit.name,
        fileName: newAudit.fileName,
        createdAt: newAudit.createdAt,
        summary: newAudit.summary,
        data: newAudit
    };

    const { error } = await sb
        .from('reconciliations')
        .upsert(row, { onConflict: 'id' });

    if (error) {
        console.error('Error saving reconciliation to Supabase:', error.message);
        throw new Error(error.message);
    }

    return newAudit;
}

export async function supabaseDeleteReconciliation(id) {
    const sb = getSupabase();
    const { error } = await sb.from('reconciliations').delete().eq('id', id);
    if (error) {
        console.error('Error deleting reconciliation from Supabase:', error.message);
        return false;
    }
    return true;
}

// --- BAILEYS WHATSAPP AUTH PERSISTENCE IN SUPABASE ---

export async function useSupabaseAuthState() {
    const sb = getSupabase();

    const readData = async (id) => {
        try {
            const { data, error } = await sb
                .from('whatsapp_auth')
                .select('data')
                .eq('id', id)
                .single();
            if (error || !data) return null;
            const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
            return JSON.parse(JSON.stringify(parsed), BufferJSON.reviver);
        } catch (e) {
            return null;
        }
    };

    const writeDataMany = async (items) => {
        if (!items || items.length === 0) return;
        try {
            const rows = items.map(({ id, data }) => ({
                id,
                data: JSON.parse(JSON.stringify(data, BufferJSON.replacer))
            }));
            for (let i = 0; i < rows.length; i += 200) {
                const chunk = rows.slice(i, i + 200);
                const { error } = await sb.from('whatsapp_auth').upsert(chunk, { onConflict: 'id' });
                if (error) {
                    console.error('⚠️ [Supabase Auth Error]:', error.message);
                }
            }
        } catch (e) {
            console.error('Error batch writing auth data to Supabase:', e.message);
        }
    };

    const removeDataMany = async (ids) => {
        if (!ids || ids.length === 0) return;
        try {
            for (let i = 0; i < ids.length; i += 200) {
                const chunk = ids.slice(i, i + 200);
                await sb.from('whatsapp_auth').delete().in('id', chunk);
            }
        } catch (e) {}
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    if (!ids || ids.length === 0) return data;
                    try {
                        const fullKeys = ids.map(id => `${type}-${id}`);
                        for (let i = 0; i < fullKeys.length; i += 200) {
                            const chunkKeys = fullKeys.slice(i, i + 200);
                            const { data: rows, error } = await sb
                                .from('whatsapp_auth')
                                .select('id, data')
                                .in('id', chunkKeys);

                            if (!error && rows) {
                                for (const row of rows) {
                                    const rawId = row.id.replace(`${type}-`, '');
                                    let value = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
                                    value = JSON.parse(JSON.stringify(value), BufferJSON.reviver);
                                    if (type === 'app-state-sync-key' && value) {
                                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                                    }
                                    if (value) data[rawId] = value;
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error batch reading keys from Supabase:', e.message);
                    }
                    return data;
                },
                set: async (data) => {
                    const toWrite = [];
                    const toRemove = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                toWrite.push({ id: key, data: value });
                            } else {
                                toRemove.push(key);
                            }
                        }
                    }
                    if (toWrite.length > 0) await writeDataMany(toWrite);
                    if (toRemove.length > 0) await removeDataMany(toRemove);
                }
            }
        },
        saveCreds: () => writeDataMany([{ id: 'creds', data: creds }]),
        clearAuth: async () => {
            await sb.from('whatsapp_auth').delete().neq('id', '___non_existent___');
        }
    };
}
