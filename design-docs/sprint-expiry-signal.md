# Sprint expiry signal

**Status:** Implemented
**Last updated:** 2026-07-16
**Code:** `app/src/lib.ts` (`daysBetween`, `sprintExpirySignal`; tests in
`sprint-expiry.test.ts`), `app/src/App.tsx` (`SprintPageHeader` banner,
`SprintStateDot` attention tone, `NewSprintDialog` carry-over)
**Related:** [sprint-rollover.md](./sprint-rollover.md) (the banner reuses the
rollover preview + move), [sprint-cadence.md](./sprint-cadence.md) (create dialog),
[sprints.md](./sprints.md)

## Purpose
A sprint passes its `endDate` and the app said **nothing** — no signal it lapsed, no
prompt to create or switch to the next sprint. Rollover only surfaced when a *next*
sprint already existed, so a lapsed sprint with no successor left the user with zero
affordance. This adds a calm, contextual signal in the sprint header (+ a sidebar
dot) that turns "this sprint is over" into a one-click path forward.

## User-facing behavior
A banner appears inside the **sprint page header** (below the title/note, above the
Dates row) whenever the viewed sprint is lapsing or has lapsed. Four states, chosen
by `sprintExpirySignal`:

| Kind | When | Tone | Primary action | Secondary |
| --- | --- | --- | --- | --- |
| **ended-open** | past · open work · next sprint exists | amber (warn) | **Roll over N → {next}** (opens the rollover preview popover) | Go to {next} |
| **ended-open-nonext** | past · open work · **no next sprint** | amber | **Start {next} — carry N over** (opens New Sprint dialog with carry-over pre-checked) | — |
| **ended-done** | past · everything done | neutral + green check | **Go to {next}** (or **Start {next}** if none) | — |
| **ending-soon** | in progress · ends today or tomorrow | neutral (calm) | **Go to {next}** (or **Plan {next}** if none) | — |

- "ended N days ago" / "ended yesterday"; "ends today" / "ends tomorrow" — worded
  from `endedDays` / `endsInDays` (tabular-nums).
- The banner **self-clears** once resolved: rolling over (or otherwise selecting the
  next sprint) moves you off the lapsed sprint, so its header no longer shows a
  past-state banner.
- **Roll over** here is the *same* `RolloverPopover` + `moveUnfinishedToNextSprint`
  used by the toolbar button (confirm-by-preview, no divergence) — see
  [sprint-rollover.md](./sprint-rollover.md). The toolbar Roll over button stays; the
  banner is the louder contextual entry that only appears on a lapsed sprint.
- **Sidebar dot:** a lapsed sprint that still has open leaf work shows an **amber**
  `SprintStateDot` (attention) instead of the muted grey, so the signal is visible in
  the sprint list too. Fully-done past = green (unchanged); a past sprint with **0
  tasks** stays grey (nothing to attend to). On the active (brand-fill) row the dot is
  white regardless.

## Data
No schema change. Everything derives from the existing `Sprint.startDate/endDate`
and the sprint's tasks (`openCount` = unfinished **leaf** tasks, matching rollover
counting). `NewSprintDialog` carry-over reuses `moveUnfinishedToNextSprint` (moves
`sprintId`/`sequence` only) — no new fields.

## Implementation
- **`sprintExpirySignal(startDate, endDate, today, openCount, hasNext)`** (`lib.ts`)
  — pure classifier returning `{ kind, endedDays, endsInDays } | null`. `null` =
  mid-sprint with time left, or upcoming (no banner). Uses **`daysBetween`** (pure,
  UTC-anchored two-arg diff — unlike `dayDiff`, which reads the live clock, so the
  signal is unit-testable with a fixed `today`).
- **`SprintPageHeader`** (`App.tsx`) takes `today`, `nextName`, `hasNext`,
  `openCount`, `rolloverTasks`, `members`, and callbacks `onRollover` /
  `onGoToNext` / `onStartNext(carry)`. It calls `sprintExpirySignal`, and when
  non-null renders the banner + (for `ended-open`) an in-header `RolloverPopover`
  anchored to its own button.
- **`onStartNext(carry)`**: sets a `carryOnCreate` descriptor (count/fromId/fromName
  when `carry`) and opens `NewSprintDialog`. On create, if carry, it runs
  `moveUnfinishedToNextSprint(fromId)` (the freshly-created sprint is found as the
  "next" by `startDate`) and selects the target; else selects the new sprint.
- **`NewSprintDialog`** gains an optional `carry` prop (`{ count, fromName }`). When
  present it shows a pre-checked "Carry N unfinished from {fromName}" checkbox and
  passes the checkbox value to `onCreate(sprint, carry)`. Opened without `carry`
  (empty state, `n` key, sidebar +) it behaves exactly as before.
- **`SprintStateDot`** gains an `attention` flag → amber (`--color-priority-high`)
  fill; `renderSprintRow` sets it for `state==='past' && total>0 && done<total`.

## Rules & edge cases
- **`endedDays` for a past sprint is ≥1** — the `endDate` day itself is still
  `progress` (window inclusive on both ends), so "ended today" never occurs; the last
  day is covered by `ending-soon` (`endsInDays===0`).
- **`ending-soon` kept (decision 2026-07-16):** the last-day heads-up fires *before*
  expiry. Neutral tone + ghost CTA so it never nags. (Considered dropping it to fire
  only after end — kept per user.)
- **Carry create finds the new sprint as "next":** the created sprint's Monday start
  is after the lapsed sprint's start, so `moveUnfinishedToNextSprint(fromId)` targets
  it. If the user picks a *later* Monday leaving an intervening sprint, the move still
  targets the chronologically-next one (same rule as manual rollover) — acceptable.
- **Empty past sprint** (0 tasks) → `ended-done` banner (nothing to carry), grey
  sidebar dot.
- **Toolbar Roll over unchanged** — it shows whenever a next sprint + unfinished exist
  (any state), so mid-sprint early rollover still works; the banner does not replace it.

## Future / open questions
- **Persistent toolbar chip** ("ended 3d ago", visible when the header scrolls away) —
  prototyped in the demo as an optional treatment, deferred. The sidebar amber dot
  already persists the signal.
