/**
 * The quizmaster prompt.
 *
 * Prompt design is the difference between a quizmaster and a chatbot wearing a
 * hat. Three things do most of the work here: the model is told to ask exactly
 * one question and then stop, it is told to ground every claim in the supplied
 * excerpt rather than in what it already knows about the topic, and the ask and
 * evaluate turns share one preamble so they cannot drift apart.
 *
 * Formats differ only in the instruction block and the reply schema. The
 * grounding rules are identical for all of them, which is the point of building
 * it this way rather than as five separate prompts.
 */

import type { QuizContext } from "./context";
import type { AnswerOption, QuestionFormat, Question } from "./types";
import { isChoiceFormat } from "./types";

/** Shared preamble. Kept in one place so the ask and evaluate turns cannot
 *  drift apart on tone or grounding rules. */
function preamble(context: QuizContext): string {
  return [
    "You are StudyBuddy, a tutor quizzing a university student on material they supplied.",
    "",
    `The material is titled "${context.title}". Everything between the markers is the ONLY source you may draw on:`,
    "",
    "<<<MATERIAL",
    context.excerpt,
    "MATERIAL>>>",
    "",
    context.truncated
      ? `NOTE: the material was truncated to fit; roughly ${context.omittedChars} characters were omitted. Do not refer to anything beyond the excerpt.`
      : "",
    "",
    "Rules that hold for every reply:",
    "- Ground everything in the excerpt. If the excerpt does not settle a point, say so rather than filling the gap from general knowledge.",
    "- Cite where in the material you are drawing from, as precisely as the text allows.",
    "- Write in sentence case, in plain verbs. No preamble, no praise, no emoji.",
  ]
    .filter(Boolean)
    .join("\n");
}

const SOURCE_REF_SCHEMA =
  '"sourceRef": {"locator": "<where in the material>", "quote": "<the passage it rests on>"}';

/**
 * The per-format ask instruction and reply schema.
 *
 * Note what multiple choice does NOT ask for: which option is correct. The
 * question travels to the browser, so an answer key in it would be one
 * devtools panel away. Correctness is settled on the evaluate turn instead,
 * server-side, against the same material — one extra round trip that was
 * already being made anyway.
 */
function askInstruction(format: QuestionFormat): readonly string[] {
  switch (format) {
    case "multiple-choice":
      return [
        "Ask exactly ONE multiple-choice question with FOUR options, exactly one of which is correct.",
        "The three wrong options must be plausible and drawn from the same material — a misreading a student could actually make, never an absurd filler.",
        "Do NOT mark, letter, order or otherwise hint at which option is correct.",
        "",
        "Reply with JSON only, in this shape:",
        `{"question": "<the question>", "options": ["<option>", "<option>", "<option>", "<option>"], ${SOURCE_REF_SCHEMA}}`,
      ];

    case "true-false":
      return [
        "Write exactly ONE statement about the material that is either clearly true or clearly false according to the excerpt.",
        "Across a session roughly half your statements should be false. Make a false one wrong in a specific, checkable way — a swapped term, a reversed relationship — not absurd.",
        "Do NOT say which it is.",
        "",
        "Reply with JSON only, in this shape:",
        `{"question": "<the statement>", ${SOURCE_REF_SCHEMA}}`,
      ];

    case "essay":
      return [
        "Ask exactly ONE question that needs a developed paragraph to answer: it must require the student to connect at least two ideas from the material, or to weigh something up, rather than recall a fact.",
        "Do NOT reveal or hint at the answer. Do NOT ask a follow-up. Stop after the question.",
        "",
        "Reply with JSON only, in this shape:",
        `{"question": "<the question>", ${SOURCE_REF_SCHEMA}}`,
      ];

    case "short-answer":
    default:
      return [
        "Ask exactly ONE question that tests whether the student understood the material — prefer 'why' and 'how' over recall of a single term.",
        "It should be answerable in two or three sentences.",
        "Do NOT reveal or hint at the answer. Do NOT ask a follow-up. Stop after the question.",
        "",
        "Reply with JSON only, in this shape:",
        `{"question": "<the question>", ${SOURCE_REF_SCHEMA}}`,
      ];
  }
}

/** Turn 1 — ask a question and then stop. */
export function buildQuestionPrompt(
  context: QuizContext,
  previouslyAsked: readonly string[] = [],
  format: QuestionFormat = "short-answer",
): string {
  const avoid =
    previouslyAsked.length > 0
      ? [
          "",
          "You have already asked these. Ask about something else:",
          ...previouslyAsked.map((q) => `- ${q}`),
        ].join("\n")
      : "";

  return [preamble(context), avoid, "", ...askInstruction(format)]
    .filter(Boolean)
    .join("\n");
}

/** Render the options so the agent judges the same list the learner saw. */
function optionBlock(options: readonly AnswerOption[]): string {
  return ["The options offered were:", ...options.map((o) => `- ${o.text}`)].join(
    "\n",
  );
}

/** What the learner actually chose, resolved from an option id back to its text.
 *  The id is what the radio group submits; the agent needs the wording. */
function chosenText(
  question: Question,
  answer: string,
): string {
  const match = question.options?.find((o) => o.id === answer);
  return match ? match.text : answer.trim();
}

/** The per-format grading rubric. */
function judgeInstruction(format: QuestionFormat): readonly string[] {
  switch (format) {
    case "multiple-choice":
    case "true-false":
      return [
        "Decide whether the option the student selected is the correct one, according to the excerpt alone.",
        '- "correct" — they selected the right option.',
        '- "partial" — the option they selected is defensible on the excerpt but another one is better.',
        '- "revisit" — they selected a wrong option, or none.',
        "",
        "Say which option is correct and why the excerpt settles it. If they were wrong, name the specific thing that makes their choice wrong rather than only asserting it.",
      ];

    case "essay":
      return [
        "Judge the answer against the material only, as a paragraph rather than a sentence.",
        '- "correct" — the ideas are connected and supported from the material, even if the prose is rough.',
        '- "partial" — the relevant ideas are present but the connection between them is missing, thin, or unsupported.',
        '- "revisit" — the answer is wrong, empty, or does not engage the question.',
        "",
        "Judge the reasoning, not the writing style or the length. Name the specific connection they made or missed.",
      ];

    case "short-answer":
    default:
      return [
        "Judge the answer against the material only.",
        '- "correct" — they got the substance, even if worded loosely.',
        '- "partial" — the core idea is there but something important is missing or muddled.',
        '- "revisit" — the answer is wrong, empty, or unrelated.',
        "",
        "Explain in two or three sentences WHY, naming the specific thing they got right or missed.",
      ];
  }
}

/** Turn 2 — evaluate the student's answer. */
export function buildEvaluationPrompt(
  context: QuizContext,
  question: Question,
  answer: string,
): string {
  const choice = isChoiceFormat(question.format) && question.options?.length;
  const given = chosenText(question, answer);

  return [
    preamble(context),
    "",
    question.format === "true-false"
      ? `You asked the student to judge this statement: ${question.prompt}`
      : `You asked: ${question.prompt}`,
    choice ? optionBlock(question.options ?? []) : "",
    `The student ${choice ? "selected" : "answered"}: ${given || "(no answer given)"}`,
    "",
    ...judgeInstruction(question.format),
    "",
    "Address the student as 'you'. Do not apologise, do not congratulate, do not restate the question.",
    "",
    "Reply with JSON only, in this shape:",
    `{"verdict": "correct|partial|revisit", "explanation": "<why>", "sourceRef": {"locator": "<where in the material>", "quote": "<the passage that settles it>"}}`,
  ]
    .filter(Boolean)
    .join("\n");
}
