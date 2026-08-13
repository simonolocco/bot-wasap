import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadCloudMedia } from '../cloudClient';
import { attachMediaAssetToMessage, completeJob, createMediaAsset, findMessageByProviderId, getMediaAssetByMessageId, retryJob, setMessageMediaStatus, updateMediaAsset } from '../db/repository';

const maxMediaBytes = 25 * 1024 * 1024;
const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_PATH ?? path.join(process.cwd(), 'storage', 'media'));

function safeFilename(filename: string) {
  const cleaned = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
  return cleaned || 'archivo';
}

function storageKey(filename: string) {
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${prefix}/${crypto.randomUUID()}-${safeFilename(filename)}`;
}

async function ensureMediaRoot() {
  await fs.mkdir(mediaRoot, { recursive: true });
}

export function getMediaStoragePath(storageKey: string) {
  const resolved = path.resolve(mediaRoot, storageKey);
  const relative = path.relative(mediaRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ruta de archivo inválida.');
  return resolved;
}

export async function storeMedia(buffer: Buffer, mimeType: string, filename: string, providerMediaId?: string) {
  if (buffer.length > maxMediaBytes) throw new Error('El archivo supera el límite de 25 MB.');
  await ensureMediaRoot();
  const key = storageKey(filename);
  const target = getMediaStoragePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
  try {
    return await createMediaAsset({
      providerMediaId,
      storageKey: key,
      mimeType,
      filename: safeFilename(filename),
      sizeBytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      status: 'ready',
    });
  } catch (error) {
    await fs.rm(target, { force: true });
    throw error;
  }
}

export async function downloadIncomingMedia(providerMediaId: string, filename: string, mimeType: string) {
  const message = await findMessageByProviderId(providerMediaId);
  if (!message) return;
  const existing = await getMediaAssetByMessageId(message.id);
  if (existing?.status === 'ready' || existing?.status === 'failed') return;
  try {
    const downloaded = await downloadCloudMedia(providerMediaId);
    const asset = await storeMedia(downloaded.buffer, downloaded.mimeType || mimeType, filename || 'archivo', providerMediaId);
    await attachMediaAssetToMessage(message.id, asset.id, 'ready');
  } catch (error) {
    await setMessageMediaStatus(message.id, 'pending', error instanceof Error ? error.message : String(error));
    console.error(`[media] No se pudo guardar ${providerMediaId}:`, error);
    throw error;
  }
}

export async function processMediaJob(job: { id: string; attempts: number; message_id: string | null; provider_media_id: string | null; media_filename: string | null; media_mime_type: string | null }) {
  if (!job.provider_media_id) { await completeJob(job.id); return; }
  try {
    await downloadIncomingMedia(job.provider_media_id, job.media_filename || 'archivo', job.media_mime_type || 'application/octet-stream');
    await completeJob(job.id);
  } catch (error) {
    if (job.attempts >= 8 && job.message_id) await setMessageMediaStatus(job.message_id, 'failed', error instanceof Error ? error.message : String(error));
    await retryJob(job.id, job.attempts, error);
  }
}

export async function markMediaUploadFailed(assetId: string, error: unknown) {
  await updateMediaAsset(assetId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
}

export { maxMediaBytes };
