---
name: plan-up-mcp
description: Use when the user asks Codex to inspect, chat about, or control the local plan-up project through the codex-handoff MCP gateway, including listing projects, reading project context, and applying typed plan-up actions.
---

# plan-up MCP

Use this skill when working with the local **plan-up** app through the
`codex-handoff` gateway. The gateway must already be running:

```bash
cd /Users/lap15967/Documents/vng/plan-up/app
npm run dev
```

The MCP server is:

```bash
/Users/lap15967/Documents/vng/plan-up/app/server/planup-mcp.mjs
```

Default gateway URL:

```text
http://127.0.0.1:5173
```

## Preferred Workflow

1. Use `planup_list_projects` to find the target project.
2. Use `planup_get_project_context` with the stable `projectId`.
3. For writes, build plan-up typed actions and call `planup_apply_actions`.
4. Use `dryRun: true` first unless the user explicitly asked to apply now.
5. After a successful non-dry-run write, tell the user what changed. The open
   browser app polls the server snapshot and should update within a few seconds.

## Tools

### `planup_list_projects`

No arguments. Returns project IDs, names, and counts.

### `planup_get_project_context`

Arguments:

```json
{ "projectId": "..." }
```

Returns a project bundle with project, members, sprints, collections, tasks,
events, and AI chat history. Prefer stable IDs from this payload over names.

### `planup_apply_actions`

Arguments:

```json
{
  "projectId": "...",
  "sprintId": "...",
  "collectionId": "...",
  "dryRun": true,
  "actions": [
    { "type": "create_task", "title": "Write tests", "assigneeName": "An", "estimate": 1 }
  ]
}
```

`sprintId` is needed for sprint-scoped task creation and task lookup. Use
`collectionId` when operating on visible collection items.

## Supported Actions

- `create_task`
- `update_task`
- `delete_task`
- `move_task_to_next_sprint`
- `move_task_to_sprint`
- `move_task_to_collection`
- `create_milestone`
- `update_milestone`
- `delete_milestone`
- `create_sprint`
- `update_sprint`
- `add_sprint_note`
- `delete_sprint`
- `create_collection`
- `update_collection`
- `delete_collection`
- `create_member`
- `update_member`
- `delete_member`
- `set_member_day_off`
- `remove_member_day_off`

## Safety Rules

- Never edit `app/.plan-up/server-db.json` directly.
- Never use arbitrary JSON/file edits for project mutations.
- Use `dryRun: true` before destructive actions unless the user explicitly says
  to apply immediately.
- For ambiguous task/member/sprint/collection names, fetch context and ask a
  short clarification instead of guessing.
- Prefer `taskSeq` only within a known sprint/collection scope. Prefer IDs for
  projects, sprints, and collections.
- Do not use old external project-management MCP contracts such as Quipu,
  Microsoft Project XML, `read_project`, or `assign_task`.

## Fallback Diagnostics

If the MCP tools are not exposed in Codex Desktop, check the gateway directly:

```bash
curl -sS http://127.0.0.1:5173/api/projects
```

Then test the stdio MCP server:

```bash
cd /Users/lap15967/Documents/vng/plan-up/app
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"planup_list_projects","arguments":{}}}' \
| PLAN_UP_GATEWAY_URL=http://127.0.0.1:5173 node server/planup-mcp.mjs
```
