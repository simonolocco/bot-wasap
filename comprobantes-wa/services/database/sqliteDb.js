import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RENDER_PERSISTENT_DIR = '/var/data';
const DATA_DIR = fs.existsSync(RENDER_PERSISTENT_DIR) 
    ? RENDER_PERSISTENT_DIR 
    : (process.env.DATA_DIR || path.resolve(__dirname, '../data'));
const DB_FILE = path.join(DATA_DIR, 'database.sqlite');

let db = null;
let SQL = null;

export function saveDbToDisk() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        const tempFile = `${DB_FILE}.tmp`;
        fs.writeFileSync(tempFile, buffer);
        fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
        console.error('Error saving SQLite DB file to disk:', err);
    }
}

export async function getDb() {
    if (db) return { db, saveDbToDisk };

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!SQL) {
        SQL = await initSqlJs();
    }

    if (fs.existsSync(DB_FILE)) {
        const fileBuffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS receipts (
            id TEXT PRIMARY KEY,
            fecha TEXT,
            fecha_comprobante TEXT,
            hora TEXT,
            monto REAL,
            moneda TEXT,
            emisor TEXT,
            destinatario TEXT,
            local TEXT,
            tipo_comprobante TEXT,
            concepto TEXT,
            nro_operacion TEXT,
            sender TEXT,
            filename TEXT,
            filePath TEXT,
            thumbnailBase64 TEXT,
            status TEXT,
            notas TEXT,
            isDuplicate INTEGER,
            repeatCount INTEGER,
            duplicateReason TEXT,
            rawText TEXT,
            createdAt TEXT,
            updatedAt TEXT
        );

        CREATE TABLE IF NOT EXISTS reconciliations (
            id TEXT PRIMARY KEY,
            name TEXT,
            fileName TEXT,
            createdAt TEXT,
            summary TEXT,
            data TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_receipts_fecha ON receipts(fecha);
        CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts(createdAt);
        CREATE INDEX IF NOT EXISTS idx_receipts_local ON receipts(local);
        CREATE INDEX IF NOT EXISTS idx_receipts_operation ON receipts(nro_operacion);
    `);

    // Self-healing migrations for existing databases
    try {
        db.run(`ALTER TABLE receipts ADD COLUMN destinatario TEXT;`);
    } catch (e) {}
    try {
        db.run(`ALTER TABLE receipts ADD COLUMN local TEXT;`);
    } catch (e) {}
    try {
        db.run(`ALTER TABLE receipts ADD COLUMN fecha_comprobante TEXT;`);
    } catch (e) {}
    try {
        db.run(`ALTER TABLE receipts ADD COLUMN hora TEXT;`);
    } catch (e) {}

    saveDbToDisk();

    // Auto-migrate legacy receipts.json into SQLite if present
    const legacyReceiptsFile = path.join(DATA_DIR, 'receipts.json');
    if (fs.existsSync(legacyReceiptsFile)) {
        try {
            const raw = fs.readFileSync(legacyReceiptsFile, 'utf-8');
            const items = JSON.parse(raw || '[]');
            if (Array.isArray(items) && items.length > 0) {
                console.log(`📦 [SQLite WASM Migration] Migrating ${items.length} receipts...`);
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO receipts 
                    (id, fecha, monto, moneda, emisor, tipo_comprobante, concepto, nro_operacion, sender, filename, filePath, thumbnailBase64, status, notas, isDuplicate, repeatCount, duplicateReason, rawText, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                for (const r of items) {
                    stmt.run([
                        r.id, r.fecha || null, typeof r.monto === 'number' ? r.monto : parseFloat(r.monto)||0,
                        r.moneda || 'ARS', r.emisor || '', r.tipo_comprobante || '', r.concepto || '',
                        r.nro_operacion || '', r.sender || '', r.filename || '', r.filePath || '',
                        r.thumbnailBase64 || '', r.status || 'completed', r.notas || '',
                        r.isDuplicate ? 1 : 0, r.repeatCount || 1, r.duplicateReason || '',
                        r.rawText || '', r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()
                    ]);
                }
                stmt.free();
                saveDbToDisk();
            }
        } catch (e) {
            console.error('⚠️ [SQLite WASM Migration Error]', e.message);
        }
    }

    // Auto-migrate legacy reconciliations.json into SQLite if present
    const legacyReconFile = path.join(DATA_DIR, 'reconciliations.json');
    if (fs.existsSync(legacyReconFile)) {
        try {
            const raw = fs.readFileSync(legacyReconFile, 'utf-8');
            const items = JSON.parse(raw || '[]');
            if (Array.isArray(items) && items.length > 0) {
                console.log(`📦 [SQLite WASM Migration] Migrating ${items.length} reconciliations...`);
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO reconciliations (id, name, fileName, createdAt, summary, data)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);
                for (const rec of items) {
                    stmt.run([
                        rec.id, rec.name || rec.fileName, rec.fileName, rec.createdAt,
                        JSON.stringify(rec.summary || {}), JSON.stringify(rec)
                    ]);
                }
                stmt.free();
                saveDbToDisk();
            }
        } catch (e) {
            console.error('⚠️ [SQLite WASM Recon Migration Error]', e.message);
        }
    }

    return { db, saveDbToDisk };
}
