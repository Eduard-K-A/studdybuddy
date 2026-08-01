/**
 * Score accumulation and session progress.
 *
 * Kept separate from the transport and the UI so a session's arithmetic can be
 * tested directly. Everything here is pure and returns new objects — the score
 * must survive re-renders without a `useRef` holding mutable state.
 */

import type { Evaluation, QuizState, Question, Score, Verdict } from "./types";

/** A partial answer is progress, not failure, so it earns half. Ochre and rose
 *  in the UI carry the same three-way distinction. */
const WEIGHT: Record<Verdict, number> = {
  correct: 1,
  partial: 0.5,
  revisit: 0,
};

export function computeScore(evaluations: readonly Evaluation[]): Score {
  let correct = 0;
  let partial = 0;
  let revisit = 0;
  let earned = 0;

  for (const evaluation of evaluations) {
    if (evaluation.verdict === "correct") correct += 1;
    else if (evaluation.verdict === "partial") partial += 1;
    else revisit += 1;
    earned += WEIGHT[evaluation.verdict];
  }

  const answered = evaluations.length;

  return {
    correct,
    partial,
    revisit,
    answered,
    ratio: answered === 0 ? 0 : earned / answered,
  };
}

/**
 * Record an evaluation against the session.
 *
 * Re-evaluating a question REPLACES the earlier verdict rather than appending.
 * Without this an agent retry, a double-submit, or a React strict-mode double
 * invoke would silently inflate the denominator and the learner's score would
 * drift from what they actually answered. It is also what keeps `isComplete`
 * honest — the session ends after N distinct answers, not N submissions.
 */
export function applyEvaluation(
  state: QuizState,
  evaluation: Evaluation,
): QuizState {
  const existing = state.evaluations.findIndex(
    (e) => e.questionId === evaluation.questionId,
  );

  const evaluations =
    existing === -1
      ? [...state.evaluations, evaluation]
      : state.evaluations.map((e, i) => (i === existing ? evaluation : e));

  return { ...state, evaluations };
}

/**
 * Present a new question.
 *
 * Appends to `history` only for questions not already seen, so re-presenting
 * the current one cannot advance the progress counter past the planned length.
 */
export function presentQuestion(
  state: QuizState,
  question: Question,
): QuizState {
  const seen = state.history.some((q) => q.id === question.id);

  return {
    ...state,
    current: question,
    history: seen ? state.history : [...state.history, question],
  };
}

/** The evaluation for a given question, if it has been answered. */
export function evaluationFor(
  state: QuizState,
  questionId: string | undefined,
): Evaluation | undefined {
  if (!questionId) return undefined;
  return state.evaluations.find((e) => e.questionId === questionId);
}

/**
 * Has the session run its length?
 *
 * Counted in *answers*, not in questions presented: a question on screen and
 * unanswered is not progress, and ending the quiz on the last question before
 * the learner has answered it would discard their final response.
 */
export function isComplete(state: QuizState): boolean {
  return state.evaluations.length >= state.plan.length;
}

/** How many questions are left to answer. Never negative. */
export function remaining(state: QuizState): number {
  return Math.max(0, state.plan.length - state.evaluations.length);
}

/**
 * The 1-based number of the question on screen, for "question 3 of 10".
 *
 * Derived from history rather than stored, so it cannot drift from the list the
 * summary renders.
 */
export function questionNumber(state: QuizState): number {
  return Math.min(state.history.length, state.plan.length);
}

/** The questions asked so far, as text — what the agent is told not to repeat.
 *
 *  This has to be the prompts themselves. It was question *ids* at one point,
 *  which meant the agent was handed a list of UUIDs and asked not to repeat
 *  them; the offline agent only reads the array's length, so nothing failed
 *  visibly and the live agent simply kept asking the same thing. */
export function askedQuestions(state: QuizState): readonly string[] {
  return state.history.map((q) => q.prompt);
}
