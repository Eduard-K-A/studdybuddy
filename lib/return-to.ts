/**
 * Shared between `middleware.ts` (server) and `components/return-to.tsx`
 * (client).
 *
 * It lives in its own module rather than being exported from `middleware.ts`
 * because importing anything from there into a client component pulls
 * `next/server` into the browser bundle, which breaks at runtime — the app then
 * fails to mount and never starts the SSO redirect at all.
 */

/** Where the intended destination is parked across the SSO round trip. */
export const RETURN_TO_COOKIE = "sb_return_to";

/**
 * Only same-origin absolute paths may be navigated to. The value comes from a
 * cookie, which is attacker-controllable, so treating it as a URL would be an
 * open redirect. Rejects `//evil.com` and `https://evil.com`.
 */
export function isSafeReturnPath(value: string | undefined): value is string {
  return typeof value === "string" && /^\/(?!\/)/.test(value);
}
