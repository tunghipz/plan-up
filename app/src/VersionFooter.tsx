import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { IS_TAURI } from './backup'

/**
 * Sidebar footer (design-docs/version-and-updates.md). Calm `plan-up · v{version}`
 * at rest; morphs IN PLACE into a glowing accent pill when the service worker has
 * a newer build precached and waiting. Clicking it does skipWaiting + reload, so
 * the swap to the new version is instant (assets are already cached).
 *
 * The SW signals *that* an update is ready (`needRefresh`); we fetch the deployed
 * `version.json` to show *which* version. In dev the virtual module is a no-op, so
 * the footer always stays calm.
 */

const CURRENT = __APP_VERSION__
const UPDATE_POLL_MS = 30 * 60 * 1000 // re-check for a new SW every 30 min

// `onRegisteredSW` fires on every mount and offers no cleanup hook, so a remount
// would stack extra intervals/listeners. The SW registration is app-global anyway
// — guard at module level so the polling is wired up exactly once per page load.
let pollingStarted = false

export function VersionFooter() {
  // Desktop (Tauri) build ships no service worker — updates arrive as new DMGs,
  // so the footer stays a static version line (desktop-app-tauri.md). Hooks
  // can't be conditional, so the SW machinery lives in the web-only component.
  if (IS_TAURI) {
    return (
      <div className="flex-1 min-w-0 px-[18px] py-2.5 text-[11px] text-ink-faint tabular-nums select-none truncate">
        plan-up · v{CURRENT}
      </div>
    )
  }
  return <SwVersionFooter />
}

function SwVersionFooter() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration || pollingStarted) return
      pollingStarted = true
      // Proactively look for a new SW on an interval and when the tab refocuses,
      // so a long-lived tab notices a deploy without waiting for a navigation.
      setInterval(() => registration.update(), UPDATE_POLL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update()
      })
    },
  })

  const [latest, setLatest] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  // Once an update is waiting, fetch the manifest to label the pill with the
  // incoming version (best-effort — falls back to "Update available").
  useEffect(() => {
    if (!needRefresh) return
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        const v = (d as { version?: unknown })?.version
        if (!cancelled && typeof v === 'string') setLatest(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [needRefresh])

  if (!needRefresh) {
    return (
      <div className="flex-1 min-w-0 px-[18px] py-2.5 text-[11px] text-ink-faint tabular-nums select-none truncate">
        plan-up · v{CURRENT}
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 px-[18px] py-2 flex">
      <button
        onClick={() => {
          setUpdating(true)
          // skipWaiting the new SW, then reload into it (assets already precached).
          updateServiceWorker(true)
        }}
        disabled={updating}
        title={latest ? `Update to v${latest} (reloads the app)` : 'Update available (reloads the app)'}
        className="update-pill inline-flex items-center gap-2 rounded-full bg-accent hover:bg-accent-hover text-white text-[12px] font-semibold tracking-[-0.01em] px-3 py-1.5 transition-colors disabled:opacity-80"
      >
        {updating ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
        ) : (
          <Package size={14} strokeWidth={2} />
        )}
        <span>
          {updating ? (
            'Updating…'
          ) : latest ? (
            <>
              Update · <span className="tabular-nums opacity-90">v{latest}</span>
            </>
          ) : (
            'Update available'
          )}
        </span>
      </button>
    </div>
  )
}
