import { resolveJevCustomerResponse, type JevBudgetClaimFunction } from '../ai/jevResponse';
import type { JevClientOptions } from './jevSimulator';
import { deriveSuggestedAiTopic, learningConfidence } from '../ai/runtimePolicy';
import {
  claimAiQueryPreviewGeneration,
  completeJob,
  ensureAiAnswerLabelDraft,
  listAiQueryPreviewCandidates,
  loadActiveAiLabelExamples,
  retryJob,
  updateAiQueryPreview,
  type AiLabelMatchRow,
  type AiPreviewJob,
  type AiQueryPreviewCursor,
  type JevBudgetSubject,
} from '../db/repository';
import { canonicalAutoLabelAnswer } from '../ai/labelPolicy';

type PreviewDependencies = {
  labels: AiLabelMatchRow[];
  clientOptions?: JevClientOptions;
  budgetClaim?: JevBudgetClaimFunction;
};

async function loadDependencies(): Promise<PreviewDependencies> {
  return { labels: await loadActiveAiLabelExamples() };
}

export function previewBudgetSubject(contactId: string | null, override?: JevBudgetSubject): JevBudgetSubject {
  return override ?? (contactId
    ? { type: 'contact', key: contactId }
    : { type: 'system', key: 'ai-preview' });
}

export async function generateAndStoreAiQueryPreview(
  queryId: string,
  options: { force?: boolean; dependencies?: PreviewDependencies; budgetSubject?: JevBudgetSubject } = {},
) {
  const claim = await claimAiQueryPreviewGeneration(queryId, options.force);
  if (claim.status !== 'claimed') return { status: claim.status, item: null };
  const context = claim.context;

  const dependencies = options.dependencies ?? await loadDependencies();
  const resolution = await resolveJevCustomerResponse({
    question: context.question,
    history: context.history,
    labels: dependencies.labels,
    clientOptions: dependencies.clientOptions,
    budgetSubject: previewBudgetSubject(context.contactId, options.budgetSubject),
    budgetClaim: dependencies.budgetClaim,
  });
  if (!resolution.answer) throw new Error('La simulación de IA terminó sin una respuesta evaluable.');

  const answer = resolution.answer;
  const displayedAnswer = [answer.text, resolution.followUpText].filter(Boolean).join('\n\n');
  const classification = resolution.classification;
  const suggestedName = deriveSuggestedAiTopic(classification, answer);
  const confidence = learningConfidence(classification, answer);
  let suggestedLabelId = resolution.matchedLabel?.id ?? null;
  let suggestedLabelName = suggestedName ?? resolution.matchedLabel?.name ?? resolution.responseLabel;
  if (!suggestedLabelId && suggestedLabelName && confidence >= 0.8
    && answer.text.trim() && !['silence', 'unavailable'].includes(answer.outcome)) {
    const draftAnswer = canonicalAutoLabelAnswer(suggestedLabelName) || answer.text;
    const draftLabel = await ensureAiAnswerLabelDraft(suggestedLabelName, 'ai-auto-preview', draftAnswer, false);
    suggestedLabelId = draftLabel?.id ?? null;
    suggestedLabelName = draftLabel?.name ?? suggestedLabelName;
  }
  const item = await updateAiQueryPreview(queryId, {
    generationId: context.generationId,
    answer: displayedAnswer,
    outcome: answer.outcome,
    source: resolution.source,
    model: answer.model || null,
    tokens: answer.tokens,
    elapsedMs: answer.elapsedMs,
    errorCode: answer.errorCode ?? null,
    suggestedLabelId,
    suggestedLabelName,
    classificationMethod: classification.method,
    classificationConfidence: confidence,
    updateSuggestion: answer.outcome !== 'unavailable',
  });
  if (!item) return { status: 'superseded' as const, item: null };
  return { status: 'processed' as const, item };
}

export async function processAiPreviewJob(job: AiPreviewJob) {
  if (!job.ai_query_log_id) { await completeJob(job.id); return; }
  try {
    await generateAndStoreAiQueryPreview(job.ai_query_log_id);
    await completeJob(job.id);
  } catch (error) {
    await retryJob(job.id, job.attempts, error);
    console.error('[ai-preview] No se pudo preparar la vista previa:', error);
  }
}

export async function runAiPreviewBackfill(input: {
  force?: boolean;
  limit?: number;
  concurrency?: number;
  after?: AiQueryPreviewCursor | null;
} = {}) {
  const candidates = await listAiQueryPreviewCandidates({ force: input.force, limit: input.limit, after: input.after });
  const dependencies = await loadDependencies();
  const concurrency = Math.min(4, Math.max(1, input.concurrency ?? 2));
  let cursor = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const outcomes: Record<string, number> = {};

  async function lane() {
    while (cursor < candidates.length) {
      const { id } = candidates[cursor++];
      try {
        const result = await generateAndStoreAiQueryPreview(id, { force: input.force, dependencies });
        if (result.status === 'processed') {
          processed += 1;
          const outcome = result.item?.previewOutcome ?? 'unknown';
          outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(`[ai-preview] Falló la consulta ${id}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, candidates.length)) }, () => lane()));
  const last = candidates[candidates.length - 1];
  return {
    selected: candidates.length,
    processed,
    skipped,
    failed,
    outcomes,
    nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}
