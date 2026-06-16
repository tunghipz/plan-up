# Version display & update prompt

**Status:** Implemented
**Last updated:** 2026-06-16
**Code:** `app/vite.config.ts` (`__APP_VERSION__` define + `version.json` emit plugin +
`VitePWA` service worker), `app/src/VersionFooter.tsx` (`useRegisterSW` + footer morph),
`app/src/App.tsx` (renders `<VersionFooter />` in the sidebar), `app/src/index.css`
(`update-pill` glow keyframes), `app/src/vite-env.d.ts` (PWA virtual-module types)
**Deps:** `vite-plugin-pwa` (workbox under the hood)
**Demo:** `demo/version-update-badge-options.html` (3 directions — **A · footer morph** chosen)

## Purpose

Surface the running app's version, and — because plan-up is a client-only SPA where a deploy
silently replaces the assets — let the user know when a **newer build is live** and reload into
it with one click. Without this, a tab opened for days keeps running stale code and the user
never knows a fix shipped.

## DNA fit (design-system §9)

- **Calm at rest.** Normal state is just a faint `plan-up · v{version}` line at the sidebar
  footer (see [app-shell-and-navigation.md](./app-shell-and-navigation.md)) — `text-ink-faint`,
  never accent. Version is reference info you rarely need.
- **Signal only when it earns it.** An available update *is* worth attention, so the SAME footer
  line **morphs in place** into a glowing accent pill. Accent-as-signal (§2.1) is justified here
  — it's a state change, not chrome. No separate toast, no layout shift.
- **Speed.** One click = update. No modal, no "release notes" wall.

## User-facing behavior

### Resting state
Sidebar footer shows `plan-up · v{version}` (faint, `text-[11px]`, tabular-nums). This is the
default and what the user sees ~always.

### Update-available state (footer morph — direction A)
When a newer version is detected the footer line is **replaced** by an accent pill:

- **`📦 Update · v{latest}`** — accent fill, white text, box (`Package`) icon, fully rounded.
- A slow **breathing glow** (`update-pill`, 2.6s, `prefers-reduced-motion` → off) draws the eye
  without flashing. Hover lifts/darkens like other accent buttons.
- `title` = "Update to v{latest} (reloads the app)" so the consequence (a reload) is honest.

### The action
Click → the pill swaps to a spinner + **"Updating…"**, then `updateServiceWorker(true)`
(skipWaiting + reload). Because the new build's assets are **already precached** by the waiting
service worker, the swap is **instant** — no re-download — and the app comes back on `v{latest}`
with a calm footer.

## How it works

### Version source — one source of truth
`package.json.version` is inlined at build time via Vite `define` as the global
`__APP_VERSION__` (string). The running bundle therefore *knows its own version* with no network
call — the same value the footer prints. The push workflow auto-bumps `patch` every push (see
root `CLAUDE.md`), so the version always changes between deploys.

### Detection & swap — a service worker (`vite-plugin-pwa`, prompt mode)
- **`VitePWA({ registerType: 'prompt' })`** generates a workbox service worker that **precaches
  the whole build** (offline-capable) and, on a new deploy, installs the new SW but leaves it
  **waiting** rather than activating immediately.
- `VersionFooter` calls **`useRegisterSW()`** (`virtual:pwa-register/react`): when a new SW is
  installed-and-waiting, `needRefresh` flips true → that's the canonical "update available"
  signal (it only fires once the new assets are fully precached, so the swap is guaranteed
  instant). The hook also calls `registration.update()` **every 30 min** and **on tab re-focus**
  so a long-lived tab notices a deploy without a manual navigation.
- **The version label** comes from a separate `version.json` (emitted next to the build by a tiny
  Vite plugin, and **excluded from the precache** via `workbox.globIgnores` so a `cache:'no-store'`
  fetch always hits the network). When `needRefresh` fires we fetch it to show `Update · v{latest}`;
  if the fetch fails the pill falls back to a plain "Update available".
- **Dev:** the `virtual:pwa-register/react` module is a **no-op in dev** (SW not built), so
  `needRefresh` is always false and the footer stays calm. Test the real flow with a build —
  see [Testing](#testing).

### Why prompt mode (not autoUpdate)
`autoUpdate` would silently activate the new SW and reload under the user — fighting our
click-to-update UX and risking a reload mid-action. `prompt` keeps the user in control: the new
version waits quietly until they click the pill.

## Testing
The SW only exists in a build, so test with `npm run build && npm run preview` (SW runs on
`localhost` over http — allowed). To see the pill morph end-to-end:
1. `npm run build` → note the version, `npm run preview`, open the page (SW installs + controls).
2. Bump (`npm version patch --no-git-tag-version`) and `npm run build` again.
3. Reload the open tab → the new SW installs and **waits** → `needRefresh` fires → the footer
   shows `Update · v{new}`. Click it → instant skipWaiting + reload onto the new version.

## Rules & edge cases

- **`needRefresh` is the trigger, version string is just the label.** Detection is the SW's
  install-and-wait, not a version compare — so even a same-version rebuild that changes any asset
  hash is correctly flagged. (The push workflow bumps anyway, so the label is always meaningful.)
- **No nagging.** Prompt mode + a passive pill: never auto-reloads or pops a dialog; the user
  clicks when ready. Unsaved work isn't a concern (everything persists to IndexedDB immediately).
- **Offline.** The precache makes the app load with no network. Data is already local (IndexedDB).
- **Reduced motion.** The glow animation is disabled under `prefers-reduced-motion`.
- **Empty / no-project state.** The footer (and thus the pill) shows in both the project-selected
  and "Select a project →" states.
- **Host caching.** `sw.js` and `index.html` must be served **no-cache** (hashed assets cache
  forever) so the browser notices a new SW promptly — standard static-SPA config.

## Future / open questions
- **PWA install / icons.** The manifest uses `favicon.svg` only; add 192/512 PNG maskable icons
  for full installability (home-screen / splash). The SW update+offline flow works without them.
- **What's-new.** Clicking could later open a changelog instead of reloading blind — deferred
  (no changelog surface yet).
- **Toast variant (direction B).** A more prominent floating pill was prototyped; kept the calm
  in-place morph. The demo retains B/C if we want to escalate prominence later.
