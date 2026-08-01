import { describe, it, expect } from "vitest";
import {
  CHARS_PER_QUESTION,
  MAX_LENGTH,
  MIN_LENGTH,
  MIXED_ROTATION,
  formatFor,
  maxQuestionsFor,
  normalisePlan,
  offeredLengths,
} from "@/lib/quiz/plan";
import { DEFAULT_PLAN } from "@/lib/quiz/types";

describe("maxQuestionsFor", () => {
  it("scales with the material", () => {
    expect(maxQuestionsFor(CHARS_PER_QUESTION * 8)).toBe(8);
  });

  it("never offers fewer than a startable session", () => {
    // The empty state already refuses material below MIN_USABLE_CHARS, so
    // anything reaching here has earned at least a short run.
    expect(maxQuestionsFor(0)).toBe(MIN_LENGTH);
    expect(maxQuestionsFor(10)).toBe(MIN_LENGTH);
  });

  it("caps a long document rather than promising fifty questions", () => {
    // The agent only ever sees the first 12,000 characters, so capacity beyond
    // that is imaginary.
    expect(maxQuestionsFor(1_000_000)).toBe(MAX_LENGTH);
  });
});

describe("offeredLengths", () => {
  it("hides lengths the material cannot support", () => {
    // ~2,400 characters is six questions' worth: 5 is honest, 10 and 15 are not.
    expect(offeredLengths(CHARS_PER_QUESTION * 6)).toEqual([5]);
  });

  it("is never empty, so the form always has something to select", () => {
    expect(offeredLengths(0)).toHaveLength(1);
    expect(offeredLengths(0)[0]).toBe(MIN_LENGTH);
  });
});

describe("normalisePlan", () => {
  const roomy = CHARS_PER_QUESTION * MAX_LENGTH;

  it("accepts a well-formed plan unchanged", () => {
    expect(normalisePlan({ format: "essay", length: 5 }, roomy)).toEqual({
      format: "essay",
      length: 5,
    });
  });

  it("falls back to the default format for anything unrecognised", () => {
    // The format selects a prompt branch, so an unknown value must not reach
    // the switch and fall through to a default it was never checked against.
    expect(normalisePlan({ format: "oral-exam", length: 5 }, roomy).format).toBe(
      DEFAULT_PLAN.format,
    );
    expect(normalisePlan({}, roomy).format).toBe(DEFAULT_PLAN.format);
    expect(normalisePlan(null, roomy).format).toBe(DEFAULT_PLAN.format);
  });

  it("clamps a length the client asked for beyond what we will run", () => {
    // Every question costs an agent call, so an unbounded length from a
    // hand-rolled request is a billing problem, not just a UI one.
    expect(normalisePlan({ length: 10_000 }, roomy).length).toBe(MAX_LENGTH);
    expect(normalisePlan({ length: -4 }, roomy).length).toBe(MIN_LENGTH);
  });

  it("clamps to what this material can actually carry", () => {
    const thin = CHARS_PER_QUESTION * 4;
    expect(normalisePlan({ length: 15 }, thin).length).toBe(4);
  });

  it("ignores a non-numeric length rather than producing NaN", () => {
    expect(normalisePlan({ length: "ten" }, roomy).length).toBe(DEFAULT_PLAN.length);
    expect(normalisePlan({ length: Number.NaN }, roomy).length).toBe(
      DEFAULT_PLAN.length,
    );
  });
});

describe("formatFor", () => {
  it("returns the chosen format for every question of a fixed plan", () => {
    const plan = { format: "true-false" as const, length: 5 };
    expect(formatFor(plan, 0)).toBe("true-false");
    expect(formatFor(plan, 4)).toBe("true-false");
  });

  it("rotates deterministically for a mixed plan", () => {
    const plan = { format: "mixed" as const, length: 6 };
    const run = [0, 1, 2, 3].map((i) => formatFor(plan, i));

    expect(run).toEqual([...MIXED_ROTATION, MIXED_ROTATION[0]]);
  });

  it("never asks for an essay inside a mixed run", () => {
    // Mixed exists to keep a drill quick and varied; a five-paragraph question
    // between two true/false items breaks the rhythm that makes it worth doing.
    const plan = { format: "mixed" as const, length: 20 };
    const formats = Array.from({ length: 20 }, (_, i) => formatFor(plan, i));

    expect(formats).not.toContain("essay");
  });

  it("tolerates a nonsense index instead of returning undefined", () => {
    const plan = { format: "mixed" as const, length: 5 };
    expect(MIXED_ROTATION).toContain(formatFor(plan, -1));
    expect(MIXED_ROTATION).toContain(formatFor(plan, Number.NaN));
  });
});
