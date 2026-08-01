import { describe, it, expect } from "vitest";
import {
  extractJsonObject,
  parseQuestion,
  parseEvaluation,
  parseOptions,
  stripOptionLabel,
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

describe("stripOptionLabel", () => {
  it("removes an enumeration label the model added itself", () => {
    // Asked for a JSON array, models still return ["A) the nucleophile", …].
    // Rendered in a radio group that gives every option two labels.
    expect(stripOptionLabel("A) the nucleophile")).toBe("the nucleophile");
    expect(stripOptionLabel("b. the leaving group")).toBe("the leaving group");
    expect(stripOptionLabel("(C) the solvent")).toBe("the solvent");
    expect(stripOptionLabel("3. inversion")).toBe("inversion");
  });

  it("leaves an option that legitimately starts with a capital letter", () => {
    // "A nucleophile attacks…" is text, not a label — the delimiter is what
    // makes it a label, so it is required.
    expect(stripOptionLabel("A nucleophile attacks the carbon")).toBe(
      "A nucleophile attacks the carbon",
    );
  });
});

describe("parseOptions", () => {
  it("assigns stable letter ids by position", () => {
    expect(parseOptions(["first", "second"])).toEqual([
      { id: "a", text: "first" },
      { id: "b", text: "second" },
    ]);
  });

  it("accepts objects as well as strings", () => {
    expect(parseOptions([{ text: "first" }, { label: "second" }])).toHaveLength(2);
  });

  it("drops duplicates rather than offering the same answer twice", () => {
    // A repeated option turns a four-way question into a three-way one with a
    // guaranteed-wrong duplicate, which is worse than simply offering three.
    const options = parseOptions(["inversion", "Inversion", "retention"]);
    expect(options).toHaveLength(2);
  });

  it("ignores anything that is not a list", () => {
    expect(parseOptions("a, b, c")).toEqual([]);
    expect(parseOptions(undefined)).toEqual([]);
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
      format: "short-answer",
      sourceRef: { locator: "p. 214, ¶3", quote: "the nucleophile attacks" },
    });
  });

  it("falls back to the whole reply when the model ignores the schema", () => {
    const q = parseQuestion("What causes inversion of configuration?", "q2");
    expect(q).toEqual({
      id: "q2",
      prompt: "What causes inversion of configuration?",
      format: "short-answer",
    });
  });

  it("accepts a plain string source ref", () => {
    const raw = JSON.stringify({ question: "Why?", sourceRef: "p. 12" });
    expect(parseQuestion(raw, "q3")?.sourceRef).toEqual({ locator: "p. 12" });
  });

  it("returns null for an empty reply", () => {
    expect(parseQuestion("   ", "q4")).toBeNull();
  });

  it("parses a multiple-choice question with its options", () => {
    const raw = JSON.stringify({
      question: "Which does the text state?",
      options: ["A) backside attack", "B) frontside attack", "C) no attack"],
    });
    const q = parseQuestion(raw, "q5", "multiple-choice");

    expect(q?.format).toBe("multiple-choice");
    expect(q?.options).toEqual([
      { id: "a", text: "backside attack" },
      { id: "b", text: "frontside attack" },
      { id: "c", text: "no attack" },
    ]);
  });

  it("degrades a multiple-choice question with too few options to a written one", () => {
    // Better to ask it as a written question than to render a radio group with
    // one item, where the only available answer is the correct one.
    const raw = JSON.stringify({
      question: "Which does the text state?",
      options: ["only one"],
    });
    const q = parseQuestion(raw, "q6", "multiple-choice");

    expect(q?.format).toBe("short-answer");
    expect(q?.options).toBeUndefined();
  });

  it("synthesises true/false options rather than parsing them", () => {
    // The agent is asked for a statement, not for a list it could word
    // inconsistently as "T"/"F" or "Yes"/"No".
    const raw = JSON.stringify({
      question: "The reaction proceeds in two steps.",
      options: ["Yes", "No", "Maybe"],
    });
    const q = parseQuestion(raw, "q7", "true-false");

    expect(q?.options).toEqual([
      { id: "true", text: "True" },
      { id: "false", text: "False" },
    ]);
  });

  it("withholds the quoted passage from a choice question", () => {
    // The question object travels to the browser. The agent is asked to quote
    // "the passage it rests on", which for multiple choice is usually the
    // sentence one option was copied from — shipping it puts the answer key in
    // the page. The locator survives; the quote does not.
    const raw = JSON.stringify({
      question: "Which does the text state?",
      options: ["backside attack", "frontside attack"],
      sourceRef: { locator: "¶2", quote: "the nucleophile attacks from the rear" },
    });
    const q = parseQuestion(raw, "q8", "multiple-choice");

    expect(q?.sourceRef).toEqual({ locator: "¶2" });
    expect(JSON.stringify(q)).not.toContain("attacks from the rear");
  });

  it("keeps the quote for a written question, where it gives nothing away", () => {
    const raw = JSON.stringify({
      question: "Why does bulk slow the reaction?",
      sourceRef: { locator: "¶4", quote: "steric bulk slows the reaction" },
    });
    expect(parseQuestion(raw, "q9", "essay")?.sourceRef?.quote).toBe(
      "steric bulk slows the reaction",
    );
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
