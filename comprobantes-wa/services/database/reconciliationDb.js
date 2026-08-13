import { getDb, saveDbToDisk } from './sqliteDb.js';
import {
    supabaseGetAllReconciliations,
    supabaseGetReconciliationById,
    supabaseSaveReconciliation,
    supabaseDeleteReconciliation
} from './supabaseService.js';

const isSupabaseEnabled = () => process.env.USE_SUPABASE === 'true';

function parseQueryRows(db, query, params = []) {
    const stmt = db.prepare(query);
    if (params.length > 0) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

/**
 * Gets all saved reconciliation audits
 * @returns {Promise<Array>}
 */
export async function getAllReconciliations() {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseGetAllReconciliations();
        } catch (err) {
            console.error('Error reading reconciliations from Supabase:', err);
        }
    }
    try {
        const { db } = await getDb();
        const rows = parseQueryRows(db, `SELECT * FROM reconciliations ORDER BY createdAt DESC`);
        return rows.map(r => {
            let dataObj = {};
            try { dataObj = JSON.parse(r.data); } catch (e) {}
            return {
                id: r.id,
                name: r.name,
                fileName: r.fileName,
                createdAt: r.createdAt,
                summary: JSON.parse(r.summary || '{}'),
                ...dataObj
            };
        });
    } catch (err) {
        console.error('Error reading reconciliations from SQLite:', err);
        return [];
    }
}

/**
 * Gets a specific reconciliation audit by ID
 * @param {string} id 
 * @returns {Promise<Object|null>}
 */
export async function getReconciliationById(id) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseGetReconciliationById(id);
        } catch (err) {
            console.error('Error reading reconciliation by ID from Supabase:', err);
        }
    }
    try {
        const { db } = await getDb();
        const rows = parseQueryRows(db, `SELECT * FROM reconciliations WHERE id = ?`, [id]);
        if (rows.length === 0) return null;
        const row = rows[0];
        let dataObj = {};
        try { dataObj = JSON.parse(row.data); } catch (e) {}
        return {
            id: row.id,
            name: row.name,
            fileName: row.fileName,
            createdAt: row.createdAt,
            summary: JSON.parse(row.summary || '{}'),
            ...dataObj
        };
    } catch (err) {
        console.error('Error reading reconciliation by ID from SQLite:', err);
        return null;
    }
}

/**
 * Saves or updates a reconciliation audit
 * @param {Object} auditData 
 * @returns {Promise<Object>}
 */
export async function saveReconciliation(auditData) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseSaveReconciliation(auditData);
        } catch (err) {
            console.error('Error saving reconciliation to Supabase:', err);
        }
    }
    try {
        const { db } = await getDb();
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

        const summaryJson = JSON.stringify(newAudit.summary);
        const dataJson = JSON.stringify(newAudit);

        const stmt = db.prepare(`
            INSERT OR REPLACE INTO reconciliations (id, name, fileName, createdAt, summary, data)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run([newAudit.id, newAudit.name, newAudit.fileName, newAudit.createdAt, summaryJson, dataJson]);
        stmt.free();

        saveDbToDisk();
        return newAudit;
    } catch (err) {
        console.error('Error saving reconciliation to SQLite:', err);
        throw err;
    }
}

/**
 * Deletes a saved reconciliation audit
 * @param {string} id 
 * @returns {Promise<boolean>}
 */
export async function deleteReconciliation(id) {
    if (isSupabaseEnabled()) {
        try {
            return await supabaseDeleteReconciliation(id);
        } catch (err) {
            console.error('Error deleting reconciliation in Supabase:', err);
        }
    }
    try {
        const { db } = await getDb();
        const stmt = db.prepare(`DELETE FROM reconciliations WHERE id = ?`);
        stmt.run([id]);
        stmt.free();
        saveDbToDisk();
        return true;
    } catch (err) {
        console.error('Error deleting reconciliation from SQLite:', err);
        return false;
    }
}
