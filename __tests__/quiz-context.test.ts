import { describe, it, expect } from "vitest";
import {
  buildQuizContext,
  normaliseMaterial,
  truncateAtBoundary,
  isUsableMaterial,
  MIN_USABLE_CHARS,
} from "@/lib/quiz/context";

describe("normaliseMaterial", () => {
  it("collapses spaces but preserves paragraph breaks", () => {
    const out = normaliseMaterial("a    b\n\n\n\nc   d");
    expect(out).toBe("a b\n\nc d");
  });

  it("normalises CRLF so Windows-pasted material matches Unix", () => {
    expect(normaliseMaterial("one\r\n\r\ntwo")).toBe("one\n\ntwo");
  });
});

describe("truncateAtBoundary", () => {
  it("returns the text unchanged when it fits", () => {
    expect(truncateAtBoundary("short text", 100)).toBe("short text");
  });

  it("never exceeds the budget", () => {
    const text = "word ".repeat(500);
    expect(truncateAtBoundary(text, 120).length).toBeLessThanOrEqual(120);
  });

  it("cuts at a sentence end rather than mid-sentence", () => {
    const text =
      "The transition state is trigonal bipyramidal. The nucleophile attacks from the opposite face. Inversion follows.";
    const out = truncateAtBoundary(text, 60);
    expect(out).toBe("The transition state is trigonal bipyramidal.");
  });

  it("falls back to a word boundary when there is no sentence end", () => {
    const out = truncateAtBoundary("alpha beta gamma delta", 14);
    expect(out).toBe("alpha beta");
    expect(out.endsWith(" ")).toBe(false);
  });

  it("hard-cuts a single token longer than the budget", () => {
    // No boundary of any kind exists, so the budget must still win.
    expect(truncateAtBoundary("x".repeat(50), 10)).toHaveLength(10);
  });

  it("returns empty for a non-positive budget", () => {
    expect(truncateAtBoundary("anything", 0)).toBe("");
  });
});

describe("buildQuizContext", () => {
  it("reports truncation and how much was dropped", () => {
    const body = "Sentence one. " + "filler ".repeat(300);
    const ctx = buildQuizContext({ title: "Ch. 7", body }, 100);

    expect(ctx.truncated).toBe(true);
    expect(ctx.omittedChars).toBeGreaterThan(0);
    expect(ctx.excerpt.length).toBeLessThanOrEqual(100);
  });

  it("does not flag truncation when everything fits", () => {
    const ctx = buildQuizContext({ title: "Ch. 7", body: "Short body." }, 5000);
    expect(ctx.truncated).toBe(false);
    expect(ctx.omittedChars).toBe(0);
  });

  it("substitutes a title when the learner left it blank", () => {
    const ctx = buildQuizContext({ title: "   ", body: "Some text." });
    expect(ctx.title).toBe("Untitled material");
  });
});

describe("isUsableMaterial", () => {
  it("rejects null and material below the usable threshold", () => {
    expect(isUsableMaterial(null)).toBe(false);
    expect(isUsableMaterial({ title: "t", body: "too short" })).toBe(false);
  });

  it("accepts material at the threshold", () => {
    const body = "a".repeat(MIN_USABLE_CHARS);
    expect(isUsableMaterial({ title: "t", body })).toBe(true);
  });
});
