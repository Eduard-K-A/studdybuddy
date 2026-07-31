"use client";

/**
 * Typed access to the ibl.ai session in localStorage.
 *
 * The scaffold repeated the same block in four pages: read `userData` and
 * `tenants` in a `useEffect`, `setState` from it, and type the tenant list as
 * `any[]`. That tripped two lint rules everywhere it appeared
 * (`no-explicit-any` and `set-state-in-effect`) and drifted between copies —
 * profile reads `user_nicename ?? username`, the layout reads it slightly
 * differently.
 *
 * One typed hook fixes both rules in one place. `useSyncExternalStore` is the
 * right primitive here: localStorage IS an external store, and reading it in an
 * effect sets state synchronously on mount and cascades an extra render.
 *
 * The session is written once by the SSO callback and does not change for the
 * life of the page, so there is nothing to subscribe to.
 */

import { useSyncExternalStore, type ComponentProps } from "react";
import type { Profile } from "@iblai/iblai-js/web-containers";

import { resolveAppTenant } from "./tenant";

/**
 * A tenant, typed as the SDK itself types it.
 *
 * Derived from the `Profile` component's own props rather than hand-written, so
 * it cannot drift from what the SDK components accept. The SDK does not export
 * the `Tenant` interface directly — it re-exports from an internal package —
 * and duplicating its fields here would just be a second definition to keep in
 * sync. `import type` is erased at build time, so this pulls in no runtime code.
 */
export type IblTenant = NonNullable<
  ComponentProps<typeof Profile>["tenants"]
>[number];

export interface IblSession {
  readonly username: string;
  readonly email: string;
  readonly tenantKey: string;
  readonly tenants: readonly IblTenant[];
  readonly currentTenant: IblTenant | undefined;
  readonly isAdmin: boolean;
  /** False during SSR and before the session has been read. */
  readonly ready: boolean;
}

const EMPTY: IblSession = {
  username: "",
  email: "",
  tenantKey: "",
  tenants: [],
  currentTenant: undefined,
  isAdmin: false,
  ready: false,
};

function parseJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Validate the one field we branch on (`key`) and pass the object through
 * otherwise. These come from the platform already in the SDK's Tenant shape;
 * rebuilding them field by field would silently drop anything the SDK reads but
 * we don't know about.
 */
function toTenant(v: unknown): IblTenant | undefined {
  if (!isRecord(v) || typeof v.key !== "string") return undefined;

  // Spread first so fields the SDK reads but this app doesn't know about
  // survive, then supply the four the Tenant type requires. A tenant missing
  // one of them is still usable — defaulting beats dropping it from the list.
  return {
    ...v,
    key: v.key,
    is_admin: v.is_admin === true,
    org: typeof v.org === "string" ? v.org : "",
    platform_name: typeof v.platform_name === "string" ? v.platform_name : "",
  };
}

function read(): IblSession {
  if (typeof window === "undefined") return EMPTY;

  const userData = parseJson(localStorage.getItem("userData"));
  const username = isRecord(userData)
    ? str(userData.user_nicename) || str(userData.username)
    : "";
  const email = isRecord(userData)
    ? str(userData.user_email) || str(userData.email)
    : "";

  const tenantKey = resolveAppTenant();

  const rawTenants = parseJson(localStorage.getItem("tenants"));
  const tenants: IblTenant[] = Array.isArray(rawTenants)
    ? rawTenants.map(toTenant).filter((t): t is IblTenant => t !== undefined)
    : [];

  const currentTenant = tenants.find((t) => t.key === tenantKey);

  return {
    username,
    email,
    tenantKey,
    tenants,
    currentTenant,
    isAdmin: currentTenant?.is_admin === true,
    ready: true,
  };
}

/**
 * `getSnapshot` must be referentially stable or React re-renders forever, and
 * `read()` builds a fresh object each call. Cache it against the raw strings it
 * derives from, so the identity only changes when the session actually does.
 */
let cachedKey: string | null = null;
let cachedValue: IblSession = EMPTY;

function getSnapshot(): IblSession {
  if (typeof window === "undefined") return EMPTY;

  const key = `${localStorage.getItem("userData") ?? ""}|${
    localStorage.getItem("tenants") ?? ""
  }|${localStorage.getItem("app_tenant") ?? ""}`;

  if (key !== cachedKey) {
    cachedKey = key;
    cachedValue = read();
  }
  return cachedValue;
}

const getServerSnapshot = (): IblSession => EMPTY;

/** Written once at SSO callback; nothing to subscribe to. */
const subscribe = () => () => {};

export function useIblSession(): IblSession {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
