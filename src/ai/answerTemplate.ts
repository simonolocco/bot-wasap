/** Marker understood by saved AI answers. It is never sent to WhatsApp. */
export const AI_MENU_MARKER = '[[MENU]]';

export function renderSavedAnswer(template: string) {
  const marker = /\[\[\s*MENU\s*\]\]/gi;
  const sendMenuAfter = /\[\[\s*MENU\s*\]\]/i.test(template);
  const text = template
    .replace(marker, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, sendMenuAfter };
}
