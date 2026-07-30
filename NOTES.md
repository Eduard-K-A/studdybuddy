# Recon notes — vibe-starter baseline

Working file (Phase 2 / Gate 2). Not shipped. Findings that shaped later phases.

Baseline: `eedbb41` — untouched `iblai/vibe-starter@spa`.

---

## Gate 2 answer, in one sentence

The app is a Next.js 16 App Router SPA that redirects to `login.iblai.app` on
first load, stores the returned session **entirely in `localStorage`**
(`axd_token`, `dm_token`, `userData`, `tenants`), and renders a navbar plus
home / profile / account / notifications pages behind a client-side auth gate.

---

## 1. Route tree

```
app/
├── layout.tsx                          root — fonts, <IblaiProviders>
├── globals.css / iblai-styles.css
├── sso-login-complete/page.tsx         SSO callback (OUTSIDE the (app) group)
└── (app)/
    ├── layout.tsx                      'use client' — navbar + drawer + <main>
    ├── page.tsx                        home
    ├── profile/page.tsx
    ├── account/page.tsx
    └── notifications/[[...id]]/page.tsx
```

Already present, so no `iblai add` needed: auth, navbar, profile, account,
notifications. Absent: chat surface, datasets, **quiz** (that's the build).

The SSO callback sits at `app/sso-login-complete/`, deliberately outside
`(app)`. `IblaiProviders` additionally skips its auth gate on that path
(`PUBLIC_ROUTES`, plus `skip={isSsoRoute}`). Both guards exist because
`AuthProvider` would otherwise see "no tokens" and bounce to login before the
callback could store them — the documented redirect-loop deadlock.

## 2. Provider hierarchy

`app/layout.tsx` → `IblaiProviders` (`providers/iblai-providers.tsx`, `'use client'`):

```
ReduxProvider (store/iblai-store.ts)
└── AuthProvider      @iblai/iblai-js/web-utils
    └── TenantProvider @iblai/iblai-js/web-utils
        └── {children}
```

`initializeDataLayer(dmUrl, lmsUrl, legacyLmsUrl, storageService, {401: …})` is
called inside a `useState` initializer so it runs **during** the render pass,
before any child RTK Query hook fires. The 401 handler force-redirects to login.

Store (`store/iblai-store.ts`) already registers `coreApiSlice`, `mentorReducer`,
`chatSliceShared`, `files`. To add quiz state I extend this store rather than
creating a second one — a second store would sit under a different
`ReactReduxContext` and SDK hooks would break.

## 3. Where the session lives — the important finding

`lib/iblai/storage-service.ts` is a thin `window.localStorage` wrapper.
`app/sso-login-complete/page.tsx` names every key it writes:

| Key | Contents |
|---|---|
| `axd_token` / `axd_token_expires` | primary API token + expiry |
| `dm_token` / `dm_token_expires` | data-manager token + expiry |
| `userData`, `tenants`, `current_tenant` | profile + tenancy |
| `edx_jwt_token` | edX bridge token |

`hasNonExpiredAuthToken()` (`lib/iblai/auth-utils.ts:64`) reads `axd_token`,
compares `axd_token_expires` to `new Date()`, and returns a boolean.

**There are no cookies.** `grep -r cookie` over application code returns hits
only in `pnpm-lock.yaml` (transitive deps) and in the plan document itself.

### Consequence for Phase 5

`localStorage` is not transmitted with requests. Next.js middleware runs on the
server and sees only cookies and headers. **Middleware therefore cannot read
this session** — a `middleware.ts` that gates `/quiz` on auth is not
implementable against this scaffold as designed. Plan §8.1 assumed otherwise.

What is actually enforcing auth today: `AuthProvider`, a client component, which
renders `fallback` and calls `redirectToAuthSpa()` when the token check fails.
The real security boundary is the API rejecting an absent/expired bearer token
(the `401` handler above) — not the routing layer.

## 4. `.mcp.json`

Absent from vibe-starter (the scaffold skill lists it under `assets/shared/`,
but the starter does not ship it). Plan §5 step 4 applies — create it.

## 5. Landmines spotted for later phases

1. **`e2e/auth.setup.ts:30` waits for `app=agent` in the login URL, but
   `auth-utils.ts:52` sends `app=custom`.** The E2E auth setup will hang for its
   full 60 s and fail. Starter bug; will hit this in Phase 6.
2. **`next.config.ts` puts the RTK dedup in `webpack:` only, while `turbopack: {}`
   is empty.** Next 16 `next dev` uses Turbopack by default, so the alias that
   prevents duplicate `@reduxjs/toolkit` does not apply in dev. If RTK Query
   hooks return `undefined` in dev but work in `next build`, this is why.
3. `package.json` has no `test` script, though `vitest` and
   `__tests__/source-paths.test.ts` and `vitest.config.ts` all exist. Only
   `test:e2e` is wired.
4. Identity is still the template's: package `name: "vibe-starter"`, root
   `metadata.title: "vibe-starter"`.
5. Installed `@iblai/iblai-js` is **1.6.0**; npm latest is **2.2.4**. Not
   upgrading unprompted — the starter is pinned `^1.6.0` and the skills'
   documented prop names track the version they shipped against.
6. `app/(app)/layout.tsx` is `'use client'`. Pages nested under it can still be
   server components (App Router passes `children` as a server-rendered slot),
   but nothing in that subtree can read the session server-side — see §3.

## 6. Security issue found in the template

`.gitignore` ignores `.env*`, which does **not** match `iblai.env` — that
pattern matches names *starting* with `.env`. `iblai.env` holds `TOKEN`, the
platform API key. On a public repo this leaks it. Fixed in the commit after the
baseline; caught before any real value was entered.
