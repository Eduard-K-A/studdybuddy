import { NextResponse, type NextRequest } from "next/server";

import { RETURN_TO_COOKIE } from "@/lib/return-to";

/**
 * Route protection for /quiz.
 *
 * READ THIS BEFORE TRUSTING IT: this is a UX optimisation, NOT a security
 * boundary. See docs/AUTH_NOTES.md for the full reasoning.
 *
 * The ibl.ai session lives in localStorage, which is never transmitted, so
 * middleware cannot see it. What middleware CAN see is `ibl_user_data`, a
 * cookie the SDK mirrors the session into — but that cookie is written by
 * client-side JavaScript and is not httpOnly, so anyone can set it by hand.
 * Its presence proves nothing.
 *
 * What this buys, honestly:
 *   - an unauthenticated visitor is redirected before the client bundle loads,
 *     instead of flashing the quiz shell and then bouncing
 *   - the intended destination survives the round trip
 *
 * What actually enforces access:
 *   - `AuthProvider` gates rendering on a real token check, client-side
 *   - the ibl.ai API rejects requests without a valid bearer token, which is
 *     the only check an attacker cannot skip
 *   - /api/quiz never trusts the browser for agent credentials; it holds the
 *     platform token server-side
 */

/** Set by the SDK from the session. Non-httpOnly and client-written. */
const SESSION_HINT_COOKIE = "ibl_user_data";

const PROTECTED = [/^\/quiz(?:\/|$)/];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!PROTECTED.some((p) => p.test(pathname))) return NextResponse.next();
  if (request.cookies.has(SESSION_HINT_COOKIE)) return NextResponse.next();

  // Send them to the app root, where AuthProvider owns the real token check and
  // starts the SSO flow. Deliberately NOT redirecting straight to the auth SPA:
  // the SDK's callback reads its return path from localStorage, which only the
  // client can populate, so routing through the app keeps one owner of that flow.
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";

  const response = NextResponse.redirect(url);

  response.cookies.set(RETURN_TO_COOKIE, `${pathname}${search}`, {
    path: "/",
    maxAge: 60 * 10,
    sameSite: "lax",
    // Readable by the client on purpose: the client is what performs the
    // post-login navigation. It carries a path, never a credential.
    httpOnly: false,
  });

  return response;
}

export const config = {
  // Skip Next internals and static assets so the middleware only runs on real
  // navigations.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
