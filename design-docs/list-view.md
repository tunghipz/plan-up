# List view

**Status:** Implemented
**Last updated:** 2026-11-13 (phone v2: task card gọn ~58pt, meta một dòng, group thành chữ cuối meta — xem [mobile-layout.md](./mobile-layout.md)). Trước đó cùng ngày (task hôm nay: nền xanh nhạt + tiêu đề đậm, hạn hôm nay thêm nhãn Due today, header member có chip "N today" — xem [today-marker.md](./today-marker.md)). Trước đó cùng ngày (phone width < 768px: each row re-flows into a two-line card, column header hidden — see [mobile-layout.md](./mobile-layout.md)). Trước đó: 2026-11-09 (card **Group nhiều người** tách khỏi Unassigned — xem task-groups.md). Trước đó: 2026-11-09 (**perf**: `TaskRow` memo thật sự bỏ qua row không đổi: structural sharing + prop dẫn xuất từng row, xem *Hiệu năng*). Trước đó: 2026-11-09 (**chip member gọn**: dải chip của All xuống dòng dưới `Group by`,
chip chỉ còn avatar · tên · done/total + chấm báo, phần còn lại trong thẻ rê chuột — xem *Chip
member gọn*; trước đó cùng ngày: toggle `By member · All` **rời top bar** xuống hàng **`Group by`**
đầu List — xem *Chỗ đặt toggle*;
**chế độ All** gộp mọi task của sprint vào một bảng có cột Assignee + dải chip member để lọc;
sort theo **Assignee**; hàng xóm khi kéo thả bỏ qua dòng bị pull — xem *Chế độ All* và
*Drag-to-reorder* dưới)
**Previously:** 2026-09-21 (sau khi sort, mỗi row có prereq bị **kéo sát ngay dưới prereq
của nó** — `orderLane()`, xem [dependencies.md](./dependencies.md) *Dependents stick to their
prerequisite*); 2026-08-17 (**title 2+ dòng bị xén 2px ở đáy — fixed**, xem v5 dưới; prior:
2026-07-08 column header → floating glass capsule; sprint note → inline description in the merged Notion-style page header, see app-shell v4; prior: calm refinements — time-on-hover dates, quiet empty cells, sticky-light group headers, compact rows, `#`-prefixed prereq)
**Code:** `app/src/SprintView.tsx` (`MemberCard`, `UnassignedCard`, `AllTasksCard`,
`ListViewBar`, `MemberFilterStrip`, `MemberFilterChip`, `memberHeaderStats`, `GroupHeader`, `TaskColumnHeader`,
`SortHeader`, `COL`, `TaskRows` drag state, `TaskRow` grip), `app/src/ViewToggle.tsx`
(segmented control), `app/src/App.tsx` (grouping state, `plan-up:list-grouping`), `app/src/task-sort.ts` (`assignee` sort, `orderLane`),
`app/src/reorder.ts` (`anchorNeighbours`), `app/src/members.tsx`
(`MemberDaysOffButton variant="compact"`), `app/src/DatePicker.tsx` (`DatePickCell`
time-on-hover), `app/src/db.ts` (`orderBetween`, `setListOrder`)

> **v5 · title auto-grow không xén chữ (2026-08-17)** — task title trong List là một
> `<textarea>` tự cao lên (`whitespace-pre-wrap break-words`, `overflow-hidden`, `rows={1}`),
> nên **title dài luôn wrap, không bao giờ có "…"**. Nhưng `resize()` set
> `el.style.height = el.scrollHeight + 'px'`, trong khi class `.editable` gắn
> `border: 1px solid transparent` và Tailwind để `box-sizing: border-box`:
> `height` **tính cả border**, `scrollHeight` **thì không** → mọi title từ 2 dòng trở lên bị
> hụt đúng **2px**, xén đáy dòng cuối (dấu nặng / descender tiếng Việt bị cụt).
> Đo trực tiếp trên app: `clientHeight 45` vs `scrollHeight 47`.
> Fix: cộng lại phần border đo runtime — `el.scrollHeight + (el.offsetHeight - el.clientHeight)`
> (delta này = tổng border trên+dưới, đúng cho mọi theme/zoom, không hardcode `2`).
> Cùng đợt với share page bỏ `truncate` (share-link-snapshot.md) — cùng một nguyên tắc:
> **title dài thì xuống dòng, không cắt chữ**.
>
> **v4 · calm refinements (2026-07-06)** — a signal-to-noise pass on the row grid
> (demo `demo/list-view-refinements.html`, options approved by user):
> 1. **Date time-of-day shows on row hover only.** The working-hours suffix (`, 08:00` /
>    `, 17:00`) was repeating on every row for near-zero info. The date shows at rest; the
>    `, HH:mm` tail fades in on `group-hover/row`. `DatePickCell` gained a `timeOnHover` prop
>    (List passes it; Collections/other callers keep time inline).
> 2. **Quiet empty cells.** A resting empty Effort / Prereq / date renders its `—` at ~25%
>    opacity (was full `ink-faint`); editable-empty cells reveal their `＋` add-affordance on
>    row hover. The grid of dashes no longer competes with real data.
> 3. **One sticky column header** for the whole list (was: a repeated header inside every
>    group card). It's rendered once at the top of `space-y-4` and **pins to the top of the
>    scroll area** as you scroll — it sticks because nothing between it and the scroll
>    container (`scrollRef` in App) is an overflow box, unlike the old per-card headers which
>    were trapped inside each card's `overflow-x-auto`. It uses the **member column layout**
>    (no Assignee column) and mirrors the member cards' `overflow-x-auto` / `min-w-[820px]` so
>    columns line up. The header itself is also lightened (no grey fill; sits on the canvas).
>    **Exception:** the **Unassigned** card keeps its *own* inline header, because it adds an
>    Assignee column the member layout doesn't have — one header can't align with both column
>    sets. The global header only renders when there's ≥1 member group (`groups.length > 0`).
>    *Caveat:* on a viewport narrow enough to trigger each card's horizontal scroll (<~820px
>    of column width, rare on this desktop-first tool) the pinned header won't track a card's
>    independent horizontal scroll.
> 4. **Compact rows** (~40px, was ~48px) — more tasks per screen (speed DNA).
> 5. **Prereq shows `#7`** (was bare `7`) — matches the `#N` language used in the cycle/notice
>    popovers and disambiguates an ID reference from a count. Prefix is display-only (the input
>    edits raw numbers).
> 6. The **sprint note** now lives as an inline **description** line inside the merged
>    sprint **page header** (see [app-shell-and-navigation.md] v4 / `SprintNoteBanner`);
>    its empty state is a quiet **"Add sprint focus…"** placeholder, not a band.

## Purpose
The primary editing surface: every task in the sprint, grouped by assignee in
inset-grouped cards, fully editable inline.

## User-facing behavior
- One **card per member** (plus a **Group nhiều người** card for groups with no holder whose
  tasks are assigned to members — see task-groups.md, *Group nhiều người* — an **Unassigned**
  card for tasks really nobody owns, and a collapsed "members with no tasks" section). Each card = a `GroupHeader` + task rows + an "Add task" row. The
  **column header is a single sticky bar** at the top of the list (not repeated per card) —
  see v4 note above. Since 2026-07-08 it renders as a **floating glass capsule**
  (`.glass-toolbar rounded-full`, sticky `top-2`, no border-b — the capsule rim is the
  edge; see liquid-glass-material.md) instead of an opaque full-bleed strip. (The
  Unassigned card is the one exception that keeps an inline header, since it carries an
  extra Assignee column.)
- **Collapse** a member card by clicking its header (persisted per sprint).
- **Sort** by any column via its header (`ID, Task, Effort, Start, End, Status, Prereq`);
  clicking a column **cycles three states: asc → desc → off**. "Off" is a NEUTRAL state
  (`sort.field === null`) where **no column shows an arrow** and rows fall back to the manual
  order (`listOrder ?? sequence`), which also re-enables drag-to-reorder. The active column
  shows an arrow (▲/▼); cleared/neutral columns show none. Every column — including `ID`/`seq`
  — can reach neutral, so its arrow can always be turned off. (Neutral and an explicit `seq asc`
  render the same row order — `seq` IS the manual order — the only difference is whether the
  ID header shows an arrow.) Sort is **shared across all member cards** (one preference, not
  per-member) and **persisted** so it survives switching view/sprint/project and a page reload
  (defaults to neutral first run).
- Sorting by **Start** / **End** uses the *displayed* date, not the raw stored field.
  Leaf rows show the **scheduled** plan date (`computeWorkingPlan`) and a group-head row shows
  a **rollup** (earliest child start … latest child end); its own stored `dueDate` never tracks
  that rollup. `compareTasks` therefore sorts these two columns by a per-lane `dateKeys` map of
  the same composite `date+time` keys the cells render, so a parent lands where its End cell says
  it should. (Before this, a parent sorted by its often-empty raw `dueDate` → jumped to the bottom
  even when its rolled-up End was early.) Empty dates sort last ascending.
- **Sau khi sort, dependent bị kéo sát prereq.** Sort xong, lane chạy thêm một pass kéo mỗi
  row có prereq lên **ngay dưới prereq của nó** (prereq cùng lane + cùng group scope). Cùng
  hợp đồng mà group children đã có: nesting được áp **sau** khi sort, nên List chỉ có một luật
  chứ không phải hai. Hệ quả có chủ đích: cột đang sort **không còn đơn điệu** từ trên xuống —
  một dependent End trống có thể nằm giữa hai row có ngày. Chi tiết + lý do ở
  [dependencies.md](./dependencies.md).
- Member cards omit the **Assignee** column (everyone in the group is the same person);
  the Unassigned card keeps it.
- **Group nhiều người** (2026-11-09, [task-groups.md](./task-groups.md)): ở By member, task con
  thuộc group của người khác nằm trong card của chính nó như dòng lẻ, kèm chip `↳ #N tên group`
  sau title. Group head luôn là dòng group (roll-up trên mọi task con) kể cả khi card đó không có
  task con nào. Ở All, group hiện đủ task con. Sort theo Start/End dùng ngày roll-up của mọi task
  con, đúng như ô ngày đang hiện.
- **Nền group** (2026-11-09): mỗi group là một thẻ bo lồng trong bảng, nhuộm nhẹ theo màu người
  giữ group (`.task-group-card`, xem [task-groups.md](./task-groups.md) *Nền group*).
- A task with **Effort = 0** renders as a **milestone**: a `◆ Milestone` pill after the
  title and a single collapsed milestone date (instead of a `Start → End` span). This is
  distinct from Effort `—` (*not estimated*, ⚠). See [milestones.md](./milestones.md).

## Chế độ All — một bảng cho cả sprint (2026-11-09)

Card theo member chia sprint thành nhiều mảnh: muốn xem cả team theo thời gian, hay đọc một
chuỗi prereq đi qua nhiều người, phải nhảy giữa các card. Chế độ **All** đổ mọi task của sprint
vào **một bảng liền**. Kiểu bảng task của MS Project / OmniPlan, nhưng không có Gantt.

Chọn qua demo `demo/list-all-tasks.html` (hướng A "dải member phía trên", không chọn B "bảng
trần, member trong nút People"). Nguyên văn user: *"tao không cần gantt, tao chỉ cần là list
toàn bộ task trên 1 trang liền nhau, thay vì chia theo member như hiện tại"*, rồi *"chọn A, bỏ
pull khi sort Assignee, làm đi"*.

- **Toggle `By member · All`** nằm ở hàng **`Group by`** đầu List (xem *Chỗ đặt toggle* ngay
  dưới). Lưu ở `localStorage['plan-up:list-grouping']` (`'member' | 'all'`, mặc định `member`),
  dùng chung mọi project như sort.
- **Chỗ đặt toggle** (đổi cùng ngày). Bản đầu đặt toggle trên top bar, ngay trước
  `List · Board · Timeline`, chỉ hiện khi đang ở List. User: *"cái này chỉ thuộc phần list, đặt
  ở đây không phù hợp, có chỗ nào khác không"*. Đứng ngang hàng List/Board/Timeline nó đọc như
  lựa chọn chung của sprint, và sang Board/Timeline thì biến mất làm top bar đổi hình. Ba hướng
  trong `demo/list-grouping-placement.html`: **A** gộp vào nút List thành menu `List ▾`, **B**
  segmented nhỏ trên thanh tên cột, **C** hàng điều khiển riêng của List. User chọn: *"C"*.
  - Hàng **`Group by [By member | All]`** là hàng đầu tiên của List, trên thanh tên cột, dưới thẻ
    sprint. Nhãn `Group by` chữ nhỏ mờ, segmented giống hệt `List · Board · Timeline` (cùng
    component `ViewToggle`).
  - Ở **All**, dải chip member nằm **ngay dưới** hàng này, thẳng mép trái với chữ `Group by`
    (bản đầu để chip cùng hàng bên phải toggle; đổi theo *Chip member gọn* dưới). Ở **By member**
    chỉ có hàng toggle. Toggle vì vậy ở đúng một chỗ cho cả hai chế độ.
  - Hàng này không dính khi cuộn (thanh tên cột vẫn dính). Đã biết khi chọn: cuộn sâu thì phải
    cuộn lên mới đổi chế độ.
  - Top bar còn lại `List · Board · Timeline` và các công cụ toàn sprint, giữ một hình ở mọi view.
  - Sprint trống (chưa có member, chưa có task) không hiện hàng này, chỉ hiện empty state.
- **Một card duy nhất** chứa mọi task của sprint, kể cả task chưa giao. Thêm cột **Assignee
  rộng** (avatar + tên, 128px), bấm để đổi người (cùng `<select>` ẩn như card Unassigned). Group
  row hiện avatar + tên của cha, chỉ đọc (đổi assignee của cha thì ungroup, xem
  [task-groups.md](./task-groups.md)). Header cột vẫn là capsule glass dính trên cùng, thêm cột
  **Assignee sort được**.
- **Dải chip member** phía trên bảng: `All N`, rồi mỗi member một chip theo thứ tự lane
  ([member-lane-order.md](./member-lane-order.md)), rồi `Unassigned N` nếu có. Chip member gồm
  avatar, tên, `done/total` (đếm leaf như header card), badge overdue nếu > 0, badge trùng lịch
  nếu có, `due <ngày>` gần nhất, và nút Days off (`MemberDaysOffButton`, cùng popover với header
  card). Từ *Chip member gọn* dưới, chip chỉ hiện avatar, tên, done/total và chấm báo; phần còn lại
  nằm trong thẻ rê chuột. Số liệu lấy từ `memberHeaderStats`, chung với `MemberCard`, nên
  chip và card không bao giờ lệch nhau. Member chưa có task vẫn có chip (mờ) để vào Days off.
- **Chip member gọn** (đổi cùng ngày). Bản đầu mỗi chip cao 36px, chứa đủ avatar, tên,
  done/total, badge overdue, ⚠ trùng lịch, `due`, và ô Days off (nét đứt khi chưa có ngày nghỉ):
  7 member chiếm 2–3 dòng. User: *"cho đống filter gọn hơn và hiện dưới chữ group"*. Ba hướng
  trong `demo/member-chips-compact.html`: **A** thu nhỏ giữ đủ, **B** chip chỉ để lọc, **C** một
  thanh segmented. User chọn: *"B"*.
  - Chip cao **28px**: avatar 18, tên, `done/total`. Có overdue thì thêm **chấm đỏ**, không có
    overdue nhưng có task trùng lịch thì **chấm cam**. Chấm chỉ báo "có chuyện", số nằm trong thẻ.
  - **Rê chuột** (hoặc focus bằng bàn phím) lên chip, sau 250ms mở **thẻ nhỏ** dưới chip: avatar,
    tên, `done/total`, dòng Overdue (nếu > 0), Schedule conflicts (nếu > 0), Next due, và nút
    **Days off** rộng cả thẻ (ghi `1d off · Edit` hoặc `Set days off`), mở đúng popover ngày nghỉ
    như trước. Thẻ còn mở khi chuột đi vào thẻ, và **giữ mở khi popover Days off đang mở**.
  - Thẻ là portal (không bị cắt bởi vùng cuộn), canh trái theo chip, kẹp trong màn hình. Cuộn
    trang thì thẻ đóng (trừ khi đang mở popover Days off).
  - `aria-label` của chip đọc luôn số liệu bị cất (done/total, overdue, trùng lịch) cho trình đọc
    màn hình.
  - Không có chuột (màn cảm ứng) thì không thấy thẻ; ngày nghỉ vẫn đặt được ở header card bên By
    member.
- **Bấm chip = lọc** bảng theo người đó; bấm lại chip đang chọn, hoặc bấm `All`, để bỏ lọc. Lọc
  là state tạm, không lưu, reset khi đổi sprint.
- **Thứ tự tay dùng chung `listOrder`.** Thứ tự neutral của All là `listOrder ?? sequence` trên cả
  sprint; mỗi card ở By member chỉ là thứ tự đó lọc theo người. Kéo một dòng ở All ghi `listOrder`
  giữa hai dòng kề, nên về By member, thứ tự trong card từng người vẫn khớp. Không thêm field,
  không đổi schema.
- **Prereq khác người:** ở All, lane là cả sprint, nên `orderLane` kéo dependent xuống ngay dưới
  prereq **kể cả khi prereq thuộc người khác**. By member không làm được vì hai dòng ở hai card.
- **Sort theo Assignee:** nhóm task theo thứ tự lane của member (Unassigned cuối khi tăng dần),
  trong mỗi người theo thứ tự tay. **Pull chỉ áp trong cùng một người**: prereq của người khác
  không kéo dòng ra khỏi khối, nên mỗi người là một khối liền. Prereq cùng người vẫn kéo như
  thường, nên khối của một người đọc y như card của họ ở By member. Xem
  [dependencies.md](./dependencies.md).
- **Add task** cuối bảng: đang lọc theo một member thì task mới giao cho người đó (placeholder
  `Add task for <name>`); không lọc, hoặc lọc Unassigned, thì task chưa giao (placeholder
  `Add task (unassigned)`).
- **Cảnh báo trùng lịch** (tam giác vàng ở gutter) vẫn tính theo từng member rồi gộp lại, nên hiện
  y như ở By member.
- Ở All không có: collapse card, kéo đổi thứ tự lane member (chip đi theo thứ tự lane, đổi ở By
  member), mục "N members with no tasks" (member không task đã có chip).
- **Không đổi:** Export PNG, Copy to Telegram, share link vẫn chia theo member. Board và Timeline
  không đổi.
- Ở **By member**, nếu sort đang là `assignee` (chọn từ All), mỗi card có đúng một người nên thứ
  tự = thứ tự tay; kéo thả vẫn bật. Header By member không có cột Assignee nên không hiện mũi tên.

## Drag-to-reorder
A hover-revealed **grip** (`GripVertical`, leftmost gutter, `cursor-grab`) lets you drag a
task to a new position — like ClickUp. Manual order is stored in `Task.listOrder` (fractional;
falls back to `sequence` when unset) and is **never logged** (arrangement, not data). `sequence`
is never touched, so task-numbers and prereq references stay stable.

- **Only enabled in the manual ascending order** — neutral (`sort.field === null`) or an
  explicit `seq asc`. Under any other sort — name/date/… **or even `seq DESC`** — the grip is
  hidden and rows aren't draggable. (Descending matters: the drop math writes a fractional
  `listOrder` *between the two displayed neighbours*, which only resolves correctly when the
  display is ascending; in a descending view `before > after`, so the value can't separate and
  the drag would silently scramble/no-op. So drag is gated to the ascending manual order only.)
  That order sorts by `listOrder ?? sequence` (tiebreak `sequence`), so it's monotonic
  and a drop just writes a fractional value **between the two displayed neighbours** (e.g.
  between 2 and 3 → 2.5); no global reindex needed.
- **Within a member card only.** Dropping onto a different card is a no-op (snap back) —
  reassigning still goes through the assignee picker, not drag. Ở **All** chỉ có một card nên
  kéo được trong cả bảng (kể cả khi đang lọc theo member); kéo không bao giờ đổi assignee.
- **Hàng xóm để tính order bỏ qua dòng bị pull (2026-11-09).** Một dependent hiện ngay dưới prereq
  vì luật pull, nhưng `listOrder` của nó có thể nằm chỗ khác hẳn. Lấy nó làm hàng xóm thì trung
  điểm rơi sai (thả giữa A và dependent D của A, row bay đi xa). Nên `anchorNeighbours`
  (`reorder.ts`) bỏ qua dòng "pinned" (có prereq trong cùng lane) và lấy dòng gốc gần nhất hai
  bên. Hệ quả: thả giữa A và D thì row nằm sau D; cặp prereq–dependent không tách được, đúng với
  luật pull. Lỗi này có sẵn ở By member nhưng hiếm; ở All prereq khác người làm nó thường gặp.
- **Only a genuine drop repositions.** Releasing the grip **without moving** (or dropping
  back onto the dragged row / into its own gap — same neighbours before and after) is a
  **no-op**: nothing is written, so grabbing a grip and letting go never perturbs
  `listOrder`.
- **Same level only.** A top-level task reorders among top-level tasks; a child reorders among
  its **siblings under the same parent**; dragging a **group head** moves the whole group (its
  children travel with it). Dragging across levels / into or out of a group is a no-op — use
  Group / Ungroup (selection bar) to reparent. (See [task-groups.md](./task-groups.md).)
- **Mechanics:** **Pointer Events** (not native HTML5 DnD). The grip's `onPointerDown`
  captures the pointer (`setPointerCapture`), so every move/up routes to the grip wherever
  the cursor goes; the owner resolves the row under the cursor via
  `document.elementFromPoint(...).closest('[data-task-id]')` (lanes use `[data-lane-id]`).
  *Replaced native HTML5 drag (2026-06-30): the old approach toggled the row `draggable`
  imperatively and relied on `dragover`→`preventDefault` timing, which silently failed in
  some browsers (the row showed the "dragging" fade but never dropped). Pointer events are
  consistent cross-browser and don't touch `draggable`, so row text stays selectable.* A 2px
  accent **insertion line** marks the drop slot, computed from the pointer vs each row's
  mid-height. `orderBetween(prev, next)` (db.ts) returns the fractional value;
  `setListOrder(id, order)` persists it raw.
- **The insertion line only shows where a drop would actually move the row.** The hover
  handler runs the *same* `computeDropSlot` the drop does and suppresses the line for a
  `null`/`ownGap` slot — so the ~2-row band around the dragged row's current slot (its own
  gap: bottom-half of the row above + top-half of the row below) shows **no line**, matching
  the no-op. Fix (2026-07-06): previously the line appeared for any hovered neighbour
  regardless of `ownGap`, so dragging a row a half-step onto an adjacent neighbour lit the
  line but releasing did nothing — the row looked stuck. To move a row down one slot, drag
  past the next row's mid-height (its bottom half). Same gating in the member-lane and
  Collections drags (all share `reorder.ts`).

## Column widths (`COL`)
Fixed widths sized to measured content + a small buffer; **Task** is `flex-1` and absorbs
slack:
`dot 16 · ID 32 · Task flex(min 150) · Assignee 64 · Effort 80 · Start 112 · End 112 ·
Status 112 · Prereq 56 · actions 16`. Header & rows share the same `COL` constants so
they stay aligned. Chế độ All dùng `COL.assigneeWide` (128px, avatar + tên) thay cho Assignee 64.

## Horizontal scroll
Each group wraps its rows in `overflow-x-auto` with a `min-w` floor (**member 820px**,
**unassigned 896px**, **All 960px**) ≥ true content width; the **single sticky header** mirrors the member
`overflow-x-auto` / `min-w-[820px]` so it aligns. On narrow screens the table scrolls instead
of crushing the Task column. *(Caveat: the pinned header doesn't track a card's independent
horizontal scroll on very narrow viewports — see v4 note.)*

## Hiệu năng: một lần sửa chỉ render lại row đổi (2026-11-09)

`TaskRow` là `memo`. Trước đây mọi lần ghi task đều làm cả List render lại: Dexie trả object
mới cho mọi row, còn `planById`/`tasksById` là Map mới, nên phép so sánh của memo luôn sai
(N=900: 106–124 ms mỗi lần sửa, long task 85 ms). Nay:

- **Structural sharing** (`app/src/stable-rows.ts`): live query `tasks` của App giữ nguyên object
  cũ cho row không đổi, và giữ nguyên cả mảng khi không có gì đổi.
- `TaskRows` tính sẵn giá trị **cho từng row** rồi truyền xuống: `plan` (so 4 field),
  `blocked` (từ `computeBlockedIds`, một pass), `prereqLabel` (chuỗi). Không truyền Map nữa.
- `PrereqInput` đọc task mới nhất của sprint qua `TaskLookupContext` (một ref ổn định) **lúc
  commit**, nên row không render lại vẫn resolve đúng số vừa thêm.

Đo: sửa title chỉ render lại 1 row (trước: cả 300). N=900: còn khoảng 66–85 ms, chủ yếu là
chi phí của live query và tầng SprintView.

## Rules & edge cases
- Changing a `COL` width means re-checking the `min-w` floors (must stay ≥ summed content).
- Collapse state key: `localStorage['plan-up:collapsed:<sprintId>']`.
- Sort state key: `localStorage['plan-up:sort']` — a single global `{field, dir}` (not
  per-sprint, since the sort is one shared preference). Seeded into state on mount and
  re-written on every change; a missing/corrupt value falls back to `seq asc`. Field
  `assignee` hợp lệ từ 2026-11-09 (chỉ sort được ở chế độ All).
- Grouping key: `localStorage['plan-up:list-grouping']` — `'member' | 'all'`, global; giá trị
  lạ hoặc thiếu thì về `member`.
- Group header right side surfaces the member summary — see
  [member-header-summary.md](./member-header-summary.md).
- Drag-reorder writes `listOrder` raw (no change-log entry) and never recomputes dates or
  touches `sequence`; it's pure arrangement. Falls back to `sequence` for any task never dragged.
