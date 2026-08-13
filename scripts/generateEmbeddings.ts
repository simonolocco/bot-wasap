/**
 * Script to generate product embeddings from the Excel catalog.
 * Run with: npx ts-node scripts/generateEmbeddings.ts
 *
 * This reads all products from data/productos.xlsx and generates
 * embeddings using Gemini's text-embedding-004 model.
 * The embeddings are saved to data/embeddings.json.
 */
import 'dotenv/config';
import { loadExcelData, getProducts } from '../src/excelLoader';
import { generateProductEmbeddings } from '../src/embeddingService';

async function main() {
  console.log('=== Generador de Embeddings ===\n');

  // Step 1: Load Excel
  console.log('[1/3] Cargando productos del Excel...');
  const { productCount } = loadExcelData();
  console.log(`      ${productCount} productos cargados.\n`);

  const products = getProducts();
  if (products.length === 0) {
    console.error('ERROR: No hay productos para generar embeddings.');
    process.exit(1);
  }

  // Step 2: Check API key
  if (!process.env.GOOGLE_GENAI_API_KEY) {
    console.error('ERROR: Falta GOOGLE_GENAI_API_KEY en el archivo .env');
    process.exit(1);
  }

  // Step 3: Generate embeddings
  console.log('[2/3] Generando embeddings con Gemini (gemini-embedding-001)...');
  console.log('      Esto puede tardar unos minutos dependiendo de la cantidad de productos.\n');

  const startTime = Date.now();
  await generateProductEmbeddings(products);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n[3/3] ¡Listo! Embeddings generados en ${elapsed}s`);
  console.log('      Archivo: data/embeddings.json');
  console.log('\n      Ahora podés levantar el bot con: npm run cloud');
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
