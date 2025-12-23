export function norm(s: string) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANON: Record<string, string> = {
  // ... (copia todo el CANON de tu cÃ³digo original, el que tiene aliases para productos como 'cremosa': 'cremoso', etc.)
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
  'jamon': 'jamon', 'jamÃ³n': 'jamon', 'jmn': 'jamon',
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
  // LÃ¡cteos
  'cremas': 'crema', 'nata': 'crema',
  'manteca': 'manteca', 'mantequilla': 'manteca',
  'dulce de leche': 'dulce de leche', 'ddl': 'dulce de leche',
  // Otros
  'pates': 'pate', 'patÃ©': 'pate',
  'pasta': 'pasta',
  'patagonia': 'patagonia',
  // Unidades
  'caja': 'caja', 'cajon': 'caja',
  'horma': 'horma',
  'bidon': 'bidon', 'bidÃ³n': 'bidon',
  'lata': 'lata',
  'pilon': 'pilon', 'pilÃ³n': 'pilon',
  'pote': 'pote',
  'displey': 'displey',
  'doy pack': 'doy pack', 'doypack': 'doy pack',
  'porcion': 'porcion', 'porciÃ³n': 'porcion', 'porciones': 'porcion',
  'sachet': 'sachet',
  'barras': 'barra',
  'pieza': 'pieza',
  'pack': 'pack',
  'media horma': 'media horma', 'cuÃ±a': 'cuÃ±a',
  'l': 'l', 'litro': 'l'
};


export function canonize(s: string) {
  const tokens = norm(s).split(' ').filter(Boolean);
  return tokens.map(t => CANON[t] ?? t).join(' ');
}

// Palabras comunes que no aportan a la bÃºsqueda de producto
const STOPWORDS = new Set<string>([
  'de','del','la','el','los','las','y','o','un','una','unos','unas','al','a','en','con','sin','por','para','que','me','te','lo','le','les','mi','tu','su','sus','mis','tus','sus',
  'tenes','tenÃ©s','tenis','tienen','hay','vendes','venden','vende','vendÃ©s',
  'quiero','necesito','precio','precios','lista','catalogo','catÃ¡logo','!cat','!p','hola','buenas','hey','hello','cuanto','cuÃ¡nto','vale','sale','costo','costa','esta','estÃ¡',
]);

export function meaningfulTokens(s: string): string[] {
  const tokens = canonize(s).split(' ').filter(Boolean);
  return tokens.filter(t => !STOPWORDS.has(t) && !/^\d+$/.test(t));
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
  if (/cuÃ±(a|a)/.test(u)) return 'cuÃ±a';
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

