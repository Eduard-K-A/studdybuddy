/**
 * POST /api/quiz — the quiz backend.
 *
 * Everything that touches the agent happens here, server-side:
 *   - the learner's material is turned into a bounded context
 *   - the session plan is clamped to something we are willing to run
 *   - the quizmaster prompt is assembled for the format this question takes
 *   - the agent is called over its WebSocket protocol
 *   - the reply is parsed into a typed Question or Evaluation
 *
 * The browser never talks to ibl.ai and never sees the platform token or the
 * prompt engineering. It posts material and answers, and receives typed JSON.
 */

import { NextResponse } from "next/server";

import { buildQuizContext, isUsableMaterial } from "@/lib/quiz/context";
import { formatFor, normalisePlan } from "@/lib/quiz/plan";
import { parseEvaluation, parseQuestion } from "@/lib/quiz/parse";
import {
  AgentUnavailableError,
  IblAgent,
  StubAgent,
  firstUnsafeHeaderIndex,
  type QuizAgent,
} from "@/lib/quiz/agent";
import type {
  AnswerOption,
  Evaluation,
  Material,
  QuestionFormat,
  Question,
} from "@/lib/quiz/types";

// The agent client opens a WebSocket, so this must not run on the edge runtime.
export const runtime = "nodejs";

/** Which agent answered. Always returned, so the UI can label offline sessions
 *  instead of passing stub grading off as real evaluation. */
export type AgentMode = "live" | "offline";

/** Why the live agent was not used, when it was configured but failed. Echoed
 *  in the response so a degraded session is diagnosable from the outside — the
 *  category only, never a stack or an internal message. */
export type DegradeReason =
  | "credits"
  | "auth"
  | "timeout"
  | "transport"
  | "unknown";

const QUESTION_FORMATS: readonly QuestionFormat[] = [
  "multiple-choice",
  "true-false",
  "short-answer",
  "essay",
];

interface AskBody {
  readonly action: "ask";
  readonly material: Material;
  readonly plan: unknown;
  /** The prompts already asked, so the agent can avoid repeating itself. Also
   *  how far through the plan we are — the handler is stateless. */
  readonly askedQuestions: readonly string[];
  readonly username?: string;
}

interface EvaluateBody {
  readonly action: "evaluate";
  readonly material: Material;
  readonly question: Question;
  readonly answer: string;
  readonly username?: string;
}

type RequestBody = AskBody | EvaluateBody;

function isMaterial(v: unknown): v is Material {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return typeof m.title === "string" && typeof m.body === "string";
}

function parseOptionList(v: unknown): readonly AnswerOption[] | undefined {
  if (!Array.isArray(v)) return undefined;

  const options = v.flatMap((entry): AnswerOption[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const o = entry as Record<string, unknown>;
    return typeof o.id === "string" && typeof o.text === "string"
      ? [{ id: o.id, text: o.text }]
      : [];
  });

  return options.length > 0 ? options : undefined;
}

/**
 * Validate a question coming back from the browser.
 *
 * It left here as typed JSON, but it is round-tripping through a client we do
 * not control, so the format is re-checked against the allowlist rather than
 * trusted — an unrecognised value would otherwise select a prompt branch by
 * falling through a switch.
 */
function isQuestion(v: unknown): v is Question {
  if (typeof v !== "object" || v === null) return false;
  const q = v as Record<string, unknown>;
  return (
    typeof q.id === "string" &&
    typeof q.prompt === "string" &&
    typeof q.format === "string" &&
    (QUESTION_FORMATS as readonly string[]).includes(q.format)
  );
}

function normaliseQuestion(v: Record<string, unknown>): Question {
  const options = parseOptionList(v.options);
  const base: Question = {
    id: v.id as string,
    prompt: v.prompt as string,
    format: v.format as QuestionFormat,
  };
  return options ? { ...base, options } : base;
}

function parseBody(v: unknown): RequestBody | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  const username = typeof b.username === "string" ? b.username : undefined;

  if (b.action === "ask" && isMaterial(b.material)) {
    const askedQuestions = Array.isArray(b.askedQuestions)
      ? b.askedQuestions.filter((p): p is string => typeof p === "string")
      : [];
    return {
      action: "ask",
      material: b.material,
      plan: b.plan,
      askedQuestions,
      username,
    };
  }

  if (
    b.action === "evaluate" &&
    isMaterial(b.material) &&
    isQuestion(b.question) &&
    typeof b.answer === "string"
  ) {
    return {
      action: "evaluate",
      material: b.material,
      question: normaliseQuestion(b.question as unknown as Record<string, unknown>),
      answer: b.answer,
      username,
    };
  }

  return null;
}

/** Build the live agent when fully configured, else null. */
function liveAgent(username: string): IblAgent | null {
  const tenant = process.env.NEXT_PUBLIC_MAIN_TENANT_KEY;
  const mentorId = process.env.IBLAI_AGENT_ID;
  const token = process.env.IBLAI_API_KEY;

  if (!tenant || !mentorId || !token) return null;
  if (/^your-/.test(tenant) || /^your-/.test(token)) return null;

  // A credential pasted through smart punctuation cannot go in a header at all
  // — header values are latin-1, and `fetch` throws a TypeError naming a
  // character offset and nothing else, before any request is made. This
  // happened in production: the deployed IBLAI_API_KEY had an em dash where a
  // hyphen belonged, and every /api/quiz call 502'd while working locally.
  // Named here, it is a one-line fix instead of a log-archaeology exercise.
  const unsafe = firstUnsafeHeaderIndex(token);
  if (unsafe !== -1) {
    console.error(
      `[quiz] IBLAI_API_KEY has a character at index ${unsafe} that cannot be ` +
        `sent in an HTTP header (code ${token.charCodeAt(unsafe)}). It was ` +
        `probably pasted through smart punctuation — an em dash (8212) for a ` +
        `hyphen. Re-paste the value. Running offline until then.`,
    );
    return null;
  }

  return new IblAgent({ tenant, mentorId, token, username });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body was not valid JSON.");
  }

  const body = parseBody(raw);
  if (!body) return badRequest("Unrecognised request. Expected an ask or evaluate action.");

  if (!isUsableMaterial(body.material)) {
    return badRequest(
      "That material is too short to build questions from. Paste a few paragraphs.",
    );
  }

  const context = buildQuizContext(body.material);
  const username = body.username?.trim() || process.env.IBLAI_USERNAME || "anonymous";

  // The plan and the format are settled here rather than taken from the client.
  // Capacity is measured against the excerpt the agent will actually see, not
  // the whole document — material beyond the context budget cannot produce
  // questions, so counting it would promise a variety we cannot deliver.
  let format: QuestionFormat = "short-answer";
  let planLength = 0;

  if (body.action === "ask") {
    const plan = normalisePlan(body.plan, context.excerpt.length);
    planLength = plan.length;

    // The session length is enforced on both sides. The UI stops offering
    // "next question" at the limit, but the limit is what bounds how many agent
    // calls one session can spend, so it cannot live only in the client.
    if (body.askedQuestions.length >= plan.length) {
      return NextResponse.json(
        { error: "This quiz has already run its length.", complete: true },
        { status: 409 },
      );
    }

    format = formatFor(plan, body.askedQuestions.length);
  }

  // Explicit opt-out for local dev, CI and E2E, where spending credits on a
  // deterministic assertion would be pointless.
  const forceStub = process.env.QUIZ_AGENT === "stub";
  const live = forceStub ? null : liveAgent(username);

  /** Set when a configured live agent failed and the offline one stood in. */
  let degraded: DegradeReason | null = null;

  const run = async (agent: QuizAgent, mode: AgentMode) => {
    const rawReply =
      body.action === "ask"
        ? await agent.ask(context, body.askedQuestions, format)
        : await agent.evaluate(context, body.question, body.answer);

    const base = {
      mode,
      truncated: context.truncated,
      ...(degraded ? { degraded } : {}),
    };

    if (body.action === "ask") {
      const question: Question | null = parseQuestion(
        rawReply,
        crypto.randomUUID(),
        format,
      );
      if (!question) throw new AgentUnavailableError("Empty reply.", "transport");
      // The clamped length goes back with every question, so a client that
      // asked for more than the material supports learns the real number
      // instead of silently running short.
      return NextResponse.json({ ...base, question, planLength });
    }

    const evaluation: Evaluation | null = parseEvaluation(rawReply, body.question.id);
    if (!evaluation) throw new AgentUnavailableError("Empty reply.", "transport");
    return NextResponse.json({ ...base, evaluation });
  };

  if (live) {
    try {
      return await run(live, "live");
    } catch (error) {
      // Log the real error. This is the ONLY record of why a live call failed —
      // the client is deliberately told a category, not an internal message, so
      // without this line a production failure leaves nothing to debug at all.
      console.error("[quiz] live agent failed:", error);

      // Degrade for ANY live failure, not only credits.
      //
      // This used to fall through on `credits` and return 502 on everything
      // else, which dead-ended the session on the deployed origin while a
      // working offline agent sat unused one line below. A transport fault
      // should cost the learner a weaker question, not the whole session.
      // Nothing is misrepresented: the response is labelled `offline`, the UI
      // says so, and `degraded` names the category.
      degraded =
        error instanceof AgentUnavailableError ? error.reason : "unknown";
    }
  }

  try {
    return await run(new StubAgent(), "offline");
  } catch (error) {
    // Reaching here means the material defeated even the deterministic agent,
    // so it is a real bug rather than an expected degradation.
    console.error("[quiz] offline agent failed:", error);
    return NextResponse.json(
      { error: "Could not build a question from that material." },
      { status: 500 },
    );
  }
}
