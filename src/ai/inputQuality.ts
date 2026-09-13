import { normalizeText } from '../botMenu';

const TYPO_GREETING_PATTERN = /^(?:hola+s*|holsa|hiola|hla|gola)(?:\s+(?:buen\s+d[ií]a|buenos\s+d[ií]as|buenas\s+tardes|buenas\s+noches))?$/i;
const KEYBOARD_PREFIX_PATTERN = /^(?:asdf|qwer|zxcv|hjkl|lkjh|wsad)[a-z0-9]*$/i;
const BUSINESS_FRAGMENT_PATTERN = /(stock|precio|ques|fiambre|lacteo|leche|envio|catalog|pedido|factura|horario|direccion|pago|mayor|menor)/i;

/**
 * True only for input that has no recoverable conversational meaning. A typo,
 * an unknown business question or an off-topic sentence is still intelligible
 * and must be answered or redirected by the assistant.
 */
export function isUnintelligibleQuestion(value: string | null | undefined) {
  const raw = value?.trim() ?? '';
  if (!raw || /^[.?¿!,;:\-\s]+$/u.test(raw)) return true;
  if (TYPO_GREETING_PATTERN.test(raw)) return false;

  const normalized = normalizeText(raw);
  if (!normalized) return true;
  if (/^(?:perdon\s*)?\d{3,}$/i.test(normalized)) return true;
  if (KEYBOARD_PREFIX_PATTERN.test(normalized)) return true;
  if (/[a-záéíóúñ]{1,3}[A-Z]{4,}/u.test(raw)) return true;

  // Catch a single long keyboard mash such as "asdjkahsd" conservatively.
  // Known business fragments are excluded so misspelled customer questions
  // continue to the model instead of being discarded as noise.
  if (/^[a-zñ]{7,}$/i.test(normalized) && !BUSINESS_FRAGMENT_PATTERN.test(normalized)) {
    const vowels = (normalized.match(/[aeiou]/gi) ?? []).length;
    if (vowels / normalized.length < 0.24) return true;
  }
  return false;
}

export function isTypoGreeting(value: string | null | undefined) {
  return TYPO_GREETING_PATTERN.test(value?.trim() ?? '');
}
