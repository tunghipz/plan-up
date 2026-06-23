# AI Chat

**Status:** Implemented (MVP)
**Last updated:** 2026-06-23
**Code:** `app/src/AiChatDrawer.tsx`, `app/src/ai/*`, `app/src/App.tsx`, `app/public/skills/project-management/SKILL.md`

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
- Panel width is compact (`clamp(320px, 28vw, 400px)`) and the composer footer is
  a one-line compact control so the lower part of the panel stays light.
- The drawer has a short chat transcript, provider settings, a composer, and a
  "Proposed changes" card when the assistant returns actions.
- Chat bubbles render safe markdown for readable assistant output: paragraphs,
  bullet/numbered lists, inline code, fenced code blocks, links, emphasis, and
  pipe tables. Markdown is rendered as React nodes, not raw HTML.
- Chat history is persisted per project. The drawer shows a compact recent-chat
  list, a "New chat" action, and lets the user switch back to older project
  conversations.
- Supported MVP actions:
  - create task in the current sprint
  - update task by sequence or title
  - create milestone in the current sprint
  - create member in the current project
- Destructive actions are intentionally not supported in the MVP.
- If DeepSeek has no API key, the drawer falls back to a small local planner
  that can handle basic "add task/member/milestone" commands. OpenAI login mode
  requires an authenticated gateway session before sending chat.
- If the OpenAI gateway is missing or returns non-JSON for the session check,
  the drawer reports "Gateway unavailable" and does not navigate the user to a
  dead sign-in URL.
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

OpenAI login requires a backend or local helper gateway. A static browser app
cannot safely perform ChatGPT/OpenAI account login and then call OpenAI models
directly, because browser code cannot hold provider credentials or OAuth client
secrets. The gateway owns the OpenAI session/credential and returns either the
typed AI proposal payload or an OpenAI-compatible chat-completions response.
This is not direct `chatgpt.com` web login; ChatGPT browser cookies/sessions are
not reused by the app.

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
- current sprint or collection
- project members
- visible task summaries only
- available action schema

It does not send the full IndexedDB database by default.

## Action safety

- Model output must be JSON with `{ "reply": string, "actions": [...] }`.
- `reply` may contain markdown, including pipe tables, but HTML is treated as
  plain text.
- Unknown action types are ignored.
- Every action is normalized and validated client-side before preview.
- Applying actions uses existing DB write functions (`addSprintTask`,
  `updateTask`, `addMember`) so activity logging and scheduler behavior stay
  consistent.
- The user must click Apply before writes happen.

## Skill loader

The `project-management` skill is bundled at
`app/public/skills/project-management/SKILL.md` and loaded with `fetch()` whenever
a new chat starts. The loaded markdown is injected into the system prompt as
skill guidance for the model, but it is still treated as data: it cannot bypass
the typed action validator/executor.

The drawer shows whether the skill loaded. If loading fails, chat still works
with the normal action schema and local fallback parser.

## Rules & edge cases

- AI Chat is disabled for writes when no current project exists.
- Each project owns its own chat threads. Switching projects switches the chat
  list and opens that project's latest thread, or creates one if none exists.
- Sprint actions require a selected sprint. Collection item actions are future
  work.
- Member matching is name-based, case-insensitive.
- Task matching prefers `taskSeq`, then exact title, then partial title.
- Date strings must be ISO `YYYY-MM-DD`; invalid provider output is ignored by
  validation.
- The panel closes on `Esc`, after search/activity/settings priority.

## Future / open questions

- Add collection item actions.
- Add bulk planning actions with stronger preview.
- Add skill enable/disable UI if more than one skill is bundled/imported.
- Implement the actual OpenAI login gateway service for the chosen deployment
  target.
