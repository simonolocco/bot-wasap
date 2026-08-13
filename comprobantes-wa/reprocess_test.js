import { processImageForReceipt } from './services/ocr/ocrService.js';
import { saveReceipt } from './services/database/dbService.js';

const imagePath = 'C:\\Users\\simon\\Desktop\\invoice\\media\\20260722_160653_244551243538579_AC723B9D85D5B868B9C418126001D932_image.jpg';

async function main() {
    console.log('Reprocessing receipt image...');
    const res = await processImageForReceipt(imagePath);
    console.log('Result:', res);

    const saved = saveReceipt({
        id: 'rec_1784747210540_AC723',
        filename: '20260722_160653_244551243538579_AC723B9D85D5B868B9C418126001D932_image.jpg',
        filePath: imagePath,
        sender: 'Hoppe',
        fecha: res.fecha,
        monto: res.monto,
        moneda: res.moneda,
        emisor: res.emisor,
        tipo_comprobante: res.tipo_comprobante,
        concepto: res.concepto,
        rawText: res.rawText,
        status: res.success ? 'completed' : 'error',
        errorMessage: res.error || null
    });

    console.log('Updated receipt in DB:', saved);
}

main();
