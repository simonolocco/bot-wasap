
export type Tier = { min: number; price: number; baseUnit: string; gate: string };
export type Variant = { codigo: string | null; producto: string; marca: string; tiers: Tier[] };

export async function reloadProducts(): Promise<Variant[]> {
  return [];
}

export async function getProducts(): Promise<Variant[]> {
  return [];
}

export async function findVariants(q: string): Promise<Variant[]> {
  return [];
}

export function pickTier(tiers: Tier[], qty: number): Tier {
  return tiers[0];
}

export function productsSummary(limit = 50): string {
  return '';
}
