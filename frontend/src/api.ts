export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = options.body instanceof FormData
    ? { ...(options.headers ?? {}) }
    : { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error HTTP ${response.status}`) as Error & { status?: number; data?: unknown };
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data as T;
}

type CacheEntry = { expiresAt: number; value?: unknown; pending?: Promise<unknown> };
const responseCache = new Map<string, CacheEntry>();

export function cachedApi<T = any>(url: string, ttlMs = 30_000): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(url);
  if (cached?.value !== undefined && cached.expiresAt > now) return Promise.resolve(cached.value as T);
  if (cached?.pending) return cached.pending as Promise<T>;
  const pending = api<T>(url).then(value => {
    responseCache.set(url, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).catch(error => {
    responseCache.delete(url);
    throw error;
  });
  responseCache.set(url, { expiresAt: now + ttlMs, pending });
  return pending;
}

export function invalidateApi(prefix = '') {
  for (const key of responseCache.keys()) if (!prefix || key.startsWith(prefix)) responseCache.delete(key);
}

export function formatDate(value?: string | null, withDate = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-AR', withDate ? { dateStyle: 'medium', timeStyle: 'short' } : { timeStyle: 'short' });
}

export function formatDateOnly(value?: string | null) {
  if (!value) return '—';
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('es-AR', { dateStyle: 'medium' });
  }
  return new Date(value).toLocaleDateString('es-AR', { dateStyle: 'medium' });
}

export function initials(row: { name?: string; publicName?: string; phone?: string }) {
  return String(row.name || row.publicName || row.phone || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function shortText(value?: string | null, length = 72) {
  return String(value ?? '').replace(/\s+/g, ' ').slice(0, length);
}

export function mediaUrl(messageId: string, download = false) {
  return `/api/messages/${encodeURIComponent(messageId)}/media${download ? '/download' : ''}`;
}

export function thumbnailUrl(messageId: string, width: 240 | 480 | 960 = 480) {
  return `/api/messages/${encodeURIComponent(messageId)}/media/thumbnail?w=${width}`;
}
