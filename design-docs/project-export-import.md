# Project export / import (shareable project files)

**Status:** Implemented
**Last updated:** 2026-07-02 (full-DB backup is now v5 too — kind marker, not version, routes the import)
**Code:** `app/src/project-io.ts` (`ProjectBundle`, `isProjectBundle`, `remapBundle`),
`app/src/io.ts` (`exportProject`, `importProject`; re-exported by the `db.ts` facade), `app/src/App.tsx` (header split-menu,
`handleImportFile`, import toast, `downloadJson`), `app/src/ProjectSettingsView.tsx`
(inline "Share this project" export).

## Purpose
Turn a single project into a portable file that can be emailed / dropped in chat / committed
to a repo, and let a teammate **import it into an existing plan-up without destroying their
own data**. Lightweight collaboration with no backend, no accounts, no sync — true to the
"ClickUp without seat tax" DNA.

This is **complementary to** the existing full-DB backup (`exportAll`/`importAll`, replace-all,
header — see [persistence-and-backup.md](./persistence-and-backup.md)). Both ship; one Import
button auto-detects which kind of file it was given.

## User-facing behavior

### Export
Two entry points, complementary by role (see the demo `demo/export-per-project.html`):
- **Header split-menu** — the `Export` toolbar button opens a small menu:
  - *Export this project* — current project only → downloads `plan-up-<slug>-YYYY-MM-DD.json`.
  - *Export all (full backup)* — the existing whole-DB backup (`plan-up-YYYY-MM-DD.json`).
- **Project settings → inline** — a "Share this project" row at the foot of the Project card
  (after a hairline) with an `Export` action, scoped to the project being edited.

### Import (one button, auto-detect)
The single `Import` button reads the file and branches on its `kind`. **A file that
*claims* `kind: 'project'` is committed to the project path** (`looksLikeProjectBundle`):
if it then fails full `isProjectBundle` validation (truncated / hand-edited / missing
array) it is rejected with *"this project file is invalid or corrupt"* — it is **never**
re-routed to the destructive replace-all confirm (a damaged share file must not raise a
full-DB-wipe prompt). Only a file with **no** `kind: 'project'` marker takes the
full-backup path. Branches:
- **`kind: 'project'` → additive.** Imports as a **new** project alongside existing ones,
  regenerating every id. **No confirm** (nothing is destroyed). A success **toast** slides up:
  *"Imported '<name>' as a new project · N sprints · N tasks · N members"* with an **Undo**
  action (deletes the just-imported project — safe because add-as-new is reversible). The new
  project is selected.
- **full backup (v1–5) → replace-all.** Unchanged: the Cupertino "Replace all data?"
  confirm sheet, destructive, then wipes & restores.

## Data
A project export is a `ProjectBundle` (`version: 5`, `kind: 'project'`) — **not** an
`ExportPayload`. It carries one `project` (singular) plus that project's rows from the other
5 tables:

```jsonc
{
  "version": 5,
  "kind": "project",
  "exportedAt": "<ISO>",
  "project":     { /* one Project */ },
  "members":     [ /* Member[]  for this project */ ],
  "sprints":     [ /* Sprint[]   */ ],
  "collections": [ /* Collection[] */ ],
  "tasks":       [ /* Task[]     */ ],
  "events":      [ /* ActivityEvent[] */ ]
}
```

`importAll`'s version allow-list is now `[1, 2, 3, 4, 5]` — the full-DB `ExportPayload`
itself reached **v5** (it carries `people`; see
[persistence-and-backup.md](./persistence-and-backup.md)). The two file kinds are therefore
told apart by the **`kind: 'project'` marker, not the version number**: a project bundle is
committed to the additive path (and rejected there if malformed), never routed to a wipe.

## Implementation

### `project-io.ts` (pure, Dexie-free, unit-tested)
- **`isProjectBundle(data): data is ProjectBundle`** — type guard / validation. Checks
  `kind === 'project'`, `version === 5`, `project` is an object, and the 5 arrays are present
  and well-shaped. Reject-whole-file on any malformation (mirrors `importAll`'s pre-clear
  guard; one bad row → nothing imported).
- **`remapBundle(bundle, newId)`** — PURE. Builds fresh-id maps for every entity, returns a
  new bundle whose ids cannot collide with anything in the target DB. The single place this
  feature could silently corrupt data, so it is isolated and tested.

**ID-remap surface** — build maps, then rewrite every reference:

| Entity | New id | References rewritten |
|--------|--------|----------------------|
| project | new | — |
| member | map M | `projectId` → new project |
| sprint | map S | `projectId` |
| collection | map C | `projectId`; nested `sections[].id` (map Sec, per-collection), `statuses[].id` (map St, per-collection) |
| task | map T | `projectId`; `sprintId`→S; `assigneeId`→M; `collectionId`→C; `sectionId`→Sec; `collectionStatusId`→St; `dependsOn[]`→T (drop unresolved); `parentId`→T (drop unresolved) |
| event | new | `projectId`; `sprintId`→S; `taskId`: `null` stays `null`; non-null → T |

Rules:
- **Dangling refs dropped.** Any `dependsOn`/`parentId` pointing outside the bundle is removed
  (filtered / nulled) — it can't resolve in the new id space.
- **Events:** a **non-null** `taskId` that doesn't resolve → **drop the whole event row** (a
  task-level event with no task is meaningless). A **null** `taskId` is a valid sprint-level
  event (e.g. `sprint_started`, db.ts) and is **kept**. `taskSeq`/`taskTitle` are frozen
  display snapshots — left verbatim.
- **`assigneeId === null`** is a no-op (unassigned), never a map lookup.
- **`sectionId`/`collectionStatusId`** are looked up only within the task's own `collectionId`
  map; an orphan is nulled like any other dangling ref.
- **`Task.sequence` is NOT an id — preserved verbatim.** It's the per-sprint (collection: per-
  project) user-facing prereq number. Allocation is derived live (`nextSequence` =
  `max+1`), so the next task created in the imported project self-corrects from the imported
  rows. No seeding, no collision.

### `io.ts` (thin wrappers)
- **`exportProject(projectId): Promise<ProjectBundle>`** — reads the 6 tables filtered by
  `projectId`, returns a `ProjectBundle` (`version: 5`).
- **`importProject(bundle): Promise<{projectId; projectName; taskCount}>`** —
  `remapBundle(bundle, uid)` → `bulkAdd` into all tables in ONE rw transaction. Additive: **no
  clears**. Returns the NEW projectId so the caller can select it. On bulk error Dexie rolls
  back (existing data safe); `BulkError`/`ConstraintError` are translated like `importAll`.

### UI
- `App.tsx`: `downloadJson(name, data)` helper (extracted from the old inline Blob+anchor).
  Header `Export` becomes a split-menu; `handleImportFile` parses, then `isProjectBundle(data)`
  → `importProject` + toast (no confirm) + select new project; else → `importAll` (confirm).
- `ProjectSettingsView.tsx`: inline "Share this project" export row in the Project card.
- A lightweight transient **toast** (slide-up from bottom, optional action button) for the
  non-destructive import. Auto-dismisses; Undo deletes the imported project (`deleteProject`).

## Rules & edge cases
- **Always additive / repeatable.** Importing the same file twice → two independent copies,
  distinct ids, no error. (Premise: "add as new project, never overwrite".)
- **Name collisions accepted for v1.** Two imports of a same-named project produce duplicate
  names in the switcher (ids differ, data correct). Auto-rename ("(imported)") deferred.
- **Reject-whole-file validation.** A single malformed row rejects the file; nothing is added.
- **Full backup unchanged.** The replace-all path and its confirm are untouched.

## Future / open questions
- Import-with-preview dialog ("Add 'Marketing' — 3 sprints, 41 tasks?") before commit.
- Auto-rename on exact name collision.
