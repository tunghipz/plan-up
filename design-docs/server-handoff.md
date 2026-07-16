# Server handoff

**Status:** Implemented
**Last updated:** 2026-07-16 (project-local Codex skill added)
**Code:** `app/server/openai-gateway.mjs`, `app/server/planup-mcp.mjs`, `app/src/server-sync.ts`, `app/src/App.tsx`, `.codex/skills/plan-up-mcp/SKILL.md`

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
- Codex/Codex CLI can connect through the stdio MCP server:
  - `planup_list_projects`
  - `planup_get_project_context`
  - `planup_apply_actions`
- This repo includes a project-local Codex skill at
  `.codex/skills/plan-up-mcp/SKILL.md`. The skill tells Codex how to use the
  MCP tools, when to dry-run actions, and how to fall back to direct HTTP/stdin
  diagnostics when the Desktop tool registry has not exposed the MCP namespace.

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
- `POST /api/actions/apply` accepts the same typed action names used by AI Chat,
  applies them to the server snapshot, rewrites the cache files, and returns a
  per-action result list. The endpoint requires `projectId`; `sprintId` or
  `collectionId` should be supplied for sprint/collection-scoped task actions.
- `app/server/planup-mcp.mjs` is a dependency-free MCP stdio wrapper around the
  HTTP gateway. It reads `PLAN_UP_GATEWAY_URL` and defaults to
  `http://127.0.0.1:5173`.
- `.codex/skills/plan-up-mcp/SKILL.md` is an agent-facing guide for operating
  plan-up through this MCP. It is intentionally separate from
  `app/public/skills/project-management/SKILL.md`, which is loaded by the
  in-app AI Chat drawer.
- `app/src/server-sync.ts` owns browser-side sync:
  - `loadServerSnapshot()` fetches `/api/db/snapshot`.
  - `saveServerSnapshot()` uploads a full payload with `PUT /api/db/snapshot`.
  - `isServerSyncEnabled()` keeps sync enabled only when the app is served over
    HTTP(S), so tests and static file usage do not fail on missing APIs.
- `App.tsx` hydrates from the server before `seedIfEmpty()`.
- `App.tsx` watches the full Dexie export payload with `useLiveQuery` and
  debounces sync writes.
- `App.tsx` also polls the server snapshot while open. If an external MCP tool
  updates the server, the browser imports the newer snapshot so the UI follows
  Codex-side changes without a manual reload.

MCP config example:

```json
{
  "mcpServers": {
    "plan-up": {
      "command": "node",
      "args": ["/Users/lap15967/Documents/vng/plan-up/app/server/planup-mcp.mjs"],
      "env": {
        "PLAN_UP_GATEWAY_URL": "http://127.0.0.1:5173"
      }
    }
  }
}
```

## Rules & edge cases

- Server data wins at startup. If the server has a snapshot, it replaces the
  browser Dexie cache.
- The first run on an empty server bootstraps from the existing seed/local data
  path, then writes that snapshot back to the server.
- Sync failures are non-fatal for the UI; the app logs the error and continues
  with Dexie cache so a temporary gateway issue does not block planning.
- The cache export is full-snapshot only in this phase. Row-level write APIs and
  conflict resolution are future work.
- The MCP write path is intentionally typed actions, not arbitrary JSON editing.
  Destructive actions such as `delete_task`, `delete_sprint`, `delete_collection`,
  and `delete_member` are available only through explicit action objects.
- Agent operators should call `planup_apply_actions` with `dryRun: true` first
  unless the user explicitly asked to apply immediately or the action is
  harmless/read-only.
- The first MCP action endpoint mutates server snapshot fields and preserves the
  same entity invariants as the app action contract. The full browser scheduling
  engine still remains richer than the server helper; future row APIs should
  converge these implementations.

## Future / open questions

- Replace full-snapshot sync with server row APIs once the UI no longer relies
  directly on Dexie writes.
- Add optimistic concurrency with snapshot revision IDs before supporting
  multi-client writes.
