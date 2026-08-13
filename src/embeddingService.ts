import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'node:fs';
import path from 'node:path';
import type { Product } from './excelLoader';

// ─── Config ──────────────────────────────────────────────────

const API_KEY = process.env.GOOGLE_GENAI_API_KEY;
if (!API_KEY) {
  console.warn('[embeddingService] GOOGLE_GENAI_API_KEY no está configurada en .env. Búsqueda semántica desactivada.');
}

const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDINGS_FILE = path.join(process.cwd(), 'data', 'embeddings.json');

let genAI: GoogleGenerativeAI | null = null;
if (API_KEY) {
  genAI = new GoogleGenerativeAI(API_KEY);
}

// ─── Types ───────────────────────────────────────────────────

export type ProductEmbedding = {
  cod: number;
  text: string;            // the text that was embedded ("Cremoso CAÑADA NEGRA")
  vector: number[];
};

// ─── In-memory cache ─────────────────────────────────────────

let embeddingsCache: ProductEmbedding[] = [];

// ─── Embedding generation ────────────────────────────────────

/**
 * Generate an embedding vector for a single text string.
 */
export async function embedText(text: string): Promise<number[]> {
  if (!genAI) {
    throw new Error('Gemini API no configurada. Agregá GOOGLE_GENAI_API_KEY al .env.');
  }

  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Generate embeddings for a batch of texts.
 * Processes in chunks to respect rate limits.
 */
export async function embedBatch(
  texts: string[],
  batchSize = 90,  // Burst up to 90 items
  delayMs = 2000, 
): Promise<number[][]> {
  const vectors: number[][] = [];
  
  if (!genAI) {
    throw new Error('Gemini API no configurada. Agregá GOOGLE_GENAI_API_KEY al .env.');
  }
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    const requests = batch.map(text => ({
      content: { role: 'user', parts: [{ text }] }
    }));
    
    let success = false;
    let retries = 0;
    while (!success && retries < 5) {
      try {
        const result = await model.batchEmbedContents({ requests });
        const batchVectors = result.embeddings.map(e => e.values);
        vectors.push(...batchVectors);
        success = true;
      } catch (err: any) {
        if (err.status === 429) {
          console.warn(`\n[embeddingService] Rate limit (429) alcanzado. Esperando 60s antes de reintentar... (Intento ${retries + 1}/5)`);
          await new Promise(resolve => setTimeout(resolve, 60000));
          retries++;
        } else {
          throw err;
        }
      }
    }

    if (!success) {
      throw new Error('Fallo al generar embeddings después de múltiples reintentos por Rate Limit.');
    }

    const processed = Math.min(i + batchSize, texts.length);
    console.log(`[embeddingService] Embeddings generados: ${processed}/${texts.length}`);

    // Rate limit delay between successful batches
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return vectors;
}

// ─── Generate and save product embeddings ────────────────────

/**
 * Generate embeddings for all products and save to data/embeddings.json.
 * Each product is embedded as "PRODUCTO MARCA" (e.g. "Cremoso CAÑADA NEGRA").
 */
export async function generateProductEmbeddings(products: Product[]): Promise<void> {
  console.log(`[embeddingService] Generando embeddings para ${products.length} productos...`);

  const texts = products.map(p => `${p.producto} ${p.marca}`.trim());
  const vectors = await embedBatch(texts);

  const embeddings: ProductEmbedding[] = products.map((p, i) => ({
    cod: p.cod,
    text: texts[i],
    vector: vectors[i],
  }));

  // Save to file
  const dir = path.dirname(EMBEDDINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(EMBEDDINGS_FILE, JSON.stringify(embeddings));
  console.log(`[embeddingService] Embeddings guardados en ${EMBEDDINGS_FILE} (${embeddings.length} productos)`);

  embeddingsCache = embeddings;
}

// ─── Load cached embeddings ──────────────────────────────────

/**
 * Load embeddings from the JSON cache file.
 * Returns true if loaded, false if file doesn't exist.
 */
export function loadEmbeddings(): boolean {
  try {
    if (!fs.existsSync(EMBEDDINGS_FILE)) {
      console.warn('[embeddingService] No se encontró embeddings.json. Corré: npx ts-node scripts/generateEmbeddings.ts');
      return false;
    }

    const raw = fs.readFileSync(EMBEDDINGS_FILE, 'utf-8');
    embeddingsCache = JSON.parse(raw) as ProductEmbedding[];
    console.log(`[embeddingService] ${embeddingsCache.length} embeddings cargados desde cache.`);
    return true;
  } catch (error) {
    console.error('[embeddingService] Error cargando embeddings:', error);
    return false;
  }
}

export function getEmbeddings(): ProductEmbedding[] {
  return embeddingsCache;
}

export function hasEmbeddings(): boolean {
  return embeddingsCache.length > 0;
}

// ─── Cosine similarity ──────────────────────────────────────

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ─── Semantic search ─────────────────────────────────────────

export type SemanticMatch = {
  cod: number;
  text: string;
  similarity: number;       // 0.0 to 1.0
  similarityPercent: number; // 0 to 100
};

/**
 * Find the best semantic matches for a user query.
 * Returns the top N matches sorted by similarity (highest first).
 *
 * @param queryVector - The embedding vector of the user's search text
 * @param topN - Number of top matches to return (default: 3)
 */
export function findBestMatches(queryVector: number[], topN = 3): SemanticMatch[] {
  if (embeddingsCache.length === 0) return [];

  const scored = embeddingsCache.map(emb => {
    const sim = cosineSimilarity(queryVector, emb.vector);
    return {
      cod: emb.cod,
      text: emb.text,
      similarity: sim,
      similarityPercent: Math.round(sim * 100),
    };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}

/**
 * Full semantic search: embed the user query and find matches.
 */
export async function semanticSearch(
  queryText: string,
  topN = 3,
): Promise<SemanticMatch[]> {
  if (!genAI || embeddingsCache.length === 0) {
    return [];
  }

  const queryVector = await embedText(queryText);
  return findBestMatches(queryVector, topN);
}

export function isSemanticReady(): boolean {
  return genAI !== null && embeddingsCache.length > 0;
}
