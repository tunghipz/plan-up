# Status & priority

**Status:** Implemented
**Last updated:** 2026-07-02 (`STATUS_META`/`STATUS_ORDER` moved to `sprint-logic.ts`)
**Code:** `app/src/sprint-logic.ts` (`STATUS_META`, `STATUS_ORDER` — pure module shared by
List/Board/Timeline), `app/src/SprintView.tsx` (`StatusDot`, `StatusIcon`, `StatusPicker`,
`PriorityChip`), `app/src/BoardView.tsx`

## Purpose
Communicate where a task stands and how urgent it is, with calm, glanceable visuals.

## Status
Three states: `todo` · `in_progress` · `done` (`STATUS_META`, `db.ts` `Status`).
- **Status circle** (`StatusIcon`): dashed ring (todo) → half-filled (in progress) →
  filled with check (done). Reminders-style.
- **Click to cycle** (`StatusDot` in list, the circle in board): todo → in_progress →
  done → todo.
- **Status pill** (`StatusPicker`): soft-tinted rounded pill + colored dot + a `<select>`
  to pick directly. Colors come from `--color-status-*` tokens (dark-safe).

## Priority
Five levels: `urgent` · `high` · `normal` · `low` · `none`.
- **`PriorityChip`** renders a soft-tint pill **only for `urgent` and `high`** (red /
  orange). Normal/low/none are the silent default — no chip — to keep rows calm.

## Implementation
- `STATUS_META` maps each status to a label + CSS color var; `STATUS_ORDER` defines the
  cycle and board column order.
- Status colors: `--color-status-todo|progress|done`. Priority colors:
  `--color-priority-urgent|high|…`.

## Rules & edge cases
- Status is the single source for the progress ring, capacity %, board columns, "done"
  exclusions in overdue/next-deadline, and blocked logic.
- Only urgent/high earn a priority chip — an intentional anti-clutter rule (see
  `design-system.md`).
