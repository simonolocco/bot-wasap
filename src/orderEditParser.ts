import type { OrderItem } from './pedidos';
import { gateNorm, norm, processFullList } from './utils';

export type LocalEditAction = 'delete' | 'update' | 'add' | 'unknown';
export type QtyMode = 'set' | 'delta';

export type LocalEditIntent = {
  action: LocalEditAction;
  targetIndices?: number[];
  newQty?: number;
  qtyMode?: QtyMode;
  newGate?: string;
  newProductText?: string;
  addText?: string;
  reply: string;
};

const ADD_VERBS = ['agrega', 'agregame', 'suma', 'sumame', 'anota', 'pone', 'poneme'];
const DELETE_VERBS = ['borrar', 'borra', 'eliminar', 'elimina', 'sacar', 'saca', 'quitar', 'quita'];
const KNOWN_GATES = new Set(['kg', 'horma', 'media horma', 'pieza', 'caja', 'unidad', 'sachet', 'lata', 'bidon', 'pote', 'barra', 'displey', 'pack', 'pilon', 'l']);

export function parseLocalOrderEdit(userText: string, currentItems: OrderItem[]): LocalEditIntent {
  const raw = userText.trim();
  const text = norm(userText);

  if (!text) {
    return { action: 'unknown', reply: 'No llego a interpretar el cambio.' };
  }

  const deleteIntent = parseDelete(text, currentItems.length);
  if (deleteIntent) return deleteIntent;

  const relativeQtyIntent = parseRelativeQtyUpdate(text);
  if (relativeQtyIntent) return relativeQtyIntent;

  const indexedIntent = parseIndexedUpdate(raw, text);
  if (indexedIntent) return indexedIntent;

  const addIntent = parseAdd(raw, text);
  if (addIntent) return addIntent;

  if (looksLikeOrderLines(raw)) {
    return {
      action: 'add',
      addText: raw,
      reply: 'Interpreto que querés agregar productos al pedido.',
    };
  }

  return {
    action: 'unknown',
    reply: 'No pude resolver ese cambio de forma directa. Probá con algo como "borrar 2", "2 son 5 cajas" o "agregá 1 caja de cremoso paulina".',
  };
}

function parseDelete(text: string, itemCount: number): LocalEditIntent | null {
  if (text.includes('no borrar') || text.includes('no borres') || text.includes('no sacar')) {
    return null;
  }

  const hasDeleteVerb = DELETE_VERBS.some(verb => text.includes(verb));
  if (!hasDeleteVerb && !/^(\d+\s*(y|,)\s*)+\d+\s+borrar$/.test(text) && !/^\d+\s+borrar$/.test(text)) {
    return null;
  }

  if (text.includes('ultimo')) {
    return {
      action: 'delete',
      targetIndices: itemCount > 0 ? [itemCount - 1] : [],
      reply: 'Voy a sacar el último producto del pedido.',
    };
  }

  const targetIndices = extractItemNumbers(text);
  if (targetIndices.length === 0) return null;

  return {
    action: 'delete',
    targetIndices,
    reply: `Voy a eliminar ${targetIndices.length === 1 ? 'ese producto' : 'esos productos'} del pedido.`,
  };
}

function parseRelativeQtyUpdate(text: string): LocalEditIntent | null {
  const plusMatch = text.match(/(?:agrega|suma)\s+(\d+(?:[.,]\d+)?)\s+mas\s+(?:al?|a la?)\s+(\d+)/);
  if (!plusMatch) return null;

  return {
    action: 'update',
    targetIndices: [Number(plusMatch[2]) - 1],
    newQty: Number(plusMatch[1].replace(',', '.')),
    qtyMode: 'delta',
    reply: 'Voy a sumar esa cantidad al producto indicado.',
  };
}

function parseIndexedUpdate(raw: string, text: string): LocalEditIntent | null {
  const startMatch = raw.trim().match(/^(\d+)\s+(.+)$/);
  const changeMatch = raw.trim().match(/(?:cambia|cambiame|modifica|edita)\s+(?:el\s+)?(\d+)\s+(?:por|a)\s+(.+)/i);
  const targetNumber = startMatch ? Number(startMatch[1]) : changeMatch ? Number(changeMatch[1]) : null;
  const remainder = startMatch ? startMatch[2].trim() : changeMatch ? changeMatch[2].trim() : null;

  if (!targetNumber || !remainder) return null;

  const qtyGateMatch = norm(remainder).match(/^(son\s+)?(\d+(?:[.,]\d+)?)\s+([a-z]+(?:\s+[a-z]+)?)\b/);
  const parsedLines = processFullList(remainder);
  const firstLine = parsedLines[0];

  if (qtyGateMatch) {
    const maybeGate = gateNorm(qtyGateMatch[3]);
    if (KNOWN_GATES.has(maybeGate)) {
      const newProductText = firstLine?.searchTerms.length ? firstLine.searchTerms.join(' ') : undefined;
      return {
        action: 'update',
        targetIndices: [targetNumber - 1],
        newQty: Number(qtyGateMatch[2].replace(',', '.')),
        qtyMode: 'set',
        newGate: maybeGate,
        newProductText,
        reply: 'Voy a actualizar cantidad y unidad de ese producto.',
      };
    }
  }

  if (firstLine) {
    const hasExplicitQty = /^\s*\d/.test(remainder);
    if (hasExplicitQty || firstLine.gate) {
      const newProductText = firstLine.searchTerms.length > 0 ? firstLine.searchTerms.join(' ') : remainder;
      return {
        action: 'update',
        targetIndices: [targetNumber - 1],
        newQty: firstLine.qty,
        qtyMode: 'set',
        newGate: firstLine.gate || undefined,
        newProductText,
        reply: 'Voy a reemplazar ese renglón con la versión corregida.',
      };
    }
  }

  return {
    action: 'update',
    targetIndices: [targetNumber - 1],
    newProductText: remainder,
    reply: 'Voy a buscar el producto corregido para ese ítem.',
  };
}

function parseAdd(raw: string, text: string): LocalEditIntent | null {
  const prefixed = ADD_VERBS.some(verb => text.startsWith(verb + ' '));
  if (!prefixed) return null;

  const stripped = raw.replace(/^(agrega|agrega|agregame|suma|sumame|anota|pone|poneme)\s+/i, '').trim();
  if (!stripped) return null;

  return {
    action: 'add',
    addText: stripped,
    reply: 'Voy a agregar esos productos al pedido.',
  };
}

function extractItemNumbers(text: string): number[] {
  const matches = text.match(/\d+/g) ?? [];
  return Array.from(new Set(matches.map(n => Number(n) - 1))).filter(n => n >= 0);
}

function looksLikeOrderLines(raw: string): boolean {
  const lines = processFullList(raw);
  return lines.length > 0 && lines.some(line => line.searchTerms.length > 0);
}
