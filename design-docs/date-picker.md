# Date picker (custom calendar)

**Status:** Implemented
**Last updated:** 2026-06-05
**Code:** `app/src/DatePicker.tsx` (component) · consumers: `SprintView.tsx` (List), `BoardView.tsx` (Board quick-edit), `App.tsx` (sprint dialog), `members.tsx` (days-off)

## Purpose
Replace the native `<input type="date">` (browser chrome — inconsistent across
browsers, not Cupertino, not dark-aware, can't show planning context) with a single
**custom Cupertino calendar popover** used everywhere a date is chosen. Designed via
/huashu-design (builder mode); direction **V1 "Mini"**, planner-aware.

## User-facing behavior
- Clicking any date target opens a **calendar popover** (portal, pinned under the
  trigger, re-pins on scroll/resize, flips up if no room below). Outside-click or **Esc**
  closes; the OS chrome is gone — it's our surface, fully themed for light/dark.
- **Month grid**, **Monday-first** (`Mo Tu We Th Fr Sa Su`). `‹ ›` step months.
- **Planner-aware markers**:
  - **Today** — accent ring (inset).
  - **Selected** — filled accent, white text.
  - **Weekends** — dimmed (muted ink) **but still selectable** (a manual start can fall on
    a weekend even though the scheduler skips them).
  - **Assignee days-off** — a small orange dot under the day (half-day = half dot), so you
    don't schedule onto a known off-day. Shown for the task's assignee (task cells) / the
    member being edited (days-off picker).
  - **Out-of-range** (min/max) — faded, not clickable (days-off entry is clamped to the
    sprint's date range).
- **Footer**: **Today** (jump+select) and **Clear** (→ null/empty) ghost actions.
- **Keyboard**: the grid is focused on open; **← → ↑ ↓** move the focused day (crossing
  months auto-flips the view), **Enter/Space** selects, **Esc** closes.

## Where it's used
| Surface | Component | Extras passed |
|---|---|---|
| List start/due | `DatePickCell` (SprintView task rows) | assignee `daysOff` dots · `locked` (computed-from-prereqs/effort) · `time` suffix · overdue red · **clamped + shaded to the sprint range** (via `SprintRangeContext`) |
| Board quick-edit | `DatePickCell` (BoardView `DatePopover`) | assignee `daysOff` · same lock/time · **clamped + shaded to the sprint range** (context) |
| Sprint create/edit | `DateField` (App `NewSprintDialog`) | plain (no range/days-off — it's *defining* the sprint) |
| Member days-off | `DateField` (members popover) | `min`/`max` = sprint range · `sprintRange` shade · existing days as `daysOff` dots. The AM/PM/All `<select>` + Add stay as-is |

## Component API (`DatePicker.tsx`)
- `CalendarGrid` (internal) — the month grid + keyboard nav. Props: `value`, `onSelect`,
  `min?`, `max?`, `sprintRange?`, `daysOff?`.
- `CalendarPopover` (internal) — portal + positioning + outside-click/Esc + footer
  (Today / Clear). Wraps `CalendarGrid`.
- **`DatePickCell`** (exported; re-exported from `SprintView` for back-compat) — task
  date trigger: `value: string|null`, `onChange(v|null)`, `time?`, `highlight?: 'overdue'`,
  `locked?`, `ariaLabel`, `sprintRange?`, `daysOff?`. Trigger visuals unchanged (right-aligned
  value + time, `—` when empty, red when overdue, disabled+tooltip when locked).
- **`DateField`** (exported) — input-styled trigger: `value: string` (`''` = empty),
  `onChange(v)`, `placeholder?`, `min?`, `max?`, `sprintRange?`, `daysOff?`, `className?`
  (per-context trigger style; App dialog = full-width panel, members = compact inline).

## Constraints preserved (parity with the old native path)
- Storage stays **`yyyy-mm-dd`** (or `null`/`''`); display stays **`MMM d`** (`formatShortDate`).
- **Locked** start/due (prereqs / effort>0) → read-only trigger + tooltip; popover never opens.
- **min/max** for days-off clamps selectable days to the sprint range.
- **time suffix** (08:00 / 17:00, display-only) and **overdue** red highlight unchanged.
- SF tabular-nums; no monospace (drops a `font-mono` slip the old members `DateField` had).

## Sprint scoping (task cells)
A task belongs to a sprint, so its start/due picker is **clamped to the sprint's date
range** — days outside the sprint are faded + non-selectable, and the range is shaded. To
avoid threading the sprint range through `TaskRows → TaskRow` / `UnassignedCard` /
`DatePopover`, the range is provided via **`SprintRangeContext`**: `SprintView` and
`BoardView` each wrap their tree in `<SprintRangeContext.Provider value={{start,end}}>`, and
`DatePickCell` reads it (an explicit `sprintRange` prop still overrides). The popover opens on
the sprint month even when the date is empty (the initial view/focus is clamped into the
range). `DateField` does **not** read the context — the sprint dialog must stay unclamped
(it's *defining* the range), and days-off passes its range explicitly.

## Notes
- localStorage: none (the picker holds no persistent UI pref).
