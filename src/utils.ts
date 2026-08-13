export function norm(s: string) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANON: Record<string, string> = {
  'quedo': 'queso', 'quesito': 'queso', 'quesillos': 'queso', 'kueso': 'queso', 'qeso': 'queso',
  // Cremoso
  'cremosa': 'cremoso', 'cremso': 'cremoso', 'kremoso': 'cremoso',
  // Muzzarella
  'mussarela': 'muzzarella', 'muzarella': 'muzzarella', 'muza': 'muzzarella', 'muzza': 'muzzarella', 'mozarella': 'muzzarella', 'muzzarela': 'muzzarella',
  // Barra / Bloque
  'barra': 'barra', 'bld': 'barra', 'bloque': 'barra', 'barrita': 'barra',
  // Tybo
  'tibo': 'tybo', 'tivo': 'tybo',
  // Danbo
  'dambo': 'danbo', 'danvo': 'danbo',
  // Pategras
  'pategras': 'pategras', 'pategrass': 'pategras', 'pate': 'pategras',
  // Senda
  'senda': 'senda',
  // Sandwich
  'sandwich': 'sandwich', 'sandwiche': 'sandwich',
  // Ricotta
  'ricota': 'ricotta', 'rikotta': 'ricotta', 'riccota': 'ricotta',
  // Azul
  'azul': 'azul', 'asul': 'azul',
  // Cheddar
  'cheddar': 'cheddar', 'chedar': 'cheddar', 'cheder': 'cheddar',
  // Untable
  'untable': 'untable', 'crema': 'untable', 'cremette': 'untable',
  // Otros quesos
  'sardo': 'sardo', 'sardoa': 'sardo',
  'reggianito': 'reggianito', 'regiano': 'reggianito',
  'provolone': 'provolone', 'provolon': 'provolone',
  'parmesano': 'parmesano', 'parmigiano': 'parmesano',
  'fontina': 'fontina', 'fontin': 'fontina',
  // Fiambres
  'bondiola': 'bondiola', 'boniola': 'bondiola', 'bondi': 'bondiola',
  'jamon': 'jamon', 'jmn': 'jamon',
  'salame': 'salame', 'salami': 'salame',
  'mortadela': 'mortadela', 'mortadella': 'mortadela',
  'panceta': 'panceta', 'pancetta': 'panceta',
  'lomo': 'lomo',
  // Aderezos
  'mayonesa': 'mayonesa', 'mayo': 'mayonesa', 'mayones': 'mayonesa',
  'ketchup': 'ketchup', 'ketchap': 'ketchup',
  'mostaza': 'mostaza', 'mostasa': 'mostaza',
  'salsa golf': 'salsa golf', 'golf': 'salsa golf',
  'barbacoa': 'barbacoa', 'barbecue': 'barbacoa', 'bbq': 'barbacoa',
  // Aceitunas
  'aceituna': 'aceituna', 'aceitunas': 'aceituna', 'oliva': 'aceituna', 'olivas': 'aceituna',
  'verde': 'verde', 'negra': 'negra', 'rodaja': 'rodaja', 'descarozada': 'descarozada',
  // Lacteos
  'cremas': 'crema', 'nata': 'crema',
  'manteca': 'manteca', 'mantequilla': 'manteca',
  'dulce de leche': 'dulce de leche', 'ddl': 'dulce de leche',
  // Otros
  'pates': 'pate',
  'pasta': 'pasta',
  'patagonia': 'patagonia',
  // Unidades
  'caja': 'caja', 'cajon': 'caja',
  'horma': 'horma', 'homra': 'horma', 'homras': 'horma',
  'bidon': 'bidon',
  'lata': 'lata',
  'pilon': 'pilon',
  'pote': 'pote',
  'displey': 'displey',
  'doy pack': 'doy pack', 'doypack': 'doy pack',
  'porcion': 'porcion', 'porciones': 'porcion',
  'sachet': 'sachet',
  'barras': 'barra',
  'pieza': 'pieza',
  'pack': 'pack',
  'media horma': 'media horma',
  'l': 'l', 'litro': 'l',
  // Por Salut
  'por salut': 'por salut', 'porsalut': 'por salut', 'por salud': 'por salut',
  // Milan
  'milanesa': 'milanesa', 'milane': 'milanesa',
  // Paleta
  'paleta': 'paleta',
  // Combo
  'combo': 'combo',
};

export function canonize(s: string) {
  const tokens = norm(s).split(' ').filter(Boolean);
  return tokens.map(t => CANON[t] ?? t).join(' ');
}

const TOKEN_EXPANSIONS: Record<string, string[]> = {
  lt: ['tirolesa'],
  tirol: ['tirolesa'],
  fiva: ['fival'],
  fival: ['fival'],
  pda: ['punta', 'agua'],
  paul: ['paulina'],
  quesera: ['quesera'],
  pala: ['paladini'],
  palad: ['paladini'],
  q: ['queso'],
  qs: ['queso'],
  cre: ['cremoso'],
  crem: ['cremoso'],
  hor: ['horma'],
  horm: ['horma'],
  caj: ['caja'],
  cocido: ['cocido', 'jamon'],
  jamonada: ['jamon', 'cocido'],
  milan: ['milan'],
  rodajas: ['rodaja'],
  rodaja: ['rodaja'],
};

const BRAND_ALIASES: Record<string, string[]> = {
  'la tirolesa': ['lt', 'tirolesa'],
  'la piamontesa': ['lp', 'piamontesa'],
  'punta del agua': ['pda', 'punta', 'agua'],
  'la quesera': ['quesera'],
  'canada negra': ['canada', 'cañada'],
  'verde cosecha': ['verde', 'cosecha'],
  'cuatro condes': ['4 condes'],
  'paulina': ['paulina'],
  'paladini': ['paladini'],
  'fival': ['fiva', 'fival'],
};

// Palabras comunes que no aportan a la busqueda de producto
const STOPWORDS = new Set<string>([
  'de','del','la','el','los','las','y','o','un','una','unos','unas','al','a','en','con','sin','por','para','que','me','te','lo','le','les','mi','tu','su','sus','mis','tus',
  'tenes','tienen','hay','vendes','venden','vende',
  'quiero','necesito','precio','precios','lista','catalogo','hola','buenas','hey','hello','cuanto','vale','sale','costo','costa','esta',
  'no','vez','envez','solo','solamente','sino','favor','plis','pls','cambiar','poneme','poner','hace','haceme','cambiame','lugar',
  'kg','kilo','kilos','horma','hormas','caja','cajas','unidad','unidades','unid','gr','gramos','l','litro','litros'
]);

export function meaningfulTokens(s: string): string[] {
  const tokens = canonize(s).split(' ').filter(Boolean);
  return expandTokens(tokens).filter(t => !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export function editDistance(a: string, b: string) {
  a = norm(a); b = norm(b);
  const n = b.length;
  const dp = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

export function fmtPrice(n: number): string {
  if (!isFinite(n)) n = 0;
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n);
}

export const baseNorm = (u: string) => {
  u = u.trim().toLowerCase();
  if (/kg/.test(u)) return 'kg';
  if (/^uni(d|s)?\b/.test(u)) return 'uni';
  if (/caja|caj/.test(u)) return 'caja';
  if (/sachet/.test(u)) return 'sachet';
  if (/lata|lat\b/.test(u)) return 'lata';
  if (/bidon/.test(u)) return 'bidon';
  if (/pote/.test(u)) return 'pote';
  if (/barra/.test(u)) return 'barra';
  if (/\b(l|litro)\b/.test(u)) return 'l';
  return u;
};

export const gateNorm = (u: string) => {
  u = u.trim().toLowerCase();
  if (/medias?\s*hormas?/.test(u)) return 'media horma';
  if (/hormas?/.test(u)) return 'horma';
  if (/cajas?/.test(u)) return 'caja';
  if (/\b(unidad|unid|uni|u)\b/.test(u)) return 'unidad';
  if (/sachets?/.test(u)) return 'sachet';
  if (/latas?/.test(u)) return 'lata';
  if (/bidones?/.test(u)) return 'bidon';
  if (/potes?/.test(u)) return 'pote';
  if (/barras?/.test(u)) return 'barra';
  if (/\b(l|litros?)\b/.test(u)) return 'l';
  if (/piezas?/.test(u)) return 'pieza';
  if (/displey/.test(u)) return 'displey';
  if (/pack/.test(u)) return 'pack';
  return u;
};

export const inferFromText = (txt: string): { baseUnit: string; gate: string } => {
  const t = txt.toUpperCase();
  if (/HORM/.test(t)) return { baseUnit: 'kg', gate: 'horma' };
  if (/BIDON/.test(t)) return { baseUnit: 'bidon', gate: 'bidon' };
  if (/LATA/.test(t)) return { baseUnit: 'lata', gate: 'lata' };
  if (/SACHET/.test(t)) return { baseUnit: 'sachet', gate: 'sachet' };
  if (/POTE/.test(t)) return { baseUnit: 'pote', gate: 'pote' };
  if (/BARRA/.test(t)) return { baseUnit: 'barra', gate: 'barra' };
  if (/CAJA|CAJ/.test(t)) return { baseUnit: 'caja', gate: 'caja' };
  if (/\bL\b|LITRO/.test(t)) return { baseUnit: 'l', gate: 'l' };
  return { baseUnit: 'uni', gate: 'unidad' };
};

// ═══════════════════════════════════════════════════════════════
// ORDER LIST PROCESSING — "Sin Fricción"
// ═══════════════════════════════════════════════════════════════

import type { Product } from './excelLoader';

export type ParsedLine = {
  rawLine: string;
  qty: number;
  gate: string;
  searchTerms: string[];
};

export type SearchResult = {
  product: Product | null;
  score: number;          // 0-100
  alternatives: Product[];
};

/**
 * Parse a multi-line order message into structured lines.
 * Splits by newlines. For each line extracts qty, gate (unit) and the
 * remaining search tokens (product + brand).
 *
 * Examples:
 *   "2 hormas cremoso cañada"  → { qty:2, gate:"horma", searchTerms:["cremoso","cañada"] }
 *   "5 kg muzza fival"         → { qty:5, gate:"kg",    searchTerms:["muzza","fival"] }
 *   "cremoso cañada"           → { qty:1, gate:"",      searchTerms:["cremoso","cañada"] }
 */
export function processFullList(text: string): ParsedLine[] {
  const lines = text
    .split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !isIgnorableOrderLine(l));

  return lines.map(parseSingleLine);
}

const GATE_WORDS: Record<string, string> = {
  horma: 'horma', hormas: 'horma', homra: 'horma', homras: 'horma',
  hor: 'horma', horm: 'horma',
  'media horma': 'media horma', 'medias hormas': 'media horma',
  pieza: 'pieza', piezas: 'pieza',
  caja: 'caja', cajas: 'caja', cajon: 'caja', cajones: 'caja',
  caj: 'caja',
  unidad: 'unidad', unidades: 'unidad', unid: 'unidad', uni: 'unidad', u: 'unidad',
  sachet: 'sachet', sachets: 'sachet',
  lata: 'lata', latas: 'lata',
  lat: 'lata',
  bidon: 'bidon', bidones: 'bidon',
  bid: 'bidon',
  pote: 'pote', potes: 'pote',
  barra: 'barra', barras: 'barra',
  displey: 'displey', displeys: 'displey',
  pack: 'pack', packs: 'pack',
  pilon: 'pilon', pilones: 'pilon',
  kg: 'kg', kilo: 'kg', kilos: 'kg',
  l: 'l', litro: 'l', litros: 'l',
};

function isIgnorableOrderLine(line: string): boolean {
  const cleaned = norm(line).replace(/[:\-]+$/g, '').trim();
  return cleaned === 'pedido'
    || cleaned === 'paso pedido'
    || cleaned === 'otro'
    || cleaned === 'otro pedido';
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();
  for (const token of tokens) {
    const canon = CANON[token] ?? token;
    expanded.add(canon);
    const aliases = TOKEN_EXPANSIONS[canon] ?? TOKEN_EXPANSIONS[token] ?? [];
    for (const alias of aliases) {
      for (const part of canonize(alias).split(' ').filter(Boolean)) {
        expanded.add(part);
      }
    }
  }
  return Array.from(expanded);
}

function parseSingleLine(line: string): ParsedLine {
  const normalized = norm(line);
  const tokens = normalized.split(' ').filter(Boolean);

  let qty = 1;
  let gate = '';
  let startIdx = 0;

  // Try to extract leading number
  if (tokens.length > 0 && /^\d+([.,]\d+)?$/.test(tokens[0])) {
    qty = parseFloat(tokens[0].replace(',', '.'));
    startIdx = 1;
  }

  // Try to extract gate word right after the number
  if (startIdx < tokens.length) {
    // Try two-word gate first ("media horma")
    if (startIdx + 1 < tokens.length) {
      const twoWord = tokens[startIdx] + ' ' + tokens[startIdx + 1];
      if (GATE_WORDS[twoWord]) {
        gate = GATE_WORDS[twoWord];
        startIdx += 2;
      }
    }
    // Single word gate
    if (!gate && GATE_WORDS[tokens[startIdx]]) {
      gate = GATE_WORDS[tokens[startIdx]];
      startIdx += 1;
    }
  }

  // Strip "de" connector if present
  if (startIdx < tokens.length && tokens[startIdx] === 'de') {
    startIdx += 1;
  }

  const searchTerms = expandTokens(tokens.slice(startIdx));

  return { rawLine: line, qty, gate, searchTerms };
}

/**
 * Search for a product in the catalog using fuzzy matching.
 * Returns the best match, its score (0-100), and up to 3 alternatives.
 */
export function searchProduct(terms: string[], catalog: Product[]): SearchResult {
  if (terms.length === 0 || catalog.length === 0) {
    return { product: null, score: 0, alternatives: [] };
  }

  const canonTerms = expandTokens(terms.map(t => CANON[t] ?? t));

  const scored = catalog.map(p => {
    const score = calcMatchScore(canonTerms, p);
    return { product: p, score };
  });

  // Sort by score descending, then by shorter product name (more specific)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.product.producto.length - b.product.producto.length;
  });

  const best = scored[0];
  const alternatives = scored
    .slice(1, 4)
    .filter(s => s.score >= 40)
    .map(s => s.product);

  return {
    product: best.score > 0 ? best.product : null,
    score: best.score,
    alternatives,
  };
}

/**
 * Calculate how well the given search terms match a product.
 * Returns a number 0-100.
 */
function calcMatchScore(canonTerms: string[], product: Product): number {
  const prodNorm = norm(product.producto);
  const marcaNorm = norm(product.marca);
  const prodTokens = expandTokens(prodNorm.split(' ').filter(Boolean).map(t => CANON[t] ?? t));
  const marcaTokens = expandTokens(marcaNorm.split(' ').filter(Boolean).map(t => CANON[t] ?? t));
  const aliasTokens = buildProductAliases(product);
  const allProductTokens = Array.from(new Set([...prodTokens, ...marcaTokens, ...aliasTokens]));

  let matchedTerms = 0;
  let totalWeight = 0;

  for (const term of canonTerms) {
    totalWeight += 1;
    let bestMatchForTerm = 0;

    // Exact token match in product or brand
    if (allProductTokens.includes(term)) {
      bestMatchForTerm = 1;
    } else {
      // Substring match
      if (prodNorm.includes(term) || marcaNorm.includes(term)) {
        bestMatchForTerm = 0.9;
      } else {
        // Fuzzy match — edit distance
        let minDist = Infinity;
        for (const pt of allProductTokens) {
          // Only compare tokens of similar length to avoid noise
          if (Math.abs(pt.length - term.length) <= 3) {
            const d = editDistance(term, pt);
            if (d < minDist) minDist = d;
          }
        }
        // Allow edit distance up to 2 for decent-length words
        const maxDist = term.length <= 3 ? 1 : 2;
        if (minDist <= maxDist) {
          bestMatchForTerm = 1 - (minDist / (maxDist + 1)) * 0.4;
        }
      }
    }

    matchedTerms += bestMatchForTerm;
  }

  if (totalWeight === 0) return 0;

  // Base score from term matching (0-100)
  let score = (matchedTerms / totalWeight) * 100;

  // Bonus: if ALL product tokens were mentioned by the user terms (exact product match)
  const coveredProductTokens = prodTokens.filter(pt =>
    canonTerms.some(ct => ct === pt || editDistance(ct, pt) <= 1)
  );
  if (prodTokens.length > 0 && coveredProductTokens.length === prodTokens.length) {
    score = Math.min(100, score + 10);
  }

  const importantAliases = aliasTokens.filter(token =>
    canonTerms.includes(token) && token.length >= 4
  ).length;
  if (importantAliases > 0) {
    score = Math.min(100, score + importantAliases * 4);
  }

  const numericTerms = canonTerms.filter(term => /^\d+(?:[.,]\d+)?$/.test(term));
  if (numericTerms.length > 0) {
    const exactNumericMatches = numericTerms.filter(term => allProductTokens.includes(term)).length;
    score += exactNumericMatches * 8;
    if (exactNumericMatches === 0) {
      score -= 5;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildProductAliases(product: Product): string[] {
  const aliasSet = new Set<string>();
  const productName = norm(product.producto);
  const brandName = norm(product.marca);

  for (const token of extractProductPackagingTokens(product.producto)) {
    aliasSet.add(token);
  }

  const brandAliases = BRAND_ALIASES[brandName] ?? [];
  for (const alias of brandAliases) {
    for (const token of canonize(alias).split(' ').filter(Boolean)) {
      aliasSet.add(token);
    }
  }

  if (productName.includes('cremoso')) {
    aliasSet.add('queso');
    aliasSet.add('cremoso');
    aliasSet.add('cre');
  }
  if (productName.includes('queso azul')) {
    aliasSet.add('azul');
    aliasSet.add('queso');
  }
  if (productName.includes('barra') && productName.includes('sandwich')) {
    aliasSet.add('sandwich');
    aliasSet.add('barra');
  }
  if (productName.includes('jamon cocido') || productName.includes('paleta jamonada')) {
    aliasSet.add('jamon');
    aliasSet.add('cocido');
  }
  if (productName.includes('mortadela')) {
    aliasSet.add('mortadela');
  }
  if (productName.includes('salame milan')) {
    aliasSet.add('milan');
  }
  if (productName.includes('grueso') || productName.includes('baston')) {
    aliasSet.add('grueso');
    if (productName.includes('salame')) {
      aliasSet.add('milan');
    }
  }
  if (productName.includes('fino')) {
    aliasSet.add('fino');
  }
  if (productName.includes('aceituna')) {
    aliasSet.add('aceituna');
  }
  if (productName.includes('rodaja')) {
    aliasSet.add('rodaja');
    aliasSet.add('rodajas');
  }

  return Array.from(aliasSet);
}

function extractProductPackagingTokens(producto: string): string[] {
  const tokens = new Set<string>();
  const s = norm(producto);
  const regex = /x\s*(\d+(?:[.,]\d+)?)\s*(kg|gr|g|l)?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(s)) !== null) {
    const value = match[1].replace(',', '.');
    const unit = match[2] ?? '';
    tokens.add(`x${value}`);
    if (unit) {
      tokens.add(`${value}${unit}`);
    }
  }
  return Array.from(tokens);
}

// ═══════════════════════════════════════════════════════════════
// SEMANTIC SEARCH — Gemini Embeddings
// ═══════════════════════════════════════════════════════════════

import { semanticSearch, isSemanticReady } from './embeddingService';
import type { SemanticMatch } from './embeddingService';

export type SemanticSearchResult = {
  /** 'auto' (≥40%), 'unknown' (<40%) */
  tier: 'auto' | 'unknown';
  bestMatch: SemanticMatch | null;
  /** Top 3 alternatives */
  alternatives: SemanticMatch[];
};

/**
 * Clean user input for embedding: remove leading quantities and gate/unit words
 * so only the product + brand terms are vectorized, PRESERVING accents.
 *
 * Example: "4 hor cre fival" → "cre fival"
 */
export function cleanForEmbedding(rawLine: string): string {
  const pattern = /^\s*\d+([.,]\d+)?\s*(hormas?|media horma|medias hormas|cajas?|cajon|cajones|unidades?|unid|uni|u|sachets?|latas?|bidones?|bidon|potes?|barras?|displeys?|packs?|pilones?|pilon|kilos?|kg|litros?|l|piezas?|hor|caj|lat|bid|sach)?\s*(de\s+)?/i;
  const cleaned = rawLine.replace(pattern, '').trim();
  return cleaned || rawLine;
}

/**
 * Find the best semantic match for a user's product query.
 *
 * Uses Gemini embeddings + cosine similarity to match products.
 * Falls back gracefully if embeddings are not available.
 *
 * @param rawLine - The original unparsed line (e.g. "2 hormas cremoso cañada")
 */
export async function findSemanticMatch(rawLine: string): Promise<SemanticSearchResult> {
  if (!isSemanticReady()) {
    return { tier: 'unknown', bestMatch: null, alternatives: [] };
  }

  const queryText = cleanForEmbedding(rawLine);
  if (!queryText.trim()) {
    return { tier: 'unknown', bestMatch: null, alternatives: [] };
  }

  const matches = await semanticSearch(queryText, 3);
  if (matches.length === 0) {
    return { tier: 'unknown', bestMatch: null, alternatives: [] };
  }

  const best = matches[0];
  const alternatives = matches.slice(1);

  if (best.similarityPercent >= 40) {
    return { tier: 'auto', bestMatch: best, alternatives };
  } else {
    return { tier: 'unknown', bestMatch: best, alternatives };
  }
}
