# Findings from building on iblai/vibe

Notes taken while building [StudyBuddy](https://studdybuddy-lemon.vercel.app) —
a quiz app scaffolded from `vibe-starter` and deployed to Vercel, roughly six
hours end to end.

Everything here was hit in normal use, not by going looking for it. Each entry
has a reproduction and a fix, and the three categories are kept apart
deliberately: **bugs** are things that are wrong, **gaps** are things that are
missing, and **tradeoffs** are decisions that look surprising but are defensible
and are recorded so they are not mistaken for the first two.

| | |
|---|---|
| Scaffold | `iblai/vibe-starter`, `spa` branch — baseline commit [`b072976`](https://github.com/Eduard-K-A/studdybuddy/commit/b072976) |
| SDK | `@iblai/iblai-js@1.6.0` |
| Stack | Next.js 16.2.4, React 19.2.4, Tailwind v4, pnpm |
| Environment | Windows 11, plus a Vercel deployment |

---

## Summary

| # | Finding | Where | Type | Severity |
|---|---|---|---|---|
| 1 | `.gitignore` pattern does not match `iblai.env`, which holds the API key | starter | Security | **High** |
| 2 | Cookie domain derived from the last two hostname labels | SDK | Bug | **High** |
| 3 | `current_tenant` written in two shapes → infinite login redirect | starter | Bug | **High** |
| 4 | Symlinked `@source` path emits zero Tailwind classes on Windows | starter | Bug | **High** |
| 5 | Starter pins SDK 1.6.0; skills document 2.x APIs | toolkit | Docs | **High** |
| 6 | E2E auth setup waits for a parameter the app never sends | starter | Bug | Medium |
| 7 | Module-dedup alias registered only for webpack; Next 16 dev is Turbopack | starter | Latent | Medium |
| 8 | Tauri template assumes a fully static export | skills | Design | Medium |
| 9 | `iblai` CLI is not publicly distributed | toolkit | Docs | Medium |
| 10 | `Profile` flips a controlled input to uncontrolled | SDK | Bug | Low |
| 11 | Vitest ships configured but with no `test` script | starter | Papercut | Low |
| 12 | Template identity left in place | starter | Papercut | Low |

---

# Bugs

## 1. `.gitignore` does not ignore the file holding the platform API key

**Severity: high — a stock scaffold commits its own credentials.**

`.gitignore` (baseline, line 34):

```
.env*
```

That pattern matches names *starting with* `.env`. The file holding `TOKEN`,
the platform API key, is `iblai.env` — which starts with `iblai`. It is not
matched, so it is staged by the first `git add -A`.

**Reproduction**

```python
import fnmatch
fnmatch.fnmatch('iblai.env', '.env*')   # False
fnmatch.fnmatch('iblai.env', '*.env')   # True
```

**Why it is easy to miss.** `.env*` reads as "all env files" to almost anyone.
It is a prefix glob, not a substring one, and the platform's own docs instruct
you to put the token in `iblai.env`.

**Fix.** Add to the starter's `.gitignore`:

```
iblai.env
```

Caught here before a real value was entered, and fixed in the second commit of
this repo.

---

## 2. Cookie domain is derived from the last two hostname labels

**Severity: high — the session silently disappears on several common hosts.**

`@iblai/iblai-js@1.6.0`, `dist/web-containers/source/next/index.esm.js:25`:

```js
const getBaseDomain = () => {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return hostname;
    }
    const parts = hostname.split('.');
    if (parts.length === 2) {
        return hostname;
    }
    if (parts.length > 2) {
        return `.${parts.slice(-2).join('.')}`;   // ← here
    }
    return hostname;
};
```

Used by `setCookie` on the next line down:

```js
const baseDomain = getBaseDomain();
const domainAttr = baseDomain ? `;domain=${baseDomain}` : '';
document.cookie = `${name}=…;path=/;SameSite=None;Secure${domainAttr}`;
```

**What happens.** For `studdybuddy-lemon.vercel.app`, `getBaseDomain()` returns
`.vercel.app`. **`vercel.app` is on the [Public Suffix List](https://publicsuffix.org/)**,
and browsers reject any cookie scoped to a public suffix — otherwise one
deployment could set a cookie that every other app on the platform could read.

The cookie is dropped with no error. Anything depending on it — cross-SPA
session sharing, and in this app a middleware route gate — sees no session and
behaves as though the user is logged out.

**Why it cannot reproduce locally.** `localhost` hits the first early return.
A two-label domain hits the second. The faulty branch only executes when the
hostname has **three or more labels**, which is exactly the shape of a
deployment URL and never the shape of a development one.

**Where else this bites.** The assumption is that the registrable domain is
always the last two labels. That is false for every multi-label public suffix:

- `*.vercel.app`
- `*.github.io`
- `*.pages.dev`
- `*.netlify.app`
- `*.co.uk`, `*.com.au`, `*.co.jp` — every country-code second-level domain

So it is a portability bug rather than a Vercel-specific one.

**Fix.** Resolve the registrable domain against the Public Suffix List rather
than by counting labels — [`tldts`](https://www.npmjs.com/package/tldts) or
[`psl`](https://www.npmjs.com/package/psl) both do this in one call:

```js
import { getDomain } from 'tldts';

const getBaseDomain = () => {
  const { hostname } = window.location;
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
  const registrable = getDomain(hostname);      // null for a public suffix
  return registrable && registrable !== hostname ? `.${registrable}` : hostname;
};
```

Falling back to a host-only cookie — omitting the `domain` attribute entirely —
is correct whenever the registrable domain cannot be established. A host-only
cookie is never rejected by the public-suffix rule; it simply does not share
across subdomains, which is the right degradation.

**Workaround used here.** A separate host-only cookie written with no `domain`
attribute at all, with the route gate accepting either that or the SDK's, so
the SDK's still short-circuits a hop on a normal registrable domain.

---

## 3. `current_tenant` is written in two incompatible shapes

**Severity: high — an unbreakable login redirect loop.**

The SDK mirrors `current_tenant` into a cookie as an object:

```json
{"key":"c4a0…"}
```

The scaffold's `saveCurrentTenant` wrote it to `localStorage` as a bare string:

```js
localStorage.setItem('current_tenant', key);
```

An interval compares the two, sees a difference on every tick, concludes another
SPA changed the tenant, and redirects to the auth SPA. Then again. Forever.

**The scaffold contradicts itself.** `app/(app)/layout.tsx` already reads the
value back with `JSON.parse(...)?.key` — so one part writes a string while
another expects an object.

**How it presented.** No error, no stack trace, only a redirect. Diagnosis
needed the SDK's own console output:

```
[syncCookiesToLocalStorage] cookieCurrentTenant {"key":"c4a0…"}
[syncCookiesToLocalStorage] localCurrentTenant  c4a0…
[AuthProvider] interval poll result {needsRefresh: true}
[auth-redirect] Cookie sync detected changes from another SPA
```

Three E2E tests failed and one passed — the fastest one, which only filled a
textarea and checked a disabled button, finishing before the interval fired.
That was the clue.

**Fix.** Write the object shape everywhere:

```js
localStorage.setItem('current_tenant', JSON.stringify({ key }));
localStorage.setItem('tenant', key);   // stays a bare key; resolveAppTenant reads this one
```

Worth grepping for every writer — in this repo there were two, and the second
(the navbar tenant switcher) was found later than the first.

---

## 4. A symlinked Tailwind `@source` path silently emits zero classes on Windows

**Severity: high — SDK components render unstyled, with no build error.**

`app/iblai-styles.css` (baseline, line 28):

```css
@source "../lib/iblai/sdk/web-containers/source";
```

`lib/iblai/sdk` is a symlink into `node_modules`. **Git on Windows defaults
`core.symlinks=false`**, so it is checked out as a regular file containing its
own target path:

```
$ git ls-tree b072976 lib/iblai/
100644 blob 5aba82a…    lib/iblai/sdk          ← 100644 = regular file (120000 = symlink)

$ git cat-file -p 5aba82a
../../node_modules/@iblai/iblai-js/dist        ← 39 bytes of path text

$ git config core.symlinks
false
```

Tailwind v4 then scans a path that does not resolve to a directory, finds no
class names, and **generates no utility classes for SDK components**. There is
no warning and no build failure — the CSS is simply missing.

**How it was caught.** The scaffold's own test suite failed 4 of 6 on a clean
clone.

**A second-order effect worth noting.** Because it checks out as a regular file,
committing it back bakes the Windows artifact into the repository, so the
breakage then propagates to everyone who clones — on any OS.

**Fix.** Point `@source` at `node_modules` directly, which needs no symlink on
any platform. This is already the form the `iblai-vibe-auth` skill documents at
Step 7, so the two just need to agree:

```css
@source "../node_modules/@iblai/iblai-js/dist/web-containers/source";
```

A test asserting the `@source` path exists on disk keeps it honest — that is the
invariant this bug violated, and it fails loudly instead of silently shipping
unstyled UI.

---

## 6. E2E auth setup waits for a parameter the app never sends

**Severity: medium — a 60-second hang, in the starter's own test suite.**

`e2e/auth.setup.ts:29`:

```ts
await page.waitForURL(
  (url) => url.href.includes('/login') && url.href.includes('app=agent'),
```

`lib/iblai/auth-utils.ts:52` builds the redirect:

```ts
let authUrl = `${config.authUrl()}/login?app=custom&redirect-to=${redirectOrigin}`;
```

`app=agent` versus `app=custom`. The condition can never be satisfied, so setup
waits its full 60-second timeout and fails. Both files ship in the same repo.

**Fix.** Match on something true for either value, and still prove the right
tenant's login page was reached:

```ts
await page.waitForURL(
  (url) => url.href.includes('/login') && url.searchParams.has('tenant'),
```

---

## 7. The module-dedup alias is registered only for webpack

**Severity: medium — currently inert; fails silently if it ever matters.**

`next.config.ts` aliases `@reduxjs/toolkit`, `react-redux` and `@iblai/data-layer`
to single resolved directories, because two copies of Redux produce two
`ReactReduxContext` instances and RTK Query hooks then return `undefined` with
no error at all.

The guard is registered under `webpack:` (line 52), while `turbopack: {}`
(line 51) is empty — and **Next 16 runs `next dev` with Turbopack by default**.
The alias therefore does not apply in development.

Nothing is broken today, because pnpm happens to resolve exactly one copy of
each. But the protection is not present where it was intended, and the failure
it guards against is a silent `undefined` rather than a crash.

**Fix.** Mirror the aliases into `turbopack.resolveAlias` so the guard holds in
both bundlers.

---

## 10. `Profile` changes a controlled input to an uncontrolled one

**Severity: low — a development-only React warning.**

`@iblai/iblai-js@1.6.0`, `dist/web-containers/source/index.esm.js`.

The form defaults every field with a fallback (line 55009):

```js
fullName: userMetadata?.name     || '',
email:    userMetadata?.email    || '',
username: userMetadata?.username || '',
title:    userMetadata?.title    ?? '',
about:    userMetadata?.about    || '',
language: userMetadata?.public_metadata?.language || '',
```

The effect that resets the form once the profile API resolves has none
(line 55107):

```js
basicForm.reset({
  fullName: userProfile.name,
  email:    userProfile.email,
  username: userProfile.username,
  title:    userProfile.title,
  about:    userProfile.about,
  language: userProfile?.public_metadata?.language,
  …
});
```

So the first render is controlled (`''`), and any field the API omits or returns
`null` for becomes `undefined` after the reset — which React reports as:

> A component is changing a controlled input to be uncontrolled.

The two blocks are fifty lines apart and disagree with each other. `title` even
uses `?? ''` in the defaults, so the distinction was considered in one place and
not the other.

**Fix.** Apply the same fallbacks in the reset, ideally by extracting one
`toFormValues(userProfile)` used by both.

---

# Gaps and packaging

## 5. The starter and the skills are a major version apart

**Severity: high — it is the first thing a new developer hits.**

`vibe-starter` pins:

```json
"@iblai/iblai-js": "^1.6.0"
```

The skills document 2.x APIs. These appear in skill example code and are not
exported by 1.6.0 — checked against the installed type definitions rather than
the docs:

| Hook | Exported in 1.6.0 `.d.ts` |
|---|---|
| `useUsername` | 0 |
| `useAxdToken` | 0 |
| `useCachedSessionId` | 0 |
| `useUserTenants` | 0 |
| `useVisitingTenant` | 0 |
| `useChatV2` | 0 |

The practical consequence is that snippets cannot be pasted as-is into a fresh
scaffold — which is the exact path the toolkit is optimised for.

**Fix.** Either bump the starter's pin, or version the skills against the
version the starter installs. A one-line note in each skill stating the minimum
SDK version would also resolve it.

---

## 8. The Tauri template assumes a fully static export

**Severity: medium — silently removes the server half of any app that has one.**

`iblai-vibe-ops-build` ships:

```json
"beforeBuildCommand": "pnpm build",
"frontendDist": "../out"
```

and the skill states that all platforms use a static `next build` export. For
the stock vibe app that is correct — everything is a client-side SDK call, so
there is no server half to lose.

It stops being correct as soon as an app has one. `output: "export"` drops route
handlers and middleware. In this app that would have removed the route handler
holding the platform API token server-side, forcing the agent call into the
browser and shipping the token with it — trading the app's one real security
property for a packaging convenience.

**Fix.** Tauri v2 accepts a URL in `frontendDist`, which keeps the server half
intact and makes the desktop app a native shell over the real deployment. The
generated `capabilities/default.json` already allows `https://*.vercel.app/*`,
so the toolkit anticipates this — the skill just does not mention the case. A
sentence noting that apps with route handlers should point `frontendDist` at a
deployed origin would cover it.

---

## 9. The `iblai` CLI is not publicly distributed

**Severity: medium — documented as the entry point, not installable.**

```
npm view @iblai/cli            → 404
pypi.org/pypi/iblai-app-cli    → 404
```

Two independent channels, both absent. `iblai add builds` and `iblai deploy` are
consequently unavailable; the Tauri templates were rendered by hand instead.

Cost here was low, because `iblai-vibe-scaffold/SKILL.md` names `vibe-starter`
as the *preferred* greenfield path anyway. But documentation that opens with
`iblai startapp agent` sends a new developer to a 404 first.

**Fix.** Lead the docs with the `vibe-starter` path, or note that the CLI is
internal.

---

## 11. Vitest ships configured but cannot be run

**Severity: low.**

The baseline has `vitest@^4.1.5` in `devDependencies`, a `vitest.config.ts`, and
`__tests__/source-paths.test.ts` — and **no `test` script**. Only `test:e2e` and
its variants are wired.

**Fix.** `"test": "vitest run"`.

---

## 12. Template identity is left in place

**Severity: low.**

Baseline `package.json` has `"name": "vibe-starter"` and the root layout's
`metadata.title` matches. Both ship to production unless noticed.

**Fix.** A `startapp` step that rewrites both, or a note in the scaffold skill.

---

# Tradeoffs, recorded so they are not mistaken for bugs

**`localStorage` rather than `httpOnly` cookies.** The SDK is a browser SDK that
calls the platform API directly from the client and supports Tauri shells;
`httpOnly` cookies would require a same-origin backend proxying every call,
which this architecture does not have. The cost is that one XSS anywhere on the
origin yields the tokens, and that server-side middleware is structurally unable
to observe the session. That is a real tradeoff with a real justification, not a
defect.

**`SameSite=None; Secure` on the shared cookies.** Necessary for the cross-SPA
sharing the cookie exists to provide. Worth being deliberate about, not wrong.

**Client-side auth gating.** `AuthProvider` blocking paint until a session
resolves is what makes SSO work without a server session. It does set the
performance ceiling — in this deployment, session resolution is a serial chain
of eight cross-origin calls, each with a CORS preflight, and nothing paints
until it finishes. Measured LCP was 14.9 s against a 38 ms TTFB. That is an
architectural consequence rather than a bug, and the fix — moving session
resolution off the render path — is the same change as the `localStorage`
question above.

---

# One security observation about the auth flow

Not part of the toolkit, but found through it.

The SSO callback delivers `axd_token`, `dm_token` and `edx_jwt_token` as a
**URL query parameter**:

```
/sso-login-complete?redirect-path=%2F&data=%7B%22axd_token%22%3A%22…
```

Query strings persist in browser history and are logged in full by most servers,
CDNs and reverse proxies by default, so live credentials land in plaintext logs.

I found this the direct way: an instrumented Playwright run logged `page.url()`
at the callback and printed live tokens into a transcript. Those tokens were
rotated. Logging a URL is not normally a credential-handling operation, which is
what makes it easy to do by accident.

In standards terms this is shaped like the **implicit flow**, which OAuth 2.1
removes — and it does not take implicit's one precaution of using the URL
fragment, which browsers never transmit to a server.

**Fix.** Deliver the same payload in the fragment (`#…`) or as a form POST.
Either removes the history and logging exposure without changing the
client-side model at all.

---

## Method

Nothing here came from an audit pass. The sequence was: clone the starter, run
its tests before trusting it, build a real feature, deploy it, and write down
whatever cost time. Findings 1, 4, 6 and 11 surfaced in the first hour; 2 and 3
only appeared once there was a deployment and a session to lose; 5 appeared the
first time a skill snippet was pasted.

The two that would not have been found any other way are **2** and **4** — one
only executes when the hostname has three or more labels, and the other only on
a platform where git does not create symlinks. Neither can reproduce in a Linux
CI job against `localhost`.
