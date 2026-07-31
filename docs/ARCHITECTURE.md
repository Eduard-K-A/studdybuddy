# StudyBuddy — technical architecture

How this app actually works, traced through the code rather than described in
general terms.

Companion documents, referenced rather than repeated here:

| Document | Covers |
|---|---|
| [AUTH_NOTES.md](AUTH_NOTES.md) | The SSO flow in depth, two security findings, and an honest scope of what I have not implemented |
| [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) | The ibl.ai agent wire protocol and how it was reverse-engineered |
| [DESKTOP_BUILD.md](DESKTOP_BUILD.md) | The Tauri shell and why it is scaffolded but not built |

**A note on scope.** The brief for this document listed OAuth 2.0 / OIDC, JWT
signing and verification, refresh-token rotation, and SAML SSO. Three of those
are **not implemented in this codebase**, and §8 says so explicitly rather than
describing them generically. Writing up an OAuth implementation that does not
exist would be the single least useful thing this document could do.

---

## 1. Scaffolding from `iblai/vibe`

### Getting the toolkit

The vibe toolkit is distributed as a **skills bundle**, not an npm package:

```bash
npx skills add iblai/vibe        # 65 skills, named iblai-vibe-*
```

The plan this project follows opens with `iblai startapp agent`. That CLI is not
publicly distributed — `npm view @iblai/cli` and the PyPI equivalent both 404.
Reading `iblai-vibe-scaffold/SKILL.md` showed that the CLI was never the only
route: `vibe-starter` is named there as the *preferred* greenfield path, so the
substitution cost nothing.

```bash
git clone -b spa https://github.com/iblai/vibe-starter
pnpm install --ignore-scripts
```

Baseline commit `b072976` is the untouched result, so `git diff b072976..HEAD`
is an exact record of what is mine.

### What the scaffold provides

Next.js 16 App Router, the ibl.ai SSO wiring and provider chain, a Redux store
preconfigured with the SDK's slices, a navbar, profile / account / notifications
pages, Vitest and Playwright harnesses, and Tauri templates.

### Two landmines worth knowing about

**The SDK version does not match its own documentation.** `vibe-starter` pins
`@iblai/iblai-js@^1.6.0`, but the skills document 2.x APIs. `useUsername`,
`useAxdToken`, `useCachedSessionId`, `useUserTenants` and `useVisitingTenant` all
appear in skill example code and **do not exist in 1.6.0**. Skill snippets cannot
be pasted as-is against the starter.

**A symlink in the scaffold breaks silently on Windows.** `app/iblai-styles.css`
pointed Tailwind's `@source` through `lib/iblai/sdk`, a symlink into
`node_modules`. Git defaults `core.symlinks=false` on Windows, so the link checks
out as a 39-byte text file containing its own target path. Tailwind v4 then
scanned a nonexistent directory and emitted **zero utility classes for SDK
components** — no build error, just unstyled UI, and 4 of the scaffold's own 6
tests failing on a clean clone. The fix points `@source` at `node_modules`
directly, the form the `iblai-vibe-auth` skill documents at Step 7:

```css
@source "../node_modules/@iblai/iblai-js/dist/web-containers/source";
```

---

## 2. Rendering model — where the server/client boundary sits

App Router defaults every component to a **server component**; `"use client"` is
the opt-out. In practice this app is a client-heavy SPA with a small server
shell, and the boundary is not where you would put it in a greenfield Next app.

```
app/layout.tsx                 server — fonts, metadata
└── <IblaiProviders>           CLIENT — the whole tree below is client-rendered
    └── app/(app)/layout.tsx   client — navbar, drawer
        ├── page.tsx           SERVER — the landing page
        └── quiz/page.tsx      SERVER — shell + metadata
            └── <QuizSession>  client — the interactive session
```

**Why the boundary is so high.** `IblaiProviders` must be a client component: it
holds `AuthProvider`, `TenantProvider`, and a Redux `Provider`, all of which need
browser APIs and React context. Because it wraps the root layout's children,
everything nested inside it renders on the client regardless of whether the
component itself declares `"use client"`.

Server components are therefore used where they still buy something:

- **`app/(app)/page.tsx`** — the landing page ships no client JavaScript of its
  own and holds no state. It replaced the scaffold's placeholder, which was both
  the LCP element and a dead end (it linked to a CLI repo that is not publicly
  reachable, with no route into `/quiz` at all).
- **`app/(app)/quiz/page.tsx`** — exports `metadata` and renders the page shell
  and heading on the server; only `<QuizSession>` below it is a client
  component. Metadata export is a server-only API, which is reason enough to
  keep the page itself a server component.

**The cost of this shape is measurable and is not hidden.** Because
`AuthProvider` blocks paint until the SDK has booted and resolved a session —
and that resolution is a serial chain of eight cross-origin calls, each with a
CORS preflight — the deployed LCP is 14.9 s against a 38 ms TTFB. The README's
performance section carries the full breakdown. The ceiling is set by the
scaffold's client-side auth gating, not by the quiz layer.

---

## 3. Route handlers

Two, both `runtime = "nodejs"`.

### `POST /api/quiz` — the agent exchange

```
parse body → validate material → build bounded context → build prompt
           → call agent → parse reply → typed JSON
```

The design rule is that **the browser never talks to ibl.ai for the quiz**. It
posts material and answers; it receives typed JSON. It never holds the platform
token and never sees the prompt engineering. That property is what makes the
desktop build load a remote origin rather than a static export.

Request validation is hand-rolled structural narrowing (`isMaterial`,
`isQuestion`, `parseBody`) rather than a schema library — the surface is two
actions with four fields, and the whole validator is 30 lines.

`runtime = "nodejs"` is load-bearing: the agent client opens a WebSocket, which
the edge runtime does not provide.

**Degradation is explicit.** `liveAgent()` returns `null` when the tenant key,
agent id, or token is missing or still a `your-` placeholder. When a configured
live agent fails, the handler logs the real error and falls through to a
deterministic offline agent rather than dead-ending the session. Every response
carries `mode: "live" | "offline"`, plus a `degraded` category when the live
agent was skipped after failing — so a degraded session is diagnosable from the
outside without leaking an internal message. The UI labels offline sessions;
stub grading is never presented as real evaluation.

```ts
console.error("[quiz] live agent failed:", error);
degraded = error instanceof AgentUnavailableError ? error.reason : "unknown";
// fall through to StubAgent
```

This is a **corrected** design. The handler originally fell through only on
`credits` and returned 502 for every other failure, which dead-ended the session
on the deployed origin while a working offline agent sat unused one line below —
and, because the caught error was never logged, left nothing to debug. A
transport fault should cost the learner a weaker question, not the whole
session.

### `POST /api/quiz/extract` — document ingestion

Accepts `multipart/form-data` with one `file` field and returns the same
`{ title, body }` shape the paste form produces, so nothing downstream knows
uploads exist. Covered in §9.

---

## 4. Middleware — `proxy.ts`

**Next 16 renamed the file convention.** `middleware.ts` became `proxy.ts` and
the exported function `middleware` became `proxy` — same feature, same execution
point in front of the app, same `config.matcher`. Both `MIDDLEWARE_FILENAME` and
`PROXY_FILENAME` still exist in `next/dist/lib/constants.js`; keeping the old
name emits a deprecation warning on every build.

```ts
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
```

### It is deliberately not a security boundary

This is the most important thing in the file, and the file says so in a comment
so the next person does not have to infer it.

> The ibl.ai session lives in `localStorage`. `localStorage` is never
> transmitted. Middleware runs on the server and sees only cookies and headers.
> **It cannot observe this session at all.**

What it *can* see is a cookie mirroring the session — but such a cookie is
written by client-side JavaScript and is not `httpOnly`, so anyone can set it
from a console. Its presence proves nothing.

So `proxy.ts` is scoped honestly as a **UX optimisation**: an unauthenticated
visitor is redirected before the client bundle loads, instead of flashing the
quiz shell and bouncing. Real enforcement lives in three other places — the
client-side `AuthProvider` token check, the ibl.ai API rejecting invalid bearer
tokens, and `/api/quiz` holding the platform token server-side. A middleware
check that *looked* authoritative would be worse than none: it invites the next
person to trust it.

### The destination hand-off, and its open-redirect guard

Middleware parks the intended path in `sb_return_to` and sends the visitor to
`/`, where the SDK owns the SSO round trip. `components/return-to.tsx` restores
it afterwards. The cookie is attacker-controllable, so the value is validated as
a root-relative path before any navigation:

```ts
// Rejects "//evil.com" and "https://evil.com".
export function isSafeReturnPath(value: string | undefined): value is string {
  return typeof value === "string" && /^\/(?!\/)/.test(value);
}
```

It lives in `lib/return-to.ts` rather than being exported from `proxy.ts`,
because importing anything from `proxy.ts` into a client component drags
`next/server` into the browser bundle and breaks at runtime.

### The Public Suffix List bug this file survived

`proxy.ts` originally gated `/quiz` on `ibl_user_data`, the SDK's cross-SPA
cookie. That worked on localhost and failed on **every** `/quiz` navigation once
deployed. The SDK derives the cookie domain from the hostname:

```js
const parts = hostname.split('.');
if (parts.length === 2) return hostname;
if (parts.length > 2)   return `.${parts.slice(-2).join('.')}`;
```

For `studdybuddy-lemon.vercel.app` that yields `.vercel.app`. **`vercel.app` is
on the Public Suffix List**, and browsers reject cookies scoped to a public
suffix — otherwise one deployment could set a cookie every other app on the
platform could read. The cookie was silently dropped, middleware never saw a
session, and every visit bounced. localhost hits the two-label early return and
keeps its hostname, which is precisely why the bug could not appear in
development.

The fix (`lib/session-hint.ts`, `components/session-hint.tsx`) writes
`sb_session` with **no domain attribute at all** — host-only, scoped to the
exact origin, immune to the public-suffix rule. Middleware accepts either
cookie, so the SDK's still short-circuits a hop on a normal registrable domain.

The heuristic's assumption — that the registrable domain is always the last two
labels — is wrong for every multi-label public suffix: `*.vercel.app`,
`*.github.io`, `*.pages.dev`, `*.co.uk`. This is a portability bug, not a Vercel
quirk.

---

## 5. Data fetching

Three distinct mechanisms, each chosen for a different constraint.

| Layer | Mechanism | Why |
|---|---|---|
| SDK ↔ ibl.ai | `initializeDataLayer` + RTK Query (`coreApiSlice`) | Provided by the SDK; attaches bearer tokens from `localStorage` |
| Browser ↔ our API | RTK Query mutations (`store/quiz-api.ts`) | Reuses the store that already exists |
| Browser ↔ extract | Plain `fetch` with `FormData` | RTK Query's `fetchBaseQuery` is JSON-shaped; a one-off multipart upload does not need cache infrastructure |
| Our API ↔ ibl.ai | `fetch` + `WebSocket`, server-side | Keeps the platform token off the client |

### The SDK data layer

`initializeDataLayer` is called **synchronously during render**, inside a
`useState` initializer, not in an effect:

```ts
const [isInitialized] = useState(() => {
  initializeDataLayer(config.dmUrl(), config.lmsUrl(), config.lmsUrl(),
    storageService, { 401: () => redirectToAuthSpa(undefined, undefined, true) });
  return true;
});
```

`Config.lmsUrl` / `Config.dmUrl` must be set before any RTK Query hook fires its
first query — including hooks inside SDK components further down the tree. A
`useEffect` runs *after* children render, which is too late. The `useState`
initializer runs during the render cycle, which is early enough.

The `401` handler registered here is the real session-expiry enforcement point
(§7).

### Quiz mutations

Both quiz calls are RTK Query **mutations**, not queries — they are not
cacheable reads. Asking the same material twice should produce a *different*
question, and evaluation has a side effect on session state.

```ts
baseQuery: fetchBaseQuery({ baseUrl: "/api" })
```

Same-origin and relative, so it works unchanged on localhost, on Vercel, and
inside the Tauri shell pointed at a remote origin.

---

## 6. State management

### One store, not two

`store/iblai-store.ts` registers the quiz slices **on the SDK's own store**:

```ts
export const iblaiStore = configureStore({
  reducer: {
    [coreApiSlice.reducerPath]: coreApiSlice.reducer,
    ...mentorReducer,
    chatSliceShared: chatSliceReducerShared,
    files: filesReducer,
    [quizApi.reducerPath]: quizApi.reducer,   // ours
    quiz: quizReducer,                        // ours
  },
  middleware: (get) => get({ serializableCheck: false })
    .concat(coreApiSlice.middleware)
    .concat(...mentorMiddleware)
    .concat(quizApi.middleware),
});
```

A second store would sit under a different `ReactReduxContext`, and the SDK's
RTK Query hooks would silently return `undefined` — no error, just missing data.
Adding a slice to the existing store works with the grain of the stack rather
than bringing a second state library alongside it.

**A related trap, now inert.** `next.config.ts` aliases `@reduxjs/toolkit`,
`react-redux` and `@iblai/data-layer` to single resolved directories, because two
copies of Redux produce two contexts and the same silent-`undefined` failure.
Worth knowing that this guard is **currently doing nothing**: it is registered in
the `webpack` hook, and Next 16 builds with Turbopack by default. The app works
because pnpm currently resolves exactly one copy of each — verified in
`node_modules/.pnpm`. The alias would need porting to `turbopack.resolveAlias`
to survive a hoisting change.

### Three kinds of state, deliberately separated

**Server cache — RTK Query.** Request lifecycle (`isLoading`, `error`), owned by
the API slice.

**Session state — a Redux slice.** `store/quiz-slice.ts` reducers are thin
wrappers over pure functions in `lib/quiz/score.ts`. The arithmetic lives there
so it can be tested without a store; the slice only wires it to Redux.

Two judgement calls are encoded in that arithmetic:

```ts
// Re-evaluating a question REPLACES the earlier verdict rather than appending.
// Without this an agent retry, a double-submit, or a React strict-mode double
// invoke would silently inflate the denominator.
```

```ts
// A partial answer is progress, not failure, so it earns half.
const WEIGHT: Record<Verdict, number> = { correct: 1, partial: 0.5, revisit: 0 };
```

Setting new material returns `initialState` rather than merging — carrying a
score across two different documents would be meaningless.

**External store — `useSyncExternalStore`.** `localStorage` *is* an external
store, and reading it in an effect sets state synchronously on mount and
cascades an extra render. `lib/iblai/session.ts` uses the right primitive:

```ts
export function useIblSession(): IblSession {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

Two details that matter:

- `getSnapshot` **must be referentially stable** or React re-renders forever.
  `read()` builds a fresh object each call, so the result is cached against the
  raw strings it derives from — identity changes only when the session does.
- `getServerSnapshot` returns `EMPTY`. There is no `localStorage` on the server,
  and the route handler falls back to `IBLAI_USERNAME` when the username is
  absent, so an empty server snapshot is correct rather than a placeholder.

`subscribe` is a no-op returning a no-op: the session is written once at the SSO
callback and does not change for the life of the page.

### The `current_tenant` shape bug

`TenantProvider.saveCurrentTenant` must write the **object** shape:

```ts
localStorage.setItem("current_tenant", JSON.stringify({ key }));
```

The scaffold wrote a bare string. The SDK mirrors this value into a cookie as
`{"key":"…"}` and compares cookie against `localStorage` on an interval. Every
poll saw a difference, concluded another SPA had changed the tenant, and
redirected to the auth SPA — an infinite login bounce. The scaffold contradicted
itself: `app/(app)/layout.tsx` already read the value back with
`JSON.parse(...)?.key`.

Diagnosing this needed the SDK's own logs, not a stack trace — there was no
error, only a redirect. One E2E test passed throughout, which was the clue: it
only filled a textarea and checked a disabled button, finishing before the
polling interval fired.

---

## 7. Session management

Full trace in [AUTH_NOTES.md](AUTH_NOTES.md); the mechanics in brief.

### The flow

```
1. AuthProvider calls hasNonExpiredAuthToken()
   → reads axd_token + axd_token_expires from localStorage
   → new Date(expiry) > new Date()

2. False → renders `fallback`, calls redirectToAuthSpa()
   → https://login.iblai.app/login?app=custom&redirect-to=<origin>&tenant=<key>

3. Auth SPA returns to /sso-login-complete with tokens IN THE QUERY STRING
   → SDK's <SsoLogin> parses and writes localStorage
   → navigates to localStorage.redirectTo (default "/")

4. Our <SessionHint> mirrors "a session exists" into a host-only cookie
   so proxy.ts can see anything at all
```

`/sso-login-complete` sits **outside** the `(app)` route group and is skipped by
`AuthProvider` twice over — `skip={isSsoRoute}` plus a `PUBLIC_ROUTES` entry.
Both guards exist because `AuthProvider` would otherwise see "no tokens",
redirect to login, and never let the callback store them: a redirect-loop
deadlock.

### What is stored, and where

| Key | Contents | Storage |
|---|---|---|
| `axd_token` / `axd_token_expires` | primary API token + expiry | `localStorage` |
| `dm_token` / `dm_token_expires` | data-manager token + expiry | `localStorage` |
| `edx_jwt_token` | signed edX JWT (RS512) | `localStorage` |
| `userData`, `tenants`, `current_tenant` | identity and tenancy | `localStorage` |
| `sb_session` | our host-only "probably authenticated" hint | cookie, 12 h |
| `sb_return_to` | parked destination | cookie, 10 min |

### Expiry, not refresh

There is **no refresh-token rotation in this app**. `axd_token` carries an
expiry (~10 days) and two things act on it:

1. `hasNonExpiredAuthToken()` compares it to `new Date()` before render.
2. The `401` handler registered with `initializeDataLayer` calls
   `redirectToAuthSpa(..., logout = true)` — an expired token mid-session forces
   a full re-login.

That second handler is the enforcement point. It is a coarse design: any 401
from any endpoint logs the user out, and there is no serialisation of concurrent
401s. Rotation with reuse detection would be the real answer, and is listed as a
gap in AUTH_NOTES.md §4 rather than papered over.

### Storage: `localStorage` vs `httpOnly` cookies

A real tradeoff, not a bug. The SDK is a browser SDK that talks to the ibl.ai
API directly from the client and supports Tauri shells; `httpOnly` cookies would
require a same-origin backend proxying every call, which this architecture does
not have. The cost is that one XSS anywhere on the origin yields both tokens —
and that middleware is structurally blind to the session (§4).

### The finding worth reading

**Tokens arrive in the URL query string**, not a fragment and not a POST:

```
/sso-login-complete?redirect-path=%2F&data=%7B%22axd_token%22%3A%22…
```

Query strings persist in browser history and are logged in full by most servers,
CDNs and reverse proxies. I found this the hard way: an instrumented Playwright
run logged `page.url()` at the callback and printed live tokens into a
transcript. Those tokens had to be rotated. Logging a URL is not normally a
credential-handling operation, which is exactly what makes it sharp. A fragment
(never sent to the server) or a form POST would remove the exposure without
changing the client-side model at all.

---

## 8. OAuth 2.0 / OIDC, JWT, and SAML — what is actually here

Stated plainly, because the alternative is implying coverage that does not exist.

| Capability | Status in this codebase |
|---|---|
| OAuth 2.0 authorization code flow | **Not implemented.** No authorization endpoint, no code exchange, no state parameter |
| PKCE | **Not implemented.** No verifier or challenge anywhere in the repo |
| OIDC | **Not implemented.** No discovery document, no ID-token handling, no nonce |
| JWT signing | **Not implemented.** This app never issues a token |
| JWT signature verification | **Not implemented.** No JWKS fetch, no `kid` selection, no `jose`/`jsonwebtoken` dependency |
| Refresh-token rotation | **Not implemented.** Tokens expire; a 401 forces re-login (§7) |
| SAML SSO | **Not present at all.** No assertion parsing, no XML signature verification, no IdP metadata |

### What *is* here instead

**Identity is fully delegated.** The app redirects to an external auth SPA at
`login.iblai.app` and receives opaque-to-us tokens back. It is a client of an
identity system, not an implementation of one.

**`edx_jwt_token` is stored and passed through, never verified.** Its header is
`{"alg":"RS512","typ":"JWT"}`. Nothing in this repo decodes its claims or checks
its signature — it is treated as a bearer credential. Verifying it would mean
fetching a JWKS, selecting by `kid`, caching, and handling rotation, none of
which exists.

**The one OAuth reference in the repo is not an OAuth implementation.**
`src-tauri/src/lib.rs` pattern-matches Google OAuth URLs and opens them in the
system browser instead of the WebView:

```rust
// Google blocks OAuth in WebViews, so we open OAuth URLs in the system browser.
```

That is routing around a WebView restriction on someone else's OAuth flow, not
performing one.

**Where the honest security work in this project actually is:** identifying that
the middleware cannot be a boundary and scoping it accordingly (§4), finding the
query-string token exposure (§7), catching a `.gitignore` gap that would have
committed a platform API key (`.env*` does not match `iblai.env` — that pattern
only matches names *starting* with `.env`), and guarding the return-path cookie
against open redirect (§4).

AUTH_NOTES.md §4 scopes what I would need to learn to own an authentication card
properly. The summary there is the honest one: I can operate and debug someone
else's auth, and I can find real problems in it. I have not built one.

---

## 9. Document ingestion

`/quiz` accepts `.pdf`, `.docx`, `.txt`, `.md` by picker or drag-and-drop, or
pasted text. Both paths converge on the same `{ title, body }`.

### Parsing is server-side

The obvious alternative is PDF.js in the browser, and it is the wrong call here:
the deployed bundle is already 2.1 MB with a 14.9 s LCP, so adding a parser to
the critical path would worsen the app's worst measured problem — for an action
that happens once per session, not per keystroke. Server-side also gives one
failure path instead of one per browser engine. `unpdf` ships a PDF.js build
compiled for serverless runtimes; `mammoth` handles `.docx`.

Both parsers are imported **lazily inside the handler**, so a learner who pastes
text never pays to load PDF.js into the function instance.

### Rules live in one pure module

`lib/quiz/extract.ts` holds what is accepted, the size cap, filename-to-title,
PDF text repair, and the empty-extraction diagnosis. It contains no `File`, no
filesystem and no parser — which is why the rules that actually bite are
unit-testable without fixtures. **Both the client and the route import it**, so
the browser's instant rejection and the server's cannot disagree.

### Details that only appear with real files

- **PDFs have no paragraphs.** Extractors emit one line per *rendered* line, so
  raw output is a column of fragments and the agent's `¶3` citations become
  meaningless. `cleanExtractedText` rejoins wrapped lines, repairs words
  hyphenated across a break (`nucleo-\nphile` → `nucleophile`), and drops page
  numbers alone on a line — while preserving blank-line paragraph breaks, which
  is the whole point. A test asserts the result still splits into two paragraphs.
- **A near-empty PDF is a scan, not an empty document.** Telling someone their
  file "contains no text" sends them after the wrong problem; the message says
  the page is an image.
- **Type is decided by extension, not `File.type`.** The MIME type is empty on
  many real drag-and-drop uploads and is trivially spoofed. `.doc` is
  deliberately refused rather than accepted and failed later — it is a different
  container that mammoth cannot open.
- **The 4 MB cap is Vercel's, not ours.** A serverless request body is capped at
  4.5 MB; above that the platform rejects it with an opaque error before our code
  runs. Staying under means the learner gets our message instead.

### Extracted text lands in the textarea

Not straight into a session. Only ~12,000 characters reach the agent, so a
silently truncated textbook would produce questions about its copyright page.
Putting the text in front of the learner — editable, filename shown above it —
makes trimming to the relevant chapter the natural next move.

---

## 10. The agent layer

`lib/quiz/` is transport-agnostic and pure, which is what let it be built and
tested before the transport was even known.

### Context construction — owning the budget

`buildQuizContext` normalises whitespace while **keeping paragraph breaks** (they
carry structure the agent can cite), then truncates to a character budget at a
clean boundary — sentence end, then paragraph, then word, then a hard cut:

```ts
// Prefer the last sentence terminator followed by whitespace, so "Fig. 2" and
// "p. 214" do not read as sentence ends.
const sentence = window.search(/[.!?]["')\]]?\s(?![\s\S]*[.!?]["')\]]?\s)/);
```

Cutting mid-sentence hands the agent a fragment it may quote back as if it were
whole, so the boundary matters more than squeezing in the last few characters.
`truncated` and `omittedChars` are returned and surfaced in the UI — the learner
is told when their material did not fit.

### Prompt design

Two turns share one preamble so tone and grounding rules cannot drift apart. The
material is delimited by explicit markers and declared the only permitted source:

```
<<<MATERIAL
…
MATERIAL>>>

- Ground everything in the excerpt. If the excerpt does not settle a point, say
  so rather than filling the gap from general knowledge.
```

The ask turn says *ask exactly one question and then stop*; the evaluate turn
defines the three verdicts explicitly.

### Transport — two implementations, one interface

```ts
export interface QuizAgent {
  ask(context, previouslyAsked): Promise<string>;   // RAW reply; parsing is separate
  evaluate(context, question, answer): Promise<string>;
}
```

`IblAgent` implements the protocol in AGENT_PROTOCOL.md: `POST /sessions/` for a
`session_id`, then one JSON frame over `wss://asgi.data.iblai.app/ws/langflow/`.
Billing rejections are detected specifically so a depleted platform does not look
like an empty answer:

```ts
if (/balance|credit/i.test(err)) reject(new AgentUnavailableError(err, "credits"));
```

A `settled` flag plus a shared `finish()` guarantees the promise resolves exactly
once across the `message` / `error` / `close` / timeout races.

`StubAgent` is not a mock of an LLM and does not pretend to understand anything.
It builds a question from a real sentence in the excerpt and grades by keyword
overlap. Its own explanation text says so: *"Offline practice mode: graded by
keyword overlap with the source passage, not by understanding."*

**What is unverified, and is flagged in the code:** the platform sits at −65
credits, so the success-path frame shape was never observed. `textFrom()`
accumulates from any of `data`, `message`, `response`, `content`, `text` and
ignores control frames. That is a reasoned guess, labelled as one.

### Parsing — a model is not a JSON API

It fences output, prefaces with "Sure!", or drops the schema. Each is
recoverable, and recovering beats showing a parse error mid-session.
`extractJsonObject` tries a ```` ```json ```` fence, then the first
balanced-looking object, then the raw text.

The one place recovery is *refused* is the verdict:

```ts
// Unknown means "look at it again", never "correct" — grading generously on a
// parse failure would quietly lie to the learner about what they know.
return "revisit";
```

A question falls back to treating the whole reply as the prompt, which is nearly
always the right reading. An evaluation has no safe prose fallback, so it becomes
`revisit` with the raw text as the explanation.

---

## 11. Testing discipline

```bash
pnpm test          # 64 Vitest unit tests
pnpm test:e2e      # 11 Playwright tests (needs e2e/.env.development)
pnpm lint          # 0 errors
pnpm build
```

### Vitest — the pure core

Configuration is deliberately minimal: no jsdom, no setup file, no mocking
framework. `vitest.config.ts` mirrors the `@/*` alias from `tsconfig.json` so
tests import the same specifiers the app does, and nothing else.

That is possible because the domain layer is pure. `lib/quiz/` has no React, no
network and no storage in it — which is a design property the tests *reward*
rather than a coincidence they exploit.

Coverage is context truncation, tolerant parsing, score accumulation, upload
validation and PDF text repair, and the open-redirect guard. The tests that earn
their keep encode **judgement**, not mechanics:

- an unparseable evaluation degrades to `revisit`, never `correct`
- re-evaluating a question replaces the verdict instead of appending
- cleaning PDF output preserves blank-line paragraph breaks — asserted by
  splitting the result and counting paragraphs, because that structure is what
  the agent's citations point at
- `.doc` is rejected, so the failure surfaces at upload rather than at parse

`__tests__/source-paths.test.ts` is unusual and worth keeping: it asserts the
Tailwind `@source` path exists on disk. That is the invariant the Windows symlink
bug violated, and it fails loudly instead of silently emitting no styles.

### Playwright — the journeys

`fullyParallel: false`, one worker locally, two under `CI`,
`trace: 'on-first-retry'`.

**Neither suite currently runs in CI.** The only GitHub workflow is
`tauri-build-desktop.yml`; the Playwright config reads `process.env.CI` but
nothing sets it. Both suites are run locally before a commit. Wiring `pnpm test`
into a workflow is trivial; wiring `pnpm test:e2e` is not, because auth setup
performs a real login and would need credentials in repository secrets — which
is a decision about exposing a live account to CI, not a config change.

**Auth setup runs once per browser** as a `setup` project and saves storage
state; journey projects declare `dependencies: ['setup-chromium']` and inherit
it. Real credentials, a real login against `login.iblai.app` — not a mocked
session.

The setup file carries a fix worth noting: the starter waited for `app=agent` in
the login URL, but `auth-utils.ts` builds the redirect with `app=custom`, so it
never matched and hung for the full 60 s. It now matches on `/login` plus the
presence of a `tenant` parameter, which holds for either value and still proves
the right tenant's login was reached.

Journeys cover the unauthenticated redirect, the authenticated render, the upload
round trip against a real PDF, the refusal path, and a full answer→evaluation
cycle.

### Accessibility as a test, not a review

Two axe scans run in the suite — one on the empty state where the upload
controls live, one on the answered surface — asserting **zero critical or
serious violations** against `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.
Failures print the rule id, impact and node count, so a failure is actionable
rather than a number.

This is why accessibility was built in rather than retrofitted: visible 2px focus
rings, `aria-live` on the margin rail and on extraction status, labelled inputs,
reduced motion respected, and colour never the sole carrier of a verdict.

Dragging a file is layered over a real labelled `<input type="file">` for the
same reason — a drop target is invisible to a screen reader and unreachable by
keyboard.

### Two process lessons that came out of testing

- **`grep -r` silently skips pnpm's symlinked package directories.** Several
  early "no results" were the tool lying rather than the code being absent. I
  only noticed when a path I had *seen in an error message* returned nothing.
  Use `grep -R`, or resolve the symlink first.
- **Never log a callback URL.** See §7.

### A binary fixture needs a `.gitattributes`

`e2e/fixtures/sn2-notes.pdf` is a hand-built 1.1 KB PDF whose bytes are almost
all printable ASCII, so git's text/binary heuristic classified it as text and
queued LF→CRLF conversion. That shifts every byte offset past the first newline —
and a PDF's xref table stores **absolute** offsets. The file would have survived
code review and failed to parse on a fresh Windows clone. `.gitattributes` marks
`*.pdf`, `*.docx` and images binary.

---

## Appendix — file map

| Path | Role |
|---|---|
| `app/layout.tsx` | Root server layout; fonts, metadata |
| `app/(app)/layout.tsx` | Client shell; navbar, `SessionHint`, `ReturnTo` |
| `app/(app)/page.tsx` | Landing page (server component) |
| `app/(app)/quiz/page.tsx` | Quiz shell + metadata (server component) |
| `app/sso-login-complete/page.tsx` | SSO callback, outside the `(app)` group |
| `app/api/quiz/route.ts` | Agent exchange |
| `app/api/quiz/extract/route.ts` | Document ingestion |
| `proxy.ts` | Next 16 middleware; `/quiz` redirect |
| `providers/iblai-providers.tsx` | Data layer init, `AuthProvider`, `TenantProvider`, Redux |
| `lib/iblai/auth-utils.ts` | Redirect construction, token expiry check, logout |
| `lib/iblai/session.ts` | Typed `localStorage` session via `useSyncExternalStore` |
| `lib/iblai/config.ts` | Runtime → build-time → fallback env resolution |
| `lib/iblai/tenant.ts` | Tenant precedence and mismatch detection |
| `lib/session-hint.ts` / `components/session-hint.tsx` | Host-only session cookie |
| `lib/return-to.ts` / `components/return-to.tsx` | Destination hand-off + open-redirect guard |
| `lib/quiz/context.ts` | Normalisation, budget, boundary truncation |
| `lib/quiz/prompt.ts` | Quizmaster prompt for both turns |
| `lib/quiz/agent.ts` | `IblAgent` (WebSocket) and `StubAgent` |
| `lib/quiz/parse.ts` | Tolerant model-reply parsing |
| `lib/quiz/score.ts` | Score accumulation, idempotent evaluation |
| `lib/quiz/extract.ts` | Upload rules and PDF text repair |
| `store/iblai-store.ts` | Single Redux store composition |
| `store/quiz-api.ts` / `store/quiz-slice.ts` | RTK Query mutations; session slice |
