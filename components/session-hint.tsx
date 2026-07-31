"use client";

import { useEffect } from "react";

import {
  SESSION_HINT_COOKIE,
  SESSION_HINT_MAX_AGE,
} from "@/lib/session-hint";

/**
 * Mirrors "a session exists" into a host-only cookie so `proxy.ts` can see it.
 *
 * The session itself lives in localStorage, which is never transmitted, so
 * middleware is otherwise blind to it. See `lib/session-hint.ts` for why this
 * does not reuse the SDK's own cookie, and docs/AUTH_NOTES.md for why none of
 * this is a security boundary.
 *
 * Deliberately writes NO domain attribute: a host-only cookie is scoped to this
 * exact origin and cannot be rejected by the Public Suffix List.
 */
export function SessionHint({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    // `Secure` is required alongside SameSite=None-style cross-site returns and
    // is good practice regardless, but it would make the cookie unsettable over
    // plain http. localhost is treated as a trustworthy origin by browsers, so
    // this only ever drops the flag on non-TLS non-localhost dev hosts.
    const secure = window.location.protocol === "https:" ? "; Secure" : "";

    document.cookie = authenticated
      ? `${SESSION_HINT_COOKIE}=1; path=/; max-age=${SESSION_HINT_MAX_AGE}; SameSite=Lax${secure}`
      : `${SESSION_HINT_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
  }, [authenticated]);

  return null;
}
