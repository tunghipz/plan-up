# Member title

**Status:** Implemented
**Last updated:** 2026-06-04
**Code:** `app/src/db.ts` (`Member.title`), `app/src/ProjectSettingsView.tsx`
(edit), `app/src/SprintView.tsx` (`GroupHeader` display), `app/src/members.tsx`
(if a shared display helper is extracted)

## Purpose
Give each member an optional **role label** ("Backend Engineer", "Designer",
"PM") so that when you look at a sprint you know *who plays what role*, not just
who is assigned. It is identity sugar — it makes the member list read like a
team, not a list of names. Fits the app DNA: a calm, single-user planner where
the "members" are virtual people you organise work around.

## User-facing behavior
- **Edit** in the project settings drawer (the member row, next to where you
  already rename a member and set days-off). A quiet, optional field — empty by
  default, placeholder prompts for a role.
- **Display** read-only everywhere a member's name appears at group level:
  - **Settings drawer member row** — under/near the name (the row is already a
    two-line layout: name + days-off metric; title slots in as part of the
    member's identity block).
  - **Sprint group header** — inline after the name as `An · Backend Engineer`,
    the title in `text-ink-faint` so it reads as secondary to the name.
- **Not** shown on individual task rows (only the assignee avatar appears there;
  adding the title would crowd a data-dense row — see chosen scope below).

## Data
- `Member` gains one **optional, non-indexed** field: `title?: string`.
  See [data-model.md](./data-model.md).
- `Member` stays `{ id, projectId, name, color, daysOff, title? }`.

### No Dexie version bump
`title` is **not indexed** (Dexie only declares indexed props in `.stores()`),
so new optional properties on stored objects need no migration — identical to the
`Project.description` / `Project.color` precedent in
[project-member-settings.md](./project-member-settings.md). Existing member rows
simply lack the field; the UI treats missing/empty as "no title". Export/import
already serialises whole `Member` objects (`exportAll` → `members: Member[]`), so
title rides along automatically; **`ExportPayload.version` does not change**, and
older export files still import (they just have no title).

## Implementation (Approach A — minimal free-text)
1. **`db.ts`** — add `title?: string` to the `Member` interface. No `.stores()`
   change, no `version().upgrade()`. `seedFresh` members may set a title or leave
   it unset (cosmetic).
2. **`ProjectSettingsView.tsx` → `MemberRow`** — add an inline editable title
   field in the member's identity block. Mirror the existing name-edit pattern
   (`.editable`, commit on blur/Enter, Escape reverts) writing
   `db.members.update(id, { title })`. Empty string clears it (store `undefined`
   or `''`; treat both as "no title" on read).
3. **`SprintView.tsx` → `GroupHeader`** — `GroupHeader` currently takes
   `name: string`. Add an optional `title?: string` prop and render it inline
   after the name: `<span className="text-ink-faint text-sm">· {title}</span>`,
   only when non-empty. Pass `title={member.title}` from the two member
   `GroupHeader` call sites (≈`SprintView.tsx:308` and `:435`).
4. **Optional shared helper** — if the "name · title" treatment is wanted in more
   than one place later, extract a tiny `MemberName` display into `members.tsx`.
   Not needed for this round (two call sites).

## Rules & edge cases
- **Optional & quiet.** No title → render just the name, no separator dot, no
  empty affordance. Title is never required.
- **Pure metadata.** Title does **not** affect scheduling, capacity, assignment,
  dependencies, or sorting. Display only.
- **Free text, single user.** No validation, no preset list — typos are the
  user's own (acceptable for a one-person tool; presets were considered and cut
  as over-engineering, see Approaches).
- **Long titles** — the sprint header is a single flex row; a very long title
  should truncate (`truncate` / `min-w-0`) rather than push the stats/extras
  off-screen. Cap visual width in the header; settings can wrap.
- **Dark mode** — uses `text-ink-faint` token, no hardcoded color.
- **Empty state** — zero members unaffected (no rows to show a title on).

## Approaches considered
- **A · Minimal free-text, inline (CHOSEN).** `title?: string`; edit in settings,
  display inline in the sprint header. Smallest diff, exactly matches the scope
  "show everywhere a member appears (settings + sprint header)". Calm, no new
  patterns.
- **B · Free-text + avatar tooltip.** Same field, plus the title in the assignee
  avatar's `title=` tooltip on task rows. Deferred: low-discoverability, more
  surfaces to keep in sync; can be added later for ~free if wanted.
- **C · Structured presets.** Title from a preset set (Eng/Design/PM/QA) + custom,
  like priority chips. Rejected: a role list to maintain is over-engineering for a
  single-user tool and cuts against "calm > breadth" (design-system §1).

## Scope decision (this round)
Display surfaces = **settings drawer member row + sprint group header** only.
Explicitly **out**: task rows (avatar only stays there). Chosen by the user during
the /office-hours session on 2026-06-04.

## The assignment / next step
Implement Approach A in the order above (db field → settings edit → header
display), then `npx tsc --noEmit` + `npm run build` + `npx vitest run` (the
no-migration claim is worth a quick check that an old export still imports).

## Future / open questions
- Promote title into the avatar tooltip (Approach B) if you find yourself wanting
  the role where only the avatar shows.
- If multiple people ever use one project (not today's model), titles might want
  a shared vocabulary — revisit presets then, not now.
