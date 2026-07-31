/**
 * A host-only "a session probably exists" cookie, shared between `proxy.ts`
 * (server) and `components/session-hint.tsx` (client).
 *
 * Separate module for the same reason as `lib/return-to.ts`: importing anything
 * from `proxy.ts` into a client component drags `next/server` into the browser
 * bundle and breaks at runtime.
 *
 * ---
 *
 * WHY THIS EXISTS — the deploy bug it fixes.
 *
 * `proxy.ts` originally gated /quiz on `ibl_user_data`, the cookie the SDK
 * mirrors the session into for cross-SPA sync. That worked on localhost and
 * failed on every /quiz navigation once deployed to Vercel.
 *
 * The SDK derives the cookie's domain from the hostname:
 *
 *   const parts = hostname.split('.');
 *   if (parts.length === 2) return hostname;
 *   if (parts.length > 2)   return `.${parts.slice(-2).join('.')}`;
 *
 * For `studdybuddy-lemon.vercel.app` that yields `.vercel.app`, so the SDK
 * writes `domain=.vercel.app`. **`vercel.app` is on the Public Suffix List**,
 * and browsers reject cookies scoped to a public suffix — otherwise one
 * deployment could set a cookie readable by every other app on the platform.
 * The cookie is silently dropped, `ibl_user_data` never exists on the origin,
 * and middleware redirected every visit back to `/`.
 *
 * localhost hits the function's early return and keeps the hostname as-is,
 * which is exactly why the bug was invisible in development.
 *
 * The rule generalises: the SDK's heuristic assumes the registrable domain is
 * always the last two labels. That is wrong for every multi-label public suffix
 * (`*.vercel.app`, `*.github.io`, `*.pages.dev`, `*.co.uk`). Any of those
 * deploy targets would hit this.
 *
 * This cookie is written with **no domain attribute at all**, making it
 * host-only — the browser scopes it to the exact origin, which is all this app
 * needs and which no public-suffix rule can reject.
 *
 * It is still NOT a security boundary. It is client-written and not httpOnly,
 * so anyone can set it by hand; its presence proves nothing. See
 * docs/AUTH_NOTES.md. It buys a redirect before the client bundle loads,
 * and nothing else.
 */

/** Host-only. Presence means "the client believed it had a session". */
export const SESSION_HINT_COOKIE = "sb_session";

/**
 * The SDK's own cross-SPA cookie. Still honoured when present — on a normal
 * registrable domain it is set correctly and saves a hop — but never required.
 */
export const SDK_SESSION_COOKIE = "ibl_user_data";

/** Bounded so a stale hint cannot outlive a session by long. */
export const SESSION_HINT_MAX_AGE = 60 * 60 * 12;
