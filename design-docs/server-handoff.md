# Server handoff

**Status:** Implemented
**Last updated:** 2026-06-30
**Code:** `app/server/openai-gateway.mjs`, `app/src/server-sync.ts`, `app/src/App.tsx`

## Purpose

Move plan-up toward a server-primary data model so external agents such as
Codex, Codex CLI, or a future MCP server can read the currently started
plan-up workspace without needing direct access to browser IndexedDB.

The server owns the canonical JSON snapshot. The browser keeps Dexie as a fast
client cache for the existing UI and syncs that cache with the server.

## User-facing behavior

- Running `npm run dev` starts the existing plan-up gateway and Vite app.
- On app start, the browser asks the gateway for the latest server snapshot.
- If the server already has a snapshot, the browser imports it into Dexie before
  rendering project data.
- If the server has no snapshot yet, the browser uses the existing local seed
  flow and then uploads the first snapshot to the server.
- After local data changes, the browser debounces and uploads a fresh full
  snapshot to the server.
- Codex or other local tools can inspect the started server through HTTP:
  - `GET /api/projects`
  - `GET /api/projects/:projectId/context`
  - `GET /api/projects/:projectId/export`
  - `GET /api/db/snapshot`

## Data

No IndexedDB schema change.

The server stores runtime JSON under `app/.plan-up/` by default, or under
`PLAN_UP_DATA_DIR` when that environment variable is set:

- `app/.plan-up/server-db.json` — canonical full `ExportPayload`.
- `app/.plan-up/cache/projects.json` — compact project index.
- `app/.plan-up/cache/projects/<projectId>.json` — per-project export bundle.

These files are runtime/cache data and are gitignored.

## Implementation

- The gateway exposes a small DB API alongside the existing OpenAI gateway.
- The DB API accepts and returns the app's existing full export payload shape
  from `exportAll()` / `importAll()`.
- `app/src/server-sync.ts` owns browser-side sync:
  - `loadServerSnapshot()` fetches `/api/db/snapshot`.
  - `saveServerSnapshot()` uploads a full payload with `PUT /api/db/snapshot`.
  - `isServerSyncEnabled()` keeps sync enabled only when the app is served over
    HTTP(S), so tests and static file usage do not fail on missing APIs.
- `App.tsx` hydrates from the server before `seedIfEmpty()`.
- `App.tsx` watches the full Dexie export payload with `useLiveQuery` and
  debounces sync writes.

## Rules & edge cases

- Server data wins at startup. If the server has a snapshot, it replaces the
  browser Dexie cache.
- The first run on an empty server bootstraps from the existing seed/local data
  path, then writes that snapshot back to the server.
- Sync failures are non-fatal for the UI; the app logs the error and continues
  with Dexie cache so a temporary gateway issue does not block planning.
- The cache export is full-snapshot only in this phase. Row-level write APIs and
  conflict resolution are future work.
- The gateway does not expose destructive write actions yet. External agents
  should read context from these endpoints and still use the app's typed action
  confirmation flow for mutations.

## Future / open questions

- Add a dedicated MCP server that wraps these HTTP endpoints as tools.
- Replace full-snapshot sync with server row APIs once the UI no longer relies
  directly on Dexie writes.
- Add optimistic concurrency with snapshot revision IDs before supporting
  multi-client writes.
