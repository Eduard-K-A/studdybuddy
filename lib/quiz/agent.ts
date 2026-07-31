/**
 * The agent transport.
 *
 * Two implementations behind one interface:
 *
 *   IblAgent   talks to the real ibl.ai agent over the WebSocket protocol
 *              observed live (see docs/AGENT_PROTOCOL.md).
 *   StubAgent  deterministic local responder, so the quiz flow, the UI and the
 *              tests all work without spending credits.
 *
 * The seam exists because the ibl.ai platform this was built against sits at a
 * negative credit balance, so the live agent refuses to generate. The real
 * client is not a sketch — it implements the verified protocol and runs the
 * moment credits exist. The stub is selected explicitly, never silently.
 */

import type { QuizContext } from "./context";
import { buildEvaluationPrompt, buildQuestionPrompt } from "./prompt";
import type { Question } from "./types";

export interface QuizAgent {
  /** Returns the agent's RAW reply text; parsing belongs to parse.ts. */
  ask(context: QuizContext, previouslyAsked: readonly string[]): Promise<string>;
  evaluate(
    context: QuizContext,
    question: Question,
    answer: string,
  ): Promise<string>;
}

export class AgentUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: "credits" | "auth" | "timeout" | "transport",
  ) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

export interface IblAgentConfig {
  readonly tenant: string;
  readonly mentorId: string;
  readonly username: string;
  /** Platform Api-Token. Verified to authenticate the socket, which is why the
   *  user's axd_token never has to leave the browser. */
  readonly token: string;
  readonly apiBase?: string;
  readonly wsUrl?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_API = "https://api.iblai.app";
const DEFAULT_WS = "wss://asgi.data.iblai.app/ws/langflow/";

interface Frame {
  readonly detail?: string;
  readonly error?: string;
  readonly message?: string;
  readonly data?: unknown;
  readonly status_code?: number;
  readonly session_id?: string;
  readonly [k: string]: unknown;
}

function textFrom(frame: Frame): string {
  // The success-path frame shape could not be verified against the live agent
  // (the account has no credits), so pull text from the fields the protocol
  // plausibly uses and ignore the control frames.
  for (const key of ["data", "message", "response", "content", "text"]) {
    const v = frame[key];
    if (typeof v === "string" && v && frame.detail !== "Connected.") return v;
  }
  return "";
}

export class IblAgent implements QuizAgent {
  constructor(private readonly cfg: IblAgentConfig) {}

  private get api() {
    return this.cfg.apiBase ?? DEFAULT_API;
  }

  /** Mint a chat session. Verified: POST returns { session_id }. */
  private async createSession(): Promise<string> {
    const { tenant, username, mentorId, token } = this.cfg;
    const res = await fetch(
      `${this.api}/dm/api/ai-mentor/orgs/${tenant}/users/${username}/sessions/`,
      {
        method: "POST",
        headers: {
          Authorization: `Api-Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mentor: mentorId }),
      },
    );

    if (res.status === 401 || res.status === 403) {
      throw new AgentUnavailableError("Agent rejected the platform token.", "auth");
    }
    if (!res.ok) {
      throw new AgentUnavailableError(
        `Could not start a session (HTTP ${res.status}).`,
        "transport",
      );
    }

    // A 2xx that is not JSON (an HTML error page from a proxy, say) would throw
    // a bare SyntaxError here, which the route cannot classify and reports as
    // an unknown failure. Name it instead.
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AgentUnavailableError(
        "Session response was not JSON.",
        "transport",
      );
    }

    const sessionId =
      typeof body === "object" && body !== null
        ? (body as { session_id?: unknown }).session_id
        : undefined;

    if (typeof sessionId !== "string") {
      throw new AgentUnavailableError("Session response had no session_id.", "transport");
    }
    return sessionId;
  }

  private async send(prompt: string): Promise<string> {
    const { tenant, mentorId, username, token } = this.cfg;

    // Node only exposes a global WebSocket from 22.4 onward, and serverless
    // runtimes do not all ship one. Constructing it blind throws a bare
    // ReferenceError that carries no reason the caller can act on — and it
    // cannot reproduce locally on a Node build that has the global.
    const WebSocketCtor: typeof WebSocket | undefined =
      typeof globalThis.WebSocket === "function"
        ? globalThis.WebSocket
        : undefined;

    if (!WebSocketCtor) {
      throw new AgentUnavailableError(
        "This runtime has no WebSocket global.",
        "transport",
      );
    }

    const sessionId = await this.createSession();
    const timeoutMs = this.cfg.timeoutMs ?? 45_000;

    return new Promise<string>((resolve, reject) => {
      const ws = new WebSocketCtor(this.cfg.wsUrl ?? DEFAULT_WS);
      const chunks: string[] = [];
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        fn();
      };

      const timer = setTimeout(
        () =>
          finish(() =>
            reject(new AgentUnavailableError("The agent timed out.", "timeout")),
          ),
        timeoutMs,
      );

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            flow: { name: mentorId, tenant, username, pathway: mentorId },
            session_id: sessionId,
            token,
            prompt,
          }),
        );
      });

      ws.addEventListener("message", (event) => {
        let frame: Frame;
        try {
          frame = JSON.parse(String(event.data)) as Frame;
        } catch {
          chunks.push(String(event.data));
          return;
        }

        // Billing rejection is the expected failure on a depleted platform, and
        // it must not look like an empty answer.
        const err = frame.error ?? "";
        if (typeof err === "string" && /balance|credit/i.test(err)) {
          finish(() =>
            reject(new AgentUnavailableError(err, "credits")),
          );
          return;
        }
        if (err) {
          finish(() => reject(new AgentUnavailableError(String(err), "transport")));
          return;
        }

        const text = textFrom(frame);
        if (text) chunks.push(text);
      });

      ws.addEventListener("error", () =>
        finish(() =>
          reject(new AgentUnavailableError("WebSocket error.", "transport")),
        ),
      );

      ws.addEventListener("close", () => finish(() => resolve(chunks.join(""))));
    });
  }

  ask(context: QuizContext, previouslyAsked: readonly string[]) {
    return this.send(buildQuestionPrompt(context, previouslyAsked));
  }

  evaluate(context: QuizContext, question: Question, answer: string) {
    return this.send(buildEvaluationPrompt(context, question, answer));
  }
}

/**
 * Deterministic local agent.
 *
 * Not a mock of an LLM — it does not pretend to understand the material. It
 * builds a question from a real sentence in the excerpt and grades by keyword
 * overlap, so the flow, scoring, and UI are all exercisable end to end. The UI
 * labels sessions run this way, so a stub answer is never mistaken for a real
 * evaluation.
 */
export class StubAgent implements QuizAgent {
  /** Prefer substantive sentences — a short declarative one ("X happens in a
   *  single step.") makes a thin question and grades badly on keyword overlap.
   *  Falls back progressively so short material still yields something. */
  private sentences(excerpt: string): string[] {
    const all = excerpt
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const substantial = all.filter((s) => s.length > 80);
    if (substantial.length > 0) return substantial;

    const usable = all.filter((s) => s.length > 40);
    return usable.length > 0 ? usable : all;
  }

  async ask(context: QuizContext, previouslyAsked: readonly string[]) {
    const pool = this.sentences(context.excerpt);
    const pick = pool[previouslyAsked.length % Math.max(pool.length, 1)] ?? context.excerpt;

    return JSON.stringify({
      question: `In your own words, explain this point from ${context.title}: "${pick.slice(0, 160)}"`,
      sourceRef: { locator: `${context.title}, sentence ${previouslyAsked.length + 1}`, quote: pick.slice(0, 160) },
    });
  }

  async evaluate(context: QuizContext, question: Question, answer: string) {
    const words = (s: string) =>
      new Set(
        s
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 4),
      );

    const target = words(question.sourceRef?.quote ?? question.prompt);
    const given = words(answer);
    let hits = 0;
    for (const w of given) if (target.has(w)) hits += 1;

    const coverage = target.size === 0 ? 0 : hits / target.size;
    const verdict = coverage >= 0.4 ? "correct" : coverage >= 0.15 ? "partial" : "revisit";

    return JSON.stringify({
      verdict,
      explanation:
        `Offline practice mode: graded by keyword overlap with the source passage, ` +
        `not by understanding. You matched ${hits} of ${target.size} key terms.`,
      sourceRef: question.sourceRef ?? { locator: context.title },
    });
  }
}
