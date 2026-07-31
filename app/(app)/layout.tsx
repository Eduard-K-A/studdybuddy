'use client';

import { useState } from 'react';
import { NavBar, type NavLink } from '@/components/navbar/nav-bar';
import {
  NavigationDrawer,
  type NavItem,
} from '@/components/navbar/navigation-drawer';
import config from '@/lib/iblai/config';
import { useIblSession } from '@/lib/iblai/session';
import { handleLogout } from '@/lib/iblai/auth-utils';
import { ReturnTo } from '@/components/return-to';
import { SessionHint } from '@/components/session-hint';

const NAV_LINKS: NavLink[] = [
  { name: 'Home', href: '/', segment: null },
  { name: 'Quiz', href: '/quiz', segment: 'quiz' },
  { name: 'Profile', href: '/profile', segment: 'profile' },
  { name: 'Account', href: '/account', segment: 'account' },
];

const DRAWER_ITEMS: NavItem[] = NAV_LINKS.map(({ name, href }) => ({
  name,
  href,
}));

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { tenantKey, username, email, isAdmin, tenants, currentTenant, ready } =
    useIblSession();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Mirrors the localStorage session into a host-only cookie so proxy.ts
          can see it at all. The SDK's own cookie is dropped by the browser on
          *.vercel.app — see lib/session-hint.ts. */}
      <SessionHint authenticated={ready && Boolean(username)} />

      {/* Restores the destination middleware parked before the SSO round trip. */}
      <ReturnTo authenticated={ready && Boolean(username)} />

      <NavBar
        onMenuClick={() => setDrawerOpen((prev) => !prev)}
        links={NAV_LINKS}
        tenantKey={tenantKey}
        username={username || undefined}
        email={email}
        mainPlatformKey={config.mainTenantKey()}
        isAdmin={isAdmin}
        currentTenant={currentTenant}
        userTenants={[...tenants]}
        authURL={config.authUrl()}
        onLogout={() => handleLogout()}
        onTenantChange={(key: string) => {
          localStorage.setItem('current_tenant', key);
          localStorage.setItem('tenant', key);
          window.location.reload();
        }}
      />

      <NavigationDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={DRAWER_ITEMS}
      />

      <main
        className="flex-1 overflow-y-auto"
        style={{ background: 'var(--sidebar-bg, #fafbfc)' }}
      >
        {children}
      </main>
    </div>
  );
}
