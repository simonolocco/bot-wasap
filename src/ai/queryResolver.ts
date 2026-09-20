import type { Catalog } from './catalog';
import type { Complete } from './openRouter';
import { answerQuestion, type Answer, type Turn } from './assistant';
import { renderSavedAnswer } from './answerTemplate';
import {
  classifyQuestionLabel,
  type AiLabelCandidate,
  type AiLabelClassification,
} from './labelClassifier';
import { AI_UNCLEAR_LABEL_NAME, normalizeAiTopic } from './labelPolicy';

export type ResolvableSavedRule = {
  id: string;
  answer: string;
  label?: string | null;
  labelId?: string | null;
  labelAnswer?: string | null;
};

export type CustomerAiResolution = {
  source: 'saved-rule' | 'approved-label' | 'generated' | 'disabled';
  answer: Answer | null;
  sendMenuAfter: boolean;
  classification: AiLabelClassification;
  matchedRuleId: string | null;
  matchedLabel: AiLabelCandidate | null;
};

function savedAnswer(template: string, source: string): Answer & { sendMenuAfter: boolean } {
  const rendered = renderSavedAnswer(template);
  return {
    ...rendered,
    outcome: 'answered',
    sources: [source],
    products: [],
    model: 'respuesta aprobada',
    tokens: 0,
    elapsedMs: 0,
  };
}

function shouldSendMenu(answer: Answer | null) {
  return Boolean(answer?.text.trim());
}

/**
 * The one customer-response pipeline used by both the WhatsApp worker and the
 * admin tester. Learning metadata may observe its result, but can never gate it.
 */
export async function resolveCustomerAiResponse(input: {
  question: string;
  history?: Turn[];
  catalog: Catalog;
  complete: Complete;
  /** Customer-facing master switch. Private previews call this with true. */
  allowCustomerResponse: boolean;
  savedRule?: ResolvableSavedRule | null;
  labels?: AiLabelCandidate[];
}): Promise<CustomerAiResolution> {
  const labels = (input.labels ?? []).filter(label => normalizeAiTopic(label.name) !== AI_UNCLEAR_LABEL_NAME);
  const savedRule = input.savedRule
    && normalizeAiTopic(input.savedRule.label) !== AI_UNCLEAR_LABEL_NAME
    ? input.savedRule
    : null;

  const classification = savedRule
    ? {
        existingLabelId: savedRule.labelId ?? null,
        suggestedName: savedRule.label ?? null,
        confidence: 1,
        method: 'exact' as const,
      }
    : await classifyQuestionLabel(input.question, labels);
  const matchedLabel = classification.existingLabelId
    ? labels.find(label => label.id === classification.existingLabelId) ?? null
    : null;

  // The production switch governs every AI-assisted customer response,
  // including deterministic rules and approved labels. The separate preview
  // worker still calls this resolver with responses enabled so the admin can
  // prepare knowledge while customer-facing AI is off.
  if (!input.allowCustomerResponse) {
    return {
      source: 'disabled',
      answer: null,
      sendMenuAfter: false,
      classification,
      matchedRuleId: savedRule?.id ?? null,
      matchedLabel,
    };
  }

  if (savedRule) {
    const answer = savedAnswer(savedRule.labelAnswer ?? savedRule.answer, 'Respuesta aprobada por el equipo');
    return {
      source: 'saved-rule',
      answer,
      sendMenuAfter: shouldSendMenu(answer),
      classification,
      matchedRuleId: savedRule.id,
      matchedLabel,
    };
  }

  // This first pass is deterministic. It cheaply reuses approved knowledge;
  // an unmatched question is answered by the assistant instead of making a
  // second provider call just to invent a label.
  if (matchedLabel?.answer.trim()) {
    const answer = savedAnswer(matchedLabel.answer, `Etiqueta aprobada: ${matchedLabel.name}`);
    return {
      source: 'approved-label',
      answer,
      sendMenuAfter: shouldSendMenu(answer),
      classification,
      matchedRuleId: null,
      matchedLabel,
    };
  }

  const answer = await answerQuestion(
    { message: input.question, history: input.history ?? [] },
    input.catalog,
    input.complete,
  );
  return {
    source: 'generated',
    answer,
    sendMenuAfter: shouldSendMenu(answer),
    classification,
    matchedRuleId: null,
    matchedLabel: null,
  };
}
