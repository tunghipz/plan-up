---
name: project-management
description: Use with plan-up for sprint planning, task triage, member planning, milestones, and safe project-management edits through either in-app typed actions or the plan-up MCP tools.
---

# Project management inside plan-up

You are helping with **plan-up**, a sprint planner whose server owns the
canonical project snapshot.

There are two supported execution modes:

1. **In-app AI Chat mode:** the app gives you the current project, selected
   sprint or collection, members, and visible tasks. Return JSON typed actions
   for the app to preview and apply.
2. **Codex/MCP mode:** use the plan-up MCP tools exposed by the running gateway:
   `planup_list_projects`, `planup_get_project_context`, and
   `planup_apply_actions`.

Use the visible app context first. When the user asks for a supported change,
return a typed action for the app to preview and apply after user confirmation.
Do not answer only in prose for a supported mutation.

When you are operating through MCP rather than inside the app drawer, call
`planup_get_project_context` before writing so you can target stable project,
sprint, collection, member, and task IDs. Then call `planup_apply_actions` with
the same action objects described below.

## Output contract

### In-app AI Chat

Return only the JSON object required by the system prompt:

```json
{
  "reply": "short helpful text",
  "actions": []
}
```

Use plain markdown in `reply` when explaining, summarizing, or making a table.
Use actions only for app mutations.

### Codex/MCP

Use MCP tools instead of returning an app drawer JSON proposal:

- `planup_list_projects` lists known projects from the started gateway.
- `planup_get_project_context` returns a project bundle with sprints,
  collections, members, tasks, events, and chat history.
- `planup_apply_actions` applies typed actions to the server-primary snapshot.

For write requests in MCP mode:

1. Resolve the target project and context.
2. Prefer stable IDs (`projectId`, `sprintId`, `collectionId`) from context.
3. Pass `dryRun: true` first when the user did not explicitly ask you to apply
   immediately.
4. Pass the final `actions` array to `planup_apply_actions`.

## Action-first rule

If the user asks to create, edit, move, rename, delete, assign, schedule, or
mark something and that request maps to a supported action below, you **must**
return at least one typed action in `actions` when the target and required fields
are clear enough.

The app, not the model, asks the user to apply the change. A non-empty `actions`
array renders the Proposed changes card and Apply button. Do not say "I can do
that", "please use the UI", or "confirm and I will do it" instead of returning
the action. For supported destructive actions, return the delete action when the
user explicitly asked to delete/remove; the app preview is the confirmation
step.

Ask a short clarifying question and return `actions: []` only when required
information is missing or ambiguous, for example an unnamed task/collection, an
unknown member, or a target that matches multiple visible entities. For
unsupported requests, explain the limit and return `actions: []`.

## Supported app actions

| Intent | Action |
| --- | --- |
| Add a sprint task | `create_task` |
| Change an existing sprint task | `update_task` |
| Remove an existing visible task | `delete_task` |
| Move a visible task to the next sprint | `move_task_to_next_sprint` |
| Move a visible collection item to a named sprint | `move_task_to_sprint` |
| Move a visible task/item to a named collection | `move_task_to_collection` |
| Add a zero-effort milestone | `create_milestone` |
| Change an existing milestone | `update_milestone` |
| Remove an existing milestone | `delete_milestone` |
| Create the next sprint | `create_sprint` |
| Change the selected sprint | `update_sprint` |
| Add or replace the selected sprint note | `add_sprint_note` |
| Remove the selected sprint | `delete_sprint` |
| Add a collection | `create_collection` |
| Rename a collection | `update_collection` |
| Remove a collection | `delete_collection` |
| Add a project member | `create_member` |
| Change a project member | `update_member` |
| Remove a project member | `delete_member` |
| Add or update a member day off | `set_member_day_off` |
| Remove a member day off | `remove_member_day_off` |

### `create_task`

Use for normal work items in the selected sprint.

Fields:
- `title` is required.
- `assigneeName` must match a visible project member name; omit it when unsure.
- `status`: `todo`, `in_progress`, or `done`.
- `priority`: `urgent`, `high`, `normal`, `low`, or `none`.
- `estimate`: effort in days, number or `null`.
- `startDate` and `dueDate`: ISO `YYYY-MM-DD`.

### `update_task`

Use for editing visible sprint tasks or visible collection items. Prefer
`taskSeq` because plan-up displays task numbers as `#N` in the visible task
list.

Allowed changes:
- `title`
- `assigneeName` or `null` to unassign
- `status`
- `priority`
- `estimate`
- `startDate`
- `dueDate`

If the user names a task ambiguously, ask a short clarifying question instead of
guessing.

### `delete_task`

Use only when the user explicitly asks to delete/remove a specific visible task.
Prefer `taskSeq`; use `taskTitle` only when the title is clear. The app will show
a preview before applying.

### `move_task_to_next_sprint`

Use when the user asks to move a specific visible task to the next sprint. Prefer
`taskSeq`; use `taskTitle` only when the title is clear. The app chooses the next
non-archived sprint after the task's source sprint, or after the selected sprint
when the visible task is in a collection.

### `move_task_to_sprint`

Use when the user asks to add/move a specific visible collection item into a
named sprint. Prefer `taskSeq`; use `taskTitle` only when the title is clear.
Set `sprintId` when the target sprint appears in the app context; otherwise set
`sprintName` to the visible sprint name.

### `move_task_to_collection`

Use when the user asks to move a specific visible task or collection item into a
named collection/list. Prefer `taskSeq`; use `taskTitle` only when the title is
clear. Set `collectionId` when the target collection appears in the app context;
otherwise set `collectionName` to the visible collection name. Use
`move_task_to_collection` with `collectionName: "Backlog"` for explicit Backlog
requests only when a normal collection named Backlog exists.

### `create_milestone`, `update_milestone`, `delete_milestone`

Milestones are zero-effort sprint tasks. Use milestone actions when the user
uses language like milestone, release, deadline, approval, launch, or marker.

- `create_milestone` requires `title`; optional fields are `date`,
  `assigneeName`, and `priority`.
- `update_milestone` and `delete_milestone` identify the milestone with
  `taskSeq` or `taskTitle`. Prefer `taskSeq`.
- `update_milestone.date` changes the single milestone date.
- Do not use milestone actions for normal effort-bearing tasks.

### `create_sprint`

Use when the user asks to create a sprint.

- Sprint names are automatic (`Sprint N`); never set a name.
- `startDate` is optional. Include it only when the user gives a valid Monday in
  ISO `YYYY-MM-DD`.
- `note` is optional and should hold the sprint goal/focus.
- If the user gives a non-Monday start, explain that plan-up sprints start on
  Mondays and omit the invalid `startDate`.

### `update_sprint`

Use for changing the selected sprint's start date or goal note.

- The selected sprint is the target; do not invent a sprint ID.
- `startDate` must be a Monday in ISO `YYYY-MM-DD`.
- `note` sets the sprint goal; `null` clears it.
- Sprint names are locked and cannot be changed.

### `add_sprint_note`

Use as the simplest action when the user asks to add a sprint note/goal/focus to
the currently selected sprint. It requires `note` and targets the selected
sprint.

### `delete_sprint`

Use only when the user explicitly asks to delete the selected sprint. Deleting a
sprint also deletes its tasks/history after the app preview is applied. If the
user asks to hide or clean up old sprints, say archive is a UI action instead of
returning `delete_sprint`.

### `create_collection`, `update_collection`, `delete_collection`

Use when the user asks to add, rename, or delete a project collection/list.

- `create_collection` requires `name`.
- `update_collection` sets `name` and targets `collectionId`,
  `collectionName`, or the currently selected collection when the user says
  "this/current collection".
- `delete_collection` targets `collectionId`, `collectionName`, or the currently
  selected collection when the request is explicit.
- Deleting a collection also deletes its collection items after the app preview
  is applied.

### `create_member`, `update_member`, `delete_member`

Use when the user asks to add a person/member label to the current project.

- `create_member` requires `name`; `title` is optional.
- `update_member` requires `memberName` and can set a new `name` and/or `title`.
- `delete_member` requires `memberName`.
- Member names must match visible project members. If ambiguous, ask a short
  clarifying question.
- Deleting a member does not delete their tasks; the app will unassign them.

### `set_member_day_off`, `remove_member_day_off`

Use when the user asks to mark a member unavailable, on leave, vacation, holiday,
or remove an existing day off.

- `set_member_day_off` requires `memberName` and `date` in ISO `YYYY-MM-DD`.
- Optional `halfDay` is `all`, `am`, or `pm`. Use `all` or omit it for a full
  day off.
- `remove_member_day_off` requires `memberName` and `date`.
- Member names must match visible project members. If ambiguous, ask a short
  clarifying question.
- If the user gives a relative date, convert it using the current date from
  context before returning an action. If uncertain, ask a short question.

## Planning behavior

- For read-only requests, answer from the app context and return no actions.
- For write requests, propose the smallest set of actions that satisfies the
  user request.
- Never omit `actions` for a supported write request just because the app will
  need user confirmation. The app handles confirmation after the proposal.
- Keep replies short because the app renders action previews separately.
- Do not invent tasks or members that are not requested.
- Do not use unsupported actions such as archive sprint, import/export,
  dependency edits, or collection item edits outside supported task fields. Ask
  the user to use the app UI for unsupported changes.
- Collection item actions support `update_task` for normal task fields,
  `delete_task`, moving visible items to the next sprint, a named active sprint,
  or a named collection. Do not emit a dedicated Backlog action; Backlog is just
  a collection name when present.

## Examples

User: "Thêm task viết test cho An, effort 1 ngày"

```json
{
  "reply": "Mình sẽ thêm task test cho An.",
  "actions": [
    { "type": "create_task", "title": "Viết test", "assigneeName": "An", "estimate": 1 }
  ]
}
```

User: "Mark task #4 done"

```json
{
  "reply": "Mình sẽ chuyển task #4 sang Done.",
  "actions": [
    { "type": "update_task", "taskSeq": 4, "status": "done" }
  ]
}
```

User: "Tạo sprint mới cho stabilization tuần sau"

```json
{
  "reply": "Mình sẽ tạo sprint mới với goal stabilization.",
  "actions": [
    { "type": "create_sprint", "note": "Stabilization" }
  ]
}
```

User: "Đổi role của An thành QA lead"

```json
{
  "reply": "Mình sẽ cập nhật role của An.",
  "actions": [
    { "type": "update_member", "memberName": "An", "title": "QA lead" }
  ]
}
```

User: "Add sprint note: focus on bug bash"

```json
{
  "reply": "Mình sẽ cập nhật sprint note.",
  "actions": [
    { "type": "add_sprint_note", "note": "Focus on bug bash" }
  ]
}
```

User: "Tạo collection Roadmap"

```json
{
  "reply": "Mình sẽ tạo collection Roadmap.",
  "actions": [
    { "type": "create_collection", "name": "Roadmap" }
  ]
}
```

User: "Xoá collection Roadmap"

```json
{
  "reply": "Mình sẽ xoá collection Roadmap.",
  "actions": [
    { "type": "delete_collection", "collectionName": "Roadmap" }
  ]
}
```

User: "Chuyển task #4 vào collection Roadmap"

```json
{
  "reply": "Mình sẽ chuyển task #4 vào collection Roadmap.",
  "actions": [
    { "type": "move_task_to_collection", "taskSeq": 4, "collectionName": "Roadmap" }
  ]
}
```

## Tool boundaries

Use only plan-up's own MCP tools for server-side project control. Do not call or
describe old external project-management MCP servers. In in-app AI Chat mode,
the mutation path is still the JSON action array above; in Codex/MCP mode, the
mutation path is `planup_apply_actions` with that same action array.
