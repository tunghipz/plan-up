---
name: project-management
description: Use when working with a Microsoft Project XML schedule — reading tasks, resources, Gantt data, assignments, workload, days off, milestones, or the critical path; also for editing the schedule (moving tasks, updating percent complete, reassigning resources, adding milestones). Invoked via the Quipu MCP tools — prefer them over raw file reads for anything schedule-shaped. Triggers on phrases like "the project", "the schedule", "tasks for X next week", "who's free", "push this task", "mark it done", ".mpp file", "Gantt", "milestone".
---

# Project management via Quipu MCP

You are editing Microsoft Project XML schedules through the `quipu` MCP server. The server exposes a small, stable tool surface — use these tools rather than reading the XML directly.

## The file-path contract

Every tool accepts an optional `filePath`. **You usually don't need to pass it.**

- When the Quipu desktop app is open with a project, it writes the path to `~/.config/quipu/current_project.txt`. The MCP server reads this automatically. So "the project" = whatever is open in the app.
- Only pass `filePath` explicitly when the user names a different file or there's no app session.
- If a tool returns "No project currently open" and the user didn't name a file, ask for one.

## Tool map — pick the right one

| User intent | Tool |
|---|---|
| "Show me the schedule / what's in this project" | `read_project` (full dump) |
| "Tasks of X next week" / "overdue" / "milestones" / "critical path" | `list_tasks` with filters |
| "Who's on the team" | `list_resources` |
| "Tell me about task #N" | `get_task` |
| "Move this task" / "mark done" / "change dates" | `update_task` |
| "Add a new task" | `add_task` |
| "Remove this task" | `delete_task` |
| "Assign X to task Y" | `assign_task` |
| "Shift many tasks at once" | `bulk_update_tasks` (one call, not a loop) |
| "Project status / progress summary" | `get_project_summary` |
| "Who's overloaded / underloaded" | `get_resource_workload` |
| "When is X off / holidays" | `list_days_off` |
| "Add a day off / holiday" | `add_days_off` |
| "Remove a day off" | `remove_days_off` |

## list_tasks — the workhorse

Reach for `list_tasks` first for almost any question about *which* tasks match *some criteria*. It supports combining filters in one call:

- `startDate` + `endDate` — date window (ISO 8601, e.g. `2026-04-20` to `2026-04-27`)
- `resourceName` — case-insensitive exact match (e.g. `"TuanNL"`)
- `resourceUid` — numeric ID when you already have it
- `status` — `completed | inProgress | notStarted | overdue`
- `onlyMilestones` / `onlyCritical` — booleans
- `excludeSummary: true` — skip rollup rows (usually what you want)
- `nameContains` — substring match

**Don't** call `read_project` and then filter in your head. Let the server filter.

## Workflow conventions

1. **Read before write.** Before `update_task` / `delete_task` / `bulk_update_tasks`, call `list_tasks` or `get_task` so you know current values (dates, assignees, percent complete) and can explain what's changing.
2. **Prefer bulk updates.** If the user asks to shift five tasks, call `bulk_update_tasks` once, not five `update_task`s.
3. **Confirm destructive changes.** For `delete_task` or bulk moves that affect >3 tasks or change dates by >1 week, summarize the plan and ask the user to confirm before calling the tool.
4. **Report what changed.** After any write, state which task IDs changed and the new values — users need to be able to verify without re-reading the Gantt.
5. **Dates are ISO 8601.** `2026-04-27` for dates; `2026-04-27T08:00:00` for datetimes; `PT40H0M0S` for durations (ISO 8601 duration, here 5 working days × 8h).
6. **Days off vs task moves.** When someone reports being out, use `add_days_off` rather than manually shifting all their tasks — the schedule tools handle the cascade.

## Common user phrasings and the right tool

- *"List tasks assigned to Khiem next week"* → `list_tasks` with `resourceName: "KhiemLNT"`, `startDate`, `endDate`.
- *"Who's underloaded the week of April 20?"* → `get_resource_workload` with that week.
- *"Push TuanNL's Friday tasks because he's off that afternoon"* → `add_days_off` for TuanNL on that Friday afternoon; then re-query `list_tasks` to show the new dates.
- *"Add a 20% buffer after milestone X"* → `get_task` the milestone; identify downstream tasks with `list_tasks`; `bulk_update_tasks` to shift them; confirm.
- *"Project status report"* → `get_project_summary` + `list_tasks` filtered to `inProgress`/`overdue` → narrate.

## Don't

- Don't `Read` or `Edit` the XML file directly. The MCP server handles invariants (XML structure, assignment elements, calendar, critical-path recompute) that hand-editing will quietly break.
- Don't loop `update_task` when `bulk_update_tasks` exists.
- Don't call `read_project` "just to check" before every query — `list_tasks` / `get_project_summary` are faster and scoped.
