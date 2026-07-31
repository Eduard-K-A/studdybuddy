import { describe, it, expect } from "vitest";
import {
  extractJsonObject,
  parseQuestion,
  parseEvaluation,
  coerceVerdict,
} from "@/lib/quiz/parse";

describe("extractJsonObject", () => {
  it("reads JSON out of a ```json fence", () => {
    const raw = 'Sure!\n```json\n{"question": "Why?"}\n```';
    expect(extractJsonObject(raw)).toEqual({ question: "Why?" });
  });

  it("reads JSON wrapped in prose without a fence", () => {
    const raw = 'Here you go: {"question": "Why?"} — hope that helps.';
    expect(extractJsonObject(raw)).toEqual({ question: "Why?" });
  });

  it("returns undefined when there is no object at all", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
  });

  it("returns undefined for a JSON array rather than mis-typing it", () => {
    expect(extractJsonObject("[1,2,3]")).toBeUndefined();
  });
});

describe("parseQuestion", () => {
  it("parses the documented schema including the source ref", () => {
    const raw = JSON.stringify({
      question: "Why is the transition state trigonal bipyramidal?",
      sourceRef: { locator: "p. 214, ¶3", quote: "the nucleophile attacks" },
    });
    expect(parseQuestion(raw, "q1")).toEqual({
      id: "q1",
      prompt: "Why is the transition state trigonal bipyramidal?",
      sourceRef: { locator: "p. 214, ¶3", quote: "the nucleophile attacks" },
    });
  });

  it("falls back to the whole reply when the model ignores the schema", () => {
    const q = parseQuestion("What causes inversion of configuration?", "q2");
    expect(q).toEqual({
      id: "q2",
      prompt: "What causes inversion of configuration?",
    });
  });

  it("accepts a plain string source ref", () => {
    const raw = JSON.stringify({ question: "Why?", sourceRef: "p. 12" });
    expect(parseQuestion(raw, "q3")?.sourceRef).toEqual({ locator: "p. 12" });
  });

  it("returns null for an empty reply", () => {
    expect(parseQuestion("   ", "q4")).toBeNull();
  });
});

describe("coerceVerdict", () => {
  it("passes through the three documented verdicts", () => {
    expect(coerceVerdict("correct")).toBe("correct");
    expect(coerceVerdict("partial")).toBe("partial");
    expect(coerceVerdict("revisit")).toBe("revisit");
  });

  it("maps common synonyms the model reaches for", () => {
    expect(coerceVerdict("Right")).toBe("correct");
    expect(coerceVerdict("almost")).toBe("partial");
  });

  it("defaults to revisit rather than correct on garbage", () => {
    // Grading generously on a parse failure would lie to the learner about
    // what they actually know.
    expect(coerceVerdict("banana")).toBe("revisit");
    expect(coerceVerdict(undefined)).toBe("revisit");
  });
});

describe("parseEvaluation", () => {
  it("parses the documented schema", () => {
    const raw = JSON.stringify({
      verdict: "partial",
      explanation: "You identified the geometry but not why inversion follows.",
      sourceRef: { locator: "p. 214" },
    });
    expect(parseEvaluation(raw, "q1")).toEqual({
      questionId: "q1",
      verdict: "partial",
      explanation: "You identified the geometry but not why inversion follows.",
      sourceRef: { locator: "p. 214" },
    });
  });

  it("degrades to revisit with the raw text when JSON is absent", () => {
    const out = parseEvaluation("That's not quite right, because...", "q1");
    expect(out?.verdict).toBe("revisit");
    expect(out?.explanation).toBe("That's not quite right, because...");
  });

  it("returns null for an empty reply", () => {
    expect(parseEvaluation("", "q1")).toBeNull();
  });
});
