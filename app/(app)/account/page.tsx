"use client";

import { useRouter } from "next/navigation";
import { Account } from "@iblai/iblai-js/web-containers/next";

import config from "@/lib/iblai/config";
import { useIblSession } from "@/lib/iblai/session";

export default function AccountPage() {
  const router = useRouter();
  const { username, email, tenantKey, tenants, isAdmin, ready } =
    useIblSession();

  if (!ready || !tenantKey) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading account settings...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full flex-1 overflow-auto px-4 py-8 md:w-[75vw] md:px-0">
      <div className="rounded-lg border border-[var(--border-color)] bg-white overflow-hidden">
        <Account
          tenant={tenantKey}
          tenants={[...tenants]}
          username={username}
          email={email}
          mainPlatformKey={config.mainTenantKey()}
          isAdmin={isAdmin}
          authURL={config.authUrl()}
          currentPlatformBaseDomain={config.platformBaseDomain()}
          currentSPA="agent"
          onInviteClick={() => {}}
          onClose={() => router.push("/")}
          targetTab="organization"
          showPlatformName={true}
          useGravatarPicFallback={true}
        />
      </div>
    </div>
  );
}
