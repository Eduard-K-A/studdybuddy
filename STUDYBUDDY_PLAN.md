# StudyBuddy — Build Plan

A time-boxed plan to scaffold an ibl.ai `vibe` app and ship **StudyBuddy**: upload
learning material, chat with an agent that quizzes you on it.

**Purpose:** this is the bonus for the ibl.ai Software Engineer application
("clone iblai/vibe, scaffold a small app, and show us what you built"). Every
phase below is chosen to produce visible evidence against a specific listed
qualification. Building something impressive is secondary to building something
that *proves the six requirements*.

**Audience:** Claude CLI, executing alongside a human operator. Phases are
sequential. Each ends in a **GATE** — do not proceed past a failed gate without
applying its contingency.

---

## 0. Success criteria

Done means all of the following exist and are linkable:

- [ ] A public GitHub repo with clean, conventional-commit history
- [ ] A deployed Vercel URL where SSO login works end-to-end
- [ ] A working quiz flow: ingest material → agent generates questions → user answers → agent evaluates
- [ ] A deliberate visual identity — a documented token system, not the shadcn defaults left untouched
- [ ] A native desktop build (screenshot or short clip is sufficient evidence)
- [ ] Passing Vitest unit tests and Playwright E2E/smoke tests, including one axe accessibility assertion
- [ ] A README with a **"What broke and how I diagnosed it"** section

The README section is not optional garnish. Requirement #5 is *"ability to read
an unfamiliar codebase, run it locally, and ship changes using the reference
repos as your map."* Narrated debugging is the only artifact that proves it.

---

## 1. Qualification → evidence map

Keep this visible while building. If a phase stops serving a row here, cut it.

| # | Required qualification | Where it gets proven | Phase |
|---|---|---|---|
| 1 | Next.js App Router, React, server components, route handlers, middleware, data fetching, state management (RTK a plus) | Quiz route handlers, session middleware, RTK Query slice for quiz state | 4, 5 |
| 2 | OAuth 2.0 / OIDC, JWT signing/verification/refresh, secure storage, session management | Route protection middleware over the SSO session + written analysis of the SDK's token storage tradeoff | 5 |
| 3 | TypeScript, Tailwind, Radix/shadcn | Quiz UI on the scaffold's shadcn components, retokenized through Tailwind rather than restyled; strict TS, no `any` | 4 |
| 4 | Tauri for desktop/mobile packaging | `iblai add builds` → working desktop binary | 7 |
| 5 | Read unfamiliar codebase, run locally, ship changes | Baseline commit + recon notes + README debugging narrative | 2, 9 |
| 6 | Vitest + Playwright, accessibility and performance | Test suite + axe check + Lighthouse numbers in README | 6 |

**Qualification #2 is the known gap.** The goal in Phase 5 is *not* to fake OAuth
experience. It is to demonstrate that you understand the flow well enough to
reason about it in someone else's codebase — which is a more honest and more
interesting thing to show.

---

## 2. Time budget

Total: **~7.5 hours**, with a hard stop leaving 90 minutes before the call.

| Phase | Work | Box |
|---|---|---|
| 0 | Pre-flight | 30 min |
| 1 | Scaffold | 45 min |
| 2 | Baseline + recon | 30 min |
| 3 | Ingestion | 45 min |
| 4 | Design direction + quiz mode | 120 min |
| 5 | Auth hardening | 45 min |
| 6 | Tests | 45 min |
| 7 | Tauri build | 30 min |
| 8 | Deploy | 20 min |
| 9 | README + demo | 45 min |

If you run over, **cut Phase 3 down to paste-only and cut quiz mode to one
question type.** Never cut Phases 6, 7, or 9 — those are pure qualification
evidence and cheap relative to their signal.

---

## 3. Phase 0 — Pre-flight

Everything downstream depends on these. Fail fast here.

```bash
mkdir studybuddy && cd studybuddy
git init
```

Manual steps, in order:

1. Create a free account at `https://iblai.app`.
2. Create an agent in the dashboard. **Record its agent ID and your platform/tenant key** — the scaffold CLI will prompt for both.
3. In the dashboard, check whether **dataset upload** is available on your tier. This single fact determines Phase 3.

```bash
npx skills add iblai/vibe
```

Optionally clone the toolkit as read-only reference — useful for reading skill
definitions before invoking them:

```bash
git clone https://github.com/iblai/vibe ~/reference/vibe
```

> **Do not build inside the cloned `vibe` directory.** It is a toolkit repo
> (`skills/`, `templates/`, `docs/`, `scripts/`) — there is no app in it to run.
> Build in `studybuddy/`; keep the clone as a map.

Then, in Claude CLI from `studybuddy/`:

```
/iblai-auth
```

This skill carries the installation guide for the `iblai` CLI itself. That matters
because the CLI's own GitHub repo is not publicly reachable, so this is the
documented install path.

**GATE 0:** `iblai --version` works, an agent exists, tenant key recorded.
*Contingency:* if the CLI cannot be installed, fall back to
`npx create-next-app@latest` plus `iblai add ...` — or, worst case, build directly
against `@iblai/iblai-js` from npm. Document whichever detour you took; it becomes
README material.

---

## 4. Phase 1 — Scaffold

```bash
iblai startapp agent -o iblai-init
cp -a iblai-init/<app-name>/. . && rm -rf iblai-init
rm -rf node_modules && pnpm install
cp .env.example .env.local
pnpm dev
```

Notes on the mechanics:

- The command is interactive; it prompts for platform key, agent ID, and app name. The `--yes` flag with `--platform`, `--agent`, `--app-name` skips prompts.
- It generates into `iblai-init/<app-name>/`, hence the hoist step.
- **The trailing `/.` in `cp -a iblai-init/<app-name>/. .` is load-bearing** — it copies hidden files (`.env.example`, `.claude/`). Do not rewrite it as `/*`.
- `rm -rf node_modules` before install is deliberate: the template vendors dependencies that may be stale or platform-mismatched.

Open `http://localhost:3000`. You should be redirected to `login.iblai.app`, sign
in, and return authenticated.

**GATE 1:** SSO round-trips and you land in an authenticated session.
*Contingency:* if the redirect fails, check `.env.local` against `.env.example`
for a missing tenant key first — that is the most likely cause. Log the symptom
and fix verbatim; this is prime README material.

---

## 5. Phase 2 — Baseline commit and recon

**Commit before touching anything.** This creates a clean diff between "what the
toolkit gave me" and "what I built," which is the central claim of the whole
exercise.

```bash
git add -A
git commit -m "chore: scaffold agent app with iblai startapp"
```

Then spend 20 minutes on recon and write findings to `NOTES.md` (working file, not
shipped):

1. **Route tree** — what pages exist already? Chat, profile, analytics, notifications? Anything present is something you do not need to `iblai add`.
2. **Provider hierarchy** — find the root layout and record the provider nesting (Redux store, auth provider, theme). You will need to slot into this in Phase 4.
3. **Where does the session live?** Find where `axd_token` and `dm_token` are read and written. Note the storage mechanism exactly — this is your Phase 5 raw material.
4. **`.mcp.json`** — if absent, create it:

```json
{
  "mcpServers": {
    "iblai": {
      "command": "npx",
      "args": ["-y", "@iblai/mcp"]
    }
  }
}
```

Restart Claude CLI to pick it up. It exposes `get_component_info`,
`get_hook_info`, `get_api_query_info`, `get_provider_setup`, and
`create_page_template` — use these instead of guessing at component APIs.

**GATE 2:** You can state in one sentence what the app does today and where its
auth state is stored.

---

## 6. Phase 3 — Material ingestion

Two paths. Decide with the Phase 0 finding.

### Path A — dataset upload (preferred)

```
/iblai-agent-dataset
```

Adds the searchable dataset table with upload. Wire a PDF through it and confirm
the agent can answer questions grounded in that document. This is the
RAG-adjacent path and the stronger demo.

### Path B — paste-only fallback

If upload is gated behind a paid tier or agent-editor permissions, build a
`<textarea>` that accepts pasted notes and injects them as context into the chat
request. Less impressive on paper, entirely honest, and **still demonstrates the
same engineering** — you are managing context construction rather than delegating
it to their pipeline.

Do not burn time fighting a permissions wall. Note the limitation in the README
and move on; recognizing a tier boundary quickly *is* the skill being tested.

**GATE 3:** Material gets into the agent's context by some route, and you can
demonstrate a grounded answer.

---

## 7. Phase 4 — Design direction and quiz mode

This is the only part that is genuinely yours. Keep it small and finished.

### 7.1 Design direction

**Brief:** a university student revising dense source material — lecture PDFs,
journal articles, textbook chapters. The interface's single job is to sustain a
focused answer-and-review loop without breaking concentration. It is not a
marketing page and it is not a chat app; treating it as either produces the wrong
design.

Ship the token system below into `globals.css` and `tailwind.config.ts` as CSS
variables. **Retokenize the scaffold's shadcn components rather than restyling
them** — shadcn reads from CSS custom properties, so overriding the variables
recolors every component consistently and takes minutes. Hand-restyling
individual components is slower, worse, and reads as not understanding how the
library works.

#### Palette

Studying happens at night, often for hours. This palette is built for low glare
and long dwell time.

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#F7F8FA` | Cool white ground — laser paper under library light, not warm cream |
| `--ink` | `#14213D` | Deep navy. Body text, primary actions |
| `--rule` | `#D8DCE4` | Hairline rules, borders, dividers |
| `--margin` | `#5B6B8C` | Slate. Annotation text, metadata, secondary UI |
| `--mark` | `#E8B84B` | Ochre. Correct answers, emphasis, highlight fills |
| `--query` | `#B5546B` | Muted rose. Needs review |

**Deliberately not red and green.** This is formative assessment — a wrong answer
means revisit, not fail. Ochre and rose carry the same information without the
punitive register, and they sidestep the most common form of colour-blind
ambiguity. Pair both with a text label or icon so colour is never the sole
carrier.

**Contrast constraint:** ochre on paper fails text contrast. Use `--mark` as a
fill, underline, or rule only — never as text on the paper ground. Note this in
your CSS as a comment so you do not undo it at 2 AM.

#### Type

Three roles, and the split encodes something true rather than decorating:

- **Source Serif 4** — the user's own material and the question text. This is *the source*.
- **IBM Plex Sans** — every piece of UI chrome, buttons, labels, navigation. This is *the system*.
- **IBM Plex Mono** — citations, page references, running score. This is *the metadata*.

Serif means "this came from your document." Sans means "this is the app talking."
A reader learns that distinction within one question and never has to be told it.
Both families are on Google Fonts; Source Serif 4 was drawn specifically for
sustained screen reading, which is exactly the job.

Set a tight scale — question text at 20px/1.6, body at 16px/1.6, margin notes at
14px, mono metadata at 13px. Two weights per family, no more.

#### Layout and the signature element

**The margin rail.** All system feedback lives in a physical margin column,
never inline with the question. You answer in the main column; the agent's
evaluation, the source citation, and the score annotation appear in the gutter
beside it — the way a tutor's pen lands in the margin of a returned essay.

```
┌────────────────────────────────────────────────────────┐
│  StudyBuddy            Organic Chemistry — Ch. 7   4/6 │
├──────────────────────────────────────┬─────────────────┤
│                                      │  MARGIN RAIL    │
│  Question 5                          │                 │
│  ─────────────────────────────────   │  ✓ Correct      │
│                                      │                 │
│  Why does the transition state in    │  You identified │
│  an SN2 reaction adopt a trigonal    │  the inversion  │
│  bipyramidal geometry?               │  correctly.     │
│                                      │                 │
│  ┌────────────────────────────────┐  │  ── source ──   │
│  │ your answer…                   │  │  p. 214, ¶3     │
│  └────────────────────────────────┘  │                 │
│                                      │                 │
│  [ Check my answer ]                 │                 │
└──────────────────────────────────────┴─────────────────┘
```

Below 900px the rail collapses beneath the question rather than disappearing —
annotation still reads as annotation, set in slate against a hairline rule.

**This is the risk, and it is the one to protect.** It costs horizontal space and
demands a real mobile fallback. It earns that cost because it is the single
gesture that makes this feel like studying rather than a chat window with a quiz
theme. If time runs short, cut question types, cut animation, cut anything else —
keep the rail.

#### Motion

One orchestrated moment, not scattered effects: when an evaluation returns, the
margin note reveals over roughly 200ms — a short fade with a few pixels of
upward travel, as if written in. Nothing else animates. Wrap it in
`@media (prefers-reduced-motion: no-preference)` so it is opt-out by default.

#### Copy

Interface words are design material here, so write them with the same care as
spacing:

- Buttons name the action: **"Check my answer"**, not "Submit". The action keeps its name through the flow.
- The empty state is an invitation, not an apology: **"Paste your notes or drop a PDF. I'll build questions from what's in it."**
- Failure states say what happened and what to do: **"That file didn't parse. Try a text-based PDF — scanned pages won't work yet."** No apologising, no vagueness.
- Sentence case throughout. Plain verbs. Nothing does double duty.

#### Quality floor

Build these in from the start rather than retrofitting: responsive to 375px,
visible keyboard focus (2px `--ink` ring, never `outline: none` without a
replacement), reduced motion respected, and every colour-coded state paired with
text. These are also exactly what your Phase 6 axe check will assert, so doing
them now saves rework.

### 7.2 The quizmaster prompt

Use `/iblai-agent-prompt` to set the system prompt. The behavior you want:

- Generate one question at a time from the ingested material
- Wait for the user's answer before revealing anything
- Evaluate the answer, explain *why* it was right or wrong, cite the source passage
- Track a running score across the session

Prompt design is the difference between a quizmaster and a chatbot with a hat on.
Iterate on it — it is cheap and highly visible in a demo.

### 7.3 The UI

Build in `app/quiz/` using the scaffold's existing shadcn components, retokenized
per §7.1. Minimum viable surface:

- Question card, set in Source Serif 4
- Answer input
- Margin rail carrying evaluation, source citation, and score
- Empty state that invites the first upload

Constraints that map to graded qualifications:

- **Server components by default**, client components only where interaction demands it. Requirement #1 names server components explicitly.
- **A route handler** at `app/api/quiz/route.ts` for quiz actions rather than calling the agent directly from the client. This demonstrates the "Own Next.js backend development" card.
- **Strict TypeScript.** No `any`. The SDK ships full type declarations — use them.
- **RTK Query for quiz state.** `@reduxjs/toolkit` and `react-redux` are already peer dependencies of `@iblai/iblai-js`, so the store exists. Add a slice rather than reaching for `useState` everywhere. Requirement #1 lists RTK as a plus and you are otherwise a Zustand user — this is a cheap conversion of a weakness into a demonstrated skill.

> **Do not add `@iblai/iblai-js` or its sub-packages to `transpilePackages` in
> `next.config.ts`.** The SDK ships pre-compiled with `'use client'` directives
> already applied. Adding it there will break the build. This is documented and is
> a common first mistake.

Commit in conventional-commit style throughout — the posting explicitly asks for
it:

```
feat(quiz): add question card and answer evaluation
fix(quiz): preserve session score across re-renders
test(quiz): cover answer evaluation edge cases
```

**GATE 4:** A full loop works — ingest, ask, answer, evaluate, score.

---

## 8. Phase 5 — Auth hardening

Forty-five minutes on the one requirement you cannot claim experience with. The
goal is demonstrated *understanding*, not fabricated experience.

### 8.1 Ship something real

Add Next.js middleware that gates `/quiz` behind an authenticated session and
redirects unauthenticated users into the SSO flow, preserving the intended
destination for post-login return. This is genuine session management work, it
touches `middleware.ts` (named in requirement #1), and it is achievable in the
time box.

### 8.2 Write something sharp

Add a short `docs/AUTH_NOTES.md` covering:

- The SSO flow as actually implemented in this scaffold, traced through the code — where the redirect originates, what comes back, where tokens land
- **The token storage tradeoff:** the SDK reads `axd_token` and `dm_token` from `localStorage`. Compare against httpOnly cookies — localStorage is readable by any script on the origin, so it trades XSS exposure for simpler client-side access and cross-tab convenience. State the tradeoff neutrally; do not posture as if you have found a bug.
- **What you would need to learn** to own the "Implement and harden authentication" card: authorization code flow with PKCE, refresh token rotation, JWT signature verification against a JWKS endpoint, and SAML assertion handling.

That third bullet is the highest-value paragraph in the entire submission. A
candidate who can precisely scope their own gap is more hireable than one who
blurs it.

**GATE 5:** Unauthenticated access to `/quiz` redirects correctly, and
`AUTH_NOTES.md` traces the real flow rather than describing OAuth generically.

---

## 9. Phase 6 — Tests

Requirement #6, and an existing strength — make it visible.

### Vitest

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react
```

Cover the pure logic: answer evaluation, score accumulation, context construction
from ingested material. Three to five meaningful tests beat twenty trivial ones.

### Playwright

```bash
pnpm add -D @playwright/test @axe-core/playwright
npx playwright install --with-deps chromium
```

The SDK exposes a `@iblai/iblai-js/playwright` subpath, with `@playwright/test`
and `@axe-core/playwright` as optional peer dependencies required only when using
it. **Check what it provides before writing helpers from scratch** — using their
test utilities is a stronger signal than rolling your own.

Smoke tests to write:

1. Unauthenticated visit to `/quiz` redirects to login
2. Authenticated session renders the quiz page
3. Submitting an answer produces an evaluation
4. **An axe accessibility scan of the quiz page with zero critical violations**

Test #4 covers the "eye for accessibility" clause directly and almost nobody else
will have it.

Optionally run `/iblai-ops-test`, the toolkit's own pre-flight validation skill.

### Performance

Run Lighthouse against the deployed URL. Record Core Web Vitals (LCP, CLS, INP)
in the README. The posting asks you to "respect Core Web Vitals and performance
budgets" — showing numbers, even imperfect ones, proves you measured.

**GATE 6:** `pnpm test` and `pnpm playwright test` both pass locally.

---

## 10. Phase 7 — Tauri desktop build

Thirty minutes, highest return per minute in the plan. Converts requirement #4
from "willing to ramp" into "already did."

```bash
iblai add builds
iblai builds build
```

Capture a screenshot of StudyBuddy running as a native window. Put it in the
README.

Optional, if time and toolchain allow: `iblai builds ci-workflow --all` to add
GitHub Actions for multi-platform builds. This also nods to your DevOps Head
experience.

**GATE 7:** A desktop binary launches. If the Rust toolchain fights you, document
the failure honestly and move on — a documented failed attempt still beats no
attempt, and the diagnosis is itself evidence.

---

## 11. Phase 8 — Deploy

```bash
iblai deploy vercel
```

Set environment variables in the Vercel dashboard to match `.env.local`. **Verify
SSO works on the deployed origin, not just localhost** — redirect URI mismatches
between origins are the single most common failure here, and finding one is
useful README content.

Push the repo to GitHub, public.

**GATE 8:** A stranger can open the URL, log in, and take a quiz.

---

## 12. Phase 9 — README and demo

The README is the deliverable he will actually read. Structure:

```markdown
# StudyBuddy

One-line description + live URL + desktop screenshot.

## What this is
Built as the bonus for the ibl.ai Software Engineer application. Scaffolded with
iblai/vibe, extended with a quiz-mode layer.

## What the toolkit gave me vs. what I built
Link the baseline commit. Be scrupulously honest about the split — overclaiming
here is the fastest way to lose credibility with someone who wrote the toolkit.

## Architecture
How ingestion, the agent, and quiz mode fit together. One diagram if it helps.

## Design notes
The token system, and why. Three or four sentences on the margin rail, the
serif/sans split between source and system, and why feedback uses ochre and rose
instead of green and red. Show that the visual choices were reasoned, not default.

## What broke and how I diagnosed it
The most important section. Three or four real problems: the symptom, what you
checked, what the actual cause was, how you fixed it. Reference which repo file or
skill definition you read to figure it out.

## Auth notes
Link to docs/AUTH_NOTES.md.

## Testing
What is covered, how to run it, the axe result, Lighthouse numbers.

## What I'd do next
Two or three concrete items. Mention the mobile SSO limitation documented in the
vibe README — mobile WebViews use a non-standard user-agent that SSO providers
reject, and the fix requires ASWebAuthenticationSession on iOS and Chrome Custom
Tabs on Android. Noting a known open limitation shows you read past the happy path.

## Time spent
Roughly six hours. Say so. It frames the scope honestly.
```

Optionally record a 60–90 second screen capture of the quiz flow. Many people
will not click a link; almost everyone watches a short clip.

**GATE 9:** Someone who has never seen the project can understand what you built
and what you learned in under three minutes.

---

## 13. Contingency table

| If this fails | Do this |
|---|---|
| `iblai` CLI will not install | `npx create-next-app` + `iblai add auth/chat`, or build directly on `@iblai/iblai-js` |
| SSO redirect never returns | Check tenant key in `.env.local` first; then compare against `.env.example` |
| Dataset upload is tier-gated | Switch to Path B (paste-only); note the limitation in README |
| Agent gives ungrounded answers | Shorten injected context; iterate the system prompt before blaming retrieval |
| Tauri build fails | Document the failure and ship without it; do not lose an hour to Rust toolchain setup |
| Vercel deploy breaks on SSO | Check redirect URI allowlist for the new origin |
| Running out of time | Cut in this order: Tauri CI workflow → Path A ingestion → extra question types. **Never cut README, tests, or deploy.** |

---

## 14. Anti-goals

Explicitly out of scope. Adding any of these makes the submission worse:

- Building a novel product concept. He asked for a *small* app.
- Building a design system from scratch. Retokenize shadcn through CSS variables; do not rebuild components.
- Voice mode. It belongs to `iblai/os`, not the hosted vibe path; a Web Speech API approximation risks signalling that you misread the architecture.
- Adding all seven `iblai add` features. Two or three, working, beats seven half-wired.
- Rewriting anything the scaffold provided. The point is building *with* the toolkit, not around it.
- Hiding the gaps. Every honest limitation stated plainly is worth more than a papered-over one.

---

## 15. Talking points this unlocks

After shipping, these become sentences you can say on the call:

- "I read the skill definitions in `skills/` before invoking them, so I knew what `/iblai-agent-dataset` expected before it ran."
- "I used RTK Query for quiz state because the SDK already brings Redux Toolkit as a peer dependency — it seemed better to work with the grain of the stack than to bring my own state library."
- "I traced how the SDK stores `axd_token` and `dm_token` and wrote up the tradeoff against httpOnly cookies. I haven't implemented OAuth from scratch, and that's the part of the role I most want to learn."
- "I'd built this idea before on my own stack — GabAI, a study tool that turns uploaded material into practice quizzes. Rebuilding it on yours took an afternoon, and that comparison told me a lot about the toolkit."
- "I retokenized shadcn through CSS variables rather than restyling components, so the whole surface recolored from six tokens. Feedback uses ochre and rose instead of green and red — it's formative assessment, so a wrong answer should read as 'revisit' rather than 'fail.'"
- "The mobile SSO limitation in the vibe README stood out to me — the WebView user-agent problem. That sits right where the auth and cross-platform work in the posting intersect."

That last one connects two of the six "What you'll do" cards. Have it ready.
