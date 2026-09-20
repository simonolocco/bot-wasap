import assert from 'node:assert/strict';
import { AI_MENU_MARKER, renderSavedAnswer } from '../src/ai/answerTemplate';

const withMenu = renderSavedAnswer(`Respuesta personalizada\n\n${AI_MENU_MARKER}`);
assert.equal(withMenu.text, 'Respuesta personalizada');
assert.equal(withMenu.sendMenuAfter, true);

const withoutMenu = renderSavedAnswer('Respuesta personalizada');
assert.equal(withoutMenu.text, 'Respuesta personalizada');
assert.equal(withoutMenu.sendMenuAfter, false);

const markerOnly = renderSavedAnswer('  [[ menu ]]  ');
assert.equal(markerOnly.text, '');
assert.equal(markerOnly.sendMenuAfter, true);

const markerWithPunctuation = renderSavedAnswer('Respuesta útil\n[[MENU]]\n[[ menu ]]');
assert.equal(markerWithPunctuation.text, 'Respuesta útil');
assert.equal(markerWithPunctuation.sendMenuAfter, true);

const markerIsCaseInsensitive = renderSavedAnswer('Respuesta útil [[menu]]');
assert.equal(markerIsCaseInsensitive.text, 'Respuesta útil');
assert.equal(markerIsCaseInsensitive.sendMenuAfter, true);

console.log('AI answer template tests: OK');
