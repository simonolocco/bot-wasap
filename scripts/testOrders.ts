/**
 * Test script for the order system refactoring.
 * Run with: npx ts-node scripts/testOrders.ts
 */
import { loadExcelData, getProducts, getSpecialPrices } from '../src/excelLoader';
import { processFullList, searchProduct, fmtPrice, findSemanticMatch } from '../src/utils';
import { getBestPrice } from '../src/pedidos';
import { loadEmbeddings } from '../src/embeddingService';

// ─── Load Excel ──────────────────────────────────────────────
console.log('=== Loading Excel & Embeddings ===');
const result = loadExcelData();
console.log(`Products loaded: ${result.productCount}`);
loadEmbeddings();
console.log(`Special prices loaded: ${result.specialPriceCount}`);

const products = getProducts();
const specials = getSpecialPrices();

console.log('\nFirst 3 products:');
products.slice(0, 3).forEach(p => {
  console.log(`  [${p.cod}] ${p.producto} - ${p.marca} | Lista1: ${fmtPrice(p.precio1)}`);
});

console.log('\nFirst 3 special prices:');
specials.slice(0, 3).forEach(sp => {
  console.log(`  [${sp.cod}] ${sp.producto} ${sp.marca} | ${fmtPrice(sp.precioFinal)} | ${sp.detalle} (minQty=${sp.minQty}, gate=${sp.gate})`);
});

// ─── Test processFullList ────────────────────────────────────
console.log('\n=== Testing processFullList ===');
const testInput = `2 hormas cremoso cañada
5 kg muzza fival
3 cajas mayonesa
1 pieza bondiola
cremoso paulina`;

const parsed = processFullList(testInput);
for (const line of parsed) {
  console.log(`  "${line.rawLine}" → qty=${line.qty}, gate="${line.gate}", terms=[${line.searchTerms.join(', ')}]`);
}

// ─── Test searchProduct ──────────────────────────────────────
console.log('\n=== Testing searchProduct ===');

const testCases = [
  { terms: ['cremoso', 'canada'], expect: 'Cremoso + CAÑADA' },
  { terms: ['muzzarella', 'fival'], expect: 'Muzzarella + FIVAL' },
  { terms: ['cremoso', 'paulina'], expect: 'Cremoso + PAULINA' },
  { terms: ['tybo', 'canada'], expect: 'Tybo + CAÑADA' },
  { terms: ['bondiola'], expect: 'Bondiola' },
  { terms: ['asdfghjkl'], expect: 'NOT FOUND' },
];

for (const tc of testCases) {
  const res = searchProduct(tc.terms, products);
  const found = res.product
    ? `[${res.product.cod}] ${res.product.producto} ${res.product.marca} (score: ${res.score})`
    : `NOT FOUND (score: ${res.score})`;
  const status = res.score >= 50 ? '✓' : res.score > 0 ? '?' : 'X';
  console.log(`  ${status} [${tc.terms.join(' ')}] -> ${found}  (expected: ${tc.expect})`);
}

// ─── Test getBestPrice ───────────────────────────────────────
console.log('\n=== Testing getBestPrice ===');

console.log('  Cremoso Canada (cod 119):');
const p1 = getBestPrice(119, 2, 'horma');
console.log(`    2 hormas -> ${fmtPrice(p1.price)} promo=${p1.promo}`);
const p2 = getBestPrice(119, 5, 'horma');
console.log(`    5 hormas -> ${fmtPrice(p2.price)} promo=${p2.promo}`);
const p3 = getBestPrice(119, 25, 'horma');
console.log(`    25 hormas -> ${fmtPrice(p3.price)} promo=${p3.promo}`);

console.log('  Cremoso Fival (cod 118):');
const p4 = getBestPrice(118, 1, 'horma');
console.log(`    1 horma -> ${fmtPrice(p4.price)} promo=${p4.promo}`);
const p5 = getBestPrice(118, 5, 'horma');
console.log(`    5 hormas -> ${fmtPrice(p5.price)} promo=${p5.promo}`);

// ─── Full E2E ────────────────────────────────────────────────
(async () => {
  console.log('\n=== Full E2E: Process order list ===');
  const catalog = getProducts();
  const orderText = `2 hormas cremoso cañada
5 kg muzza fival
mantecol pepito`;

  const lines = processFullList(orderText);
  const items: Array<{ cod: number; name: string; marca: string; qty: number; gate: string; price: number; total: number; promo: boolean }> = [];
  const notFound: string[] = [];

  for (const line of lines) {
    if (line.searchTerms.length === 0) { notFound.push(line.rawLine); continue; }
    
    const semRes = await findSemanticMatch(line.rawLine);
    let resolvedProd = null;

    if (semRes.tier === 'auto' && semRes.bestMatch) {
      resolvedProd = catalog.find(p => p.cod === semRes.bestMatch!.cod);
    } else {
      // fallback
      const res = searchProduct(line.searchTerms, catalog);
      if (res.product && res.score >= 50) resolvedProd = res.product;
    }

    if (resolvedProd) {
      const gate = line.gate || 'kg';
      const { price, promo } = getBestPrice(resolvedProd.cod, line.qty, gate);
      items.push({
        cod: resolvedProd.cod,
        name: resolvedProd.producto,
        marca: resolvedProd.marca,
        qty: line.qty,
        gate,
        price,
        total: price * line.qty,
        promo,
      });
    } else {
      notFound.push(line.rawLine);
    }
  }

  console.log('  Items found:');
  for (const item of items) {
    const promoTag = item.promo ? ' PROMO' : '';
    console.log(`    [${item.cod}] ${item.qty} ${item.gate} ${item.name} ${item.marca} -> ${fmtPrice(item.price)}/${item.gate} = ${fmtPrice(item.total)}${promoTag}`);
  }
  console.log('  Not found:', notFound);
  console.log('  Grand total:', fmtPrice(items.reduce((s, i) => s + i.total, 0)));

  console.log('\n=== Testing CRUD Edition via Chat ===');
  
  // Test "borrar 3" (Mantecol)
  console.log('  > User sends: "borrar 3"');
  const deleteMatch = "borrar 3".match(/^(?:borrar\s+(\d+)|(\d+)\s+borrar)$/);
  if (deleteMatch) {
    const itemIndex = parseInt(deleteMatch[1] || deleteMatch[2], 10) - 1;
    const removed = items.splice(itemIndex, 1)[0];
    console.log(`    ✓ Removed: ${removed.name}`);
  }

  // Test "2 no es fival, es paulina"
  console.log('  > User sends: "2 paulina en vez de fival"');
  const editMatch = "2 paulina en vez de fival".match(/^(\d+)\s+(.+)$/);
  if (editMatch) {
    const itemIndex = parseInt(editMatch[1], 10) - 1;
    const correctionText = editMatch[2].trim();
    console.log(`    Attempting to correct item 2 with: "${correctionText}"`);
    
    const parsedLines = processFullList(correctionText);
    const parsed = parsedLines[0];
    const semResult = await findSemanticMatch(parsed.rawLine);
    
    if (semResult.tier === 'auto' && semResult.bestMatch) {
      const product = catalog.find(p => p.cod === semResult.bestMatch!.cod);
      if (product) {
        items[itemIndex].name = product.producto;
        items[itemIndex].marca = product.marca;
        items[itemIndex].cod = product.cod;
        console.log(`    ✓ Updated item 2 to: [${product.cod}] ${product.producto} ${product.marca}`);
      }
    }
  }

  console.log('\n  Final cart after edits:');
  for (const item of items) {
    console.log(`    [${item.cod}] ${item.qty} ${item.gate} ${item.name} ${item.marca}`);
  }

  console.log('\n=== ALL TESTS COMPLETE ===');
})();

