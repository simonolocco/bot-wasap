import { normalizeText } from '../botMenu';

export type IntentExample = { id: string; label: string | null; examples: string[] };

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function tokenSimilarity(a: string, b: string) {
  if (a === b) return 1;
  // Very short words produce too many false positives when fuzzy matched.
  if (a.length < 4 || b.length < 4) return 0;
  // Spanish verb conjugations often differ only after the stem ("venden" /
  // "vendemos"). Treat a shared four-character stem as a useful signal while
  // keeping short/common words out of the fuzzy path.
  if (a.length >= 6 && b.length >= 6 && a.slice(0, 4) === b.slice(0, 4)) return 0.75;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function tokenScore(queryTokens: string[], exampleTokens: string[]) {
  if (!queryTokens.length || !exampleTokens.length) return 0;
  const matches = queryTokens.map(token => {
    const best = Math.max(...exampleTokens.map(example => tokenSimilarity(token, example)));
    return best;
  });
  const exactCount = queryTokens.filter(token => exampleTokens.includes(token)).length;
  const significantMatches = matches.filter(score => score >= 0.68).length;
  const queryCoverage = significantMatches / queryTokens.length;
  const exactCoverage = exactCount / queryTokens.length;
  // Queries often contain extra context ("hacen envios a ..."). Keep the
  // intent if their meaningful words still match the saved example.
  const score = queryCoverage * 0.68 + exactCoverage * 0.22 + (significantMatches > 0 ? 0.1 : 0);
  return score;
}

/**
 * Finds the closest saved intent for a message. Exact aliases are handled by
 * the repository before this function; this score is intentionally strict so
 * an approximate typo cannot hijack an unrelated answer.
 */
export function matchIntent<T extends IntentExample>(message: string, intents: T[], minimumScore = 0.72) {
  const normalized = normalizeText(message);
  if (!normalized || !intents.length) return null;
  const queryTokens = normalized.split(' ').filter(Boolean);
  const bestByIntent: Array<{ intent: T; score: number; example: string }> = [];
  for (const intent of intents) {
    let bestForIntent: { intent: T; score: number; example: string } | null = null;
    for (const rawExample of intent.examples) {
      const example = normalizeText(rawExample);
      if (!example) continue;
      const score = tokenScore(queryTokens, example.split(' ').filter(Boolean));
      if (!bestForIntent || score > bestForIntent.score) bestForIntent = { intent, score, example: rawExample };
    }
    if (bestForIntent) bestByIntent.push(bestForIntent);
  }
  bestByIntent.sort((a, b) => b.score - a.score);
  const best = bestByIntent[0];
  if (!best || best.score < minimumScore) return null;
  const runnerUp = bestByIntent[1];
  // A near tie is not safe enough to answer a customer. Keep it in the
  // learning queue so an operator can choose the intended label.
  if (runnerUp && runnerUp.score >= minimumScore && best.score - runnerUp.score < 0.08) return null;
  return best;
}

export function intentExampleScore(message: string, example: string) {
  const result = matchIntent(message, [{ id: 'example', label: null, examples: [example] }], 0);
  return result?.score ?? 0;
}
