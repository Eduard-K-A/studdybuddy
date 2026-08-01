/**
 * Parsing the agent's replies into typed domain objects.
 *
 * The agent is asked for JSON, but a language model is not a JSON API: it
 * fences its output, prefaces it with "Sure!", or drops the schema entirely
 * under an unusual prompt. Every one of those is recoverable, and recovering
 * beats showing the learner a parse error mid-session — so the fallbacks here
 * are deliberate, not defensive clutter.
 */

import {
  CHOICE_IDS,
  MAX_CHOICES,
  MIN_CHOICES,
  TRUE_FALSE_OPTIONS,
} from "./plan";
import type {
  AnswerOption,
  Evaluation,
  QuestionFormat,
  Question,
  SourceRef,
  Verdict,
} from "./types";
import { isChoiceFormat } from "./types";

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

/**
 * Strip an enumeration label the model added of its own accord.
 *
 * Asked for a JSON array, models still routinely return ["A) the nucleophile",
 * "B) the leaving group"]. Rendering that in a radio group gives every option
 * two labels — the model's letter and the input's own — which read out
 * differently to a screen reader. The delimiter is required, so a legitimate
 * option beginning "A nucleophile attacks…" is left alone.
 */
export function stripOptionLabel(text: string): string {
  return text.replace(/^\s*(?:\(?[A-Fa-f]\)|[A-Fa-f][).:]|\d{1,2}[).:])\s+/, "").trim();
}

/** Normalise whatever the model called an option into text. */
function optionText(value: unknown): string | undefined {
  if (typeof value === "string") return asString(stripOptionLabel(value));
  if (!isRecord(value)) return undefined;

  const raw =
    asString(value.text) ?? asString(value.option) ?? asString(value.label);
  return raw ? asString(stripOptionLabel(raw)) : undefined;
}

/**
 * Parse the option list for a choice question.
 *
 * Deduplicates case-insensitively: a model that repeats an option turns a
 * four-way question into a three-way one with a guaranteed-wrong duplicate,
 * which is worse than simply offering three.
 */
export function parseOptions(value: unknown): readonly AnswerOption[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const texts: string[] = [];

  for (const entry of value) {
    const text = optionText(entry);
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    texts.push(text);
    if (texts.length === MAX_CHOICES) break;
  }

  return texts.map((text, i) => ({ id: CHOICE_IDS[i] ?? String(i), text }));
}

/**
 * Parse a question.
 *
 * Two fallbacks, both deliberate:
 *
 *   - No parseable JSON at all → treat the whole reply as the prompt, which is
 *     nearly always the right reading when the model skips the schema.
 *   - Multiple choice with too few usable options → ask it as a written
 *     question instead of showing a one-option radio group. The learner still
 *     gets a real question about their material, and the UI renders what the
 *     question actually IS rather than what was ordered.
 */
export function parseQuestion(
  raw: string,
  id: string,
  format: QuestionFormat = "short-answer",
): Question | null {
  const text = raw.trim();
  if (!text) return null;

  const json = extractJsonObject(text);

  const prompt =
    (json &&
      (asString(json.question) ?? asString(json.prompt) ?? asString(json.text))) ||
    text;

  const sourceRef = json ? parseSourceRef(json.sourceRef ?? json.source) : undefined;

  // True/false options are synthesised, never parsed — the agent is asked for a
  // statement, not for a list it could word inconsistently ("T"/"F", "Yes"/"No").
  if (format === "true-false") {
    return withRef({ id, prompt, format, options: TRUE_FALSE_OPTIONS }, sourceRef);
  }

  if (format === "multiple-choice") {
    const options = json ? parseOptions(json.options ?? json.choices ?? json.answers) : [];
    if (options.length >= MIN_CHOICES) {
      return withRef({ id, prompt, format, options }, sourceRef);
    }
    return withRef({ id, prompt, format: "short-answer" }, sourceRef);
  }

  return withRef({ id, prompt, format }, sourceRef);
}

/**
 * Attach a source ref only when there is one, so the shape stays exact.
 *
 * For a choice question the quoted passage is dropped and only the locator
 * survives. The question object travels to the browser, and the agent is asked
 * to quote "the passage it rests on" — which, for multiple choice, is very
 * often the sentence one of the options was copied from. Shipping it would put
 * the answer key in the page for anyone who opened devtools. The locator
 * ("¶3") narrows where to look without settling which option is right, and the
 * full citation still appears in the margin rail once the answer is graded.
 */
function withRef(question: Question, sourceRef: SourceRef | undefined): Question {
  if (!sourceRef) return question;

  const safe = isChoiceFormat(question.format)
    ? { locator: sourceRef.locator }
    : sourceRef;

  return { ...question, sourceRef: safe };
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
