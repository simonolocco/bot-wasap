import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';

// ─── Types ───────────────────────────────────────────────────
export type Product = {
  cod: number;
  producto: string;
  marca: string;
  uxb: number;
  kgProm: number | null;
  precio1: number;
  precio2: number;
};

export type SpecialPrice = {
  cod: number;
  producto: string;
  marca: string;
  precioFinal: number;
  detalle: string;
  /** Minimum qty to qualify (parsed from detalle). 1 means "per unit/per piece". */
  minQty: number;
  /** Normalized gate (horma, pieza, caja, unidad, sachet, etc.) */
  gate: string;
};

// ─── In-memory store ─────────────────────────────────────────
let products: Product[] = [];
let specialPrices: SpecialPrice[] = [];

const EXCEL_PATH = path.join(process.cwd(), 'data', 'productos.xlsx');

// ─── Detalle parser ──────────────────────────────────────────
// Parses strings like "x kg + 4 HORMAS", "x Kg x HORMA", "x unid. Minimo 20 unid"
function parseDetalle(raw: string): { minQty: number; gate: string } {
  const s = raw.trim().toLowerCase();

  // Pattern: "x kg + 4 HORMAS" → minQty=4, gate extracted from "HORMAS"
  const plusMatch = s.match(/\+\s*(\d+)\s+(.+)/);
  if (plusMatch) {
    return { minQty: Number(plusMatch[1]), gate: normalizeGateWord(plusMatch[2]) };
  }

  // Pattern: "x unid. Minimo 20 unid" → minQty=20
  const minimoMatch = s.match(/m[ií]nimo\s+(\d+)\s+(.+)/);
  if (minimoMatch) {
    return { minQty: Number(minimoMatch[1]), gate: normalizeGateWord(minimoMatch[2]) };
  }

  // Pattern: "x Kg x HORMA" or "x unid x CAJA" → minQty=1, gate from last word
  const perUnitMatch = s.match(/x\s+(\S+)$/);
  if (perUnitMatch) {
    return { minQty: 1, gate: normalizeGateWord(perUnitMatch[1]) };
  }

  // Pattern: "X DISPLEY" or "X COMBO" → minQty=1
  const simpleMatch = s.match(/^x\s+(.+)/);
  if (simpleMatch) {
    return { minQty: 1, gate: normalizeGateWord(simpleMatch[1]) };
  }

  return { minQty: 1, gate: '' };
}

function normalizeGateWord(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-záéíóúñü\s]/g, '')
    .trim();
  if (/hormas?/.test(s)) return 'horma';
  if (/medias?\s*hormas?/.test(s)) return 'media horma';
  if (/piezas?/.test(s)) return 'pieza';
  if (/cajas?|cajones?/.test(s)) return 'caja';
  if (/unid|unis/.test(s)) return 'unidad';
  if (/sachets?/.test(s)) return 'sachet';
  if (/latas?/.test(s)) return 'lata';
  if (/bidones?|bidon/.test(s)) return 'bidon';
  if (/potes?/.test(s)) return 'pote';
  if (/barras?/.test(s)) return 'barra';
  if (/displey/.test(s)) return 'displey';
  if (/packs?/.test(s)) return 'pack';
  if (/pilone?s?/.test(s)) return 'pilon';
  if (/cuña/.test(s)) return 'cuña';
  if (/ganchos?/.test(s)) return 'gancho';
  if (/combos?/.test(s)) return 'combo';
  if (/litros?|^l$/.test(s)) return 'l';
  if (/doy\s*pack/.test(s)) return 'doy pack';
  return s;
}

// ─── Excel loader ────────────────────────────────────────────
function plainCellValue(value: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  if ('result' in value) return plainCellValue(value.result ?? null);
  if ('text' in value) return value.text;
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  return String(value);
}

function worksheetRows(worksheet: ExcelJS.Worksheet | undefined) {
  const rows: Array<Array<string | number | boolean | Date | null>> = [];
  worksheet?.eachRow({ includeEmpty: true }, row => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map(value => plainCellValue(value as ExcelJS.CellValue)));
  });
  return rows;
}

export async function loadExcelData(): Promise<{ productCount: number; specialPriceCount: number }> {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`[excelLoader] No se encontró el archivo Excel: ${EXCEL_PATH}`);
    return { productCount: 0, specialPriceCount: 0 };
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);

  // ── Sheet1: lista de productos ──
  const raw1 = worksheetRows(wb.worksheets[0]);

  // Find the header row (has "CODIGO")
  let headerIdx1 = -1;
  for (let i = 0; i < Math.min(20, raw1.length); i++) {
    const row = raw1[i];
    if (row && row.some((cell: any) => String(cell).toUpperCase().includes('CODIGO'))) {
      headerIdx1 = i;
      break;
    }
  }

  const loadedProducts: Product[] = [];
  if (headerIdx1 >= 0) {
    for (let i = headerIdx1 + 1; i < raw1.length; i++) {
      const row = raw1[i];
      if (!row || row.length < 6) continue;
      const cod = row[0];
      if (cod == null || typeof cod !== 'number') continue;

      loadedProducts.push({
        cod,
        producto: String(row[1] ?? '').trim(),
        marca: String(row[2] ?? '').trim(),
        uxb: Number(row[3]) || 0,
        kgProm: typeof row[4] === 'number' ? row[4] : null,
        precio1: Number(row[5]) || 0,
        precio2: Number(row[6]) || 0,
      });
    }
  }

  // ── Sheet2: precios especiales ──
  const raw2 = worksheetRows(wb.worksheets[1]);

  // Find header row (has "Código" or "Producto")
  let headerIdx2 = -1;
  for (let i = 0; i < Math.min(20, raw2.length); i++) {
    const row = raw2[i];
    if (row && row.some((cell: any) => String(cell).toLowerCase().includes('código') || String(cell).toLowerCase().includes('codigo'))) {
      headerIdx2 = i;
      break;
    }
  }

  const loadedSpecialPrices: SpecialPrice[] = [];
  if (headerIdx2 >= 0) {
    for (let i = headerIdx2 + 1; i < raw2.length; i++) {
      const row = raw2[i];
      if (!row || row.length < 5) continue;
      const cod = row[0];
      if (cod == null || typeof cod !== 'number') continue;

      const detalle = String(row[5] ?? '').trim();
      const { minQty, gate } = parseDetalle(detalle);

      loadedSpecialPrices.push({
        cod,
        producto: String(row[1] ?? '').trim(),
        marca: String(row[2] ?? '').trim(),
        precioFinal: Number(row[4]) || 0,
        detalle,
        minQty,
        gate,
      });
    }
  }

  products = loadedProducts;
  specialPrices = loadedSpecialPrices;

  console.log(`[excelLoader] Cargados ${products.length} productos y ${specialPrices.length} precios especiales.`);
  return { productCount: products.length, specialPriceCount: specialPrices.length };
}

export function getProducts(): Product[] {
  return products;
}

export function getSpecialPrices(): SpecialPrice[] {
  return specialPrices;
}

export function reloadExcel() {
  return loadExcelData();
}
