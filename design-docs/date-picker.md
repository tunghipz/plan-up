# Date picker (custom calendar)

**Status:** Implemented
**Last updated:** 2026-07-21 (days-off entry range widens to the member's task span)
**Code:** `app/src/DatePicker.tsx` (component) · consumers: `SprintView.tsx` (List), `BoardView.tsx` (Board quick-edit), `App.tsx` (sprint dialog), `members.tsx` (days-off), `CollectionView.tsx` (collection items — **range** mode)

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
    member being edited (days-off picker). **Only off-days inside the sprint are dotted** —
    an off-day in another sprint/month carries no marker (filtered by `sprintRange`).
  - **Days-off list (footer)** — below the grid, when the assignee has off-days inside the
    sprint, a compact list spells out each: `Jun 6 · AM off · 08:00–12:00`, `Jun 10 · Off all
    day`. Always visible (glanceable, no hover needed). Header carries the orange dot key.
  - **Out-of-range** (min/max) — faded, not clickable (days-off entry is clamped to the
    sprint's date range, widened to the member's task span — see below).
- **Footer**: **Today** (jump+select) and **Clear** (→ null/empty) ghost actions.
- **Keyboard**: the grid is focused on open; **← → ↑ ↓** move the focused day (crossing
  months auto-flips the view), **Enter/Space** selects, **Esc** closes.

## Where it's used
| Surface | Component | Extras passed |
|---|---|---|
| List start/due | `DatePickCell` (SprintView task rows) | assignee `daysOff` dots · `locked` (computed-from-prereqs/effort) · `time` suffix · overdue red · **sprint range shaded, opens on the sprint month** (via `SprintRangeContext`) — **shade only, all dates selectable** |
| Board quick-edit | `DatePickCell` (BoardView `DatePopover`) | assignee `daysOff` · same lock/time · **sprint range shaded, shade only** (context) |
| Sprint create/edit | `DateField` (App `NewSprintDialog`) | plain (no range/days-off — it's *defining* the sprint) |
| Member days-off | `DateField` (members popover) | `min`/`max` = sprint range **widened to the member's task span** (`daysOffWindow`, so an overdue task date before the sprint start is pickable) · `sprintRange` shade · existing days as `daysOff` dots. The AM/PM/All `<select>` + Add stay as-is |
| Collection item start/end | `DateRangePickCell` (CollectionView item rows) | **range** mode — one popover sets both `startDate` + `dueDate`; no sprint range / days-off / time |

## Range mode (collection items) — 2026-06-25
Collection items span a **date range** (`[startDate … dueDate]`, **no time-of-day** — the
user explicitly didn't want clock times). A single calendar popover picks **both** endpoints
in two clicks, replacing the two independent single-date cells. Opt-in only — sprint/board/
days-off keep the single-date behavior unchanged.

- **Trigger** — `DateRangePickCell` renders the same right-aligned cell as `DatePickCell`.
  Two cells share one range: the **Start** cell shows `startDate`, the **End** cell shows
  `dueDate`; **both open the same range popover**. Empty cells show the quiet dashed pill
  (`＋ Start` / `＋ End`) via the existing `emptyHint`.
- **Two-click cycle** (`RangeCalendarPopover`):
  1. Click 1 → set **start**, clear end, wait for end.
  2. Click 2 → if `≥ start`: set **end**, write `{startDate, dueDate}` once, close. If `< start`:
     treat as a new start (re-pick). Clicking the **same day twice** = a 1-day event (start = end).
  - **Init**: have start but no end → open straight into "waiting for end"; have both → reopening
     starts a fresh range (old range stays highlighted so re-picking is easy); have neither → wait
     for start.
  - **Closing mid-pick** (outside-click / Esc) commits the draft as-is (start may have no end).
- **Grid visuals** — `CalendarGrid` gains optional `rangeStart` / `rangeEnd` / `selectingEnd`:
  the two endpoints fill accent (white text), days **between** tint `accent-soft` (same tint as
  the sprint shade), and while waiting for the end click the grid shows a **hover preview** band
  from start to the hovered day. Absent these props → single-date rendering, byte-for-byte as before.
- **Footer (range mode)** — left shows a live hint (`Pick a start` → `Jul 3 – …` → `Jul 3 – Jul 5`);
  right is **Clear** (clears *both* endpoints). **No "Today"** in range mode (a single jump-select
  is meaningless for a range).

## Component API (`DatePicker.tsx`)
- `CalendarGrid` (internal) — the month grid + keyboard nav. Props: `value`, `onSelect`,
  `min?`, `max?`, `sprintRange?`, `daysOff?`, plus optional range props `rangeStart?`,
  `rangeEnd?`, `selectingEnd?` (range mode: endpoint fills + `accent-soft` band + hover preview).
- `CalendarPopover` (internal) — portal + positioning + outside-click/Esc + footer
  (Today / Clear). Wraps `CalendarGrid`.
- `RangeCalendarPopover` (internal) — same portal/positioning as `CalendarPopover`, but runs
  the two-click range state machine + range footer (hint + Clear). Wraps `CalendarGrid` in range mode.
- **`DateRangePickCell`** (exported) — collection range trigger: `which: 'start'|'end'`,
  `start: string|null`, `end: string|null`, `onChange({start, end})`, `ariaLabel`, `emptyHint?`.
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
A task belongs to a sprint, so its start/due picker **highlights the sprint** — the range is
shaded and the popover **opens on the sprint month** even when the date is empty (initial
view/focus lands in the range). It's **shade only — every date stays selectable**: a task can
legitimately start/end outside its sprint (long effort, manual due), so the sprint is a hint,
not a hard fence. To avoid threading the range through `TaskRows → TaskRow` / `UnassignedCard`
/ `DatePopover`, it's provided via **`SprintRangeContext`**: `SprintView` and `BoardView` wrap
their tree in `<SprintRangeContext.Provider value={{start,end}}>`, and `DatePickCell` reads it
(an explicit `sprintRange` prop still overrides) and passes it as the shade only — no min/max.

`DateField` does **not** read the context. The sprint dialog stays unscoped (it *defines* the
range); the **days-off** picker is the one place that DOES hard-clamp (`min`/`max` = sprint
range) — a day off must fall inside the sprint being edited.

## Notes
- localStorage: none (the picker holds no persistent UI pref).
