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
  readonly sourceRef?: SourceRef;
}

export interface Evaluation {
  readonly questionId: string;
  readonly verdict: Verdict;
  /** Why it was right or wrong. Appears in the margin rail. */
  readonly explanation: string;
  readonly sourceRef?: SourceRef;
}

/** Running state for one study session. Immutable — every transition returns a
 *  new object, so RTK/React see a changed reference and re-render predictably. */
export interface QuizState {
  readonly material: Material | null;
  readonly current: Question | null;
  readonly evaluations: readonly Evaluation[];
  readonly asked: number;
}

export const emptyQuizState: QuizState = {
  material: null,
  current: null,
  evaluations: [],
  asked: 0,
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
