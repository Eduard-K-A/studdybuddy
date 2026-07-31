import { describe, it, expect } from "vitest";
import {
  computeScore,
  applyEvaluation,
  presentQuestion,
  evaluationFor,
} from "@/lib/quiz/score";
import { emptyQuizState, type Evaluation, type Verdict } from "@/lib/quiz/types";

const evalFor = (questionId: string, verdict: Verdict): Evaluation => ({
  questionId,
  verdict,
  explanation: "because",
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
  it("increments asked for a new question", () => {
    const next = presentQuestion(emptyQuizState, { id: "q1", prompt: "Why?" });
    expect(next.asked).toBe(1);
    expect(next.current?.id).toBe("q1");
  });

  it("does not double-count re-presenting the current question", () => {
    const once = presentQuestion(emptyQuizState, { id: "q1", prompt: "Why?" });
    const twice = presentQuestion(once, { id: "q1", prompt: "Why?" });
    expect(twice.asked).toBe(1);
  });

  it("does not re-count a question that was already answered", () => {
    const asked = presentQuestion(emptyQuizState, { id: "q1", prompt: "Why?" });
    const answered = applyEvaluation(asked, evalFor("q1", "correct"));
    const again = presentQuestion(answered, { id: "q1", prompt: "Why?" });
    expect(again.asked).toBe(1);
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
