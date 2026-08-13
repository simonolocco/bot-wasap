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

export function formatDate(value?: string | null, withDate = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-AR', withDate ? { dateStyle: 'medium', timeStyle: 'short' } : { timeStyle: 'short' });
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
