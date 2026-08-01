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
import type { QuestionFormat, Question } from "./types";

export interface QuizAgent {
  /** Returns the agent's RAW reply text; parsing belongs to parse.ts. */
  ask(
    context: QuizContext,
    previouslyAsked: readonly string[],
    format: QuestionFormat,
  ): Promise<string>;
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

/**
 * Index of the first character that cannot travel in an HTTP header, or -1.
 *
 * Header values are ByteString — latin-1, one byte per character. A value
 * carrying anything above U+00FF makes `fetch` throw
 *
 *   TypeError: Cannot convert argument to a ByteString because the character
 *   at index N has a value of 8212 which is greater than 255
 *
 * before a single byte goes over the wire. 8212 is U+2014, an em dash.
 *
 * This is precisely what a credential pasted through smart punctuation looks
 * like — an em dash where a hyphen belongs. It cost a production outage here:
 * the deployed `IBLAI_API_KEY` had one, so building `Authorization` threw a
 * TypeError that named a character offset and nothing else. Checking the value
 * up front lets the failure name the variable instead.
 */
export function firstUnsafeHeaderIndex(value: string): number {
  // Exactly the ByteString condition: any code unit above 255. A loop rather
  // than a regex so the check carries no non-ASCII literal of its own.
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 255) return i;
  }
  return -1;
}

export function isHeaderSafe(value: string): boolean {
  return firstUnsafeHeaderIndex(value) === -1;
}

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

  ask(
    context: QuizContext,
    previouslyAsked: readonly string[],
    format: QuestionFormat,
  ) {
    return this.send(buildQuestionPrompt(context, previouslyAsked, format));
  }

  evaluate(context: QuizContext, question: Question, answer: string) {
    return this.send(buildEvaluationPrompt(context, question, answer));
  }
}

/* ------------------------------------------------------------------------- */
/* The offline agent                                                          */
/* ------------------------------------------------------------------------- */

/** Longest option we will show. Long enough to carry a real claim, short enough
 *  that four of them still scan as a list rather than as prose. */
const OPTION_CHARS = 160;

/** Compare loosely enough to survive the whitespace normalisation the excerpt
 *  went through, strictly enough that a swapped word is a miss. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The stub's entire notion of "correct": does this text actually appear in the
 * learner's material?
 *
 * That is what lets the offline agent grade a choice question without carrying
 * an answer key from the ask turn to the evaluate turn — the route handler is
 * stateless, so anything it "remembered" would have to travel via the browser,
 * where the learner could read it.
 */
function appearsIn(excerpt: string, text: string): boolean {
  return normalise(excerpt).includes(normalise(text));
}

/** Cut at a word boundary so an option never ends mid-word. */
function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const window = trimmed.slice(0, limit);
  const space = window.lastIndexOf(" ");
  return (space > limit * 0.6 ? window.slice(0, space) : window).trimEnd();
}

function longWords(text: string): string[] {
  return text.match(/\b[A-Za-z]{6,}\b/g) ?? [];
}

/**
 * Make a statement false in a specific, checkable way.
 *
 * Swaps the longest content word for one borrowed from elsewhere in the
 * material, so the result stays on-topic and plausibly worded but is no longer
 * something the text says — which is exactly the property `appearsIn` tests.
 * Deterministic: no randomness anywhere in the stub, so two runs of the same
 * material produce the same quiz and a failing test reproduces.
 */
function corrupt(sentence: string, donor: string, excerpt: string): string {
  const targets = longWords(sentence).sort((a, b) => b.length - a.length);
  const donors = longWords(donor).sort((a, b) => b.length - a.length);

  for (const target of targets) {
    const replacement = donors.find(
      (d) => d.toLowerCase() !== target.toLowerCase(),
    );
    if (!replacement) break;

    const swapped = sentence.replace(target, replacement);
    // Guard the invariant rather than assuming it: if the swap happened to
    // produce something the material does say, this option would be graded
    // correct and the question would have two right answers.
    if (!appearsIn(excerpt, swapped)) return swapped;
  }

  const negated = `It is not the case that ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
  return negated;
}

/**
 * Deterministic local agent.
 *
 * Not a mock of an LLM — it does not pretend to understand the material. It
 * builds questions from real sentences in the excerpt and grades by whether the
 * chosen option is something the material actually says, or by keyword overlap
 * for written answers. The UI labels sessions run this way, so a stub answer is
 * never mistaken for a real evaluation.
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

  async ask(
    context: QuizContext,
    previouslyAsked: readonly string[],
    format: QuestionFormat,
  ) {
    const pool = this.sentences(context.excerpt);
    const index = previouslyAsked.length;
    const pick = pool[index % Math.max(pool.length, 1)] ?? context.excerpt;
    const locator = `${context.title}, sentence ${index + 1}`;

    if (format === "multiple-choice") {
      return this.askChoice(context, pool, pick, index, locator);
    }

    if (format === "true-false") {
      // Alternate so a session is not all-true, which would make "always answer
      // true" a winning strategy and the drill worthless.
      const statement = clip(pick, OPTION_CHARS);
      const shouldBeFalse = index % 2 === 1;
      const donor = pool[(index + 1) % Math.max(pool.length, 1)] ?? pick;

      return JSON.stringify({
        question: shouldBeFalse
          ? corrupt(statement, donor, context.excerpt)
          : statement,
        sourceRef: { locator },
      });
    }

    const lead =
      format === "essay"
        ? `Drawing on ${context.title}, develop a paragraph explaining this point and how it connects to the rest of the material:`
        : `In your own words, explain this point from ${context.title}:`;

    return JSON.stringify({
      question: `${lead} "${clip(pick, OPTION_CHARS)}"`,
      sourceRef: { locator, quote: clip(pick, OPTION_CHARS) },
    });
  }

  /** One true option drawn verbatim from the material, three altered ones. */
  private askChoice(
    context: QuizContext,
    pool: readonly string[],
    pick: string,
    index: number,
    locator: string,
  ) {
    const correct = clip(pick, OPTION_CHARS);

    const distractors: string[] = [];
    for (let offset = 1; distractors.length < 3 && offset <= pool.length; offset += 1) {
      const source = pool[(index + offset) % pool.length];
      if (!source) continue;
      // Clip BEFORE corrupting: corrupting first and clipping after could cut
      // the swapped word off the end and leave a verbatim prefix, which would
      // grade as correct.
      const donor = pool[(index + offset + 1) % pool.length] ?? pick;
      const altered = corrupt(clip(source, OPTION_CHARS), donor, context.excerpt);
      if (!distractors.includes(altered) && altered !== correct) {
        distractors.push(altered);
      }
    }

    // Rotate the correct answer's position so it is not always first — a fixed
    // position makes the drill a pattern-matching exercise instead of a recall
    // one.
    const options = [...distractors];
    options.splice(index % (options.length + 1), 0, correct);

    return JSON.stringify({
      question: `Which of these does ${context.title} actually state?`,
      options,
      sourceRef: { locator },
    });
  }

  async evaluate(context: QuizContext, question: Question, answer: string) {
    if (question.format === "true-false") {
      return this.gradeTrueFalse(context, question, answer);
    }
    if (question.format === "multiple-choice" && question.options?.length) {
      return this.gradeChoice(context, question, answer);
    }
    return this.gradeWritten(context, question, answer);
  }

  private gradeTrueFalse(context: QuizContext, question: Question, answer: string) {
    const statementIsTrue = appearsIn(context.excerpt, question.prompt);
    const correctId = statementIsTrue ? "true" : "false";
    const verdict = answer === correctId ? "correct" : "revisit";

    return JSON.stringify({
      verdict,
      explanation:
        `Offline practice mode: judged by whether the statement appears in your ` +
        `material as written, not by understanding. The statement is ` +
        `${statementIsTrue ? "true" : "false"} — ` +
        `${statementIsTrue ? "the material says exactly this" : "the material does not say this"}.`,
      sourceRef: question.sourceRef ?? { locator: context.title },
    });
  }

  private gradeChoice(context: QuizContext, question: Question, answer: string) {
    const options = question.options ?? [];
    const chosen = options.find((o) => o.id === answer);
    const correct = options.find((o) => appearsIn(context.excerpt, o.text));

    // A question written by the live agent can reach the offline grader when a
    // live call fails mid-session. There is then no verbatim option to find,
    // and guessing would be worse than saying so.
    if (!correct) {
      return JSON.stringify({
        verdict: "revisit",
        explanation:
          "Offline practice mode could not check this question against your " +
          "material, so it is marked for review rather than guessed at.",
        sourceRef: question.sourceRef ?? { locator: context.title },
      });
    }

    return JSON.stringify({
      verdict: chosen?.id === correct.id ? "correct" : "revisit",
      explanation:
        `Offline practice mode: the right option is the one your material ` +
        `actually states — "${clip(correct.text, 120)}". Graded by matching ` +
        `against the source text, not by understanding.`,
      sourceRef: question.sourceRef ?? { locator: context.title },
    });
  }

  private gradeWritten(context: QuizContext, question: Question, answer: string) {
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
