/**
 * The quizmaster prompt.
 *
 * Prompt design is the difference between a quizmaster and a chatbot wearing a
 * hat. Two things do most of the work here: the model is told to ask exactly
 * one question and then stop, and it is told to ground every claim in the
 * supplied excerpt rather than in what it already knows about the topic.
 */

import type { QuizContext } from "./context";
import type { Question } from "./types";

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

/** Turn 1 — ask a question and then stop. */
export function buildQuestionPrompt(
  context: QuizContext,
  previouslyAsked: readonly string[] = [],
): string {
  const avoid =
    previouslyAsked.length > 0
      ? [
          "",
          "You have already asked these. Ask about something else:",
          ...previouslyAsked.map((q) => `- ${q}`),
        ].join("\n")
      : "";

  return [
    preamble(context),
    avoid,
    "",
    "Ask exactly ONE question that tests whether the student understood the material — prefer 'why' and 'how' over recall of a single term.",
    "Do NOT reveal or hint at the answer. Do NOT ask a follow-up. Stop after the question.",
    "",
    "Reply with JSON only, in this shape:",
    '{"question": "<the question>", "sourceRef": {"locator": "<where in the material>", "quote": "<the passage it rests on>"}}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Turn 2 — evaluate the student's answer. */
export function buildEvaluationPrompt(
  context: QuizContext,
  question: Question,
  answer: string,
): string {
  return [
    preamble(context),
    "",
    `You asked: ${question.prompt}`,
    `The student answered: ${answer.trim() || "(no answer given)"}`,
    "",
    "Judge the answer against the material only.",
    '- "correct" — they got the substance, even if worded loosely.',
    '- "partial" — the core idea is there but something important is missing or muddled.',
    '- "revisit" — the answer is wrong, empty, or unrelated.',
    "",
    "Explain in two or three sentences WHY, naming the specific thing they got right or missed.",
    "Address the student as 'you'. Do not apologise, do not congratulate, do not restate the question.",
    "",
    "Reply with JSON only, in this shape:",
    '{"verdict": "correct|partial|revisit", "explanation": "<why>", "sourceRef": {"locator": "<where in the material>", "quote": "<the passage that settles it>"}}',
  ].join("\n");
}
