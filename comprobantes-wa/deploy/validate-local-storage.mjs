import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';
import sharp from 'sharp';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';

const dataDir = process.env.DATA_DIR || '/app/data';
const mediaDir = process.env.MEDIA_DIR || '/app/media';
const authDir = process.env.AUTH_DIR || '/app/auth_info';
const requestedDb = process.argv[2] || 'database.sqlite';
const dbPath = path.join(dataDir, requestedDb);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));

function scalar(sql) {
    const result = db.exec(sql);
    return result[0]?.values?.[0]?.[0] || 0;
}

const files = fs.existsSync(mediaDir)
    ? fs.readdirSync(mediaDir).filter(name => fs.statSync(path.join(mediaDir, name)).isFile())
    : [];
const imageFiles = files.filter(name => /\.(jpe?g|png|webp)$/i.test(name));
const sample = imageFiles.slice(0, 5);
for (const filename of sample) {
    await sharp(path.join(mediaDir, filename)).metadata();
}

const credsFile = path.join(authDir, 'creds.json');
const creds = fs.existsSync(credsFile) ? JSON.parse(fs.readFileSync(credsFile, 'utf8')) : null;
const localAuth = await useMultiFileAuthState(authDir);
const report = {
    database: requestedDb,
    receipts: scalar('SELECT COUNT(*) FROM receipts'),
    reconciliations: scalar('SELECT COUNT(*) FROM reconciliations'),
    receiptRowsWithFile: scalar("SELECT COUNT(*) FROM receipts WHERE filename IS NOT NULL AND filename != ''"),
    receiptRowsWithInlineBase64: scalar("SELECT COUNT(*) FROM receipts WHERE thumbnailBase64 IS NOT NULL AND thumbnailBase64 != ''"),
    mediaFiles: files.length,
    mediaBytes: files.reduce((total, name) => total + fs.statSync(path.join(mediaDir, name)).size, 0),
    validatedImageSamples: sample.length,
    whatsappAuthFiles: fs.existsSync(authDir) ? fs.readdirSync(authDir).length : 0,
    whatsappRegisteredRaw: Boolean(creds?.registered),
    whatsappRegisteredByBaileys: Boolean(localAuth.state.creds?.registered),
    whatsappHasIdentity: Boolean(localAuth.state.creds?.me),
    whatsappHasAccount: Boolean(localAuth.state.creds?.account)
};
db.close();
console.log(JSON.stringify(report));
