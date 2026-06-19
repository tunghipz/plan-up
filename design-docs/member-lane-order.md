# Member lane order

**Status:** Implemented
**Last updated:** 2026-06-19
**Code:** `app/src/db.ts` (`Member.order`, `setMemberOrder`, `renormalizeMemberOrder`,
`orderBetween`, `addMember`, Dexie v12 upgrade), `app/src/SprintView.tsx`
(`MemberCard` grip + lane drag), `app/src/BoardView.tsx` (member sort)

## Purpose
Let the user manually arrange the order of **member lanes** (the per-member cards in
a sprint's List view) by drag-and-drop, instead of the implicit insertion order.
The chosen order is the user's mental model of their team and should be stable and
shared across the whole project.

## User-facing behavior
- Each member card header has a **drag grip** (left of the avatar). Press the grip and
  drag a card up/down to reorder lanes; a drop-indicator line shows where it will land.
- The order is **per project**: reordering lanes in one sprint applies to **every**
  sprint of that project (members are project-level entities).
- The order also drives **Board view**: when a column's sort mode is `member`, cards are
  grouped by this custom member order (not alphabetical name).
- Out of scope (v1): the **Unassigned** card (no member) and the collapsed
  **"members with no tasks"** section are **not** draggable. Empty members still *follow*
  the custom order in their section (sorted by `order`), they just can't be dragged.

## Data
- New field on `Member`: `order: number` — non-indexed (same pattern as `Collection.order`
  and `Task.listOrder`), so no index change. See [data-model.md](./data-model.md).
- **Dexie v12** upgrade backfills `order` for existing members: per project, assign
  `0..N-1` in the current `toArray()` order so the first render is identical to today's.
- `addMember` assigns `order = (max order in project) + 1` so new members land last.

## Implementation
- **Order math** reuses `orderBetween(before, after)` (fractional midpoint) exactly like
  `Task.listOrder` drag. `setMemberOrder(memberId, order)` persists one card's order;
  `renormalizeMemberOrder(orderedIds)` rewrites a clean `0..N-1` integer spacing in one
  transaction as the precision-exhaustion fallback.
- **Read path:**
  - `SprintView` (`useMemo` building `groups`/`emptyMembers`): sort the member list by
    `order` ascending, tiebreak `name` then `id`, before splitting into filled/empty. Both
    filled lanes and the empty-members section then honour the order.
  - `BoardView` `cmp` for `mode === 'member'`: compare by `membersById.get(id)?.order`
    instead of `name.toLowerCase()` (unassigned still sinks last).
- **Drag UI (List only):** a grip on the `MemberCard` header, pointer-armed (only the grip
  starts a drag — clicking the header still toggles collapse), mirroring `TaskRow`'s grip.
  Drag state lives in the `SprintView` lane container; on drop, compute the new `order` from
  the neighbouring lanes' orders via `orderBetween` and call `setMemberOrder`; renormalize on
  precision exhaustion.

## Rules & edge cases
- **Single lane** → drag is a no-op.
- **Collapsed lane** is still draggable via its grip.
- **Task sort is independent**: changing the column sort never changes lane order.
- Order is **shared across all sprints** of the project; there is no per-sprint override.
- New members always append last; deleting a member leaves gaps in `order` (harmless —
  sort only cares about relative value; renormalize tidies when needed).
