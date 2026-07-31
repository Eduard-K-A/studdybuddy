/**
 * Context construction — turning the learner's raw pasted material into the
 * bounded excerpt the agent actually sees.
 *
 * This is the part of Path B that earns its keep. Delegating retrieval to a
 * dataset pipeline hides this step; doing it by hand means owning the budget,
 * the truncation boundary, and the honesty of telling the learner when their
 * material did not fit.
 */

import type { Material } from "./types";

/** Roughly 4 characters per token; ~3000 tokens of material leaves plenty of
 *  room for the system prompt, the question, and the answer in a typical
 *  context window. Callers may override. */
export const DEFAULT_BUDGET_CHARS = 12_000;

export interface QuizContext {
  readonly title: string;
  /** The excerpt actually sent to the agent. */
  readonly excerpt: string;
  /** True when `excerpt` is a prefix of the material rather than all of it. */
  readonly truncated: boolean;
  /** Characters of normalised material that did not fit. */
  readonly omittedChars: number;
}

/** Collapse runs of whitespace but keep paragraph breaks — they carry structure
 *  the agent can cite ("¶3"). */
export function normaliseMaterial(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut `text` to at most `budget` characters, preferring a clean boundary.
 *
 * Order of preference: end of a sentence, then end of a paragraph, then end of
 * a word. Cutting mid-sentence hands the agent a fragment it may quote back at
 * the learner as if it were whole, so the boundary matters more than squeezing
 * in the last few characters.
 */
export function truncateAtBoundary(text: string, budget: number): string {
  if (budget <= 0) return "";
  if (text.length <= budget) return text;

  const window = text.slice(0, budget);

  // Prefer the last sentence terminator that is followed by whitespace, so
  // "Fig. 2" and "p. 214" do not read as sentence ends.
  const sentence = window.search(/[.!?]["')\]]?\s(?![\s\S]*[.!?]["')\]]?\s)/);
  if (sentence > 0) {
    const end = window.indexOf(" ", sentence);
    return window.slice(0, end === -1 ? sentence + 1 : end).trimEnd();
  }

  const paragraph = window.lastIndexOf("\n");
  if (paragraph > 0) return window.slice(0, paragraph).trimEnd();

  const word = window.lastIndexOf(" ");
  if (word > 0) return window.slice(0, word).trimEnd();

  // A single unbroken token longer than the budget — hard cut is the only option.
  return window;
}

/** Build the bounded context for one material. */
export function buildQuizContext(
  material: Material,
  budget: number = DEFAULT_BUDGET_CHARS,
): QuizContext {
  const normalised = normaliseMaterial(material.body);
  const excerpt = truncateAtBoundary(normalised, budget);

  return {
    title: material.title.trim() || "Untitled material",
    excerpt,
    truncated: excerpt.length < normalised.length,
    omittedChars: normalised.length - excerpt.length,
  };
}

/** Enough material to ask a question about at all. Below this the empty state
 *  should keep inviting rather than pretending to quiz. */
export const MIN_USABLE_CHARS = 200;

export function isUsableMaterial(material: Material | null): boolean {
  if (!material) return false;
  return normaliseMaterial(material.body).length >= MIN_USABLE_CHARS;
}
