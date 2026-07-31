"use client";

/**
 * ibl.ai Provider wrapper.
 *
 * Wrap your root layout children with <IblaiProviders> to get:
 *  - Redux store (RTK Query for IBL APIs)
 *  - AuthProvider  (SSO redirect, JWT validation, cross-SPA sync)
 *  - TenantProvider (multi-tenant routing)
 *
 * Usage in app/layout.tsx:
 *
 *   import { IblaiProviders } from "@/providers/iblai-providers";
 *   export default function RootLayout({ children }) {
 *     return <html><body><IblaiProviders>{children}</IblaiProviders></body></html>;
 *   }
 */

import { useMemo, useState, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { usePathname } from "next/navigation";
import { initializeDataLayer } from "@iblai/iblai-js/data-layer";
import { AuthProvider, TenantProvider } from "@iblai/iblai-js/web-utils";

import { iblaiStore } from "@/store/iblai-store";
import { LocalStorageService } from "@/lib/iblai/storage-service";
import config from "@/lib/iblai/config";
import { resolveAppTenant, checkTenantMismatch } from "@/lib/iblai/tenant";
import {
  redirectToAuthSpa,
  hasNonExpiredAuthToken,
  handleLogout,
} from "@/lib/iblai/auth-utils";

const storageService = LocalStorageService.getInstance();

/** Routes that do NOT require authentication. */
const PUBLIC_ROUTES = new Map<RegExp, () => Promise<boolean>>([
  [new RegExp("^/sso-login"), async () => false],
]);

export function IblaiProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // initializeDataLayer MUST be called synchronously before any children
  // render so that Config.lmsUrl / Config.dmUrl are set before RTK Query
  // hooks (e.g. inside the Profile component) fire their first queries.
  // useState initializer runs during the render cycle, not after it.
  const [isInitialized] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      // data-layer v1.2+ signature:
      // (dmUrl, lmsUrl, legacyLmsUrl, storageService, httpErrorHandler)
      initializeDataLayer(
        config.dmUrl(),
        config.lmsUrl(),
        config.lmsUrl(),  // legacyLmsUrl (same as lmsUrl for consolidated API)
        storageService,
        {
          401: () => redirectToAuthSpa(undefined, undefined, true),
        },
      );
    } catch (e) {
      console.error("[ibl.ai] initializeDataLayer failed:", e);
    }
    return true;
  });

  const username = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = localStorage.getItem("userData");
      if (raw) return JSON.parse(raw).user_nicename ?? "";
    } catch { /* ignore */ }
    return "";
  }, [isInitialized]);

  // Tenant resolution: .env -> app_tenant -> localStorage tenant
  const tenantKey = useMemo(() => resolveAppTenant(), [isInitialized]);

  const isSsoRoute = pathname?.startsWith("/sso-login") ?? false;

  const LOADING = (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-400">Loading...</p>
    </div>
  );

  if (!isInitialized) return LOADING;

  return (
    <ReduxProvider store={iblaiStore}>
      <AuthProvider
        skip={isSsoRoute}
        redirectToAuthSpa={redirectToAuthSpa}
        hasNonExpiredAuthToken={hasNonExpiredAuthToken}
        username={username}
        pathname={pathname ?? "/"}
        storageService={storageService}
        middleware={PUBLIC_ROUTES}
        enableStorageSync
        fallback={LOADING}
      >
        <TenantProvider
          skip={isSsoRoute}
          currentTenant={tenantKey}
          requestedTenant={tenantKey}
          saveCurrentTenant={(t: unknown) => {
            const key =
              typeof t === "string"
                ? t
                : ((t as { key?: string } | null)?.key ?? String(t));

            // `current_tenant` MUST be the JSON object shape, not a bare key.
            //
            // The SDK mirrors this value into a cookie as {"key":"…"} and
            // compares cookie against localStorage on an interval. Writing a
            // bare string here made every poll see a difference, decide
            // "another SPA changed the tenant", and redirect to the auth SPA —
            // an infinite login bounce on any session restore where the cookie
            // was already warm.
            //
            // app/(app)/layout.tsx already reads this back with
            // JSON.parse(...)?.key, so the object shape is what the rest of the
            // app expects too. `tenant` stays a bare key: resolveAppTenant()
            // reads that one as a plain string.
            localStorage.setItem("current_tenant", JSON.stringify({ key }));
            localStorage.setItem("tenant", key);

            // If the SDK resolved a different tenant than what the app
            // expects, redirect to re-login for the correct tenant.
            checkTenantMismatch();
          }}
          saveUserTenants={(t: unknown) =>
            localStorage.setItem("tenants", JSON.stringify(t))
          }
          handleTenantSwitch={async () => {
            const tenant = resolveAppTenant();
            redirectToAuthSpa(undefined, tenant, false, true);
          }}
          redirectToAuthSpa={redirectToAuthSpa}
          username={username}
          fallback={LOADING}
        >
          {children}
        </TenantProvider>
      </AuthProvider>
    </ReduxProvider>
  );
}
