import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import dotenv from 'dotenv';
import { normalizeCuit } from '../receipts/recipientService.js';

dotenv.config({ override: true });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Processes an image file using OpenRouter Vision API to extract fecha and monto
 * @param {string} filePath Absolute or relative path to image file
 * @returns {Promise<Object>} { fecha, monto, moneda, emisor, destinatario, cuit, tipo_comprobante, concepto, rawText, success }
 */
export async function processImageForReceipt(filePath) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const modelName = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
    const configuredMaxTokens = Number.parseInt(process.env.OPENROUTER_MAX_TOKENS || '800', 10);
    const maxTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
        ? configuredMaxTokens
        : 800;

    if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY dynamic check failed: Key missing in environment.');
    }

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    console.log(`[OCR Service] Encoding file: ${path.basename(filePath)}`);
    const fileBytes = fs.readFileSync(filePath);
    const fileB64 = fileBytes.toString('base64');
    
    let mimeType = mime.lookup(filePath) || 'image/jpeg';
    if (mimeType === false) mimeType = 'image/jpeg';

    const prompt = `Analiza detenidamente esta imagen de comprobante de pago, transferencia bancaria, recibo o factura.
Debes extraer de forma precisa únicamente la FECHA, la HORA / HORARIO, el MONTO y el NÚMERO DE OPERACIÓN / COMPROBANTE (ID de transferencia), además de datos secundarios si existen.

DEBES responder EXCLUSIVAMENTE con un objeto JSON válido con la siguiente estructura (sin texto explicativo adicional fuera del JSON):

{
  "fecha": "YYYY-MM-DD",
  "hora": "HH:MM",
  "monto": "15000.50",
  "moneda": "ARS",
  "emisor": "Nombre del Banco/Mercado Pago/Entidad",
  "destinatario": "Alias o nombre del destinatario/receptor del dinero",
  "cuit": "30714254622",
  "tipo_comprobante": "Transferencia / Factura / Recibo",
  "concepto": "Concepto o nota breve",
  "nro_operacion": "168234037681",
  "rawText": "Resumen de texto detectado en la imagen"
}

Reglas estrictas:
1. "fecha": Debe ser OBLIGATORIAMENTE la fecha explícita impresa en el comprobante de pago en formato YYYY-MM-DD (ej: 2026-08-05). Si la fecha NO es claramente visible en el comprobante (por ejemplo porque la foto está cortada antes del campo 'Fecha/Hora' o está tapada), PON OBLIGATORIAMENTE "fecha": null. Queda ESTRICTAMENTE PROHIBIDO inventar, adivinar o deducir fechas a partir de la hora de la pantalla del teléfono, notificaciones, CUITs o números de operación.
2. "hora": Debe estar en formato de 24 horas HH:MM o HH:MM:SS (ej: "14:35" o "09:12:05" o "18:42"). Si en la imagen dice "14:35 hs" o "02:35 PM", conviértelo a 24 horas ("14:35"). Si no se visualiza ninguna hora u horario del comprobante, pon null. Nunca formes una hora usando los dígitos del monto (por ejemplo, $4.062 no significa 04:06) ni uses la hora de la barra superior del teléfono.
3. "monto": Debe ser un STRING que represente el importe tal cual aparece en el comprobante (ej: "15.000,00" o "110.556"). En Argentina, el punto (.) suele ser separador de miles y la coma (,) de decimales. Nuestro sistema lo parseará automáticamente de forma segura.
4. "nro_operacion": Número de operación, id Op., N° de comprobante o código de identificación único de la transferencia (ej: "170172163242", "86VRPQ2GXV1J01JJ9GLYOM"). Si no se visualiza, pon null.
5. Si la fecha o el monto NO están claramente visibles en el texto del comprobante, pon "fecha": null, "hora": null. Es OBLIGATORIO poner null si no se visualiza la fecha explícita.
6. "destinatario": Nombre o alias del RECEPTOR del dinero (a quién se le transfirió). Puede aparecer como "Alias destino", "A favor de", "Para", "Destinatario", etc. Si no se visualiza, pon null.
7. "cuit": CUIT del RECEPTOR o DESTINATARIO. Puede aparecer con guiones, espacios o sin separadores (por ejemplo, "30-71425462-2" o "30717290824"). Extrae solo los 11 dígitos; si no se visualiza, pon null.`;

    const payload = {
        model: modelName,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${fileB64}`
                        }
                    }
                ]
            }
        ],
        temperature: 0.1,
        // OpenRouter validates affordability against the requested output
        // ceiling. Vision models may advertise very large defaults (65k+),
        // even though this endpoint only expects a compact JSON object.
        max_tokens: maxTokens
    };

    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/hoppe/baileys-group-media-downloader',
        'X-OpenRouter-Title': 'WhatsApp Invoice Processor'
    };

    console.log(`[OCR Service] Querying OpenRouter model: ${modelName}...`);

    try {
        const { data: resData } = await requestOpenRouter(payload, headers);

        const choices = resData.choices;
        if (!choices || choices.length === 0) {
            throw new Error('No choice returned from AI vision model.');
        }

        const content = choices[0].message?.content || '';
        console.log(`[OCR Service] AI Raw Response received for ${path.basename(filePath)}:\n${content}`);

        // Parse JSON from markdown block or raw string
        const parsed = cleanAndParseJSON(content);
        const rawTextContent = parsed.rawText || content;

        let parsedMonto = parseAmount(parsed.monto);
        if (parsedMonto === null) {
            parsedMonto = extractAmountFallback(rawTextContent);
        }

        let parsedFecha = normalizeDate(parsed.fecha);
        if (!parsedFecha) {
            parsedFecha = extractDateFallback(rawTextContent);
        }

        let parsedHora = normalizeTime(parsed.hora);
        if (!parsedHora) {
            parsedHora = extractTimeFallback(rawTextContent);
        }

        // Extracción de número de operación (vía IA o fallback Regex)
        const extractedNroOp = parsed.nro_operacion || extractOperationNumber(rawTextContent) || null;
        const extractedCuit = normalizeCuit(parsed.cuit) || extractCuitFallback(rawTextContent);

        // Emisor extraction with dynamic fallback based on raw text keyword matching
        let extractedEmisor = parsed.emisor || '';
        if (!extractedEmisor || extractedEmisor.toLowerCase() === 'desconocido' || extractedEmisor.toLowerCase() === 'entidad') {
            extractedEmisor = extractEmisorFallback(rawTextContent) || parsed.emisor || 'Mercado Pago';
        } else {
            // Normalize common names
            const norm = extractedEmisor.toLowerCase();
            if (norm.includes('macro')) extractedEmisor = 'Banco Macro';
            else if (norm.includes('mercado') && norm.includes('pago')) extractedEmisor = 'Mercado Pago';
            else if (norm.includes('galicia')) extractedEmisor = 'Banco Galicia';
            else if (norm.includes('santander')) extractedEmisor = 'Banco Santander';
            else if (norm.includes('bbva') || norm.includes('frances')) extractedEmisor = 'BBVA';
            else if (norm.includes('nacion')) extractedEmisor = 'Banco Nación';
            else if (norm.includes('provincia')) extractedEmisor = 'Banco Provincia';
            else if (norm.includes('uala')) extractedEmisor = 'Ualá';
            else if (norm.includes('brubank')) extractedEmisor = 'Brubank';
            else if (norm.includes('credicoop')) extractedEmisor = 'Banco Credicoop';
        }

        // A receipt is only ready for reconciliation when both date and time are
        // known. Never invent today's date when OCR could not read the receipt
        // date. If only the time is missing, preserve the detected base date so
        // an operator can complete the record later from the dashboard.
        const isMissingHoraOrDate = !parsedFecha || !parsedHora;

        // Keep the extraction date as the date printed on the receipt. The
        // homebanking cutoff affects only the date used for reconciliation.
        // Otherwise a receipt sent after 20:00 incorrectly moves to the next
        // day in the "Fecha Extracción" column.
        const fechaExtraccion = parsedFecha || null;
        const fechaComprobante = parsedFecha && parsedHora
            ? adjustDateForCutoff(parsedFecha, parsedHora)
            : parsedFecha || null;

        return {
            fecha: fechaExtraccion,
            fecha_comprobante: fechaComprobante,
            hora: parsedHora || null,
            monto: parsedMonto !== null ? parsedMonto : 0,
            moneda: parsed.moneda || 'ARS',
            emisor: extractedEmisor,
            destinatario: parsed.destinatario || null,
            cuit: extractedCuit,
            tipo_comprobante: parsed.tipo_comprobante || 'Transferencia',
            concepto: parsed.concepto || '',
            nro_operacion: extractedNroOp,
            rawText: rawTextContent,
            success: parsedMonto !== null && !isMissingHoraOrDate,
            missingDate: isMissingHoraOrDate
        };
    } catch (err) {
        console.error(`[OCR Service Error] ${err.message}`);
        return {
            fecha: null,
            fecha_comprobante: null,
            hora: null,
            monto: 0,
            moneda: 'ARS',
            emisor: '',
            destinatario: null,
            cuit: null,
            tipo_comprobante: '',
            concepto: '',
            rawText: `Error en análisis OCR: ${err.message}`,
            success: false,
            missingDate: false,
            error: err.message
        };
    }
}

/**
 * OpenRouter rejects otherwise valid requests when the requested output
 * ceiling is higher than the amount affordable with the current balance.
 * Receipt JSON is compact, so retry once with a safe ceiling derived from the
 * provider error instead of losing a clearly readable receipt.
 */
export function getAffordableRetryMaxTokens(message, requestedMaxTokens) {
    if (!message || !/requires more credits|can only afford|fewer max_tokens/i.test(String(message))) return null;
    const affordable = String(message).match(/can only afford\s+(\d+)/i);
    const providerLimit = affordable ? Number.parseInt(affordable[1], 10) : requestedMaxTokens;
    if (!Number.isFinite(providerLimit) || providerLimit < 128) return null;
    const safeLimit = Math.max(128, Math.min(800, providerLimit - 32, requestedMaxTokens - 1));
    return safeLimit < requestedMaxTokens ? safeLimit : null;
}

async function requestOpenRouter(payload, headers) {
    let requestPayload = { ...payload };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestPayload)
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok) return { data, maxTokens: requestPayload.max_tokens };

        const errorMsg = data?.error?.message || `HTTP ${response.status}`;
        const retryMaxTokens = getAffordableRetryMaxTokens(errorMsg, requestPayload.max_tokens);
        if (attempt === 0 && retryMaxTokens) {
            console.warn(`[OCR Service] Retrying with max_tokens=${retryMaxTokens} after provider affordability limit.`);
            requestPayload = { ...requestPayload, max_tokens: retryMaxTokens };
            continue;
        }
        throw new Error(`OpenRouter API Error: ${errorMsg}`);
    }
    throw new Error('OpenRouter API Error: retry exhausted');
}

/**
 * Parses numeric amounts from strings or numbers safely
 */
export function parseAmount(val) {
    if (typeof val === 'number') {
        const strVal = String(val);
        const parts = strVal.split('.');
        // Si tiene 3 decimales exactos (ej. 110.556), probablemente es un valor de miles en Argentina
        // mal interpretado por la IA como float. Lo convertimos a string para limpiarlo.
        if (parts[1] && parts[1].length === 3) {
            val = strVal;
        } else {
            return val;
        }
    }
    if (!val) return null;
    let str = String(val).replace(/[^0-9.,]/g, '').trim();
    if (!str) return null;

    if (str.includes('.') && str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes('.')) {
        const parts = str.split('.');
        if (parts.length > 2) {
            str = str.replace(/\./g, '');
        } else if (parts[1] && parts[1].length === 3) {
            str = str.replace(/\./g, '');
        }
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }

    const parsed = parseFloat(str);
    return isNaN(parsed) ? null : parsed;
}

/**
 /**
  * Cleans markdown ```json blocks and parses JSON safely
  */
 function cleanAndParseJSON(text) {
     if (!text) return {};
     let cleaned = text.trim();
     
     // Remove ```json and ``` code block wrappers
     if (cleaned.startsWith('```')) {
         cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
     }
     
     try {
         return JSON.parse(cleaned);
     } catch (err) {
         // Try finding json substring {...}
         const start = cleaned.indexOf('{');
         const end = cleaned.lastIndexOf('}');
         if (start !== -1 && end !== -1 && end > start) {
             try {
                 return JSON.parse(cleaned.substring(start, end + 1));
             } catch (innerErr) {
                 console.warn('[OCR Service] Failed to parse extracted JSON substring.');
             }
         }
         return {};
     }
 }

/**
 * Extracts operation number from raw text using regex patterns for various banks and digital wallets
 * @param {string} rawText 
 * @returns {string|null}
 */
export function extractOperationNumber(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    
    // Pattern 1: Mercado Pago / Generic "Número de operación 170172163242" or "Nro. de operación: 169141131893" or "N° de operacion 169141131893"
    const opMatch = rawText.match(/(?:N[úu]mero|Nro\.?|N[º°])\s+de\s+operaci[óo]n(?:\s+de\s+Mercado\s+Pago)?\s*[:#]?\s*([A-Za-z0-9]+)/i) ||
                    rawText.match(/(?:Nro\.?|N[º°]|ID|Id)\s*(?:de\s*)?(?:operaci[óo]n|op\.?)\s*[:#]?\s*([A-Za-z0-9]+)/i);
    if (opMatch && opMatch[1]) return opMatch[1].trim();

    // Pattern 2: Ualá / otros "id Op. 86VRPQ2GXV1J01JJ9GLYOM" or "ID de operación 86VRPQ..."
    const ualaMatch = rawText.match(/(?:id\s+Op\.|ID\s+de\s+operaci[óo]n)\s*[:#]?\s*([A-Za-z0-9]+)/i);
    if (ualaMatch && ualaMatch[1]) return ualaMatch[1].trim();

    // Pattern 3: Santander / Macro / Galicia "Nº comprobante 95525510" or "Nro. de Referencia 736280"
    const compMatch = rawText.match(/(?:N[º°o]\s*comprobante|Nro\.\s*de\s*Referencia|Referencia:?)\s*[:#]?\s*([A-Za-z0-9]+)/i);
    if (compMatch && compMatch[1]) return compMatch[1].trim();

    // Pattern 4: Generic "Código de identificación Z6OLMDN37X5GPJMX9E7RQ5"
    const codMatch = rawText.match(/C[óo]digo\s+de\s+identificaci[óo]n\s*[:#]?\s*([A-Za-z0-9]+)/i);
    if (codMatch && codMatch[1]) return codMatch[1].trim();

    return null;
}

/**
 * Extracts a recipient CUIT from OCR raw text, accepting common separators.
 */
export function extractCuitFallback(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    const match = rawText.match(/C[.\s]*U[.\s]*I[.\s]*T[.\s:#-]*(\d{2}[\s.-]?\d{8}[\s.-]?\d)/i);
    return match && match[1] ? normalizeCuit(match[1]) : null;
}

/**
 * Normalizes Spanish and standard date strings into YYYY-MM-DD format
 */
export function normalizeDate(str) {
    if (!str || typeof str !== 'string') return null;
    str = str.trim();
    
    let year = null, month = null, day = null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const parts = str.split('-').map(Number);
        year = parts[0];
        month = parts[1];
        day = parts[2];
    } else {
        const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (ddmmyyyy) {
            day = parseInt(ddmmyyyy[1], 10);
            month = parseInt(ddmmyyyy[2], 10);
            year = parseInt(ddmmyyyy[3], 10);
        } else {
            const months = {
                'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
                'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
                'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
            };
            const spanishMatch = str.match(/(\d{1,2})\s+de\s+([a-zA-Z]+)\s+de\s+(\d{4})/i);
            if (spanishMatch) {
                day = parseInt(spanishMatch[1], 10);
                month = months[spanishMatch[2].toLowerCase()] || 0;
                year = parseInt(spanishMatch[3], 10);
            }
        }
    }

    if (year && month && day) {
        if (year >= 2020 && year <= 2035 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const yyyy = String(year);
            const mm = String(month).padStart(2, '0');
            const dd = String(day).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
    }
    return null;
}

/**
 * Regex fallback for date if AI JSON parsing missed it
 */
export function extractDateFallback(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // Search exclusively for an explicit full date pattern inside text
    const textMatch = rawText.match(/\b(\d{1,2}\s+de\s+[a-zA-Z]+\s+de\s+\d{4})\b/i) ||
                      rawText.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/);
    if (textMatch && textMatch[1]) {
        return normalizeDate(textMatch[1]);
    }
    return null;
}

/**
 * Regex fallback for dollar amounts in text (e.g. "$ 202.017" or "$ 202.017,50")
 */
export function extractAmountFallback(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const match = rawText.match(/\$\s*([\d\.,]+)/);
    if (match && match[1]) {
        return parseAmount(match[1]);
    }
    return null;
}

/**
 * Fallback to extract Banco / Wallet name from raw text via keyword matching
 */
export function extractEmisorFallback(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const text = rawText.toLowerCase();
    if (text.includes('mercado pago') || text.includes('mercadopago') || text.includes('cvu')) return 'Mercado Pago';
    if (text.includes('macro')) return 'Banco Macro';
    if (text.includes('galicia')) return 'Banco Galicia';
    if (text.includes('santander')) return 'Banco Santander';
    if (text.includes('bbva') || text.includes('frances')) return 'BBVA';
    if (text.includes('nacion') || text.includes('bna')) return 'Banco Nación';
    if (text.includes('provincia') || text.includes('bapro')) return 'Banco Provincia';
    if (text.includes('uala')) return 'Ualá';
    if (text.includes('brubank')) return 'Brubank';
    if (text.includes('credicoop')) return 'Banco Credicoop';
    return null;
}

/**
 * Normalizes time strings into standard HH:MM format (24h)
 */
export function normalizeTime(str) {
    if (!str || typeof str !== 'string') return null;
    str = str.trim();

    // Check AM/PM format (e.g. "02:35 PM", "2:35pm" or "12 PM")
    const ampmMatch = str.match(/^(\d{1,2})(?:[:.](\d{2})(?:[:.]\d{2})?)?\s*(am|pm|a\.m\.|p\.m\.)$/i);
    if (ampmMatch) {
        let hours = parseInt(ampmMatch[1], 10);
        const minutes = ampmMatch[2] || '00';
        const period = ampmMatch[3].toLowerCase();
        if (hours < 1 || hours > 12 || parseInt(minutes, 10) > 59) return null;
        if (period.includes('p') && hours < 12) hours += 12;
        if (period.includes('a') && hours === 12) hours = 0;
        const hh = String(hours).padStart(2, '0');
        return `${hh}:${minutes}`;
    }

    // Match 24h format HH:MM or HH:MM:SS or HH:MM h / hs (e.g. "14:35", "12:22 h", "09:15:22")
    const match = str.match(/^(\d{1,2})[:.](\d{2})/);
    if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            const hh = String(hours).padStart(2, '0');
            const mm = match[2];
            return `${hh}:${mm}`;
        }
    }
    return null;
}

/**
 * Regex fallback for time extraction from raw text (e.g., "01/08/2026 - 12:22 h" or "Hora: 14:35")
 */
export function extractTimeFallback(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    // A dotted amount such as "$4.062,00" must never become the time 04:06.
    // Dotted times are accepted only with an explicit label or time suffix;
    // standalone clock values must use a colon.
    const labeledTime = rawText.match(
        /(?:fecha\s*\/\s*hora|hora|horario)\s*[:#-]?\s*(\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*(?:h|hs|hrs|am|pm|a\.m\.|p\.m\.))?\b)/i
    );
    if (labeledTime?.[1]) return normalizeTime(labeledTime[1]);

    const colonTime = rawText.match(
        /(?:^|[^\d$])((?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:h|hs|hrs|am|pm|a\.m\.|p\.m\.))?\b)/i
    );
    if (colonTime?.[1]) return normalizeTime(colonTime[1]);

    const dottedTimeWithSuffix = rawText.match(
        /(?:^|[^\d$])((?:[01]?\d|2[0-3])\.[0-5]\d\s*(?:h|hs|hrs|am|pm|a\.m\.|p\.m\.)\b)/i
    );
    if (dottedTimeWithSuffix?.[1]) return normalizeTime(dottedTimeWithSuffix[1]);

    return null;
}

/**
 * Adjusts receipt date YYYY-MM-DD to next day if time is >= 20:00 (homebanking cutoff)
 * @param {string} fechaStr YYYY-MM-DD
 * @param {string|null} horaStr HH:MM or HH:MM:SS
 * @returns {string} Adjusted YYYY-MM-DD
 */
export function adjustDateForCutoff(fechaStr, horaStr) {
    if (!fechaStr || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return fechaStr;
    const normalizedHora = normalizeTime(horaStr);
    if (!normalizedHora) return fechaStr;

    const match = normalizedHora.match(/^(\d{1,2}):\d{2}/);
    if (match) {
        const hours = parseInt(match[1], 10);
        if (hours >= 20) {
            const parts = fechaStr.split('-').map(Number);
            const year = parts[0];
            const month = parts[1];
            const day = parts[2];

            const d = new Date(Date.UTC(year, month - 1, day));
            d.setUTCDate(d.getUTCDate() + 1);
            const nextYear = d.getUTCFullYear();
            const nextMonth = String(d.getUTCMonth() + 1).padStart(2, '0');
            const nextDay = String(d.getUTCDate()).padStart(2, '0');
            const adjusted = `${nextYear}-${nextMonth}-${nextDay}`;
            console.log(`[Cutoff 20hs] Date adjusted for homebanking cutoff: ${fechaStr} ${normalizedHora} -> ${adjusted}`);
            return adjusted;
        }
    }

    return fechaStr;
}
