import pg from 'pg';
import dotenv from 'dotenv';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

dotenv.config();

const { Pool } = pg;

let pool = null;

export function getPostgresPool() {
    if (!pool && process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
        });
    }
    return pool;
}

export async function initPostgresTables() {
    const p = getPostgresPool();
    if (!p) return false;

    try {
        await p.query(`
            CREATE TABLE IF NOT EXISTS receipts (
                id TEXT PRIMARY KEY,
                fecha TEXT,
                hora TEXT,
                monto NUMERIC,
                moneda TEXT,
                emisor TEXT,
                tipo_comprobante TEXT,
                concepto TEXT,
                nro_operacion TEXT,
                sender TEXT,
                filename TEXT,
                filePath TEXT,
                thumbnailBase64 TEXT,
                status TEXT,
                notas TEXT,
                isDuplicate BOOLEAN DEFAULT FALSE,
                repeatCount INTEGER DEFAULT 1,
                duplicateReason TEXT,
                rawText TEXT,
                createdAt TIMESTAMPTZ DEFAULT NOW(),
                updatedAt TIMESTAMPTZ DEFAULT NOW()
            );

            ALTER TABLE receipts ADD COLUMN IF NOT EXISTS hora TEXT;
            ALTER TABLE receipts ADD COLUMN IF NOT EXISTS fecha_comprobante TEXT;

            CREATE TABLE IF NOT EXISTS reconciliations (
                id TEXT PRIMARY KEY,
                name TEXT,
                fileName TEXT,
                createdAt TIMESTAMPTZ DEFAULT NOW(),
                summary JSONB,
                data JSONB
            );

            CREATE TABLE IF NOT EXISTS whatsapp_auth (
                id TEXT PRIMARY KEY,
                data JSONB NOT NULL
            );
        `);
        console.log('🟢 [PostgreSQL Supabase] Tables initialized successfully.');
        return true;
    } catch (err) {
        console.error('❌ [PostgreSQL Supabase Init Error]', err.message);
        return false;
    }
}

export async function usePostgresAuthState() {
    const p = getPostgresPool();
    if (!p) return null;

    const readData = async (id) => {
        try {
            const res = await p.query('SELECT data FROM whatsapp_auth WHERE id = $1', [id]);
            if (res.rows.length === 0) return null;
            return JSON.parse(res.rows[0].data, BufferJSON.reviver);
        } catch (e) {
            return null;
        }
    };

    const writeData = async (id, data) => {
        try {
            const value = JSON.stringify(data, BufferJSON.replacer);
            await p.query(
                `INSERT INTO whatsapp_auth (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
                [id, value]
            );
        } catch (e) {
            console.error('Error writing auth data to Postgres:', e.message);
        }
    };

    const removeData = async (id) => {
        try {
            await p.query('DELETE FROM whatsapp_auth WHERE id = $1', [id]);
        } catch (e) {}
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            if (value) data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(writeData(key, value));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData('creds', creds),
        clearAuth: async () => {
            await p.query('DELETE FROM whatsapp_auth');
        }
    };
}
