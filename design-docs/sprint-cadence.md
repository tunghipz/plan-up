# Sprint cadence — start-of-week & fixed duration

**Status:** Implemented (2026-06-17)
**Last updated:** 2026-06-23
**Code:** `app/src/lib.ts` (`snapToMonday`, `nextMondayOnOrAfter`, `defaultSprintDates`,
`upcomingMondays`; tests in `sprint-cadence.test.ts`), `app/src/App.tsx` (`MondayStrip`,
`NewSprintDialog`), `app/src/db.ts` (`seedFresh`)
**Related:** [sprints.md](./sprints.md) (sprint CRUD + locked `Sprint N` name),
[date-picker.md](./date-picker.md) (the calendar this would constrain)

## Purpose
Decide how a new sprint's **start date and length** are chosen. ClickUp removes the
choice entirely — every sprint starts on a Monday and runs exactly 2 weeks. plan-up
today lets you pick any start and any end. This doc lays the two models side by side
so we can pick a direction; the lean (recorded below) is to adopt ClickUp's model.

## The two models

### ClickUp (from the Create Sprint dialog)
- **Duration** is a radio: **Default (2 weeks)** selected, **Custom** *disabled/greyed*
  → in this folder you cannot change the length at all.
- **Start date** only offers **Mondays**, at a biweekly cadence (the picker greys out
  every day except the aligned Mondays — e.g. Jun 29, Jul 13, Jul 27).
- **End date** is **read-only / greyed** — auto-derived as start + 2 weeks.
- Sprint **name** must include `{INDEX}` (auto sequential number).
- Extra fields: **Use template**, **Sprint Goal**.

### plan-up today (`NewSprintDialog`)
- **Start** = day after the last sprint's `endDate` (back-to-back), else **today**
  (any weekday). `App.tsx:1370`.
- **End** = start + 13 days, but **freely editable** via a second `DateField`.
- Both Start and End are open date pickers (`DateField`, Monday-first calendar,
  every day selectable).
- **Name** is locked `Sprint N` (already automatic — see [sprints.md](./sprints.md)).
- One **optional note** field (our equivalent of Sprint Goal). No templates.

### Side by side
| Aspect | ClickUp | plan-up today |
|---|---|---|
| Start day | Monday only (snapped, enforced) | Any day (today / day-after-last) |
| Duration | Locked 2 weeks | 14 days default, editable |
| End date | Read-only, derived | Free date picker |
| Week start | Monday (ISO) | Monday-first calendar, but start unconstrained |
| Name | `{INDEX}` token | Locked `Sprint N` (already done) |
| Goal/context | Sprint Goal field | Optional note (already done) |
| Templates | Yes | No (out of scope) |

**Key insight:** plan-up is already 80% aligned. The calendar is Monday-first, and
back-to-back biweekly sprints stay Monday-aligned on their own (Mon + 13 days ends on
a Sunday → the next sprint starts Monday). Only **two** things break the ClickUp model:
1. The **first** sprint of a project defaults to *today* (any weekday).
2. The **End** field is freely editable, so a user can drift the length.

## Decision (agreed 2026-06-17)
- **Start locked to Mondays** — like ClickUp. The start picker only allows Mondays;
  every other weekday is faded/non-clickable.
- **Default start = the current week's Monday** (or day-after-last-sprint, which is
  already a Monday for biweekly runs). The user **can still pick a later Monday**
  (a subsequent sprint Monday) — the default is current, not a hard floor.
- **Week starts Monday** (ISO).
- **Fixed 2-week duration**, end auto-derived and **read-only**. **No Custom option**
  — the length is absolute (revisit only if a real need like a 1-week hotfix appears).
- **End is shown as a range line + "2 weeks" badge**, not a greyed read-only field
  (calmer, fewer boxes). Mockup: `demo/sprint-cadence-demo.html`.

This fits plan-up DNA: *speed > breadth, ≤1 click per action, calm utility*. Fewer
inputs on create — start is the only real choice, and it snaps to a Monday.

## Proposed spec (if we commit the lean)

### Create dialog
- **Start**: a **Monday-strip picker** — a horizontal row of chips, one per upcoming
  Monday (`Mon / 15 / Jun`, scroll for later ones), **not** a month calendar. Since only
  Mondays are valid, a month grid is ~25/30 dead cells; the strip shows only real
  options and removes the "disabled-day keyboard nav" problem entirely. The default
  Monday is pre-selected and carries a small **"this week"** badge. (Pattern 2, chosen
  2026-06-17 from `demo/sprint-create-patterns.html`.) All Mondays stay selectable
  (default isn't a hard floor). Default selection:
  - If a previous sprint exists → day after its end (already a Monday for biweekly
    runs); if a legacy sprint ended mid-week, snap that result **forward to the next
    Monday**.
  - Else → **Monday of the current week** (`snapToMonday(today)`).
- **End**: no picker. Replaced by a **calm range line + "2 weeks" badge** — the derived
  end (`start + 13`, a Sunday) shown on an `accent-soft` line as `→ Sun Jul 12` with a
  small `2 weeks` pill, plus the full range echoed in a caption beneath
  (`Mon Jun 29 → Sun Jul 12 · ends on a Sunday…`). Chosen over a ClickUp-style greyed
  read-only field — fewer boxes, fits calm-utility DNA. (Decided 2026-06-17 from the
  `demo/sprint-cadence-demo.html` mockup.)
- **Name** stays locked `Sprint N` (unchanged).
- **Note** stays (our Sprint Goal).

### Shared helper (single source of truth — DRY)
Both sprint-creation paths (the dialog **and** `seedFresh`, see below) compute their
default dates through **one** helper in `lib.ts`, so the Monday invariant can never
drift between them:
```
snapToMonday(iso):           // → ISO of the Monday of that date's week
  d = parse(iso)
  delta = (d.weekday + 6) % 7   // Mon=0 … Sun=6
  return d - delta days

defaultSprintDates(lastSprint?):   // → { startDate, endDate }
  start = lastSprint
    ? snapToMonday(lastSprint.endDate + 1 day)   // fwd-snap covers legacy mid-week ends
    : snapToMonday(today)
  return { start, end: start + 13 days }
```
End is always `start + 13 days`. Because start is a Monday and the length is fixed,
end is always the second Sunday — back-to-back sprints chain Monday→Monday with no gap.

## Data
No schema change. `Sprint { startDate, endDate }` already store `yyyy-mm-dd`. The
Monday invariant is enforced at the **two creation paths** (not stored as a flag), so
the row shape is identical → no Dexie version bump (same spirit as the optional-note
decision in [sprints.md](./sprints.md)).

> **Both creation paths must use the shared helper** — there are two:
> 1. `App.tsx` `NewSprintDialog` (user-initiated) — `db.sprints.add` at ~L1412.
> 2. `db.ts` `seedFresh()` (~L1940) — auto-creates "Sprint 1" when a project is first
>    seeded, currently `startDate = today` (any weekday). **This bypasses the dialog**,
>    so it must also call `defaultSprintDates()` or its Sprint 1 silently breaks the
>    Monday invariant. (Caught in CEO review — was the doc's one real gap.)

## Implementation (built)
- `lib.ts` shared helpers (single source of truth): `snapToMonday`,
  `nextMondayOnOrAfter`, `defaultSprintDates`, `upcomingMondays`, plus
  `sprintEndForStart` (start + 13) and `todayLocalISO` (the one "local today"
  computation, reused by the dialog and `seedFresh`). `MON` (month abbreviations) is
  exported and reused — no duplicate arrays. Unit-tested in `sprint-cadence.test.ts`
  (identity, mid-week snap, forward-snap, **stale-clamp**, year boundary, end-derivation).
- **New `MondayStrip` component** (sprint-create only): a horizontal, scrollable row of
  Monday chips from `upcomingMondays(n)`. Each chip = weekday/day/month; selected = accent
  fill; the current week's Monday gets a `"this week"` badge. **Proper radiogroup keyboard
  contract** — roving `tabIndex` (only the checked chip is in the tab order), `← ↑` / `→ ↓`
  move the selection and focus, `Home` / `End` jump to ends. **The `DatePicker` month
  calendar is NOT touched** — pattern 2 sidesteps the disabled-day keyboard problem
  entirely; task/board/days-off pickers keep the month calendar as-is.
- `App.tsx` `NewSprintDialog`: default dates via `defaultSprintDates(lastSprint?.endDate,
  todayLocalISO())`, render the `MondayStrip` for Start, derive end via `sprintEndForStart`,
  show the read-only range line.
- `db.ts` `seedFresh()`: dates via `defaultSprintDates(null, todayLocalISO())` so the
  seeded Sprint 1 is Monday-aligned too.

## Rules & edge cases
- **Legacy sprints** with non-Monday starts keep their stored dates (display only). The
  lock applies to **new creates**, not a renumber/migration — same philosophy as the
  locked-name decision (2026-06-12).
- **Editing dates after create:** uses the same Monday-lock and fixed two-week duration
  as creation. The edit dialog changes `startDate` and derives `endDate`; it does not
  rewrite existing task dates.
- **First sprint mid-week:** the snap means a project's first sprint may start a few
  days "ago" (the current week's Monday). Acceptable and matches ClickUp's feel.
- **Stale / long-ago last sprint → clamp to this week.** `defaultSprintDates` clamps the
  back-to-back start to `max(nextMondayAfterLast, thisWeekMonday)`, so resuming after a
  break never defaults a new sprint into the past (and the strip's "this week" Monday stays
  reachable). Continuous chains are unaffected (the back-to-back Monday is already ≥ this
  week). Tested. (Caught in tech-lead review of 752ebe2.)
- **Off-by-week:** because end is derived, a user can never accidentally create a 9- or
  20-day sprint — the source of the "drift" the locked `Sprint N` numbering dislikes.
- **Legacy mid-week chains leave a gap.** For an existing project whose latest sprint
  starts mid-week, the forward-snap means the *next* sprint starts on the upcoming Monday
  — leaving a few dead days between them. This repeats on each create until the chain
  re-aligns to Monday (which it does after the first snapped sprint, since every new one
  is then Mon→Sun). Acceptable: a one-time realignment, no data loss, and brand-new
  projects (post-`seedFresh` fix) never see it.

## Resolved (2026-06-17)
1. **First-sprint default → current week's Monday.** The user can still pick a later
   ("subsequent") Monday in the picker; the default is just the current week's Monday.
2. **Length → fixed 2 weeks, absolute.** No Custom escape hatch. Revisit only if a real
   need (e.g. 1-week hotfix sprint) appears.
3. **Week start → Monday (ISO).** Calendar header stays Mo-first; `snapToMonday` matches.

## Future / open questions
- **Templates / Sprint Goal parity:** ClickUp's template picker is out of scope; our
  optional note already covers the Goal. No action unless requested.
