import assert from 'node:assert/strict';
import { extractAmountFallback, getAffordableRetryMaxTokens, parseAmount } from '../services/ocr/ocrService.js';

assert.equal(parseAmount('$167.000'), 167000);
assert.equal(parseAmount('$ 167.000,50'), 167000.5);
assert.equal(parseAmount('ARS 1.234.567'), 1234567);
assert.equal(parseAmount('167000.50'), 167000.5);
assert.equal(extractAmountFallback('Transferiste $ 167.000 a un destinatario'), 167000);
assert.equal(extractAmountFallback('Monto total: $1.234.567,89'), 1234567.89);

assert.equal(
    getAffordableRetryMaxTokens('This request requires more credits, or fewer max_tokens. You requested up to 2000 tokens, but can only afford 1923.', 2000),
    800
);
assert.equal(
    getAffordableRetryMaxTokens('can only afford 600', 800),
    568
);
assert.equal(getAffordableRetryMaxTokens('Unauthorized', 800), null);

console.log('ocrService tests: OK');
