import fs from 'node:fs';
import path from 'node:path';
import { getProducts, getSpecialPrices } from './excelLoader';
import type { Product, SpecialPrice } from './excelLoader';

// ─── Types ───────────────────────────────────────────────────

export type OrderStatus = 'pending_customer' | 'submitted' | 'canceled' | 'accepted';

export type OrderItem = {
  cod: number | null;
  name: string;
  marca: string;
  qty: number;
  gate: string;
  price: number;      // unit price applied
  total: number;       // price × qty
  promo: boolean;      // true if from Sheet2 special price
};

export type OrderRecord = {
  id: number;
  chat_id: string;
  customer_name: string | null;
  detail: string;        // raw text from the customer
  items: OrderItem[];
  grandTotal: number;
  created_at: string;
  status: OrderStatus;
  accepted: number;
  accepted_at: string | null;
};

// ─── JSON file persistence ───────────────────────────────────

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ordersMap = new Map<number, OrderRecord>();
let nextOrderId = 1;

// Load orders on startup
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const list = JSON.parse(raw) as OrderRecord[];
    if (Array.isArray(list)) {
      for (const o of list) {
        ordersMap.set(o.id, {
          ...o,
          items: Array.isArray(o.items) ? o.items : [],
          grandTotal: Number.isFinite(o.grandTotal) ? o.grandTotal : 0,
        });
      }
      if (list.length > 0) {
        nextOrderId = Math.max(...list.map((x) => x.id)) + 1;
      }
    }
  }
} catch (error) {
  console.error('[pedidos] Error cargando orders.json:', error);
}

function saveOrders() {
  try {
    const list = Array.from(ordersMap.values());
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, (key, value) =>
      typeof value === 'bigint' ? Number(value) : value
    , 2));
  } catch (error) {
    console.error('[pedidos] Error guardando orders.json:', error);
  }
}

// ─── Price logic ─────────────────────────────────────────────

export type CalcResult = {
  price: number;
  total: number;
  promo: boolean;
  isVariableWeight: boolean; // True if unit relies on kgProm but it's null/NaN
  weightTotal: number;       // total kg
  unitsTotal: number;        // total standard units (cajas -> units)
};

/**
 * Calculates item price and totals according to Business Rules:
 *   - Kilo: Uses Sheet1 base price.
 *   - Horma: Looks up KG PROM to calculate total weight. Uses Sheet2 discount prices based on Horma qty.
 *   - Caja/Bulto: Uses UxB to calculate total units, applies volume pricing.
 */
export function calculateItem(
  cod: number,
  qty: number,
  gate: string,
): CalcResult {
  const products = getProducts();
  const specialPrices = getSpecialPrices();

  const product = products.find(p => p.cod === cod);
  if (!product) {
    return { price: 0, total: 0, promo: false, isVariableWeight: false, weightTotal: 0, unitsTotal: 0 };
  }

  const matching = specialPrices.filter(sp => sp.cod === cod);
  const findSpecialPrice = (targetGate: string, targetQty: number) => {
    const qualifying = matching.filter(sp => {
      const matchGate = !sp.gate || !targetGate || sp.gate === targetGate
        || (sp.gate === 'horma' && targetGate === 'kg')
        || sp.gate === targetGate.replace(/s$/, '');
      return matchGate && targetQty >= sp.minQty;
    });
    if (qualifying.length > 0) {
      return qualifying.reduce((a, b) => a.precioFinal < b.precioFinal ? a : b);
    }
    // Base tier fallback
    return matching.find(sp => sp.minQty === 1 && (!sp.gate || sp.gate === targetGate));
  };

  const g = gate.toLowerCase();

  // Rule: Kilo - always uses standard list
  if (g === 'kg' || g === 'kilo') {
    return {
      price: product.precio1,
      total: product.precio1 * qty,
      promo: false,
      isVariableWeight: false,
      weightTotal: qty,
      unitsTotal: 0,
    };
  }

  // Rule: Horma - Uses KG PROM, looks for sheet 2 pricing
  if (g.includes('horma') || g.includes('pieza')) {
    const kgProm = product.kgProm;
    const isVarWeight = !kgProm || isNaN(kgProm);
    // If half horma, it's 0.5 horma for pricing lookup purposes, but generally we multiply unit by kgProm
    const factor = g.includes('media') ? 0.5 : 1;
    const effQtyHormas = qty * factor;
    
    // Look for special price for Hormas
    const bestSp = findSpecialPrice('horma', qty);
    
    if (bestSp) {
      const pricePerKg = bestSp.precioFinal;
      const totalWeight = effQtyHormas * (isVarWeight ? 1 : kgProm);
      return {
        price: pricePerKg,
        total: pricePerKg * totalWeight,
        promo: true,
        isVariableWeight: isVarWeight,
        weightTotal: totalWeight,
        unitsTotal: qty,
      };
    } else {
      // Fallback
      const pricePerKg = product.precio1;
      const totalWeight = effQtyHormas * (isVarWeight ? 1 : kgProm);
      return {
        price: pricePerKg,
        total: pricePerKg * totalWeight,
        promo: false,
        isVariableWeight: isVarWeight,
        weightTotal: totalWeight,
        unitsTotal: qty,
      };
    }
  }

  // Rule: Caja/Bulto - Uses UxB to multiply
  if (g.includes('caja') || g.includes('bulto') || g.includes('cajon')) {
    const uxb = product.uxb > 0 ? product.uxb : 1;
    const totalUnitsInside = qty * uxb;
    
    // Check if there is a special price for the box itself
    const bestSpBox = findSpecialPrice('caja', qty);
    if (bestSpBox) {
      // Price is expected to be either per box OR per unit inside the box
      // Assuming it's typically 'price per unit inside the box' if UxB > 1 for scalable comparisons,
      // but if the SP specifies "caja", we assume it's per unit inside. Let's do Price * UxB * qty
      // (Unless it's a fixed combo, but per requirements UxB multiplies the volume).
      const pricePerUnit = bestSpBox.precioFinal;
      return {
        price: pricePerUnit,
        total: pricePerUnit * totalUnitsInside,
        promo: true,
        isVariableWeight: false,
        weightTotal: 0,
        unitsTotal: totalUnitsInside,
      };
    }

    // Default to pricing per unit
    const fallbackPrice = product.precio1;
    return {
      price: fallbackPrice,
      total: fallbackPrice * totalUnitsInside,
      promo: false,
      isVariableWeight: false,
      weightTotal: 0,
      unitsTotal: totalUnitsInside,
    };
  }

  // Any other unit (unidad, sachet, etc.)
  const bestSpGeneric = findSpecialPrice(g, qty);
  if (bestSpGeneric) {
    return {
      price: bestSpGeneric.precioFinal,
      total: bestSpGeneric.precioFinal * qty,
      promo: true,
      isVariableWeight: false,
      weightTotal: 0,
      unitsTotal: qty,
    };
  }
  
  return {
    price: product.precio1,
    total: product.precio1 * qty,
    promo: false,
    isVariableWeight: false,
    weightTotal: 0,
    unitsTotal: qty,
  };
}

// ─── CRUD operations ─────────────────────────────────────────

export async function createOrder(
  chatId: string,
  customerName: string | undefined,
  detail: string,
  items: OrderItem[] = [],
  grandTotal: number = 0,
): Promise<OrderRecord> {
  const id = nextOrderId++;
  const order: OrderRecord = {
    id,
    chat_id: chatId,
    customer_name: customerName ?? null,
    detail,
    items,
    grandTotal,
    created_at: new Date().toISOString(),
    status: 'pending_customer',
    accepted: 0,
    accepted_at: null,
  };
  ordersMap.set(id, order);
  saveOrders();
  return order;
}

export async function submitOrder(orderId: number): Promise<OrderRecord | null> {
  const order = ordersMap.get(orderId);
  if (!order) return null;
  order.status = 'submitted';
  saveOrders();
  return order;
}

export async function cancelOrder(orderId: number): Promise<void> {
  const order = ordersMap.get(orderId);
  if (!order) return;
  order.status = 'canceled';
  saveOrders();
}

export async function updateOrderContents(
  orderId: number,
  items: OrderItem[],
  grandTotal: number,
): Promise<OrderRecord | null> {
  const order = ordersMap.get(orderId);
  if (!order) return null;
  order.items = items;
  order.grandTotal = grandTotal;
  saveOrders();
  return order;
}

export async function acceptOrder(orderId: number): Promise<OrderRecord | null> {
  const order = ordersMap.get(orderId);
  if (!order) return null;
  order.status = 'accepted';
  order.accepted = 1;
  order.accepted_at = new Date().toISOString();
  saveOrders();
  return order;
}

export async function listOrders(): Promise<OrderRecord[]> {
  return Array.from(ordersMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getOrder(orderId: number): Promise<OrderRecord | null> {
  return ordersMap.get(orderId) ?? null;
}
