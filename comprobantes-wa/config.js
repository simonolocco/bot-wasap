import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Load environment variables from .env
dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RENDER_PERSISTENT_DIR = '/var/data';
export const DATA_DIR = fs.existsSync(RENDER_PERSISTENT_DIR) 
    ? RENDER_PERSISTENT_DIR 
    : (process.env.DATA_DIR || path.resolve(__dirname, './data'));

export const config = {
    targetGroupJid: (process.env.TARGET_GROUP_JID || '').trim(),
    targetGroupSubject: (process.env.TARGET_GROUP_SUBJECT || process.env.TARGET_GROUP_NAME || '').trim(),
    allowedNumbers: (process.env.ALLOWED_NUMBERS || '3517565641,3517565644,3517565643').split(',').map(s => s.trim()),
    mediaDir: process.env.MEDIA_DIR || path.join(DATA_DIR, 'media'),
    authDir: process.env.AUTH_DIR || path.join(DATA_DIR, 'auth_info'),
    logLevel: process.env.LOG_LEVEL || 'info',
    dataDir: DATA_DIR
};
