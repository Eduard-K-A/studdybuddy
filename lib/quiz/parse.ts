/**
 * Parsing the agent's replies into typed domain objects.
 *
 * The agent is asked for JSON, but a language model is not a JSON API: it
 * fences its output, prefaces it with "Sure!", or drops the schema entirely
 * under an unusual prompt. Every one of those is recoverable, and recovering
 * beats showing the learner a parse error mid-session — so the fallbacks here
 * are deliberate, not defensive clutter.
 */

import type { Evaluation, Question, SourceRef, Verdict } from "./types";

const VERDICTS: readonly Verdict[] = ["correct", "partial", "revisit"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * Pull a JSON object out of a model reply.
 *
 * Handles a ```json fence, a bare fence, raw JSON, and JSON preceded by prose.
 * Returns undefined rather than throwing — callers decide the fallback.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];

  if (fenced?.[1]) candidates.push(fenced[1]);

  // First balanced-looking object in the text, for replies wrapped in prose.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1));

  candidates.push(raw);

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

function parseSourceRef(value: unknown): SourceRef | undefined {
  if (typeof value === "string") {
    const locator = asString(value);
    return locator ? { locator } : undefined;
  }
  if (!isRecord(value)) return undefined;

  const locator =
    asString(value.locator) ?? asString(value.source) ?? asString(value.page);
  if (!locator) return undefined;

  const quote = asString(value.quote) ?? asString(value.passage);
  return quote ? { locator, quote } : { locator };
}

export function coerceVerdict(value: unknown): Verdict {
  const raw = asString(value)?.toLowerCase();
  if (raw && (VERDICTS as readonly string[]).includes(raw)) return raw as Verdict;

  // Common synonyms the model reaches for when it ignores the schema.
  if (raw === "right" || raw === "true" || raw === "yes") return "correct";
  if (raw === "partially" || raw === "close" || raw === "almost") return "partial";

  // Unknown means "look at it again", never "correct" — grading generously on a
  // parse failure would quietly lie to the learner about what they know.
  return "revisit";
}

/**
 * Parse a question. Falls back to treating the whole reply as the prompt, which
 * is nearly always the right reading when the model skips the schema.
 */
export function parseQuestion(raw: string, id: string): Question | null {
  const text = raw.trim();
  if (!text) return null;

  const json = extractJsonObject(text);
  if (json) {
    const prompt =
      asString(json.question) ?? asString(json.prompt) ?? asString(json.text);
    if (prompt) {
      const sourceRef = parseSourceRef(json.sourceRef ?? json.source);
      return sourceRef ? { id, prompt, sourceRef } : { id, prompt };
    }
  }

  return { id, prompt: text };
}

/**
 * Parse an evaluation. Unlike a question this has no safe prose fallback — a
 * verdict must be explicit — so an unparseable reply becomes `revisit` with the
 * raw text as the explanation rather than a fabricated result.
 */
export function parseEvaluation(raw: string, questionId: string): Evaluation | null {
  const text = raw.trim();
  if (!text) return null;

  const json = extractJsonObject(text);
  if (json) {
    const explanation =
      asString(json.explanation) ??
      asString(json.feedback) ??
      asString(json.reason);

    if (explanation) {
      const sourceRef = parseSourceRef(json.sourceRef ?? json.source);
      const verdict = coerceVerdict(json.verdict ?? json.result);
      return sourceRef
        ? { questionId, verdict, explanation, sourceRef }
        : { questionId, verdict, explanation };
    }
  }

  return { questionId, verdict: "revisit", explanation: text };
}
