# The ibl.ai agent protocol, as observed

The vibe toolkit is built for the browser: every skill mounts a React component
that talks to ibl.ai from the client. There is no documented server-side API for
calling an agent, and StudyBuddy needed one — plan §7.3 asks for a route handler
that owns the agent exchange rather than calling it from the client.

This is what the protocol turned out to be, and how it was established.

## How it was found

Reverse-engineering the SDK bundles failed, and the failures were informative:

- No public OpenAPI schema — `/docs`, `/swagger`, `/redoc`, `/openapi.json` all 404.
- `grep -c WebSocket` over both `@iblai/iblai-js` bundles returns **0**. The
  socket is not in the SDK at all, so `ChatConfig.baseWsUrl` is a passthrough.
- `grep -r` silently skips pnpm's symlinked package directories. Several early
  "no results" were the tool lying rather than the code being absent; `grep -R`
  or resolving the symlink first fixes it.

What worked was watching the real thing: log into ibl.ai's own agent surface
with Playwright, send one message, and record every request and WebSocket frame.

> **Redact callback URLs when logging.** The SSO callback carries `axd_token`,
> `dm_token` and `edx_jwt_token` **in the query string**, so a plain
> `console.log(page.url())` prints live credentials. See
> [AUTH_NOTES.md](AUTH_NOTES.md).

## REST surface

Base: `https://api.iblai.app/dm/api/ai-mentor/orgs/{org}`

Authenticated with the **platform** token — `Authorization: Api-Token <TOKEN>`.
Verified against a real tenant:

| Method | Path | Result |
|---|---|---|
| `POST` | `/users/{user}/sessions/` | `200` → `{ session_id, tools, enable_artifacts, artifacts }` |
| `GET` | `/users/{user}/sessions/{id}/` | `200` (also `PUT`, `DELETE`) |
| `GET` | `/users/{user}/mentors/{mentorId}/` | `200` → full agent config |
| `GET` | `/users/{user}/mentors/{mentorId}/public-settings/` | `200`, works anonymously |

`GET /users/{user}/sessions/` returns **405 with `Allow: POST, OPTIONS`** — the
405 is what revealed that session creation was a POST rather than a missing
endpoint.

The agent config includes `system_prompt`, `study_mode_prompt`, `llm_provider`,
`llm_name`, `suggested_prompts`, `tools`, and the moderation/safety prompts — so
the quizmaster prompt could also be set platform-side instead of per request.

## Message transport — WebSocket

```
wss://asgi.data.iblai.app/ws/langflow/
```

Send one JSON frame:

```json
{
  "flow": {
    "name": "<mentorId>",
    "tenant": "<platformKey>",
    "username": "<iblUsername>",
    "pathway": "<mentorId>"
  },
  "session_id": "<from POST /sessions/>",
  "token": "<auth token>",
  "prompt": "<the message>"
}
```

First frame back on success:

```json
{ "detail": "Connected.", "status_code": 200, "session_id": "…" }
```

On a platform with no credit balance, the socket instead closes with:

```json
{ "error": "Insufficient balance. Please add credits to continue.",
  "details": { "platform_key": "…", "available_credits": -65, "required_credits": … } }
```

### The platform token authenticates the socket

The browser sends the user's `axd_token` in the `token` field. Substituting the
**platform `Api-Token`** was tested and reached the billing check — i.e. it
passed authentication and failed on business logic. That is what makes a
server-side route handler worthwhile: the browser never has to hand its session
token to our backend, and the platform token never reaches the browser.

## What is NOT verified

**The success-path frame shape.** The tenant this was built against sits at
**-65 credits**, so the agent never generated a completion. Every frame observed
was either the `Connected.` handshake or the billing rejection.

`IblAgent` in [`lib/quiz/agent.ts`](../lib/quiz/agent.ts) therefore accumulates
text from any of `data`, `message`, `response`, `content`, `text` and ignores
control frames. That is a reasonable reading, not a confirmed one — expect to
adjust `textFrom()` on the first run against a funded platform. Streaming
semantics (per-token deltas vs. one final frame) are likewise unconfirmed.

Because of this, `app/api/quiz/route.ts` falls back to a deterministic offline
agent when the live call fails on credits, and every response carries
`mode: "live" | "offline"` so the UI can label offline sessions rather than
present keyword matching as real evaluation.
