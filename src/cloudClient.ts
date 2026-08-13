import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const CLOUD_TOKEN = process.env.WHATSAPP_CLOUD_TOKEN;
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? 'v20.0';
const GRAPH_BASE_URL = (process.env.WHATSAPP_GRAPH_BASE_URL ?? 'https://graph.facebook.com').replace(/\/$/, '');
const HTTP_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.WHATSAPP_HTTP_TIMEOUT_MS ?? '15000', 10) || 15000);
const production = process.env.NODE_ENV === 'production';
const transport = (process.env.WHATSAPP_TRANSPORT ?? (production ? 'cloud' : 'mock')).trim().toLowerCase();
const liveCloudAllowed = production || process.env.ALLOW_LIVE_WHATSAPP === 'true';
const mockLogSetting = process.env.MOCK_OUTBOUND_LOG ?? path.join(process.cwd(), 'storage', 'mock-outbound.jsonl');
const mockLogPath = mockLogSetting.toLowerCase() === 'off' ? null : path.resolve(mockLogSetting);
const mockDelayMs = Math.max(0, Number.parseInt(process.env.MOCK_WHATSAPP_DELAY_MS ?? '0', 10) || 0);
const mockFailureMode = (process.env.MOCK_WHATSAPP_FAILURE_MODE ?? '').trim().toLowerCase();

export type WhatsAppTransport = 'cloud' | 'mock';

function maskedPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length <= 4 ? '***' : `***${digits.slice(-4)}`;
}

export function getWhatsAppTransport(): WhatsAppTransport {
  return transport === 'cloud' ? 'cloud' : 'mock';
}

function assertCloudAllowed() {
  if (getWhatsAppTransport() === 'cloud' && !liveCloudAllowed) {
    throw new Error('El transporte Cloud real está bloqueado fuera de producción. Usá WHATSAPP_TRANSPORT=mock o ALLOW_LIVE_WHATSAPP=true de forma explícita.');
  }
}

async function appendMockEvent(event: Record<string, unknown>) {
  if (!mockLogPath) return;
  await fs.mkdir(path.dirname(mockLogPath), { recursive: true });
  await fs.appendFile(mockLogPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, 'utf8');
}

async function sendMockMessage(payload: Record<string, unknown>) {
  if (mockDelayMs > 0) await new Promise(resolve => setTimeout(resolve, mockDelayMs));
  if (mockFailureMode === 'always' || (mockFailureMode === '429' && Math.random() < 0.2) || (mockFailureMode === '500' && Math.random() < 0.2)) {
    const status = mockFailureMode === '429' ? 429 : 500;
    await appendMockEvent({ kind: 'error', status, payload });
    throw new Error(`Mock WhatsApp respondió HTTP ${status}`);
  }
  const providerMessageId = `mock-${crypto.randomUUID()}`;
  await appendMockEvent({ kind: 'sent', providerMessageId, payload });
  return providerMessageId;
}

export function hasCloudCredentials(): boolean {
  return getWhatsAppTransport() === 'mock' || Boolean(PHONE_ID && CLOUD_TOKEN && liveCloudAllowed);
}

export async function sendCloudMessage(payload: Record<string, unknown>) {
  if (getWhatsAppTransport() === 'mock') return sendMockMessage(payload);
  assertCloudAllowed();
  if (!PHONE_ID || !CLOUD_TOKEN) {
    throw new Error('Falta configurar WHATSAPP_PHONE_ID o WHATSAPP_CLOUD_TOKEN');
  }
  try {
    const response = await axios.post<{ messages?: Array<{ id?: string }> }>(`${GRAPH_BASE_URL}/${GRAPH_VERSION}/${PHONE_ID}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${CLOUD_TOKEN}`,
        'Content-Type': 'application/json',
      },
      timeout: HTTP_TIMEOUT_MS,
    });
    return response.data.messages?.[0]?.id;
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: { message?: string; type?: string; code?: number } }>;
    if (axiosError.response) {
      console.error('[cloud-client] WhatsApp rechazó la solicitud:', {
        status: axiosError.response.status,
        code: axiosError.response.data?.error?.code,
        type: axiosError.response.data?.error?.type,
      });
    } else {
      console.error('[cloud-client] Error sin respuesta de WhatsApp:', axiosError.message);
    }
    throw error;
  }
}

export async function uploadCloudMedia(buffer: Buffer, mimeType: string, filename: string) {
  if (getWhatsAppTransport() === 'mock') {
    const mediaId = `mock-media-${crypto.randomUUID()}`;
    await appendMockEvent({ kind: 'media_upload', mediaId, mimeType, filename, size: buffer.length });
    return mediaId;
  }
  assertCloudAllowed();
  if (!PHONE_ID || !CLOUD_TOKEN) throw new Error('Falta configurar WHATSAPP_PHONE_ID o WHATSAPP_CLOUD_TOKEN');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
  const response = await fetch(`${GRAPH_BASE_URL}/${GRAPH_VERSION}/${PHONE_ID}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${CLOUD_TOKEN}` }, body: form,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const data = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !data.id) throw new Error(data.error?.message ?? 'Meta no aceptó el archivo.');
  return data.id;
}

export async function downloadCloudMedia(providerMediaId: string) {
  if (getWhatsAppTransport() === 'mock') {
    throw new Error(`El mock no tiene contenido multimedia para ${providerMediaId}.`);
  }
  assertCloudAllowed();
  if (!CLOUD_TOKEN) throw new Error('Falta configurar WHATSAPP_CLOUD_TOKEN');
  const metadata = await axios.get<{ url?: string; mime_type?: string; file_size?: number }>(
    `${GRAPH_BASE_URL}/${GRAPH_VERSION}/${providerMediaId}`,
    { headers: { Authorization: `Bearer ${CLOUD_TOKEN}` }, timeout: HTTP_TIMEOUT_MS },
  );
  if (!metadata.data.url) throw new Error('Meta no devolvió la URL privada del archivo.');
  const file = await axios.get<ArrayBuffer>(metadata.data.url, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${CLOUD_TOKEN}` },
    maxContentLength: 25 * 1024 * 1024,
    maxBodyLength: 25 * 1024 * 1024,
    timeout: HTTP_TIMEOUT_MS,
  });
  const buffer = Buffer.from(file.data);
  if (buffer.length > 25 * 1024 * 1024) throw new Error('El archivo supera el límite de 25 MB.');
  return { buffer, mimeType: metadata.data.mime_type ?? String(file.headers['content-type'] ?? 'application/octet-stream'), size: buffer.length };
}

export function buildMediaPayload(to: string, mediaId: string, mediaType: 'image' | 'document' | 'audio' | 'video', caption?: string, filename?: string) {
  const media: Record<string, unknown> = { id: mediaId };
  if (caption && mediaType !== 'audio') media.caption = caption;
  if (filename && mediaType === 'document') media.filename = filename;
  return { messaging_product: 'whatsapp', to, type: mediaType, [mediaType]: media };
}


export async function sendCloudTextMessage(to: string, body: string) {
  console.log(`[cloud-client] Enviando mensaje a ${maskedPhone(to)} (${body.length} caracteres)`);
  return sendCloudMessage({
    messaging_product: 'whatsapp',
    to,
    text: { body },
  });
}

export async function sendCloudAudio(to: string, audioUrl: string, caption?: string) {
  console.log(`[cloud-client] Enviando audio a ${maskedPhone(to)}`);
  return sendCloudMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'audio',
    audio: {
      link: audioUrl,
    },
  });
}

export async function sendCloudTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParameters: string[] = [],
) {
  console.log(`[cloud-client] Enviando plantilla ${templateName} a ${maskedPhone(to)}`);
  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  };
  if (bodyParameters.length > 0) {
    template.components = [{
      type: 'body',
      parameters: bodyParameters.map(text => ({ type: 'text', text })),
    }];
  }
  return sendCloudMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template,
  });
}
