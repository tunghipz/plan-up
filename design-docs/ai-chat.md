# AI Chat

**Status:** Implemented (MVP)
**Last updated:** 2026-06-30 (project-management skill documents plan-up MCP mode)
**Code:** `app/src/AiChatDrawer.tsx`, `app/src/ai/*`, `app/src/App.tsx`, `app/public/skills/project-management/SKILL.md`, `app/server/planup-mcp.mjs`

## Purpose

AI Chat is a right-side command copilot for plan-up. It helps the user ask
questions about the current planning context and prepare concrete app actions
such as adding/editing tasks, creating members, or adding milestones.

It is not a second source of truth and it never writes to IndexedDB directly.
The model may only propose typed actions. The app validates those actions,
renders a human-readable preview, and applies them only after the user confirms.

## User-facing behavior

- A floating circular AI button sits at the bottom-right corner of the app,
  using a `Sparkles` glyph so it reads as an AI affordance without adding a
  second brand color. When the panel is open, the button docks to the panel's
  left edge and remains a toggle.
- The chat opens as a docked, non-modal right-side panel. It is a real flex
  column in the app shell, so the planning surface shrinks instead of being
  covered. There is no full-screen scrim, no backdrop blur, and the planning
  surface remains visible for reference.
- Panel width is compact (`clamp(320px, 28vw, 400px)`) and the composer footer
  keeps a four-line text input visible so multi-line prompts can be reviewed
  before sending.
- The drawer header title is the entry point for chat controls. Clicking the
  title opens a compact header menu with project chat history, New chat, skill
  state, and provider configuration. These controls do not live inside the chat
  transcript, so the conversation starts near the top of the scroll area.
- The drawer has a short chat transcript, a composer, and a "Proposed changes"
  card when the assistant returns actions.
- Right-clicking a visible sprint row, sprint member group header, or sprint task
  row inserts a plain-text reference tag into the chat composer and opens the AI
  drawer if needed. Tags include both a human label and stable/user-facing ID,
  e.g. `@task[#8: Fix login | id=...]`, so the model can target the element
  without the user retyping names.
- Chat bubbles render safe markdown for readable assistant output: paragraphs,
  bullet/numbered lists, inline code, fenced code blocks, links, emphasis, and
  pipe tables. Markdown is rendered as React nodes, not raw HTML.
- The composer supports attaching readable text files. The browser reads the
  file locally and appends its content to the user message as fenced markdown so
  the assistant can inspect it. Supported MVP inputs are text-like files such as
  `.txt`, `.md`, `.csv`, `.json`, `.yaml`, source code, and logs. The chat
  transcript shows attached file names only; it must not render the full file
  content back into the conversation bubble.
- Assistant replies can return downloadable text files by using a fenced code
  block with a file marker, for example ```` ```file:tasks.csv ````. The bubble
  renders the file name and a Download button while still showing the generated
  text content for inspection. HTML remains plain text and is never executed.
- Chat history is persisted per project. The header menu shows a compact
  recent-chat list, a "New chat" action, and lets the user switch back to older
  project conversations.
- Supported MVP actions:
  - create task in the current sprint
  - update task by sequence or title
  - delete task by sequence or title
  - move task by sequence or title to the next non-archived sprint
  - move task by sequence or title to a named collection
  - move a visible collection task by sequence or title to a named sprint
  - assign or delete visible collection tasks
  - create, update, or delete milestone in the current sprint
  - create, update, or delete sprint, with automatic `Sprint N` naming and
    Monday-locked dates
  - add sprint note as an explicit alias for updating the selected sprint note
  - create, rename, or delete user-created collections
  - create, update, or delete member in the current project
  - add/update or remove member day off by member name and ISO date
- Destructive task deletion is supported only as a typed proposed action. It is
  never applied until the user reviews the preview and clicks Apply.
- If DeepSeek has no API key, the drawer falls back to a small local planner
  that can handle basic "add task/member/milestone" commands. OpenAI login mode
  requires an authenticated gateway session before sending chat.
- If the OpenAI gateway is missing or returns non-JSON for the session check,
  the drawer reports "Gateway unavailable" and does not navigate the user to a
  dead sign-in URL.
- If the gateway is reachable but `OPENAI_API_KEY` is not configured, the session
  check reports the missing server key before the user is sent to the sign-in
  route.
- Sign-out is only enabled for a confirmed signed-in gateway session. If the
  gateway is unavailable or the user is already signed out, the drawer should not
  call the logout endpoint or show a logout 404 as an error.
- OpenAI login settings keep the everyday path simple: show session state and a
  single primary action (`Connect OpenAI` or `Check gateway`) first. Technical
  endpoint fields live behind an `Advanced` disclosure.
- Provider settings are stored in `localStorage` only. Chat threads/messages live
  in IndexedDB (`aiThreads`, `aiMessages`) scoped by `projectId`.

## Provider model

MVP provider modes:

- `openai_login` — default mode. The browser opens an OpenAI login gateway
  (`/api/auth/openai/start` by default), checks session state through
  `/api/auth/session`, and sends chat requests to `/api/ai/chat` with
  `credentials: include`. The browser never asks for or stores an OpenAI API key.
- `deepseek` — direct OpenAI-compatible chat request to DeepSeek with a user
  supplied DeepSeek API key.
- `proxy` — sends the same payload to a user-controlled gateway endpoint.

OpenAI login requires the bundled backend gateway. A static browser app cannot
safely perform ChatGPT/OpenAI account login and then call OpenAI models directly,
because browser code cannot hold provider credentials or OAuth client secrets.
The gateway owns the OpenAI credential and exposes a same-origin app session.
This is not direct `chatgpt.com` web login; ChatGPT browser cookies/sessions are
not reused by the app.

The implemented gateway is a practical server-side-key session:

- `OPENAI_API_KEY` is configured only on the Node server (`app/.env.local` locally
  or an environment variable in deployment).
- `GET /api/auth/openai/start` checks that the key exists, creates a short-lived
  same-origin HTTP-only session cookie, and redirects back to the app.
- `POST /api/ai/chat` requires that session cookie, forwards chat messages to
  OpenAI's Responses API from the server, and returns `{ reply, actions }`.
- The frontend never sees or stores `OPENAI_API_KEY`.

Gateway contract:

- `GET /api/auth/openai/start?returnTo=<url>` — starts the OpenAI login flow.
- `GET /api/auth/session` — returns `{ authenticated: boolean, user?: { email?: string, name?: string } }`.
- `POST /api/auth/logout` — clears the gateway session.
- `POST /api/ai/chat` — accepts `{ provider, model, messages, temperature }`
  and responds with `{ reply, actions }` or an OpenAI-compatible
  `choices[0].message.content` JSON payload.

## Context sent to AI

The app sends a compact text context:

- current date
- selected screen/container/view
- current project
- current sprint or collection; selected sprint context includes the sprint name,
  stable ID, date range, and note when present
- active project sprint list with stable IDs and date ranges
- project collection list with stable IDs and item counts
- project members
- visible task summaries only
- available action schema
- attached text-file excerpts on the current user message

It does not send the full IndexedDB database by default.

## Action safety

- Preferred model output is JSON with `{ "reply": string, "actions": [...] }`,
  but plain text/markdown provider output is accepted as a normal assistant
  reply with no actions. This keeps read-only chat and file summaries from
  failing when the provider does not wrap the answer in JSON.
- `reply` may contain markdown, including pipe tables, but HTML is treated as
  plain text.
- If `reply` includes a fenced code block with `file:<name>`,
  `download:<name>`, or `filename=<name>` as the fence info string, the UI
  treats that block as a downloadable text file and creates the download from
  the block content in the browser.
- Unknown action types are ignored.
- Every action is normalized and validated client-side before preview. The app
  accepts up to 100 proposed actions per assistant response; anything beyond
  that is ignored so the user still reviews a bounded change set before Apply.
- Applying actions uses existing DB write functions (`addSprintTask`,
  `updateTask`, `deleteTask`, `moveTaskToNextSprint`, `moveTaskToCollection`,
  `moveTaskToSprint`, `createSprint`, `updateSprint`, `deleteSprint`,
  `createCollection`, `renameCollection`, `deleteCollection`, `addMember`,
  `deleteMember`) so activity logging, dependency cleanup, member orphaning,
  and sprint cadence behavior stay consistent.
- The user must click Apply before writes happen.

## Skill loader

The `project-management` skill is bundled at
`app/public/skills/project-management/SKILL.md` and loaded with `fetch()` whenever
a new chat starts. The loaded markdown is injected into the system prompt as
skill guidance for the model, but it is still treated as data: it cannot bypass
the typed action validator/executor.

The bundled skill must describe **plan-up's action contract**. In the drawer it
guides the model to answer from the visible app context and propose only the
supported JSON action types (`create_task`,
`update_task`, `delete_task`, `create_milestone`, `update_milestone`,
`delete_milestone`, `move_task_to_next_sprint`, `move_task_to_sprint`,
`move_task_to_collection`, `create_sprint`,
`update_sprint`, `add_sprint_note`, `delete_sprint`, `create_collection`,
`update_collection`,
`delete_collection`, `create_member`, `update_member`, `delete_member`,
`set_member_day_off`, `remove_member_day_off`). References to external
project-management MCP tools such as Quipu, Microsoft Project XML,
`read_project`, `list_tasks`, or `assign_task` belong outside this app skill and
should fail regression tests.

The same skill also documents the new plan-up MCP mode for Codex/Codex CLI:
`planup_list_projects`, `planup_get_project_context`, and
`planup_apply_actions`. These tools target the plan-up gateway's server-primary
snapshot and use the same typed action objects as the drawer.

For supported write requests, the skill must be action-first: return at least
one typed action whenever the target and required fields are clear enough. The
assistant should not answer only with prose such as "I can do that" or "please
use the UI" for supported mutations. The app's Proposed changes card and Apply
button are the confirmation mechanism; the model should ask a clarification
question only when the target or required data is genuinely ambiguous.

The drawer shows whether the skill loaded. If loading fails, chat still works
with the normal action schema and local fallback parser.

Skill loading is runtime state, not persisted message content. Opening an
existing chat thread after reload must fetch `project-management/SKILL.md` again
before the next model request, otherwise the restored thread would show a skill
history marker but send only the base action schema.

## Rules & edge cases

- AI Chat is disabled for writes when no current project exists.
- Each project owns its own chat threads. Switching projects switches the chat
  list and opens that project's latest thread, or creates one if none exists.
- Task and milestone create actions require a selected sprint.
  `update_sprint` and `add_sprint_note` / `delete_sprint` target the selected
  sprint. `update_task` and `delete_task` can target visible sprint tasks or
  visible collection tasks; this enables assigning and removing collection
  items directly from AI Chat.
- Collection actions target the current project. `create_collection` creates a
  normal user collection. `update_collection` and `delete_collection` target
  either `collectionId`, visible collection name, or the currently selected
  collection. A collection named `Backlog` is not special.
- `move_task_to_next_sprint` targets a visible task and uses the next active
  sprint after the task's source sprint, or after the selected sprint when the
  task is in a collection.
- `move_task_to_sprint` targets a visible task and moves it into a specific
  active sprint by `sprintId` or visible sprint name.
- `move_task_to_collection` targets a visible task and moves it into a specific
  project collection by `collectionId` or visible collection name. Use this for
  a user-created collection named `Backlog`; there is no dedicated Backlog
  action.
- Member matching is name-based, case-insensitive.
- Member day-off actions use `setMemberDaysOff`, so assigned tasks are
  recomputed immediately after Apply.
- Task matching prefers `taskSeq`, then exact title, then partial title.
- Milestone matching follows task matching but only applies to tasks with
  `estimate = 0`.
- Date strings must be ISO `YYYY-MM-DD`; invalid provider output is ignored by
  validation.
- AI-created sprints use the same cadence rules as the New Sprint dialog:
  automatic `Sprint N` naming, Monday start, `start + 13` end date, and
  `sprint_started` activity event. If the model supplies a non-Monday start
  date, applying the action fails instead of silently creating an invalid
  sprint.
- File attachments are read client-side only. Binary files such as PDF/images
  are rejected in the MVP. Up to 4 files can be attached at once; each file is
  truncated before being included in the model prompt. Persisted user messages
  keep the prompt payload for replay/history, but the UI hides attachment
  contents and displays only filename chips.
- The panel closes on `Esc`, after search/activity/settings priority.

## Future / open questions

- Add collection item actions.
- Add bulk planning actions with stronger preview.
- Add skill enable/disable UI if more than one skill is bundled/imported.
- Replace the local server-key gateway with true OAuth if a product deployment
  later requires per-user OpenAI accounts.
