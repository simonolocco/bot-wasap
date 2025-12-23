
import fs from 'node:fs';
import path from 'node:path';

export type OrderStatus = 'pending_customer' | 'submitted' | 'canceled' | 'accepted';

export type OrderRecord = {
  id: number;
  chat_id: string;
  customer_name: string | null;
  detail: string;
  created_at: string;
  status: OrderStatus;
  accepted: number;
  accepted_at: string | null;
};

// JSON file persistence
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'orders.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory storage for orders
const ordersMap = new Map<number, OrderRecord>();
let nextOrderId = 1;

// Load orders on startup
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const list = JSON.parse(raw) as OrderRecord[];
    if (Array.isArray(list)) {
      for (const o of list) {
        ordersMap.set(o.id, o);
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
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
  } catch (error) {
    console.error('[pedidos] Error guardando orders.json:', error);
  }
}

export async function createOrder(chatId: string, customerName: string | undefined, detail: string): Promise<OrderRecord> {
  const id = nextOrderId++;
  const order: OrderRecord = {
    id,
    chat_id: chatId,
    customer_name: customerName ?? null,
    detail,
    created_at: new Date().toISOString(),
    status: 'pending_customer',
    accepted: 0,
    accepted_at: null
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

// Stubs for removed alias functionality
export async function listPendingAliases() { return []; }
export async function assignAliasToProduct() { return { updated: 0 }; }
export async function searchCatalogProducts() { return []; }
export async function listPendingUnitAliases() { return []; }
export async function assignUnitAlias() { return { updated: 0 }; }
