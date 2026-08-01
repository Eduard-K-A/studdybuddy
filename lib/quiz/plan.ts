/**
 * Session policy: how long a quiz runs, and which format each question takes.
 *
 * Separate from types.ts because these are *rules*, not shapes — they are the
 * decisions a reviewer should be able to find in one place and argue with. Pure
 * and dependency-free, so the route handler and the browser can both enforce
 * them and cannot disagree about the answer.
 */

import type { AnswerOption, QuestionFormat, QuizFormat, QuizPlan } from "./types";
import { DEFAULT_PLAN } from "./types";

/** Every format the learner may pick, in the order the form offers them. */
export const QUIZ_FORMATS: readonly QuizFormat[] = [
  "multiple-choice",
  "true-false",
  "short-answer",
  "essay",
  "mixed",
];

/** Lengths the form offers. Not a free number field: an arbitrary count invites
 *  "200" and a session nobody finishes, and the useful range here is narrow. */
export const QUIZ_LENGTHS: readonly number[] = [5, 10, 15];

/** Hard bounds, enforced server-side regardless of what the client sends. */
export const MIN_LENGTH = 3;
export const MAX_LENGTH = 20;

/**
 * Roughly how much material one good question needs.
 *
 * The agent sees a bounded excerpt (12,000 characters), so questions are drawn
 * from a finite pool of ideas. Asking fifteen questions about two paragraphs
 * does not produce fifteen questions — it produces the same three, reworded,
 * which reads as the agent malfunctioning. Capping the offer is more honest
 * than letting the session degrade in a way the learner has to diagnose.
 */
export const CHARS_PER_QUESTION = 400;

/**
 * The most questions this material can carry.
 *
 * Clamped to MIN_LENGTH at the bottom so a session is always startable — the
 * empty state already refuses material below MIN_USABLE_CHARS, so anything
 * that reaches here deserves at least a short run.
 */
export function maxQuestionsFor(materialChars: number): number {
  const supported = Math.floor(materialChars / CHARS_PER_QUESTION);
  return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, supported));
}

/** The lengths worth offering for this material — never an empty list. */
export function offeredLengths(materialChars: number): readonly number[] {
  const max = maxQuestionsFor(materialChars);
  const offered = QUIZ_LENGTHS.filter((n) => n <= max);
  return offered.length > 0 ? offered : [MIN_LENGTH];
}

function isQuizFormat(value: unknown): value is QuizFormat {
  return typeof value === "string" && (QUIZ_FORMATS as readonly string[]).includes(value);
}

/**
 * Coerce whatever the client sent into a plan we are willing to run.
 *
 * The length arrives from the browser, so it is not trusted: a hand-rolled
 * request could ask for 10,000 questions and every one of them costs an agent
 * call. Clamping here rather than validating-and-rejecting keeps a slightly
 * wrong request working instead of failing the learner's session over it.
 */
export function normalisePlan(value: unknown, materialChars: number): QuizPlan {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  const format = isQuizFormat(raw.format) ? raw.format : DEFAULT_PLAN.format;

  const requested =
    typeof raw.length === "number" && Number.isFinite(raw.length)
      ? Math.round(raw.length)
      : DEFAULT_PLAN.length;

  const length = Math.max(
    MIN_LENGTH,
    Math.min(maxQuestionsFor(materialChars), requested),
  );

  return { format, length };
}

/**
 * The formats `mixed` rotates through.
 *
 * Essay is deliberately absent. Mixed exists to keep a drill varied and quick;
 * a five-paragraph question landing between two true/false items breaks the
 * rhythm that makes the drill worth doing. Someone who wants essays picks
 * essays.
 */
export const MIXED_ROTATION: readonly QuestionFormat[] = [
  "multiple-choice",
  "true-false",
  "short-answer",
];

/**
 * Which format question number `index` (0-based) takes.
 *
 * Rotation rather than randomness: the learner can see the pattern, the E2E
 * suite can assert on it, and two runs of the same plan are comparable.
 */
export function formatFor(plan: QuizPlan, index: number): QuestionFormat {
  if (plan.format !== "mixed") return plan.format;
  const safe = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return MIXED_ROTATION[safe % MIXED_ROTATION.length];
}

/** The two options every true/false question uses. Synthesised rather than
 *  parsed — the agent is asked for a statement, not for a list it could word
 *  inconsistently ("T"/"F", "Yes"/"No"). */
export const TRUE_FALSE_OPTIONS: readonly AnswerOption[] = [
  { id: "true", text: "True" },
  { id: "false", text: "False" },
];

/** Option ids for multiple choice, assigned by position. */
export const CHOICE_IDS: readonly string[] = ["a", "b", "c", "d", "e", "f"];

/** How many options a multiple-choice question may carry. Four is the ask;
 *  the range tolerates a model that returns three or five. */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 6;

export interface FormatDescription {
  readonly label: string;
  readonly hint: string;
}

/** Copy for the format picker. Kept beside the rules so a new format cannot be
 *  added without someone deciding how to describe it. */
export const FORMAT_DESCRIPTIONS: Record<QuizFormat, FormatDescription> = {
  "multiple-choice": {
    label: "Multiple choice",
    hint: "Four options, one right. Quick to answer.",
  },
  "true-false": {
    label: "True or false",
    hint: "One statement at a time. Fastest way through a chapter.",
  },
  "short-answer": {
    label: "Short answer",
    hint: "Two or three sentences, in your own words.",
  },
  essay: {
    label: "Essay",
    hint: "A developed paragraph connecting more than one idea.",
  },
  mixed: {
    label: "Mixed",
    hint: "Rotates through choice, true/false and short answer.",
  },
};
