# Task groups (parent task with nested children)

**Status:** Implemented
**Last updated:** 2026-11-09 (**card "Group nhiều người"** ở By member: group không có người giữ mà có task con đã giao thì không còn nằm trong card Unassigned — xem *Group nhiều người*; trước đó cùng ngày: **group không có người giữ** không pha xám nữa: thẻ trắng viền
mảnh, head hiện avatar chồng của những người trong group — xem *Nền group*; trước đó cùng ngày:
**group một người đi cùng nhau**: giao hết task con cho một người
thì group head theo sang người đó, đổi người cho head của group một người thì task con theo — xem
*Group nhiều người*; trước đó cùng ngày: **nền group** thẻ bo nhuộm màu người giữ group, group
được chứa task của nhiều người, và **Add to group** chọn group trong popover của selection bar)
**Previously:** 2026-09-11 (bulk Assign obeys the no-cross-member rule; see tasks.md)
**Code:** `app/src/db.ts` (`Task.parentId`, `createGroupFromSelection`, `addTasksToGroup`,
`setTaskParent`),
`app/src/SprintView.tsx` (`MemberCard` task tree render, `TaskGroupRow` parent roll-up,
`SelectionBar` group/ungroup/delete, `GroupPickPopover` add-to-group), collapse persisted in `localStorage`

## Purpose
Inside a member's task list, let related tasks be **gathered under a parent task**
that acts as a group heading — e.g. `32) build 3` with `33/34/35` nested beneath it
(see the user's reference image). The parent is a real task (has a sequence number)
that doubles as the group title. Gives structure to a long member list without a
separate epic/tag system. Approach **B** chosen 2026-06-04 (see
`demo/task-group-options.html`): nested render **plus** parent roll-up + collapse.

## Nền group (2026-11-09)

Trước đây mọi dòng trong List cùng nền trắng, group head chỉ in đậm (và một vệt accent 2.5% gần
như không thấy), nên lướt bảng khó biết group bắt đầu và kết thúc ở đâu. User: *"cho group có màu
nền khác nhẹ nhẹ để dễ nhìn hơn"*.

Ba hướng trong `demo/group-background.html`: **A** dải nền xám liền, **B** thẻ lồng, **C** dải nền
nhuộm theo màu người giữ group. User chọn: *"B nhưng màu theo C"*.

- **Hình (B):** cả group (head + các task con đang hiện) nằm trong **một thẻ bo 12px lồng trong
  bảng**, cách mép card 8px và cách dòng trên/dưới 6px, viền 0.5px. Đây là "inset grouped" của
  card member (design-system §4.1) lặp lại ở cấp con. Dòng ngay trên thẻ không có hairline: khoảng
  trống tách thẻ, không phải đường kẻ (§8.2). Bên trong thẻ các dòng vẫn cách nhau bằng hairline.
  Dòng trong thẻ dùng padding ngang 8px thay 16px, nên mọi cột vẫn thẳng với header.
- **Màu (C):** nền thẻ = màu avatar của **người giữ group** (`assigneeId` của head) pha 5% (dark
  8%), dòng head pha 10% (dark 14%). Màu lấy đúng như avatar (`member.color`, thiếu thì
  `colorForName`). Dòng đang chọn vẫn dùng `accent-soft` đè lên.
- **Group không có người giữ** (head Unassigned, thường là group nhiều người; sửa cùng ngày).
  Bản đầu pha màu chữ (gần đen) 5%/10% nên ra **xám đục**, cạnh pill `To do` xám thì cả khối bẩn.
  User: *"group nhiều người màu xấu quá, có cách nào fix không"*. Ba hướng trong
  `demo/mixed-group-color.html`: **A** xám nhẹ hơn, **B** màu riêng cho mỗi group, **C** thẻ
  trắng + avatar chồng. User chọn: *"C"*.
  - Thẻ **không pha nền**: chỉ viền mảnh đậm hơn một nấc (`border-strong`), dòng head xám rất nhạt
    (màu chữ 4%, dark 7%). Màu không nằm ở nền nữa mà ở avatar.
  - Ô **Assignee của head** hiện **avatar chồng** của những người có task con trong group (theo
    thứ tự xuất hiện, tối đa 3, thêm `+N`), viền trắng tách nhau; ở All (cột rộng) kèm chữ
    `N people`. Rê chuột thấy tên đủ. Group chưa có ai (mọi task con chưa giao) vẫn hiện `—`.
  - Group có người giữ giữ nguyên màu người đó, kể cả khi bên trong có task của người khác.
- Thẻ hiện ở **List** (By member và All). Board, Timeline, PNG, share link không đổi.
- Group thu gọn thì thẻ chỉ còn dòng head.
- **Không `overflow: hidden`** (sửa cùng ngày): bản đầu cắt mọi thứ ở mép thẻ, và vì dòng trong thẻ
  chỉ còn 8px padding trái, nút kéo (grip, nằm sát mép trái dòng) đè lên checkbox. Giờ góc bo nằm
  ở dòng đầu/dòng cuối của thẻ, và grip của dòng trong thẻ dời ra lề thẻ (`left: -8px`), đúng chỗ
  nó đứng ở dòng thường.

## Thêm task ngay trong group (2026-11-09)

User: *"tao muốn add task vào group đang có thì có cách nào làm nhanh không"*; trong 3 cách đề xuất
(dòng thêm trong thẻ group / kéo thả vào thẻ / phím `g` cho Add to group) user chọn: *"làm 1"*.

- Cuối mỗi thẻ group (khi không thu gọn) có dòng **`+ Add task to #N`** (N = số của group head),
  hiện rõ như dòng Add task cuối card. Gõ tên, Enter: task mới nằm **cuối group** (`listOrder` =
  max các con + 1), ô vẫn mở để gõ tiếp. Bấm ra ngoài cũng lưu, như Add task thường.
  - Bản đầu làm dòng này mờ 55% khi không rê chuột; cộng với placeholder vốn nhạt, user không thấy
    (*"không thấy thẻ add task"*). Giờ không làm mờ, và placeholder ghi rõ group đích.
- Task mới: cùng sprint, ngày bắt đầu = đầu sprint, log `created` như mọi task mới, rồi
  `recomputeDates` để task phụ thuộc vào group dời theo span mới.
- **Người làm**: ở By member là người của card đó (card Unassigned → chưa giao); ở All là người
  đang lọc nếu bảng đang lọc theo một member, không thì **người giữ group** (head chưa giao → task
  chưa giao).
- `addSprintTask({ parentId })` chỉ nhận group head còn tồn tại, top-level, cùng sprint; sai thì
  tạo task lẻ như thường thay vì gắn nhầm.

## Group nhiều người (2026-11-09)

Trước ngày này một group chỉ chứa task của **một** người (group là danh sách con trong card của
member đó). Từ khi List có chế độ **All** ([list-view.md](./list-view.md)), nhu cầu gom theo
**tính năng** (ví dụ "Build 1" gồm việc của phongnd, duyl, minhvq) là hợp lý, nên luật đó bỏ.
User hỏi *"task của người khác không push vô group được ah"*, rồi chọn hướng đề xuất: *"làm theo
hướng đó đi"*.

- **Ở All**: group hiện đủ mọi task con, của ai cũng được. Đây là chỗ chính để xem group.
- **Ở By member**: group head nằm trong card của người giữ group (`assigneeId` của head). Task
  con của **người khác** nằm trong card của chính họ như một dòng lẻ, kèm chip **`↳ #N tên
  group`** sau title để biết thuộc group nào. Group head vẫn là dòng group (chevron, roll-up) kể
  cả khi card đó không có task con nào của người giữ group.
- **Card "Group nhiều người"** (2026-11-09). Group head không có người giữ mà **có ít nhất một
  task con đã giao cho member** thì nằm trong card riêng tên **Group nhiều người**, xếp trước
  card Unassigned. Trước đó các head này nằm trong card **Unassigned** và được đếm vào số của
  card, nên sprint đã giao hết vẫn hiện `Unassigned 3`. User hỏi *"sao lại chưa assign, tất cả
  task đều được assign hết rồi"*, rồi chọn hướng **card riêng** trong ba hướng (card riêng · cùng
  card đổi nhãn · chỉ sửa số đếm).
  - Header: icon nhóm người trong vòng tròn nét đứt (như Unassigned), số đếm là **số group**
    (`3 group`), không phải số task.
  - Card **Unassigned** chỉ còn task thật sự chưa giao, kể cả group head không người giữ mà task
    con cũng đều chưa giao (đó là việc chưa giao thật). Không còn gì thì card ẩn.
  - Thứ tự hiển thị (Chain prereqs, chọn nhiều): các card member, rồi Group nhiều người, rồi
    Unassigned.
- **Roll-up của group head** (`done/total`, status suy ra, effort cộng, ngày từ sớm nhất tới muộn
  nhất) tính trên **mọi task con**, kể cả của người khác — giống số Timeline và share link vẫn
  dùng. Ở By member, dưới head chỉ hiện task con của người đó, nên `0/5` có thể đứng trên 2 dòng.
- **Đếm của từng member** (header card, chip ở All, PNG, share viewer) vẫn chỉ đếm **leaf** của
  người đó. Một task là group head khi **bất kỳ** task nào trong sprint trỏ `parentId` vào nó,
  không chỉ task cùng card — nếu không, head có toàn task con của người khác sẽ bị đếm như việc
  của người giữ group.
- **Tạo group** từ task của nhiều người: group head mới **Unassigned**. Cùng một người thì head
  thuộc người đó, như trước.
- **Add to group** liệt kê **mọi** group của sprint, mỗi dòng ghi người giữ group.
- **Đổi người làm** (Assign hàng loạt, ô Assignee từng dòng): task con **ở lại group**. Xem
  [tasks.md](./tasks.md).
- **Group một người đi cùng nhau** (sửa cùng ngày). User tạo group từ 3 task chưa giao (head ra
  Unassigned), rồi giao cả 3 cho một người: head vẫn nằm ở card Unassigned, còn card người đó chỉ
  có 3 dòng lẻ kèm chip `↳ #51`, không thành thẻ group, không có màu (*"tao group khi chưa assign,
  sau khi group xong mới assign thì hiện như này, cũng không có màu theo member"*). Group chỉ
  thật sự "nhiều người" khi task con thuộc nhiều người, nên:
  - **Task con đổi người** mà sau đó **mọi** task con của group cùng một người → group head
    **theo sang** người đó (ghi log `Assignee` như mọi lần đổi). Còn lẫn nhiều người thì head giữ
    nguyên.
  - **Đổi người cho group head** khi mọi task con đang cùng người với head (group một người) →
    task con **theo head**. Group lẫn nhiều người thì **chỉ head** chuyển, task con giữ người của
    mình.
  - Chọn lại đúng người đang giữ (ví dụ chọn 3 task con đang của A rồi Assign A) cũng chạy bước
    khớp head, nên group lệch từ trước sửa được bằng một lần Assign lại, hoặc đổi Assignee của head.
  - Head theo sang người mới thì nằm **cuối card** người đó (như task được Assign), trừ khi đổi
    bằng ô Assignee trên dòng (giữ chỗ). Task con luôn giữ chỗ trong group.
  - Chỉ áp dụng khi **đổi người**. Gỡ task khỏi group hay xoá task con không tự đổi người giữ group.
- **Không đổi**: một cấp; cùng sprint (`setTaskParent`, rollover chuyển cả group); group làm
  prereq được.
- **Export**: PNG và Copy to Telegram vẫn chia theo member. Task con của người khác hiện thành
  dòng lẻ trong phần của người làm nó, nên **không mất, không trùng**. Hạn chế đã biết: ở hai
  chỗ này dòng group head chỉ gom task con cùng người (roll-up tính trong phần đó); head không có
  task con nào cùng người thì hiện như một task thường. Share link đóng băng roll-up từ mọi task
  con nên không bị hạn chế này.

## User-facing behavior
- **Create a group (multi-select):** hover a task row → a **checkbox** appears in the
  left gutter; check several tasks (any people — see *Group nhiều người*). A **floating action bar**
  slides up at the bottom (English labels): *"N selected · [Ungroup] · [Chain prereqs] ·
  [Clear prereqs] · [Group] · [Delete] · [Cancel]"*.
  - **Group** creates a **new parent task** titled `New group` (rename inline) and
    nests the selected tasks under it. Enabled when ≥2 **loose** tasks are selected and none
    is already a group head (one level). The head belongs to the selection's person when they
    all share one, else it is **Unassigned**.
  - **Add to group** (2026-11-09) đưa task lẻ vào một **group đã có**. Chỉ cần tick task lẻ
    (không cần tick gì trong group, group thu gọn cũng được) rồi bấm **Add to group** trên
    selection bar: một popover (cùng kiểu với Assign: ô tìm, ↑/↓, Enter, Esc) liệt kê các
    group của sprint, mỗi dòng `#N tên group` + người giữ group + số task con.
    Chọn một group thì các task lẻ vào **cuối group** (`listOrder` = max của các con + 1, theo
    thứ tự hiển thị), rồi `recomputeDates` để task phụ thuộc vào group dời theo span mới.
    - Liệt kê **mọi group cùng sprint**, của ai cũng được (từ 2026-11-09, xem *Group nhiều
      người*; bản đầu chỉ cho group cùng người làm).
    - Task đã nằm trong group khác hoặc group head trong lựa chọn thì bị bỏ qua (chuyển task
      giữa hai group: Ungroup trước).
    - Nút chỉ hiện khi sprint có ít nhất một group và lựa chọn có ít nhất một task lẻ.
    - Lịch sử: bản đầu (cùng ngày) bắt tick thêm một task con của group để nút Group đổi thành
      "Add to #N". User bác: *"tao muốn add 1 task vào group có sẵn, như hình là add 8 vào 6,
      chứ không phải task trong group rồi add làm gì nữa"* — group thường đang thu gọn, phải mở
      ra tick một task con là thừa. Câu hỏi gốc: *"tao có task này muốn cho vào group đang có thì
      như nào"*. Không dùng kéo thả vì kéo thả chỉ đổi thứ tự trong cùng cấp
      ([list-view.md](./list-view.md)).
  - **Group** chỉ đếm task lẻ: cần ≥2 task lẻ. Trước đây lựa chọn lẫn task con vẫn bật
    Group nhưng bấm không làm gì (task con bị loại trong `createGroupFromSelection`).
  - **Ungroup** ungroups any selected children (clears their `parentId`); shown when the
    selection contains ≥1 grouped task.
  - **Chain prereqs** / **Clear prereqs** set or clear prerequisites across the selection —
    see [dependencies.md](./dependencies.md#bulk-actions-multi-select).
  - **Delete** deletes the selected tasks (confirm first; works on a multi-select).
    Deleting a group head ungroups its children rather than cascade-deleting them; the
    confirm copy says so when the selection contains a group head. Deletes run
    sequentially so a parent's child-promotion can't race a selected child's own delete.
  - **Cancel** clears the selection. Selection also clears on sprint change.
  - Checkboxes are hover-revealed (hidden at rest, kept visible while selected) so the
    resting list stays calm; they share the left gutter with the conflict triangle.
  - **There is no per-row kebab (⋯).** Grouping is select-driven and **delete also lives
    on the selection bar** — the row has no actions column at all.
  - Children render indented beneath the parent (left padding, no connector tick).
- **One level only.** A child cannot itself be a parent, and a task that already has
  children cannot become someone's child. Enforced when setting `parentId`.
- **Roll-up on the parent row (Approach B):** the parent shows
  - a **progress count** `done/total` of its **children** (text only — no progress
    bar; the empty grey track read as noise at 0%, removed 2026-06-04),
  - a **derived status** badge (done if all children done; in-progress if any child
    is in-progress/done but not all done; else to-do) — display-only, computed on
    render, not written to the parent's stored `status`. The badge is the read-only
    `StatusPill`, sized to match a normal row's interactive pill exactly: that pill's
    native `<select>` reserves the widest label's width ("In progress"), so `StatusPill`
    reserves the same via an invisible sizer (no magic px) — group and normal status
    pills line up regardless of the displayed status,
  - a **summed effort** (sum of children `estimate`) in the Effort cell,
  - **dates** = the span of children (earliest child start → latest child end),
    read-only, shown with the **same date+time format and size as a normal row**
    (e.g. `Jun 8, 17:00`).
- **Collapse/expand:** the parent row has a chevron; collapsing hides its children.
  Persisted per parent in `localStorage` (`plan-up:taskgroup-collapsed:{parentId}`),
  mirroring the member-group collapse pattern (design-system §5.9 / §6.2).
- **Ordering with sort:** top-level tasks render in the current column sort order;
  each parent is immediately followed by its own children (children sorted within the
  group). Nesting is preserved regardless of sort.

## Data
- `Task` gains one **optional, non-indexed** field: `parentId?: string | null`
  (id of the parent task; absent/null = top-level). See [data-model.md](./data-model.md).

### No Dexie version bump
`parentId` is **not indexed**; children are grouped in memory from the already-loaded
sprint tasks. New optional property → no migration (same precedent as `member.title`,
`project.description`). Export/import serialise whole `Task` objects, so `parentId`
rides along; **`ExportPayload.version` unchanged**; older exports import fine (every
task simply top-level).

## Counting & capacity (the Approach-B decision)
A parent (a task **with** children) is treated as a **container**, not a leaf:
- It is **excluded** from the member header `done/total` and from capacity effort sums.
  Only **leaf** tasks (no children) count. This avoids double-counting the work that
  actually lives in the children, and makes the parent's roll-up the single source of
  truth.
- The parent's own stored `status`/`estimate`/dates are **ignored for counting** while
  it has children (its displayed status/effort/dates are derived from children).
- A task with **no** children counts normally (today's behavior unchanged).

This is the one place Approach B touches existing logic: wherever the member group
computes `total`, `done`, overdue, and capacity, it must skip tasks that have children.

## Scheduling
- **Children schedule independently** — each keeps its own `estimate` / `dependsOn` /
  dates and flows through `computeWorkingPlan` exactly as today.
- `parentId` is **organizational only** for the children — grouping never reorders the
  children or makes a child wait on a sibling.
- The parent's dates are a read-only **span** of its children — but that span is now
  computed inside `planFor` itself (min child start → latest child end+fraction), not just
  in the row render, so it has ONE source and can be **used as a prereq anchor** (below).

### Group as a prerequisite (2026-06-25)
A normal task can depend on a **group (parent) task** — `dependsOn` may reference a parent's
sequence number. The dependent then starts after the group's rolled-up **end** (the latest
child finish), exactly as if it depended on the latest child. Mechanics:
- `planFor(parent)` returns the rolled-up span (it recurses into children), so a dependent
  reads a real `dueDate` to anchor on. If **no** child has a date yet, the span end is null →
  the dependent has no anchor and its start clears (same rule as any unscheduled prereq).
- **Blocked state**: a task whose prereq is a group is *blocked* until **every child** of that
  group is done (not the parent's stale stored status). See [dependencies.md](./dependencies.md).
- **Cascade**: editing a child re-flows tasks that depend on the child's parent (the group's
  end shifted) — `recomputeDates` enqueues dependents of the changed task's `parentId` too.
- **Cycle safety**: depending on a group means depending on all its children, so the cycle
  check treats `parent → children` as edges. A child that tries to depend back on a task which
  waits on its own group is rejected inline like any other cycle.
- **Out of scope**: you still cannot set a prereq *on* a group (the parent row's prereq cell
  stays empty) — a group is a container, not a schedulable unit with its own dependency.

## Implementation notes
1. **`db.ts`** — add `parentId?: string | null` to `Task`. No `.stores()` change.
   - Helper: `setTaskParent(childId, parentId | null)` with the one-level guard
     (reject if target has a parent, or if child already has children) **and a
     same-sprint guard** (reject if `child.sprintId !== parent.sprintId` — a
     cross-sprint parent link would break rollover cohesion; `planSprintRollover`
     assumes a group moves as one unit within its sprint). The guards run inside a
     transaction so they can't go stale between the reads and the write (two
     overlapping group edits would otherwise TOCTOU past them).
   - On **delete** of a parent: promote children to top-level (`parentId = null`),
     **do not** cascade-delete. Confirm dialog notes "its grouped tasks become
     ungrouped, not deleted."
   - **Cross-member / cross-sprint moves** are handled by the **render**, not by
     mutating data: `TaskRows` resolves children only against tasks in the *same*
     member+sprint list, so a child whose parent isn't present (assignee/sprint
     changed, or parent rolled over) simply falls back to rendering top-level. No
     need to intercept every assignee/sprint update to clear `parentId`.
2. **`SprintView.tsx` → `MemberCard`** — build a render tree from the flat task list:
   top-level tasks (sorted) each followed by their children (sorted), indent children.
   - `TaskRow` gains a `depth`/`isChild` style (left padding only, no connector) and, for a
     parent, a chevron + roll-up cluster (progress count, mini bar, derived status,
     summed effort).
   - Counting: compute `leafTasks = tasks.filter(t => !hasChildren(t))`; use those for
     `total`/`done`/overdue/capacity.
3. **Collapse** — local state keyed by parentId, persisted to
   `localStorage['plan-up:taskgroup-collapsed:'+parentId]`; reset semantics like the
   member-group collapse.
4. **Selection bar** — assign/group/ungroup/chain/clear-prereqs/delete all live on
   `SelectionBar` (the floating bar). There is no per-row kebab/`RowActionsMenu` and no
   actions column on the row. The bar keeps its buttons on one line (`whitespace-nowrap`)
   and is capped at `100vw - 16px` with its own horizontal scroll, so on a phone the
   actions stay reachable instead of being clipped off both edges.

## Rules & edge cases
- **One level**: enforced in `setTaskParent`; UI hides "Group under…" on tasks that
  already have children, and excludes parents from the sibling picker.
- **Empty group**: a parent whose children are all removed/ungrouped silently reverts
  to a normal leaf task (no special "empty group" state).
- **Cross-sprint**: groups never span sprints; `setTaskParent` refuses a parent in a
  different sprint. **Cross-member is allowed** since 2026-11-09 (*Group nhiều người*): Assign
  never ungroups a child and never drags children along with their head (see
  [tasks.md](./tasks.md) "Bulk assign").
- **Board view**: out of scope this round — `parentId` is ignored in BoardView (tasks
  show flat). Flag if grouping is wanted there later.
- **Dark mode**: all via tokens (derived status dot via `STATUS_META` varName).

## Approaches considered
- **A · parentId + nested render (no roll-up).** Children indented under parent, each
  task fully independent. Smallest diff. Was the minimal option.
- **B · A + roll-up + collapse (CHOSEN).** Adds parent progress/derived-status/summed-
  effort + collapse, and leaf-based counting so capacity stays correct. More code,
  touches the member-group counting, but the parent reads as a real "mini group."
- **C · separate Group entity.** A named Group table + `groupId` on tasks, rendered as
  sub-headers. Rejected: the parent is then **not** a task, which contradicts the
  reference image (parent `32) build 3` has a sequence number), and adds a table.

## Status / history
Shipped as Approach B: `db.ts` field + `setTaskParent` guard + delete-promote →
`MemberCard` tree render + leaf-based counting → `TaskGroupRow` parent roll-up + collapse →
`SelectionBar` group/ungroup/**delete** (the per-row kebab was removed entirely; the bar
is now the only group/delete affordance). Verified with `npx tsc --noEmit && npm run build
&& npx vitest run`, plus a check that a pre-`parentId` export still imports and that member
`done/total` + capacity exclude parents.

## Future / open questions
- **Roll-up of parent dates/effort**: span/sum. The date span is now also a **prereq anchor**
  (a task can depend on a group; see "Group as a prerequisite") — computed on the fly in
  `planFor`, still **not persisted** on the parent. Setting a prereq *on* a group, or a
  stored/schedulable parent, remains out of scope.
- **Multi-level nesting** (groups within groups): deliberately cut for calm; revisit
  only on real need.
- **Board view grouping**: deferred.
- **Parent assignee change**: this round ungroups children rather than moving them —
  confirm that's the desired behavior in use.
