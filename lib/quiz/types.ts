/**
 * StudyBuddy quiz domain types.
 *
 * Deliberately transport-agnostic: nothing here knows whether the agent is
 * reached over HTTP, WebSocket, or a mock. That keeps the whole module unit
 * testable without a network, and lets the transport be settled last.
 */

/** How confident the agent is that the learner got it. Three states, not two —
 *  formative assessment needs room for "nearly". */
export type Verdict = "correct" | "partial" | "revisit";

/**
 * What the learner picked when they set the session up.
 *
 * `mixed` is a *plan* format only. It never reaches a question — `formatFor`
 * in plan.ts resolves it to one of the others before the agent is asked, so
 * everything downstream deals in a single concrete format.
 */
export type QuizFormat =
  | "multiple-choice"
  | "true-false"
  | "short-answer"
  | "essay"
  | "mixed";

/** The format of a question that actually got asked. */
export type QuestionFormat = Exclude<QuizFormat, "mixed">;

/** True when the learner picks from a list rather than writing prose. */
export function isChoiceFormat(format: QuestionFormat): boolean {
  return format === "multiple-choice" || format === "true-false";
}

/**
 * One selectable answer.
 *
 * `id` is a stable short token ("a", "b", "true", "false") so the radio input,
 * the evaluation prompt and the agent's reply can all refer to the same option
 * without depending on its wording surviving a round trip intact.
 */
export interface AnswerOption {
  readonly id: string;
  readonly text: string;
}

/** A pointer back into the learner's own material. Always rendered in mono, in
 *  the margin rail, never inline with the question. */
export interface SourceRef {
  /** Free-form locator as the agent cites it, e.g. "p. 214, ¶3" or "§2.1". */
  readonly locator: string;
  /** The quoted passage the claim rests on, when the agent supplies one. */
  readonly quote?: string;
}

/** Material the learner supplied. Path B (paste) produces one of these
 *  directly; a future dataset-backed path would produce the same shape. */
export interface Material {
  readonly title: string;
  readonly body: string;
}

export interface Question {
  readonly id: string;
  /** Set in Source Serif — this is *the source* speaking. */
  readonly prompt: string;
  readonly format: QuestionFormat;
  /**
   * Present for multiple-choice and true-false, absent for written answers.
   *
   * Note what is NOT here: which option is correct. The answer key is never
   * sent to the browser — grading happens on the evaluate turn, server-side,
   * against the same material. See lib/quiz/prompt.ts.
   */
  readonly options?: readonly AnswerOption[];
  readonly sourceRef?: SourceRef;
}

export interface Evaluation {
  readonly questionId: string;
  readonly verdict: Verdict;
  /** Why it was right or wrong. Appears in the margin rail. */
  readonly explanation: string;
  readonly sourceRef?: SourceRef;
}

/**
 * How the learner configured this session.
 *
 * Fixed once the session starts. Changing the format or the length mid-run
 * would make the score describe two different exercises, so the UI only offers
 * it on the empty state and `materialSet` resets everything.
 */
export interface QuizPlan {
  readonly format: QuizFormat;
  /** How many questions this session runs for. Finite by construction. */
  readonly length: number;
}

/** The plan a session starts with if the learner changes nothing.
 *
 *  Short answer rather than multiple choice: the brief is a student revising
 *  dense material, and recalling something unaided is the exercise that
 *  actually shows whether they understood it. Ten is long enough to be worth
 *  starting and short enough to finish in one sitting. */
export const DEFAULT_PLAN: QuizPlan = {
  format: "short-answer",
  length: 10,
};

/** Running state for one study session. Immutable — every transition returns a
 *  new object, so RTK/React see a changed reference and re-render predictably. */
export interface QuizState {
  readonly material: Material | null;
  readonly plan: QuizPlan;
  readonly current: Question | null;
  /**
   * Every question presented this session, in the order asked.
   *
   * Serves three purposes at once: the progress counter, the review list on the
   * summary, and the "don't ask this again" list sent to the agent. That last
   * one is why it holds whole questions rather than a count — the agent needs
   * the prompt text to avoid repeating itself.
   */
  readonly history: readonly Question[];
  readonly evaluations: readonly Evaluation[];
}

export const emptyQuizState: QuizState = {
  material: null,
  plan: DEFAULT_PLAN,
  current: null,
  history: [],
  evaluations: [],
};

/** What the margin rail renders as the running score. */
export interface Score {
  readonly correct: number;
  readonly partial: number;
  readonly revisit: number;
  readonly answered: number;
  /** 0–1. `partial` counts half — it is progress, not failure. */
  readonly ratio: number;
}
