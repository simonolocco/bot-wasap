import { randomUUID } from 'crypto';
import '../../config.js';

const AUTH_USER = process.env.APP_USERNAME || '';
const AUTH_PASS = process.env.APP_PASSWORD || '';
export const AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASS);

const COOKIE_SECURE = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sessions = new Map();

export function parseCookies(req) {
    const header = req?.headers?.cookie || '';
    return Object.fromEntries(
        header.split(';')
            .map((cookie) => cookie.trim().split('='))
            .filter((parts) => parts.length >= 2)
            .map(([key, ...value]) => [key.trim(), value.join('=').trim()])
    );
}

export function isSessionValid(token) {
    return Boolean(token && sessions.has(token) && sessions.get(token) > Date.now());
}

export function createSession(username, password) {
    if (!AUTH_ENABLED || username !== AUTH_USER || password !== AUTH_PASS) {
        return null;
    }

    const token = randomUUID();
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
}

export function revokeSession(token) {
    if (token) sessions.delete(token);
}

export function getSessionCookie(token) {
    return `wa_auth=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax${COOKIE_SECURE ? '; Secure' : ''}`;
}

export function getExpiredSessionCookie() {
    return 'wa_auth=; HttpOnly; Path=/; Max-Age=0';
}

export function requireAuth(req, res, next) {
    if (!AUTH_ENABLED) return next();

    const token = parseCookies(req).wa_auth;
    if (isSessionValid(token)) return next();

    const isApi = req.path.startsWith('/api/') || req.path.startsWith('/auth/');
    if (isApi) return res.status(401).json({ error: 'No autorizado' });
    return res.redirect('/login.html');
}
