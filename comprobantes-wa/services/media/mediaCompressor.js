import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/**
 * Compress receipt images for durable local storage. The optimized file is
 * the source of truth; inline base64 copies are disabled by default because
 * they add roughly 33% overhead and make database reads unnecessarily heavy.
 * 
 * @param {Buffer} inputBuffer 
 * @param {string} mimetype 
 * @returns {Promise<{ compressedBuffer: Buffer, base64DataUrl: string }>}
 */
export async function compressMediaImage(inputBuffer, mimetype = 'image/jpeg') {
    try {
        if (!inputBuffer || !Buffer.isBuffer(inputBuffer)) {
            throw new Error('Input must be a valid Buffer');
        }

        const keepInlineCopy = process.env.STORE_MEDIA_INLINE === 'true';

        // PDFs cannot go through the sharp image pipeline.
        const normalizedMimeType = String(mimetype || '').toLowerCase().split(';')[0].trim();
        const isPdf = normalizedMimeType === 'application/pdf' || inputBuffer.subarray(0, 4).toString() === '%PDF';
        if (isPdf) {
            const base64DataUrl = keepInlineCopy
                ? `data:application/pdf;base64,${inputBuffer.toString('base64')}`
                : '';
            return { compressedBuffer: inputBuffer, base64DataUrl };
        }

        // 1000px is ample for receipt text/OCR while keeping each file small.
        const compressedBuffer = await sharp(inputBuffer)
            .rotate()
            .resize({ width: 1000, height: 1800, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 70, progressive: true, mozjpeg: true })
            .toBuffer();

        const base64DataUrl = keepInlineCopy
            ? `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`
            : '';

        console.log(`⚡ [MediaCompressor] Original size: ${(inputBuffer.length / 1024).toFixed(1)}KB -> Compressed: ${(compressedBuffer.length / 1024).toFixed(1)}KB (${Math.round((1 - compressedBuffer.length / inputBuffer.length) * 100)}% smaller!)`);

        return { compressedBuffer, base64DataUrl };
    } catch (err) {
        console.error('⚠️ [MediaCompressor Error]', err.message);
        // Fallback: return original buffer
        const base64DataUrl = process.env.STORE_MEDIA_INLINE === 'true'
            ? `data:${mimetype};base64,${inputBuffer.toString('base64')}`
            : '';
        return { compressedBuffer: inputBuffer, base64DataUrl };
    }
}
