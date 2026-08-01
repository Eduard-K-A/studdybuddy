import { describe, it, expect } from "vitest";
import { StubAgent } from "@/lib/quiz/agent";
import { buildQuizContext } from "@/lib/quiz/context";
import { parseEvaluation, parseQuestion } from "@/lib/quiz/parse";
import type { Question } from "@/lib/quiz/types";

/**
 * The offline agent is the only agent that has ever actually run — the platform
 * this was built against has no credit balance. Its behaviour is therefore not
 * a test fixture but the shipped experience, and the properties asserted here
 * are the ones that decide whether a choice question is answerable at all:
 * exactly one option is true, and the grader can find it without an answer key.
 */

const MATERIAL = {
  title: "SN2 notes",
  body: `The SN2 reaction proceeds through a single concerted step in which bond
forming and bond breaking happen at the same moment. The nucleophile attacks the
electrophilic carbon from the face directly opposite the leaving group, which is
what the literature calls backside attack. This geometry forces the transition
state to adopt a trigonal bipyramidal arrangement with three substituents lying
in a plane. Because the nucleophile and the leaving group occupy axial positions
the stereochemistry at the carbon is inverted, a result known as Walden
inversion. Steric bulk around the electrophilic carbon slows the reaction very
sharply, which is the reason tertiary halides make poor SN2 substrates.`,
};

const context = buildQuizContext(MATERIAL);
const agent = new StubAgent();

/** Ask question number `index` and parse it the way the route handler does. */
async function askAt(index: number, format: Question["format"]): Promise<Question> {
  const asked = Array.from({ length: index }, (_, i) => `question ${i}`);
  const raw = await agent.ask(context, asked, format);
  const question = parseQuestion(raw, `q${index}`, format);
  if (!question) throw new Error("the stub produced no question");
  return question;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

describe("StubAgent — multiple choice", () => {
  it("offers several options, exactly one of which the material states", () => {
    // The distractors are real sentences with a word swapped, so they stay
    // on-topic and plausibly worded but are no longer something the text says.
    // Two true options would make the question unanswerable.
    return askAt(0, "multiple-choice").then((question) => {
      const options = question.options ?? [];
      expect(options.length).toBeGreaterThanOrEqual(3);

      const verbatim = options.filter((o) =>
        normalise(context.excerpt).includes(normalise(o.text)),
      );
      expect(verbatim).toHaveLength(1);
    });
  });

  it("grades the option drawn from the material as correct", async () => {
    const question = await askAt(0, "multiple-choice");
    const correct = (question.options ?? []).find((o) =>
      normalise(context.excerpt).includes(normalise(o.text)),
    );

    const graded = parseEvaluation(
      await agent.evaluate(context, question, correct!.id),
      question.id,
    );
    expect(graded?.verdict).toBe("correct");
  });

  it("grades an altered option as one to revisit", async () => {
    const question = await askAt(0, "multiple-choice");
    const wrong = (question.options ?? []).find(
      (o) => !normalise(context.excerpt).includes(normalise(o.text)),
    );

    const graded = parseEvaluation(
      await agent.evaluate(context, question, wrong!.id),
      question.id,
    );
    expect(graded?.verdict).toBe("revisit");
  });

  it("does not always put the answer in the same position", async () => {
    // A fixed position turns the drill into pattern matching rather than recall.
    const positions = await Promise.all(
      [0, 1, 2].map(async (index) => {
        const question = await askAt(index, "multiple-choice");
        return (question.options ?? []).findIndex((o) =>
          normalise(context.excerpt).includes(normalise(o.text)),
        );
      }),
    );

    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  it("says it cannot check a question it did not write", async () => {
    // A question written by the live agent reaches the offline grader whenever
    // a live call fails mid-session. There is no verbatim option to find, and
    // guessing would be worse than admitting it.
    const foreign: Question = {
      id: "live-1",
      prompt: "Which mechanism operates here?",
      format: "multiple-choice",
      options: [
        { id: "a", text: "a concerted displacement not phrased as the text phrases it" },
        { id: "b", text: "a stepwise carbocation route absent from the text" },
      ],
    };

    const graded = parseEvaluation(
      await agent.evaluate(context, foreign, "a"),
      foreign.id,
    );
    expect(graded?.verdict).toBe("revisit");
    expect(graded?.explanation).toMatch(/could not check/i);
  });
});

describe("StubAgent — true or false", () => {
  it("alternates, so 'always true' is not a winning strategy", async () => {
    const statements = await Promise.all(
      [0, 1, 2, 3].map((i) => askAt(i, "true-false")),
    );

    const truths = statements.map((q) =>
      normalise(context.excerpt).includes(normalise(q.prompt)),
    );

    expect(truths).toContain(true);
    expect(truths).toContain(false);
  });

  it("grades a true statement answered 'true' as correct", async () => {
    const question = await askAt(0, "true-false");
    // Index 0 is deliberately a verbatim statement.
    expect(normalise(context.excerpt)).toContain(normalise(question.prompt));

    const graded = parseEvaluation(
      await agent.evaluate(context, question, "true"),
      question.id,
    );
    expect(graded?.verdict).toBe("correct");
  });

  it("grades a falsified statement answered 'true' as one to revisit", async () => {
    const question = await askAt(1, "true-false");
    expect(normalise(context.excerpt)).not.toContain(normalise(question.prompt));

    const graded = parseEvaluation(
      await agent.evaluate(context, question, "true"),
      question.id,
    );
    expect(graded?.verdict).toBe("revisit");
  });
});

describe("StubAgent — determinism", () => {
  it("produces the same quiz twice for the same material", async () => {
    // No randomness anywhere in the stub: two runs of one document are
    // comparable, and a failing test reproduces instead of flaking.
    const first = await agent.ask(context, [], "multiple-choice");
    const second = await agent.ask(context, [], "multiple-choice");
    expect(first).toBe(second);
  });
});
