# CLAUDE.md

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

This project is built on the ibl.ai platform using the `@iblai/iblai-js` SDK.

## Component Priority

When adding UI features, follow this priority order:

1. **ibl.ai components** (`@iblai/iblai-js`) -- always use these first
2. **shadcn/ui** (`npx shadcn@latest add`) -- for everything else
3. **Custom/third-party** -- only when no ibl.ai or shadcn component exists

### When the user asks to add...

| Feature | Use this | NOT this |
|---------|----------|----------|
| Profile page / dropdown | `/iblai-profile` skill + `Profile`, `UserProfileDropdown` from SDK | Custom profile form |
| Account / org settings | `/iblai-account` skill + `Account` from SDK | Custom settings page |
| Analytics dashboard | `/iblai-analytics` skill + `AnalyticsOverview`, `AnalyticsLayout` from SDK | Chart library from scratch |
| Notifications | `/iblai-notification` skill + `NotificationDropdown` from SDK | Custom notification system |
| Chat / AI assistant | `/iblai-chat` skill + `<mentor-ai>` web component | Custom chat UI |
| Auth / login | `/iblai-auth` skill + `AuthProvider`, `SsoLogin` from SDK | Custom auth flow |
| Invite users | `/iblai-invite` skill + `InviteUserDialog` from SDK | Custom invite form |
| Workflow builder | `/iblai-workflow` skill + workflow components from SDK | Custom node editor |
| Course content | `/iblai-course-access` skill + `CourseContentLayout`, `CourseContentTabPage` from SDK | Custom course player |
| Create / publish courses | `/iblai-course-create` skill (Course Creation API) | Manually authoring OLX in edX Studio |
| Onboarding flow | `/iblai-onboard` skill | Custom onboarding from scratch |
| Buttons, forms, modals, tables | shadcn/ui (`npx shadcn@latest add button dialog table`) | Raw HTML or other UI libraries |
| Page sections / blocks | shadcn/ui blocks (`npx shadcn@latest add @shadcn-space/hero-01`) | Custom layout from scratch |

### Key rule

Do NOT build custom components when an ibl.ai SDK component exists.
Do NOT use raw HTML or third-party UI libraries when shadcn/ui has an equivalent.
ibl.ai and shadcn share the same Tailwind theme -- they render in brand colors automatically.

## SDK Imports

```typescript
// Data layer
import { initializeDataLayer, mentorReducer } from "@iblai/iblai-js/data-layer";

// Auth & utilities
import { AuthProvider, TenantProvider, useChatV2 } from "@iblai/iblai-js/web-utils";

// Framework-agnostic components
import { Profile, AnalyticsLayout, NotificationDropdown } from "@iblai/iblai-js/web-containers";

// Next.js-specific components
import { SsoLogin, UserProfileDropdown, Account } from "@iblai/iblai-js/web-containers/next";
```

## Adding Features

Use skills to add features. Each skill runs the CLI generator and guides
you through the remaining manual steps:

```
/iblai-auth          # SSO authentication (run first)
/iblai-chat          # AI chat widget
/iblai-profile       # Profile dropdown + settings page
/iblai-account       # Account/org settings page
/iblai-analytics     # Analytics dashboard
/iblai-course-access # Course content pages (edX learner UI)
/iblai-course-create # Generate and publish courses via Course Creation API
/iblai-notification  # Notification bell
/iblai-invite        # User invitation dialogs
/iblai-workflow      # Workflow builder
/iblai-onboard       # Onboarding questionnaire flow
/iblai-ops-build     # Desktop/mobile builds (Tauri v2)
/iblai-ops-test      # Test before showing work
/iblai-ops-upgrade   # Upgrade CLI, SDK, and skills to latest
/iblai-component     # Browse all available components
```

All features require auth first (`/iblai-auth` or `iblai add auth`).

## Environment

Platform configuration lives in `iblai.env` (`DOMAIN`, `PLATFORM`, `TOKEN`,
and optionally `VERCEL_TOKEN` for mobile dev builds). The CLI derives all
`NEXT_PUBLIC_*` env vars into `.env.local` automatically. Do NOT edit
`.env.local` directly for platform config -- update `iblai.env` and re-run
a CLI command.

`VERCEL_TOKEN` in `iblai.env` enables `iblai deploy vercel` — builds,
deploys to Vercel, disables auth protection, and updates `devUrl` in
`tauri.conf.json` automatically. If missing when the user wants to deploy,
ask once for their token (https://vercel.com/account/tokens).

## Brand

- **Primary**: `#0058cc`, **Gradient**: `linear-gradient(135deg, #00b0ef, #0058cc)`
- **Style**: shadcn/ui new-york variant, system sans-serif, Lucide icons
- SDK components ship with their own styles -- do NOT override them

## Layout Patterns

- **Page background**: `var(--sidebar-bg, #fafbfc)`
- **SDK wrappers**: Wrap SDK components in `bg-white rounded-lg border border-[var(--border-color)] overflow-hidden`
- **Responsive width**: `w-full px-4` mobile, `md:w-[75vw] md:px-0` desktop
- **Mobile safe area**: `globals.css` must have `padding-top: env(safe-area-inset-top)` (and bottom/left/right) on body, and `app/layout.tsx` metadata must include `viewport: "width=device-width, initial-scale=1, viewport-fit=cover"` -- prevents content from overlapping the iOS notch / Android status bar
- **Package manager**: Use `pnpm` (fall back to `npm`)
- **Project names**: Lowercase only — npm rejects capital letters in package names. Convert any name the user gives (e.g. `MyApp` → `my-app`) before passing to `create-next-app`, `iblai startapp`, or `--app-name`.

## Commands

```bash
pnpm dev             # Dev server
pnpm build           # Production build
iblai config show    # View configuration
iblai add <feature>  # Add a feature
```
