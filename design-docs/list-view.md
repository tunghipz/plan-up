# List view

**Status:** Implemented
**Last updated:** 2026-06-03
**Code:** `app/src/SprintView.tsx` (`MemberCard`, `UnassignedCard`, `GroupHeader`,
`TaskColumnHeader`, `SortHeader`, `COL`)

## Purpose
The primary editing surface: every task in the sprint, grouped by assignee in
inset-grouped cards, fully editable inline.

## User-facing behavior
- One **card per member** (plus an **Unassigned** card, and a collapsed "members with no
  tasks" section). Each card = a `GroupHeader` + its own labelled column header + task rows
  + an "Add task" row.
- **Collapse** a member card by clicking its header (persisted per sprint).
- **Sort** by any column via its header (`ID, Task, Effort, Start, End, Status, Prereq`);
  click toggles asc/desc, active column shows an arrow.
- Member cards omit the **Assignee** column (everyone in the group is the same person);
  the Unassigned card keeps it.

## Column widths (`COL`)
Fixed widths sized to measured content + a small buffer; **Task** is `flex-1` and absorbs
slack:
`dot 16 · ID 32 · Task flex(min 150) · Assignee 64 · Effort 80 · Start 112 · End 112 ·
Status 112 · Prereq 56 · actions 16`. Header & rows share the same `COL` constants so
they stay aligned.

## Horizontal scroll
Each group wraps its header + rows in `overflow-x-auto` with a `min-w` floor (**member
820px**, **unassigned 896px**) ≥ true content width. On narrow screens the table scrolls
instead of crushing the Task column, and the grey column-header background still spans the
full content width (no fall-short on scroll).

## Rules & edge cases
- Changing a `COL` width means re-checking the `min-w` floors (must stay ≥ summed content).
- Collapse state key: `localStorage['plan-tmp:collapsed:<sprintId>']`.
- Group header right side surfaces the member summary — see
  [member-header-summary.md](./member-header-summary.md).
