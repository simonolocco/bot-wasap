import 'dotenv/config';
import { closePool } from './db/pool';
import { runAiPreviewBackfill } from './services/aiPreviewProcessor';

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const force = process.argv.includes('--force');
  const limit = positiveInteger(process.env.AI_PREVIEW_BACKFILL_LIMIT, 1000);
  const concurrency = positiveInteger(process.env.AI_PREVIEW_BACKFILL_CONCURRENCY, 2);
  const totals = { selected: 0, processed: 0, skipped: 0, failed: 0, outcomes: {} as Record<string, number> };
  let after: { createdAt: string; id: string } | null = null;

  while (true) {
    const result = await runAiPreviewBackfill({ force, limit, concurrency, after });
    totals.selected += result.selected;
    totals.processed += result.processed;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    for (const [outcome, count] of Object.entries(result.outcomes)) {
      totals.outcomes[outcome] = (totals.outcomes[outcome] ?? 0) + count;
    }
    if (result.selected < limit || !result.nextCursor) break;
    after = result.nextCursor;
  }

  console.log(`[ai-preview] Reprocesadas ${totals.processed}/${totals.selected}; omitidas ${totals.skipped}; fallidas ${totals.failed}.`);
  console.log(`[ai-preview] Resultados: ${JSON.stringify(totals.outcomes)}`);
  if (totals.failed > 0) process.exitCode = 1;
}

main()
  .catch(error => { console.error('[ai-preview] El reprocesamiento no pudo completarse:', error); process.exitCode = 1; })
  .finally(async () => { await closePool(); });
