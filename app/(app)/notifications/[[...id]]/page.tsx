"use client";

import { useParams } from "next/navigation";
import { NotificationDisplay } from "@iblai/iblai-js/web-containers";

import { useIblSession } from "@/lib/iblai/session";

export default function NotificationsPage() {
  const params = useParams();
  const idParam = (params?.id as string[] | undefined) ?? undefined;
  const notificationId = idParam?.[0] ?? undefined;

  const { tenantKey, username, isAdmin, ready } = useIblSession();

  if (!ready || !tenantKey) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading notifications...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full flex-1 overflow-auto px-4 py-8 md:w-[75vw] md:px-0">
      <div className="rounded-lg border border-[var(--border-color)] bg-white overflow-hidden">
        <NotificationDisplay
          org={tenantKey}
          userId={username}
          isAdmin={isAdmin}
          selectedNotificationId={notificationId}
        />
      </div>
    </div>
  );
}
