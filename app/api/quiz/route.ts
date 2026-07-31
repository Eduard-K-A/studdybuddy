/**
 * POST /api/quiz — the quiz backend.
 *
 * Everything that touches the agent happens here, server-side:
 *   - the learner's material is turned into a bounded context
 *   - the quizmaster prompt is assembled
 *   - the agent is called over its WebSocket protocol
 *   - the reply is parsed into a typed Question or Evaluation
 *
 * The browser never talks to ibl.ai and never sees the platform token or the
 * prompt engineering. It posts material and answers, and receives typed JSON.
 */

import { NextResponse } from "next/server";

import { buildQuizContext, isUsableMaterial } from "@/lib/quiz/context";
import { parseEvaluation, parseQuestion } from "@/lib/quiz/parse";
import {
  AgentUnavailableError,
  IblAgent,
  StubAgent,
  type QuizAgent,
} from "@/lib/quiz/agent";
import type { Evaluation, Material, Question } from "@/lib/quiz/types";

// The agent client opens a WebSocket, so this must not run on the edge runtime.
export const runtime = "nodejs";

/** Which agent answered. Always returned, so the UI can label offline sessions
 *  instead of passing stub grading off as real evaluation. */
export type AgentMode = "live" | "offline";

interface AskBody {
  readonly action: "ask";
  readonly material: Material;
  readonly askedPrompts?: readonly string[];
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

function isQuestion(v: unknown): v is Question {
  if (typeof v !== "object" || v === null) return false;
  const q = v as Record<string, unknown>;
  return typeof q.id === "string" && typeof q.prompt === "string";
}

function parseBody(v: unknown): RequestBody | null {
  if (typeof v !== "object" || v === null) return null;
  const b = v as Record<string, unknown>;
  const username = typeof b.username === "string" ? b.username : undefined;

  if (b.action === "ask" && isMaterial(b.material)) {
    const askedPrompts = Array.isArray(b.askedPrompts)
      ? b.askedPrompts.filter((p): p is string => typeof p === "string")
      : [];
    return { action: "ask", material: b.material, askedPrompts, username };
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
      question: b.question,
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

  // Explicit opt-out for local dev, CI and E2E, where spending credits on a
  // deterministic assertion would be pointless.
  const forceStub = process.env.QUIZ_AGENT === "stub";
  const live = forceStub ? null : liveAgent(username);

  const run = async (agent: QuizAgent, mode: AgentMode) => {
    const rawReply =
      body.action === "ask"
        ? await agent.ask(context, body.askedPrompts ?? [])
        : await agent.evaluate(context, body.question, body.answer);

    if (body.action === "ask") {
      const question: Question | null = parseQuestion(rawReply, crypto.randomUUID());
      if (!question) throw new AgentUnavailableError("Empty reply.", "transport");
      return NextResponse.json({ mode, truncated: context.truncated, question });
    }

    const evaluation: Evaluation | null = parseEvaluation(rawReply, body.question.id);
    if (!evaluation) throw new AgentUnavailableError("Empty reply.", "transport");
    return NextResponse.json({ mode, truncated: context.truncated, evaluation });
  };

  if (live) {
    try {
      return await run(live, "live");
    } catch (error) {
      // A depleted platform is the expected failure here. Fall through to the
      // offline agent rather than dead-ending the session — the response is
      // labelled `offline`, and the UI says so plainly.
      const isCredits =
        error instanceof AgentUnavailableError && error.reason === "credits";
      if (!isCredits) {
        const message =
          error instanceof AgentUnavailableError
            ? error.message
            : "The agent could not be reached.";
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }
  }

  try {
    return await run(new StubAgent(), "offline");
  } catch {
    return NextResponse.json(
      { error: "Could not build a question from that material." },
      { status: 500 },
    );
  }
}
