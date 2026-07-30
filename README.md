# vibe-starter

The starting point for any ibl.ai SPA.

A pre-wired Next.js 16 + Tailwind v4 + shadcn/ui project with the
`@iblai/iblai-js` SDK already integrated. Use it as the base for new
ibl.ai single-page apps — auth, navbar, profile/account/notifications
pages, and Redux/data-layer providers are already in place.

## What's included

- **Next.js 16** with App Router, TypeScript, Tailwind v4
- **shadcn/ui** (new-york variant) initialized
- **ibl.ai SSO authentication** (`iblai add auth`) — providers, SSO
  callback, storage service, Redux store, tenant resolution
- **Responsive top navbar** with logo, page links, notification bell,
  and user profile dropdown (collapses to a hamburger drawer on mobile)
- **Pages** under the `(app)` route group:
  `/`, `/profile`, `/account`, `/notifications/[[...id]]`
- **Mobile safe-area insets** wired in `globals.css` for iOS/Android
  builds (Tauri v2 ready)

## Getting started

1. Fill in `iblai.env` with your platform credentials:

   ```
   PLATFORM=<your-tenant-key>
   TOKEN=<your-platform-api-key>
   ```

2. Re-run the auth generator so the tenant key is written into
   `.env.local`:

   ```bash
   iblai add auth
   ```

3. Start the dev server:

   ```bash
   pnpm dev
   ```

   Open http://localhost:3000 — unauthenticated users are redirected to
   `https://login.iblai.app` and returned with a session.

## Adding features

This starter is auth-ready, so any ibl.ai feature skill works out of the
box:

```
/iblai-chat          # AI chat widget
/iblai-analytics     # Analytics dashboard
/iblai-workflow      # Workflow builder
/iblai-course-access # edX learner UI
/iblai-onboard       # Onboarding questionnaire
/iblai-component     # Browse all available components
```

See `CLAUDE.md` for the full component priority guide and skill list.

## Project layout

```
app/
  (app)/                          # Authenticated pages (wrapped with navbar)
    layout.tsx                    # Renders <NavBar> + <NavigationDrawer>
    page.tsx                      # Home
    profile/page.tsx              # SDK <Profile>
    account/page.tsx              # SDK <Account>
    notifications/[[...id]]/      # SDK <NotificationDisplay>
  sso-login-complete/             # SSO callback (outside route group)
  layout.tsx                      # Root layout — wraps with <IblaiProviders>
components/
  navbar/                         # nav-bar, navigation-drawer, logo, user-profile-button
  ui/                             # shadcn/ui components
lib/iblai/                        # config, storage-service, auth-utils, tenant
providers/iblai-providers.tsx     # Redux + Auth + Tenant providers
store/iblai-store.ts              # RTK store
iblai.env                         # Platform credentials (DOMAIN, PLATFORM, TOKEN)
```

## Brand

- **Primary**: `#0058cc`
- **Gradient**: `linear-gradient(135deg, #00b0ef, #0058cc)`
- **Style**: shadcn/ui new-york, system sans-serif, Lucide icons

SDK and shadcn components share the same Tailwind theme and render in
ibl.ai brand colors automatically — do not override them.

## Commands

```bash
pnpm dev             # Dev server
pnpm build           # Production build
pnpm test            # Vitest
iblai config show    # View configuration
iblai add <feature>  # Add a feature
iblai deploy vercel  # Deploy to Vercel (requires VERCEL_TOKEN in iblai.env)
```

## Resources

- [ibl.ai docs](https://docs.ibl.ai)
- [iblai-app-cli](https://github.com/iblai/iblai-app-cli)
- [Next.js docs](https://nextjs.org/docs)
- [shadcn/ui docs](https://ui.shadcn.com)
