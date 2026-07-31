# Desktop build (Tauri)

`src-tauri/` is scaffolded from the toolkit's own templates
(`iblai-vibe-ops-build/assets/tauri/`) with one deliberate deviation, explained
below. The Rust toolchain is **not** installed on the machine this was built on,
so **no binary has been produced and this is unverified** — it is wiring, not
evidence. Said plainly rather than implied.

## Running it

```bash
# once
rustup default stable          # https://rustup.rs
pnpm add -D @tauri-apps/cli

# then
pnpm tauri dev                 # dev window
pnpm tauri build               # installers into src-tauri/target/release/bundle/
```

Windows needs the MSVC build tools (Visual Studio 2022 with "Desktop
development with C++"). macOS needs Xcode command line tools; Linux needs
`webkit2gtk` and `libayatana-appindicator`.

`.github/workflows/tauri-build-desktop.yml` builds macOS (Intel + Apple
Silicon), Windows and Linux on `workflow_dispatch`, so binaries can be produced
in CI without a local toolchain.

## The deviation: remote origin, not a static export

The toolkit's template ships:

```json
"beforeBuildCommand": "pnpm build",
"frontendDist": "../out"
```

That assumes a **fully static export** — and the skill says so explicitly:
*"All platforms (desktop and mobile) use a static `next build` export."* For the
stock vibe app that is correct: everything is a client-side SDK call, so there
is no server half to lose.

**StudyBuddy cannot use it.** `output: "export"` drops:

- `app/api/quiz/route.ts` — the route handler that talks to the agent
- `proxy.ts` — the route gate

Losing the route handler is not cosmetic. It holds the **platform API token**
server-side; that is the reason the browser never sees an agent credential
(see [AUTH_NOTES.md](AUTH_NOTES.md) §3). Statically exporting would force the
agent call into the client and ship the token with it — trading the app's one
real security property for a packaging convenience.

So `frontendDist` is set to the **deployed origin** instead. Tauri v2 accepts a
URL there and loads the app remotely, which keeps the server half intact and
makes the desktop app a native shell over the real deployment. The toolkit
anticipates this: the generated `capabilities/default.json` already allows
`https://*.vercel.app/*` and `https://*.iblai.app/*` as remote URLs.

**Before building, replace the placeholder** in `src-tauri/tauri.conf.json`:

```json
"frontendDist": "https://REPLACE-WITH-DEPLOYED-ORIGIN"
```

The tradeoff is honest: the desktop app then requires a network connection and
is not an offline bundle. Given the app's whole purpose is talking to a hosted
agent, it would not work offline regardless.

## Known limitation: mobile SSO

Flagged in the vibe README and worth repeating. Mobile WebViews present a
non-standard user agent that SSO providers reject, so the desktop flow does not
transfer to iOS/Android as-is. The fix is platform-specific:
`ASWebAuthenticationSession` on iOS, Chrome Custom Tabs on Android.

The scaffold already carries the groundwork — `lib/iblai/auth-utils.ts` has
`isTauri()` / `isTauriMobile()` and swaps the redirect origin for a custom
scheme (`studybuddy://`) on mobile, and `tauri.conf.json` registers that scheme
as a deep link. What is missing is the native authentication session on each
platform.
