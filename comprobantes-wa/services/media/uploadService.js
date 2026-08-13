import fs from 'fs';
import multer from 'multer';

export function createMediaUpload(mediaDir) {
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }
            cb(null, mediaDir);
        },
        filename: (req, file, cb) => {
            const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15);
            const sanitizeName = file.originalname.replace(/[^a-zA-Z0-9_.]/g, '_');
            cb(null, `${timestamp}_manual_${sanitizeName}`);
        }
    });

    return multer({ storage });
}
