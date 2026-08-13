import { getRecipientAccounts, identifyRecipientAccount } from './recipientService.js';

function getOcrStatus(ocrResult) {
    return ocrResult.missingDate
        ? 'missing_date'
        : (ocrResult.success ? 'completed' : 'error');
}

/**
 * Converts the OCR result into the canonical receipt shape used by all
 * ingestion paths (WhatsApp, manual upload and reprocessing).
 *
 * This function only builds data. Persistence and realtime notifications stay
 * in the caller so the bot and HTTP layer remain independently testable.
 */
export function createReceiptFromOcr(baseReceipt, ocrResult, options = {}) {
    const {
        fallbackLocal = baseReceipt.local || 'local1',
        filterUnknownRecipient = false,
        persistRecipient = false,
        mercadoFrescosLocal = null
    } = options;

    const configuredAccounts = getRecipientAccounts();
    const recipientAccount = identifyRecipientAccount(ocrResult.destinatario, ocrResult.cuit);
    const recipient = ocrResult.destinatario || null;
    const cuit = ocrResult.cuit || null;
    const sharedFields = {
        ...baseReceipt,
        fecha: ocrResult.fecha,
        fecha_comprobante: ocrResult.fecha_comprobante || ocrResult.fecha,
        hora: ocrResult.hora,
        monto: ocrResult.monto,
        moneda: ocrResult.moneda,
        emisor: ocrResult.emisor,
        nro_operacion: ocrResult.nro_operacion,
        tipo_comprobante: ocrResult.tipo_comprobante,
        concepto: ocrResult.concepto,
        rawText: ocrResult.rawText,
        status: getOcrStatus(ocrResult),
        errorMessage: ocrResult.error || null
    };

    if (persistRecipient) {
        // When OCR only finds the CUIT, keep the canonical configured alias in
        // the row so the dashboard still shows which recipient was identified.
        sharedFields.destinatario = recipient || recipientAccount?.alias || null;
    }

    if (filterUnknownRecipient && (recipient || cuit) && configuredAccounts.length > 0 && !recipientAccount) {
        const configuredAliases = configuredAccounts.map((account) => account.alias).join(' / ');
        const detectedRecipient = recipient
            ? 'destinatario "' + recipient + '"'
            : 'CUIT "' + cuit + '"';
        const filterReason = 'Comprobante conservado fuera del cruce: ' + detectedRecipient +
            ' no coincide con las cuentas configuradas (' + configuredAliases + ').';

        return {
            receipt: {
                ...sharedFields,
                notas: filterReason,
                status: 'filtered'
            },
            filtered: true,
            filterReason,
            recipientAccount: null
        };
    }

    return {
        receipt: {
            ...sharedFields,
            // A Mercado receipt can be assigned to a physical branch by the
            // WhatsApp group/sender context. Without that context, preserve
            // the legacy account value for manual uploads and old flows.
            local: recipientAccount?.id === 'mercado_frescos'
                ? (mercadoFrescosLocal || recipientAccount.storageValue)
                : (recipientAccount?.storageValue || fallbackLocal)
        },
        filtered: false,
        filterReason: null,
        recipientAccount
    };
}
