import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

const activate = process.argv.includes('--activate');
const dataDir = process.env.DATA_DIR || '/app/data';
const mediaDir = process.env.MEDIA_DIR || '/app/media';
const authDir = process.env.AUTH_DIR || '/app/auth_info';
const stagingDb = path.join(dataDir, 'database.migrating.sqlite');
const activeDb = path.join(dataDir, 'database.sqlite');
const reportFile = path.join(dataDir, 'migration-report.json');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!process.env.SUPABASE_URL || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for migration.');
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });
fs.mkdirSync(authDir, { recursive: true });

const supabase = createClient(process.env.SUPABASE_URL, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

async function fetchPages(table, columns, pageSize = 200) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
            .from(table)
            .select(columns)
            .range(from, from + pageSize - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) return rows;
    }
}

const receiptColumns = [
    'id', 'fecha', 'fecha_comprobante', 'hora', 'monto', 'moneda', 'emisor', 'destinatario',
    'local', 'tipo_comprobante', 'concepto', 'nro_operacion', 'sender', 'filename', 'filePath',
    'status', 'notas', 'isDuplicate', 'repeatCount', 'duplicateReason', 'rawText', 'createdAt', 'updatedAt'
].join(',');

console.log('[Migration] Downloading receipt metadata...');
const receipts = await fetchPages('receipts', receiptColumns);
console.log(`[Migration] ${receipts.length} receipts found.`);

function safeId(id) {
    return String(id || 'receipt').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isPdf(filename, dataUrl = '') {
    return String(filename || '').toLowerCase().endsWith('.pdf') || dataUrl.startsWith('data:application/pdf');
}

function decodeDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null;
    return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function fetchInlineMedia(id) {
    const { data, error } = await supabase
        .from('receipts')
        .select('thumbnailBase64')
        .eq('id', id)
        .maybeSingle();
    if (error) throw new Error(`thumbnail ${id}: ${error.message}`);
    return data?.thumbnailBase64 || '';
}

async function writeAtomic(filename, buffer) {
    const destination = path.join(mediaDir, filename);
    const temp = `${destination}.tmp-${process.pid}`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, destination);
}

async function optimizeReceiptMedia(receipt) {
    if (!receipt.filename) return { state: 'no-photo', filename: '' };

    const originalPath = path.join(mediaDir, path.basename(receipt.filename));
    const pdf = isPdf(receipt.filename);
    const targetFilename = `${safeId(receipt.id)}${pdf ? '.pdf' : '.jpg'}`;
    const targetPath = path.join(mediaDir, targetFilename);

    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
        return { state: 'existing', filename: targetFilename };
    }

    let sourceBuffer = null;
    let inlineData = '';
    if (fs.existsSync(originalPath) && fs.statSync(originalPath).size > 0) {
        sourceBuffer = fs.readFileSync(originalPath);
    } else {
        inlineData = await fetchInlineMedia(receipt.id);
        sourceBuffer = decodeDataUrl(inlineData)?.buffer || null;
    }

    if (!sourceBuffer) {
        return { state: 'missing', filename: receipt.filename };
    }

    if (isPdf(receipt.filename, inlineData)) {
        await writeAtomic(targetFilename, sourceBuffer);
        return { state: 'recovered', filename: targetFilename };
    }

    const optimized = await sharp(sourceBuffer)
        .rotate()
        .resize({ width: 1000, height: 1800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70, progressive: true, mozjpeg: true })
        .toBuffer();
    await sharp(optimized).metadata();
    await writeAtomic(targetFilename, optimized);
    return { state: 'recovered', filename: targetFilename };
}

async function mapWithConcurrency(items, concurrency, worker) {
    let cursor = 0;
    const output = new Array(items.length);
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            output[index] = await worker(items[index], index);
            if ((index + 1) % 50 === 0 || index + 1 === items.length) {
                console.log(`[Migration] Media ${index + 1}/${items.length}`);
            }
        }
    });
    await Promise.all(runners);
    return output;
}

console.log('[Migration] Recovering and optimizing available media...');
const mediaResults = await mapWithConcurrency(receipts, 4, async receipt => {
    try {
        return await optimizeReceiptMedia(receipt);
    } catch (error) {
        console.warn(`[Migration] Media failed for ${receipt.id}: ${error.message}`);
        return { state: 'failed', filename: receipt.filename, error: error.message };
    }
});

for (let index = 0; index < receipts.length; index += 1) {
    const result = mediaResults[index];
    if (result?.filename) {
        receipts[index].filename = result.filename;
        receipts[index].filePath = path.join(mediaDir, result.filename);
    }
}

console.log('[Migration] Downloading reconciliations and WhatsApp session...');
const [reconciliations, authRows] = await Promise.all([
    fetchPages('reconciliations', '*'),
    fetchPages('whatsapp_auth', 'id,data', 500)
]);

const SQL = await initSqlJs();
const db = new SQL.Database();
db.run(`
    CREATE TABLE receipts (
        id TEXT PRIMARY KEY, fecha TEXT, fecha_comprobante TEXT, hora TEXT, monto REAL,
        moneda TEXT, emisor TEXT, destinatario TEXT, local TEXT, tipo_comprobante TEXT,
        concepto TEXT, nro_operacion TEXT, sender TEXT, filename TEXT, filePath TEXT,
        thumbnailBase64 TEXT, status TEXT, notas TEXT, isDuplicate INTEGER,
        repeatCount INTEGER, duplicateReason TEXT, rawText TEXT, createdAt TEXT, updatedAt TEXT
    );
    CREATE TABLE reconciliations (
        id TEXT PRIMARY KEY, name TEXT, fileName TEXT, createdAt TEXT, summary TEXT, data TEXT
    );
    CREATE INDEX idx_receipts_fecha ON receipts(fecha);
    CREATE INDEX idx_receipts_created_at ON receipts(createdAt);
    CREATE INDEX idx_receipts_local ON receipts(local);
    CREATE INDEX idx_receipts_operation ON receipts(nro_operacion);
`);

db.run('BEGIN TRANSACTION');
const receiptStatement = db.prepare(`
    INSERT INTO receipts
    (id, fecha, fecha_comprobante, hora, monto, moneda, emisor, destinatario, local,
     tipo_comprobante, concepto, nro_operacion, sender, filename, filePath, thumbnailBase64,
     status, notas, isDuplicate, repeatCount, duplicateReason, rawText, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const receipt of receipts) {
    receiptStatement.run([
        receipt.id, receipt.fecha || null, receipt.fecha_comprobante || receipt.fecha || null,
        receipt.hora || null, Number(receipt.monto) || 0, receipt.moneda || 'ARS',
        receipt.emisor || '', receipt.destinatario || null, receipt.local || null,
        receipt.tipo_comprobante || '', receipt.concepto || '', receipt.nro_operacion || '',
        receipt.sender || '', receipt.filename || '', receipt.filePath || '', '',
        receipt.status || 'completed', receipt.notas || '', receipt.isDuplicate ? 1 : 0,
        receipt.repeatCount || 1, receipt.duplicateReason || '', receipt.rawText || '',
        receipt.createdAt || new Date().toISOString(), receipt.updatedAt || receipt.createdAt || new Date().toISOString()
    ]);
}
receiptStatement.free();

const reconciliationStatement = db.prepare(`
    INSERT INTO reconciliations (id, name, fileName, createdAt, summary, data)
    VALUES (?, ?, ?, ?, ?, ?)
`);
for (const row of reconciliations) {
    const summary = typeof row.summary === 'string' ? row.summary : JSON.stringify(row.summary || {});
    const data = typeof row.data === 'string' ? row.data : JSON.stringify(row.data || {});
    reconciliationStatement.run([row.id, row.name || '', row.fileName || '', row.createdAt || '', summary, data]);
}
reconciliationStatement.free();
db.run('COMMIT');

const exported = Buffer.from(db.export());
db.close();
fs.writeFileSync(`${stagingDb}.tmp`, exported);
fs.renameSync(`${stagingDb}.tmp`, stagingDb);

for (const row of authRows) {
    const id = row.id === 'creds' ? 'creds' : String(row.id);
    const filename = `${id.replace(/\//g, '__').replace(/:/g, '-')}.json`;
    const value = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const destination = path.join(authDir, filename);
    fs.writeFileSync(`${destination}.tmp`, JSON.stringify(value));
    fs.renameSync(`${destination}.tmp`, destination);
}

const mediaSummary = mediaResults.reduce((summary, result) => {
    summary[result?.state || 'unknown'] = (summary[result?.state || 'unknown'] || 0) + 1;
    return summary;
}, {});
const report = {
    completedAt: new Date().toISOString(),
    receipts: receipts.length,
    reconciliations: reconciliations.length,
    whatsappAuthRecords: authRows.length,
    media: mediaSummary,
    databaseBytes: exported.length,
    activated: activate
};

if (activate) {
    if (fs.existsSync(activeDb)) {
        const backup = path.join(dataDir, `database.before-migration-${Date.now()}.sqlite`);
        fs.copyFileSync(activeDb, backup);
    }
    fs.renameSync(stagingDb, activeDb);
}

fs.writeFileSync(`${reportFile}.tmp`, JSON.stringify(report, null, 2));
fs.renameSync(`${reportFile}.tmp`, reportFile);
console.log(JSON.stringify(report));
