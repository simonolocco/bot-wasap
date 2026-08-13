import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { downloadCloudMedia } from '../cloudClient';
import { attachMediaAssetToMessage, completeJob, createMediaAsset, getMediaAssetByMessageId, getMediaAssetByProviderMediaId, retryJob, setMessageMediaStatus, updateMediaAsset } from '../db/repository';

const maxMediaBytes = 25 * 1024 * 1024;
const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_PATH ?? path.join(process.cwd(), 'storage', 'media'));
const mediaDriver = (process.env.MEDIA_STORAGE_DRIVER ?? 'local').trim().toLowerCase() === 's3' ? 's3' : 'local';
const mediaBucket = process.env.MEDIA_S3_BUCKET;
const mediaPrefix = (process.env.MEDIA_S3_PREFIX ?? 'abastobot/media').replace(/^\/+|\/+$/g, '');
const s3 = mediaDriver === 's3' ? new S3Client({
  endpoint: process.env.MEDIA_S3_ENDPOINT || process.env.BACKUP_S3_ENDPOINT,
  region: process.env.AWS_DEFAULT_REGION || 'auto',
  forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === 'true',
}) : null;

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

function requireS3() {
  if (!s3 || !mediaBucket) throw new Error('MEDIA_STORAGE_DRIVER=s3 requiere MEDIA_S3_BUCKET y credenciales S3.');
  return { client: s3, bucket: mediaBucket };
}

function objectKey(key: string) {
  return mediaPrefix ? `${mediaPrefix}/${key}` : key;
}

export function getMediaStorageDriver() { return mediaDriver; }

const safeUploadMimeTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac',
  'application/pdf', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function begins(buffer: Buffer, signature: number[]) {
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

export function isSafeUpload(buffer: Buffer, rawMimeType: string) {
  const mimeType = rawMimeType.toLowerCase().split(';', 1)[0].trim();
  if (!safeUploadMimeTypes.has(mimeType) || buffer.length < 4) return false;
  if (mimeType === 'image/jpeg') return begins(buffer, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/png') return begins(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === 'image/gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/heic' || mimeType === 'image/heif' || mimeType === 'audio/mp4') return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  if (mimeType === 'audio/mpeg') return buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (mimeType === 'audio/ogg') return buffer.subarray(0, 4).toString('ascii') === 'OggS';
  if (mimeType === 'audio/wav' || mimeType === 'audio/x-wav') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
  if (mimeType === 'audio/aac') return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel') return begins(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return begins(buffer, [0x50, 0x4b, 0x03, 0x04]);
}

export function getMediaStoragePath(storageKey: string) {
  const resolved = path.resolve(mediaRoot, storageKey);
  const relative = path.relative(mediaRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ruta de archivo inválida.');
  return resolved;
}

export async function ensureMediaCached(storageKey: string) {
  const filePath = getMediaStoragePath(storageKey);
  try { await fs.access(filePath); return filePath; } catch { /* cache miss */ }
  if (mediaDriver !== 's3') throw new Error('Archivo inexistente.');
  const { client, bucket } = requireS3();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey(storageKey) }));
  if (!response.Body) throw new Error('El objeto multimedia no tiene contenido.');
  const buffer = Buffer.from(await response.Body.transformToByteArray());
  if (buffer.length > maxMediaBytes) throw new Error('El archivo remoto supera el límite permitido.');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try { await fs.writeFile(filePath, buffer, { flag: 'wx' }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return filePath;
}

export async function checkMediaStorage() {
  const startedAt = Date.now();
  try {
    if (mediaDriver === 's3') {
      const { client, bucket } = requireS3();
      await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: mediaPrefix || undefined, MaxKeys: 1 }));
    } else {
      await ensureMediaRoot();
      await fs.access(mediaRoot);
    }
    return { healthy: true, driver: mediaDriver, latencyMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return { healthy: false, driver: mediaDriver, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function storeMedia(buffer: Buffer, mimeType: string, filename: string, providerMediaId?: string) {
  if (buffer.length > maxMediaBytes) throw new Error('El archivo supera el límite de 25 MB.');
  await ensureMediaRoot();
  const key = storageKey(filename);
  const target = getMediaStoragePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
  try {
    const dimensions: { width?: number; height?: number } = mimeType.startsWith('image/')
      ? await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata().then(meta => ({ width: meta.width, height: meta.height })).catch(() => ({}))
      : {};
    if (mediaDriver === 's3') {
      const { client, bucket } = requireS3();
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: objectKey(key), Body: buffer, ContentType: mimeType,
        Metadata: { sha256: crypto.createHash('sha256').update(buffer).digest('hex') },
      }));
    }
    return await createMediaAsset({
      providerMediaId,
      storageKey: key,
      mimeType,
      filename: safeFilename(filename),
      sizeBytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      status: 'ready',
      width: dimensions.width,
      height: dimensions.height,
    });
  } catch (error) {
    await fs.rm(target, { force: true });
    if (mediaDriver === 's3') {
      const { client, bucket } = requireS3();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(key) })).catch(() => undefined);
    }
    throw error;
  }
}

export async function ensureMediaThumbnail(storageKey: string, width: 240 | 480 | 960) {
  const source = await ensureMediaCached(storageKey);
  const thumbnailKey = `.thumbnails/${storageKey}.${width}.webp`;
  const target = getMediaStoragePath(thumbnailKey);
  try { await fs.access(target); return target; } catch { /* cache miss */ }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await sharp(source, { limitInputPixels: 80_000_000, animated: false })
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toFile(temporary);
    try { await fs.rename(temporary, target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await fs.rm(temporary, { force: true });
    }
    return target;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function downloadIncomingMedia(messageId: string, providerMediaId: string, filename: string, mimeType: string) {
  const existing = await getMediaAssetByMessageId(messageId);
  if (existing?.status === 'ready' || existing?.status === 'failed') return;
  const persisted = await getMediaAssetByProviderMediaId(providerMediaId);
  if (persisted?.status === 'ready') {
    await attachMediaAssetToMessage(messageId, persisted.id, 'ready');
    return;
  }
  try {
    const downloaded = await downloadCloudMedia(providerMediaId);
    const asset = await storeMedia(downloaded.buffer, downloaded.mimeType || mimeType, filename || 'archivo', providerMediaId);
    await attachMediaAssetToMessage(messageId, asset.id, 'ready');
  } catch (error) {
    await setMessageMediaStatus(messageId, 'pending', error instanceof Error ? error.message : String(error));
    console.error(`[media] No se pudo guardar ${providerMediaId}:`, error);
    throw error;
  }
}

export async function processMediaJob(job: { id: string; attempts: number; message_id: string | null; provider_media_id: string | null; media_filename: string | null; media_mime_type: string | null }) {
  if (!job.provider_media_id || !job.message_id) { await completeJob(job.id); return; }
  try {
    await downloadIncomingMedia(job.message_id, job.provider_media_id, job.media_filename || 'archivo', job.media_mime_type || 'application/octet-stream');
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
