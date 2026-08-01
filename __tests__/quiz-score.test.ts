import { describe, it, expect } from "vitest";
import {
  applyEvaluation,
  askedQuestions,
  computeScore,
  evaluationFor,
  isComplete,
  presentQuestion,
  questionNumber,
  remaining,
} from "@/lib/quiz/score";
import {
  emptyQuizState,
  type Evaluation,
  type Question,
  type QuizState,
  type Verdict,
} from "@/lib/quiz/types";

const evalFor = (questionId: string, verdict: Verdict): Evaluation => ({
  questionId,
  verdict,
  explanation: "because",
});

const question = (id: string, prompt = `Why ${id}?`): Question => ({
  id,
  prompt,
  format: "short-answer",
});

/** A state with a plan of `length`, so completion can be exercised directly. */
const planned = (length: number): QuizState => ({
  ...emptyQuizState,
  plan: { ...emptyQuizState.plan, length },
});

describe("computeScore", () => {
  it("is zero for an empty session without dividing by zero", () => {
    expect(computeScore([])).toEqual({
      correct: 0,
      partial: 0,
      revisit: 0,
      answered: 0,
      ratio: 0,
    });
  });

  it("counts a partial as half — progress, not failure", () => {
    const score = computeScore([
      evalFor("a", "correct"),
      evalFor("b", "partial"),
      evalFor("c", "revisit"),
    ]);
    expect(score).toMatchObject({ correct: 1, partial: 1, revisit: 1, answered: 3 });
    expect(score.ratio).toBeCloseTo(0.5); // (1 + 0.5 + 0) / 3
  });
});

describe("applyEvaluation", () => {
  it("appends a first evaluation", () => {
    const next = applyEvaluation(emptyQuizState, evalFor("a", "correct"));
    expect(next.evaluations).toHaveLength(1);
  });

  it("replaces rather than appends when a question is re-evaluated", () => {
    // A retry, a double-submit, or a strict-mode double invoke must not
    // inflate the denominator — the score has to match what was answered.
    const first = applyEvaluation(emptyQuizState, evalFor("a", "revisit"));
    const second = applyEvaluation(first, evalFor("a", "correct"));

    expect(second.evaluations).toHaveLength(1);
    expect(computeScore(second.evaluations)).toMatchObject({
      answered: 1,
      correct: 1,
      revisit: 0,
    });
  });

  it("does not mutate the previous state", () => {
    const next = applyEvaluation(emptyQuizState, evalFor("a", "correct"));
    expect(emptyQuizState.evaluations).toHaveLength(0);
    expect(next).not.toBe(emptyQuizState);
  });
});

describe("presentQuestion", () => {
  it("records a new question in history", () => {
    const next = presentQuestion(emptyQuizState, question("q1"));
    expect(next.history).toHaveLength(1);
    expect(next.current?.id).toBe("q1");
  });

  it("does not double-count re-presenting the current question", () => {
    const once = presentQuestion(emptyQuizState, question("q1"));
    const twice = presentQuestion(once, question("q1"));
    expect(twice.history).toHaveLength(1);
  });

  it("does not re-count a question that was already answered", () => {
    const asked = presentQuestion(emptyQuizState, question("q1"));
    const answered = applyEvaluation(asked, evalFor("q1", "correct"));
    const again = presentQuestion(answered, question("q1"));
    expect(again.history).toHaveLength(1);
  });
});

describe("evaluationFor", () => {
  it("finds the evaluation for a question and tolerates undefined", () => {
    const state = applyEvaluation(emptyQuizState, evalFor("q1", "partial"));
    expect(evaluationFor(state, "q1")?.verdict).toBe("partial");
    expect(evaluationFor(state, "nope")).toBeUndefined();
    expect(evaluationFor(state, undefined)).toBeUndefined();
  });
});

describe("isComplete", () => {
  it("is false while questions remain", () => {
    const state = applyEvaluation(planned(3), evalFor("q1", "correct"));
    expect(isComplete(state)).toBe(false);
    expect(remaining(state)).toBe(2);
  });

  it("counts answers, not questions presented", () => {
    // Presenting the last question must not end the quiz — doing so would
    // throw away the learner's final answer before they gave it.
    let state = planned(2);
    state = presentQuestion(state, question("q1"));
    state = presentQuestion(state, question("q2"));

    expect(isComplete(state)).toBe(false);
  });

  it("is true once the planned number of answers is in", () => {
    let state = planned(2);
    state = applyEvaluation(state, evalFor("q1", "correct"));
    state = applyEvaluation(state, evalFor("q2", "revisit"));

    expect(isComplete(state)).toBe(true);
    expect(remaining(state)).toBe(0);
  });

  it("is not reached early by re-answering the same question", () => {
    // The whole reason applyEvaluation replaces rather than appends: two
    // submissions of one question are one answer, so a double-submit must not
    // end a two-question quiz after the first.
    let state = planned(2);
    state = applyEvaluation(state, evalFor("q1", "revisit"));
    state = applyEvaluation(state, evalFor("q1", "correct"));

    expect(state.evaluations).toHaveLength(1);
    expect(isComplete(state)).toBe(false);
  });
});

describe("questionNumber", () => {
  it("is 1-based and never exceeds the planned length", () => {
    let state = planned(2);
    expect(questionNumber(state)).toBe(0);

    state = presentQuestion(state, question("q1"));
    expect(questionNumber(state)).toBe(1);

    state = presentQuestion(state, question("q2"));
    state = presentQuestion(state, question("q3"));
    // A third question in a two-question plan should not read "3 of 2".
    expect(questionNumber(state)).toBe(2);
  });
});

describe("askedQuestions", () => {
  it("returns the prompts, not the ids", () => {
    // The agent is handed this list and told not to repeat it. Ids would be
    // UUIDs — nothing a model can avoid asking again. The offline agent only
    // reads the array's LENGTH, so passing ids failed silently for exactly as
    // long as the live agent was unreachable.
    let state = emptyQuizState;
    state = presentQuestion(state, question("q1", "Why is it concerted?"));
    state = presentQuestion(state, question("q2", "Why does bulk slow it?"));

    expect(askedQuestions(state)).toEqual([
      "Why is it concerted?",
      "Why does bulk slow it?",
    ]);
  });
});
