# Auth notes

How authentication actually works in this app, traced through the code rather
than described in general terms — plus an honest account of where my own
knowledge runs out.

## 1. The SSO flow as implemented

### Where the redirect originates

`providers/iblai-providers.tsx` wraps the whole tree in the SDK's
`<AuthProvider>`, handing it two host-supplied functions from
`lib/iblai/auth-utils.ts`:

- `hasNonExpiredAuthToken()` — reads `axd_token` and `axd_token_expires` from
  `localStorage` and compares the expiry to `new Date()`.
- `redirectToAuthSpa()` — builds the login URL and assigns `window.location`.

When the token check fails, `AuthProvider` renders its `fallback` and calls
`redirectToAuthSpa()`. The URL is assembled at `auth-utils.ts:52`:

```
https://login.iblai.app/login?app=custom&redirect-to=<origin>&tenant=<platformKey>
```

Verified live: `http://localhost:3000` redirects to exactly that, with
`tenant=c4a0…`. (The starter's own E2E setup waited for `app=agent` here, which
this app never sends — fixed in `e2e/auth.setup.ts`.)

`initializeDataLayer` also registers a `401` handler that calls
`redirectToAuthSpa(undefined, undefined, true)`, so an expired token mid-session
forces a re-login. **That handler is the real enforcement point** — see §3.

### What comes back

The auth SPA returns to `/sso-login-complete`, which sits deliberately outside
the `(app)` route group and is additionally skipped by `AuthProvider`
(`skip={isSsoRoute}` plus a `PUBLIC_ROUTES` entry). Both guards exist because
`AuthProvider` would otherwise see "no tokens", redirect to login, and never let
the callback store them — the documented redirect-loop deadlock.

The SDK's `<SsoLogin>` component parses the response and writes:

| Key | Contents |
|---|---|
| `axd_token` / `axd_token_expires` | primary API token + expiry |
| `dm_token` / `dm_token_expires` | data-manager token + expiry |
| `edx_jwt_token` | signed edX JWT |
| `userData` | user id, email, nicename |
| `tenants`, `current_tenant` | tenancy |

Return path comes from `localStorage.redirectTo`, defaulting to `/`.

## 2. Two findings

### 2a. Tokens are delivered in the URL query string

This is the one I did not expect. The callback is not a POST and not a
fragment — the tokens arrive as a **query parameter**:

```
https://os.ibl.ai/sso-login-complete?redirect-path=%2F&data=%7B%22axd_token%22%3A%22…
```

`data` is a URL-encoded JSON blob containing `axd_token`, `dm_token`, and a full
`edx_jwt_token`.

Query strings leak in ways request bodies do not:

- **Browser history** — the tokens persist in the visitor's local history.
- **Server access logs** — most web servers, CDNs and reverse proxies log the
  full request line by default, so live credentials land in plaintext logs.
- **`Referer` headers** — a request to a third-party origin from that page can
  carry the full URL. Modern default referrer policies strip the query for
  cross-origin requests, so this is mitigated in current browsers rather than
  absent by design.
- **Anything that shoulder-reads a URL** — screenshots, pasted links, bug reports.

I found this the hard way: an instrumented Playwright run logged `page.url()` at
the callback and printed live tokens into a transcript. Those tokens had to be
rotated. Logging a URL is not normally a credential-handling operation, which is
exactly what makes this sharp.

Delivering the same payload in the URL **fragment** (`#…`, never sent to the
server, absent from logs) or as a form POST would remove the logging and history
exposure without changing the client-side model at all.

### 2b. localStorage vs httpOnly cookies

The SDK keeps `axd_token` and `dm_token` in `localStorage`
(`lib/iblai/storage-service.ts` is a thin wrapper), and mirrors some session
state into non-httpOnly cookies (`ibl_user_data`, `ibl_current_tenant`).

Stated neutrally, the tradeoff:

| | `localStorage` | httpOnly cookie |
|---|---|---|
| XSS exposure | readable by **any** script on the origin | not readable by JS |
| CSRF exposure | not sent automatically, so no ambient authority | sent automatically; needs SameSite/anti-CSRF |
| Cross-tab sync | trivial, plus a `storage` event | works, but harder to observe |
| Client-side access | direct — needed here, since the SDK attaches bearer tokens from JS | impossible without a server round trip |
| Server-side access | impossible — never transmitted | available to middleware and route handlers |

This is a real tradeoff, not a bug. The SDK is a browser SDK that talks to the
ibl.ai API directly from the client and supports Tauri desktop/mobile shells;
httpOnly cookies would require a same-origin backend to proxy every call, which
this architecture does not have. The cost is that one XSS anywhere on the origin
yields both tokens.

## 3. Why the middleware is not a security boundary

> The file is `proxy.ts`, not `middleware.ts`. Next 16 renamed the convention —
> same feature and same `config.matcher`, with the export renamed from
> `middleware` to `proxy`. Keeping the old name emits a deprecation warning on
> every build.


The plan called for middleware gating `/quiz` on the session. **That cannot work
as stated**, and understanding why is the point:

> `localStorage` is never transmitted. Middleware runs on the server and sees
> only cookies and headers. It cannot observe this session at all.

What it *can* see is `ibl_user_data` — but that cookie is written by client-side
JavaScript and is not httpOnly, so anyone can set it from the console. Its
presence proves nothing.

So `proxy.ts` here is deliberately scoped as a **UX optimisation**:

- an unauthenticated visitor is redirected before the client bundle loads,
  instead of flashing the quiz shell and bouncing
- the intended destination is parked in `sb_return_to` and restored by
  `components/return-to.tsx` after login (validated as a root-relative path, so
  the cookie cannot drive an open redirect)

Access is actually enforced in three places, none of them the router:

1. `AuthProvider` gates rendering on the token check, client-side.
2. **The ibl.ai API rejects requests without a valid bearer token.** This is the
   only check an attacker cannot skip, and it is where the boundary really sits.
3. `/api/quiz` never accepts agent credentials from the browser — it holds the
   platform token server-side, so a forged cookie buys a page render and no data.

A middleware check that *looked* authoritative would be worse than none: it
invites the next person to trust it.

## 4. What I would need to learn to own this properly

I have not implemented OAuth or OIDC from scratch. I can read this flow, reason
about where its tokens live, and find real problems in it — the two above — but
that is a different skill from building the issuer. Concretely, the gaps:

- **Authorization Code flow with PKCE.** I understand the shape — code
  challenge, verifier, exchange — but have not implemented the verifier
  lifecycle or thought hard about where it is stored in a SPA.
- **Refresh-token rotation.** This app has none: `axd_token` simply expires
  (~10 days) and the 401 handler forces a full re-login. I would need to learn
  rotation with reuse detection, and how to serialise concurrent refreshes so
  parallel 401s do not each fire their own.
- **JWT signature verification against a JWKS endpoint.** `edx_jwt_token` is
  RS512 (`{"alg":"RS512","typ":"JWT"}`). Nothing in this app verifies it — it is
  passed through as a bearer credential. I can decode a JWT and read its claims;
  I have not implemented key fetching, `kid` selection, caching, or rotation.
- **SAML assertion handling.** No practical exposure at all. I know it is
  XML-based and that signature verification is the hard part.
- **Session fixation and CSRF specifics** for a cookie-based redesign — if the
  tokens moved to httpOnly cookies, SameSite alone would not be a complete
  answer and I would need to work through the double-submit / origin-check
  options properly.

The honest summary: I can operate and debug someone else's auth, and I can spot
where it leaks. I have not built one, and that is the part of this role I most
want to learn.
