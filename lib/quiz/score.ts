/**
 * Score accumulation.
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
 * drift from what they actually answered.
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

/** Present a new question. Increments the asked counter only for questions we
 *  have not already shown. */
export function presentQuestion(
  state: QuizState,
  question: Question,
): QuizState {
  const seen =
    state.current?.id === question.id ||
    state.evaluations.some((e) => e.questionId === question.id);

  return {
    ...state,
    current: question,
    asked: seen ? state.asked : state.asked + 1,
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
