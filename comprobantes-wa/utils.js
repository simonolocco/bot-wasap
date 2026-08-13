import fs from 'fs';
import { Readable } from 'stream';
import mime from 'mime-types';

/**
 * Formats a message timestamp or current system time as standard string: YYYYMMDD_HHmmss.
 * @param {number} [timestampSeconds]
 * @returns {string}
 */
export function getFormattedTimestamp(timestampSeconds) {
    const date = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
    const pad = (num) => String(num).padStart(2, '0');
    
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    
    return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

/**
 * Strips Windows/Unix forbidden filename characters and replaces them with underscores.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/[\\/:*?"<>|\s]/g, '_');
}

/**
 * Recursively searches a message structure to find the first media content object.
 * It ignores the contextInfo (quoted message details) to prevent downloading old replies.
 * @param {object} message
 * @returns {{type: string, content: object}|null}
 */
export function findMediaContent(message) {
    if (!message || typeof message !== 'object') {
        return null;
    }
    
    // Potential media properties in WhatsApp proto
    const mediaKeys = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
    for (const key of mediaKeys) {
        if (message[key] && typeof message[key] === 'object') {
            return {
                type: key,
                content: message[key]
            };
        }
    }
    
    // Cycle through other sub-keys (excluding contextInfo to reject quoted message downloads)
    for (const key of Object.keys(message)) {
        if (key === 'contextInfo') {
            continue;
        }
        if (message[key] && typeof message[key] === 'object') {
            const found = findMediaContent(message[key]);
            if (found) {
                return found;
            }
        }
    }
    
    return null;
}

/**
 * Normalizes a messages objects by stripping nested wrappers and constructing a clean virtual message.
 * @param {object} msg
 * @returns {{type: string, content: object, virtualMsg: object}|null}
 */
export function getNormalizedMediaMessage(msg) {
    if (!msg || !msg.message) return null;
    
    const media = findMediaContent(msg.message);
    if (!media) return null;
    
    // Create a virtual WAMessage with the media property at the root message object level.
    // This allows Baileys downloadMediaMessage utility to find decryption keys at predictable paths.
    const virtualMsg = {
        ...msg,
        message: {
            [media.type]: media.content
        }
    };
    
    return {
        type: media.type,
        content: media.content,
        virtualMsg
    };
}

/**
 * Determines file extension based on the content mimetype or mediaType fallback.
 * @param {object} content
 * @param {string} mediaType
 * @returns {string}
 */
export function getFileExtension(content, mediaType) {
    if (content && content.mimetype) {
        const ext = mime.extension(content.mimetype);
        if (ext) return ext;
    }
    
    switch (mediaType) {
        case 'imageMessage':
            return 'jpg';
        case 'videoMessage':
            return 'mp4';
        case 'audioMessage':
            return 'ogg';
        case 'stickerMessage':
            return 'webp';
        case 'documentMessage':
            return 'bin';
        default:
            return 'dat';
    }
}

/**
 * Returns a standardized, unique chronological filename.
 * Format: YYYYMMDD_HHmmss_[sender]_[msgId]_[baseName].[ext]
 * @param {object} content The media message properties
 * @param {string} mediaType E.g. 'imageMessage'
 * @param {string} senderNumber Sender remote/participant JID
 * @param {string} msgId Unique message ID
 * @param {number} timestampSeconds The WhatsApp message timestamp
 * @returns {string}
 */
export function getMediaFileName(content, mediaType, senderNumber, msgId, timestampSeconds) {
    const timeStr = getFormattedTimestamp(timestampSeconds);
    const sender = senderNumber ? sanitizeFilename(senderNumber.split('@')[0]) : 'unknown';
    const messageId = msgId ? sanitizeFilename(msgId) : Math.random().toString(36).substring(2, 8);
    
    let baseName = '';
    let ext = '';
    
    if (mediaType === 'documentMessage' && content.fileName) {
        const origName = content.fileName;
        const lastDot = origName.lastIndexOf('.');
        if (lastDot !== -1) {
            baseName = origName.substring(0, lastDot);
            ext = origName.substring(lastDot + 1);
        } else {
            baseName = origName;
            ext = getFileExtension(content, mediaType);
        }
    } else {
        const prefixes = {
            imageMessage: 'image',
            videoMessage: 'video',
            audioMessage: 'audio',
            stickerMessage: 'sticker',
        };
        baseName = prefixes[mediaType] || 'media';
        ext = getFileExtension(content, mediaType);
    }
    
    baseName = sanitizeFilename(baseName) || 'file';
    ext = sanitizeFilename(ext) || 'dat';
    
    return `${timeStr}_${sender}_${messageId}_${baseName}.${ext}`;
}

/**
 * Saves a Stream or Buffer value into a file path, ensuring directory folders exist.
 * @param {Readable|Buffer} mediaData
 * @param {string} destPath
 * @returns {Promise<void>}
 */
export function saveMedia(mediaData, destPath) {
    return new Promise((resolve, reject) => {
        if (Buffer.isBuffer(mediaData)) {
            fs.writeFile(destPath, mediaData, (err) => {
                if (err) reject(err);
                else resolve();
            });
        } else if (mediaData instanceof Readable || (mediaData && typeof mediaData.pipe === 'function')) {
            const writeStream = fs.createWriteStream(destPath);
            
            mediaData.pipe(writeStream);
            
            writeStream.on('finish', () => {
                resolve();
            });
            
            writeStream.on('error', (err) => {
                writeStream.destroy();
                reject(err);
            });
            
            mediaData.on('error', (err) => {
                writeStream.destroy();
                reject(err);
            });
        } else {
            reject(new Error('Invalid media format. Must be a Buffer or Readable stream.'));
        }
    });
}
