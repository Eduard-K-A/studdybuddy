"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { RETURN_TO_COOKIE, isSafeReturnPath } from "@/lib/return-to";

function readCookie(name: string): string | undefined {
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
}

/**
 * Completes the destination hand-off started by middleware.
 *
 * Middleware parks the intended path in a cookie and sends the visitor to the
 * app root, where the SDK owns the SSO round trip. Once they are back and
 * authenticated, this restores where they were actually going.
 *
 * Only ever navigates to a same-origin absolute path — a cookie is
 * attacker-controllable, so treating its contents as a URL would be an open
 * redirect.
 */
export function ReturnTo({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!authenticated) return;

    const target = readCookie(RETURN_TO_COOKIE);
    if (!target) return;

    clearCookie(RETURN_TO_COOKIE);

    if (!isSafeReturnPath(target)) return;
    if (target === window.location.pathname + window.location.search) return;

    router.replace(target);
  }, [authenticated, router]);

  return null;
}
