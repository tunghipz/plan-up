# Collections (task ngoài sprint)

**Status:** Implemented
**Last updated:** 2026-07-01
**Code:** `app/src/db.ts` (schema v9 + collection/section/status/item CRUD, export v3),
`app/src/lib.ts` (buildMonthGrid/assignLanes/computeBarSegments — pure calendar helpers),
`app/src/CollectionView.tsx` (List card-per-section + status editor + click-assign +
editable Start/End dates via shared `DateRangePickCell` — a **date-range** picker, one popover
sets both start+end in two clicks, no time-of-day; see [date-picker.md](./date-picker.md) "Range mode"),
`app/src/CollectionCalendar.tsx` (month grid + seamless multi-day bars + multi-month chevrons),
`app/src/App.tsx` (sidebar SPRINTS/COLLECTIONS + routing)

## Purpose
Cho app một **chỗ chứa task ngoài sprint**: event live-ops, changelog/tính năng đã ship,
việc lẻ có hoặc không có lịch. Sprint hiện tại bị đóng khung quanh biweekly + scheduling +
assignee; những việc này không hợp khuôn đó. Giải pháp: tổng quát hoá khái niệm **List**.

Một project (trong sidebar) có hai loại "List":
- **Sprint** — time-boxed, có scheduling/capacity/rollover (**giữ nguyên 100%**, không đổi UX).
- **Collection** — **tên tự đặt**, chứa task ngoài sprint, không scheduling. Đây là phần mới.

> Quyết định nền: *collection chỉ là một dạng list bạn tự đặt tên* — không phải một entity
> "Event" cố định. "Live-ops 2026", "Changelog", "Roadmap Q3"… đều là collection.

## User-facing behavior

### Sidebar
Panel trái tách hai mục: **SPRINTS** (như hiện tại) và **COLLECTIONS**. Mỗi collection là một
row (tên + số item). `+` cạnh "COLLECTIONS" → mở **modal "New Collection"** (cùng style sheet
Cupertino với "New Sprint": input Name + Cancel/Create, không có ngày) → tạo collection mới. Đổi
tên / xoá collection từ row (hover) hoặc trong nó.

### Nhiều "bảng" (sections) trong một collection
Một collection chứa **nhiều bảng tự đặt tên** (sections), xếp dọc — tổng quát hoá đúng cơ chế
"card-per-group" của [list-view.md](./list-view.md) (sprint nhóm theo assignee; collection nhóm
theo section do user tạo). Mỗi bảng:
- Header: chấm màu + tên + đếm + collapse (click header) + ✎ đổi tên (hover) + ⋯ menu.
- Cột: **Name · Start · End · Status**. **Không** có Assignee / Effort / Prereq.
- **Start/End = date-range picker**: bấm ô Start *hoặc* ô End mở chung **một** popover lịch;
  click ngày đầu = start, click ngày sau = end (dải ngày giữa highlight). Không có giờ. Chi tiết
  ở [date-picker.md](./date-picker.md) "Range mode".
- **Click tiêu đề cột để sort** — giống sprint list ([list-view.md](./list-view.md)): chu kỳ 3
  trạng thái mỗi cột `asc → desc → off`; "off" trả về thứ tự tự nhiên (thứ tự thêm/DB). Một preference
  sort **dùng chung cho mọi bảng** trong collection, persist qua `localStorage` (`plan-up:collSort`).
  Status sort theo **thứ tự status do user định nghĩa** (item không status xếp cuối); ngày trống xếp
  cuối. Mũi tên ▲/▼ chỉ chiều sort đang active.
- "＋ Add item" riêng từng bảng (inline: gõ + Enter); "＋ Add table" ở cuối mở **modal "New Table"**
  (cùng sheet Cupertino name-only với New Sprint/Collection — qua component dùng chung `NameModal`).
- **Xoá item:** ô chấm-màu status ở đầu dòng **hoán thành nút thùng rác (`Trash2`) khi hover** row
  (cùng slot → không thêm cột đuôi, không xô lệch lưới; tách khỏi grip kéo ở lead-gutter); click →
  xoá ngay (1 click, không confirm). Item lẻ nhẹ, dễ gõ lại — đúng DNA "speed > breadth, ≤1 click".
  Dùng lại `deleteTask` (an toàn cho collection-item: không children/deps).
- **Kéo-thả item = pointer-based** (dùng chung `useDragHandle`/`RowDrag` với sprint list — xem
  [list-view.md](./list-view.md)), thay HTML5 DnD cũ (browser-fragile). Grip hiện khi hover trong
  lead-gutter. Kéo để **sắp-xếp-lại thứ tự trong cùng bảng** *và* **chuyển sang bảng khác** — cùng
  một cử chỉ; thả vào bảng rỗng cũng được (thả cuối bảng). Chỉ bật khi **sort = off** (thứ tự
  natural); đang sort theo cột thì ẩn grip (giống `canReorder` của sprint).

### Hai view: List | Calendar
Toggle sống trên **top bar** (một *context bar* duy nhất), **không** lặp trong nội dung. Top bar
là adaptive theo container đang xem: sprint → `List / Board / Timeline`; collection → `List / Calendar`
(chỉ 2 nút, **bỏ Board**). Cùng *một* component toggle, đổi options theo `selKind`.
- **List:** card-per-section như trên.
- **Calendar:** lịch tháng (Mon-start), **thanh event liền mạch** (xem phần Calendar bên dưới).

> **Một context bar, không double-toggle (2026-06-08).** Trước đây top bar luôn hiện chrome của
> sprint (tên sprint + ★ + dải ngày + `List/Board/Timeline`) *kể cả* khi xem collection, trong khi
> `CollectionView` lại tự vẽ identity + toggle `List/Calendar` riêng bên dưới → **hai toggle, hai
> identity chồng nhau**, toggle trên không điều khiển được collection. Nay top bar đổi *context*
> theo container: xem collection thì bên trái là identity collection (icon stack + tên đổi-được +
> summary), bên phải là `Statuses` + toggle `List/Calendar`. `CollectionView` chỉ còn render nội
> dung — bỏ hẳn sub-header. View state của collection persist qua `plan-up:collectionView`.

### UX refinements (2026-06-08)
Một loạt chỉnh nhỏ để Collections bám sát design-system constitution (đọc kèm
[design-system.md](../design-system.md)):

1. **Header = summary, không phải badge.** Bỏ badge "COLLECTION" tô accent đặc (accent là
   *tín hiệu*, không trang trí — §2.1). Thay bằng: icon stack mờ cạnh tên + dòng summary nhỏ
   (`N items` + hàng chấm màu phân bố theo status). Tên collection có icon ✎ hiện khi hover.
2. **Empty state.** Bảng 0 item: ẩn column header, hiện dòng calm "No items yet — add your first
   below" + vẫn còn dòng Add item inline (CTA tự nhiên). Calendar không có item nào có ngày:
   "No items have dates yet." / "No items yet — add some in List." (checklist §#4).
3. **Calendar — Unscheduled tray.** Item **không có startDate** trước đây bị lọc mất khỏi Calendar
   (trông như mất). Nay hiện trong khay **UNSCHEDULED · N** dưới lưới; mỗi chip có `DatePickCell`
   để gán ngày (gán xong item nhảy lên lịch). Không gì bị ẩn vô hình.
4. **Calendar — bar bấm được.** Bar không còn `cursor-default` + chỉ `title`. Bấm bar → popover
   (portal + float-shadow như StatusPill/DatePicker) sửa inline: title · status (click-assign) ·
   Start/End (`DateRangePickCell` — **cùng range picker** như List) · "View in list →" (đổi segmented
   về List). Theo §5.7 (inline edit). *Lưu ý:* outside-click của popover này phải bỏ qua click trong
   `[data-calendar-popover]` (calendar portal ra `<body>`) — nếu không, bấm chọn ngày sẽ đóng popover
   trước khi ngày kịp ghi.
5. **Quiet dashed pill cho ô trống.** "No status" và ngày trống render như **pill viền đứt**
   (`＋ Status` / `＋ End`), hover thành accent — đúng idiom days-off đã có, đọc ra "bấm được".
   `DatePickCell` thêm prop optional `emptyHint` (sprint view không truyền → giữ nguyên dấu "—").
6. **Đổi tên = single-click + ✎.** Tên collection và tên bảng đổi từ *double-click ẩn* sang
   **single-click để sửa** + icon ✎ hiện khi hover (đồng bộ với item title luôn-sửa-được).
7. **Bỏ `window.confirm()`.** Xoá bảng / xoá status → **inline confirm** (thanh đỏ nhạt
   Delete/Cancel ngay trong card/row). Xoá collection → **sheet Cupertino** (cùng style NameModal,
   nút Delete đỏ). Không còn dialog OS xám phá DNA (§8).
8. **Calendar — Today + legend.** Nút **Today** (hiện khi không ở tháng hiện tại) nhảy về tháng nay;
   hàng **legend** (chấm màu + tên status) phía trên lưới để map màu → status.
9. **Một context bar — hết double-toggle (xem "Hai view" ở trên).** Identity collection + `Statuses`
   + toggle `List/Calendar` dời lên top bar; toggle dùng chung một component adaptive với sprint
   (`List/Board/Timeline`). `CollectionView` bỏ sub-header, chỉ render nội dung. Đúng DNA "calm
   utility + single source of truth": một thanh, một toggle, không chrome thừa.

### Status — người dùng tự tạo (per-collection)
Mỗi collection có **bộ status riêng do người dùng tự định nghĩa** — không cố định, không dùng
chung. User thêm / đổi tên / đổi màu / xoá / sắp xếp status trong từng collection. Ví dụ một
collection live-ops có thể tạo `FEATURE` (cam) + `EVENT` (xanh); collection khác tự tạo bộ khác
(`PLANNED`, `LIVE`, `ENDED`…).

- Mỗi status `{ id, name, color }`. **Màu chọn từ palette hệ Apple** (như avatar palette,
  [design-system.md](../design-system.md) §2.4) — không cho hex tự do, để giữ "màu = semantic, hệ
  Apple", không lệch DNA.
- Hiển thị: **pill soft-tint + dot** như [status-and-priority.md](./status-and-priority.md); màu
  pill/thanh-calendar suy từ `status.color`.
- Collection mới **seed sẵn vài status mặc định** (vd `FEATURE`, `EVENT`) để dùng được ngay; user
  sửa/thêm/xoá thoải mái. Bộ status quản lý từ menu của collection (⋯ → "Edit statuses").

## Calendar (month view) — thanh liền mạch

Yêu cầu cốt lõi: event nhiều ngày là **một thanh trải liên tục**, không cắt vụn.

- **Lưới:** Mon-start, số tuần tính động (5–6) đủ phủ tháng; ngày tháng kề (trước/sau) hiển thị
  mờ. Today = số trên nền tròn accent (kiểu Apple).
- **Lane packing:** mỗi item giữ **một hàng (lane)** xuyên suốt tháng. Sắp xếp theo start
  (tie-break: dài hơn trước), gán lane thấp nhất chưa bị item chồng ngày chiếm. Item không chồng
  ngày → dùng chung lane (đọc như một timeline). Item chồng ngày → rớt xuống lane dưới.
- **Segment theo tuần:** mỗi item cắt thành đoạn theo từng tuần nó đi qua. Bo tròn **chỉ ở
  ngày bắt đầu/kết thúc thật**; sang tuần mới thì vuông + sát mép, nối tiếp ở đầu tuần sau.
- **Đa tháng:** item vắt sang tháng khác → đoạn chạm mép lưới được cắt vuông + **chevron `‹` / `›`**
  báo "còn tiếp". Lật tháng (‹ ›) thì item hiện lại từ mép kia, bo tròn ở đầu/cuối thật.
- **Bar style:** mặc định **Soft** (nền tint nhạt + chữ màu status + vạch màu 3px ở đầu thanh).
  Đúng tinh thần "accent là tín hiệu" của design-system. (Filled = nền đặc + chữ trắng — không
  dùng mặc định.)
- Item 1 ngày hiện như một pill ngắn trên đúng ngày; màu theo `status.color`.
- Tất cả item của collection (mọi section) lên **chung một lịch** — section chỉ là tổ chức ở List.

Prototype tham chiếu: `demo/event-calendar-seamless.html`, `demo/collection-multi-table.html`.

## Data

### Entity mới
```ts
Section          { id: string; name: string; color?: string }    // bảng, nhúng trong collection
CollectionStatus { id: string; name: string; color: string }     // status do user tạo, nhúng
Collection { id; projectId; name; order: number;
             sections: Section[]; statuses: CollectionStatus[]; createdAt }
```
`sections` và `statuses` đều là mảng **nhúng, không-index, có thứ tự**. Collection mới sinh ra với
**1 section "All"** + một **bộ status mặc định** (vd `FEATURE`, `EVENT`) mà user sửa được.

### Thay đổi `Task`
Thêm 3 field optional (xem [data-model.md](./data-model.md)):
- `collectionId?: string | null` — **indexed**. Task thuộc collection nào.
- `sectionId?: string | null` — non-indexed. Bảng nào trong collection.
- `collectionStatusId?: string | null` — non-indexed. Trỏ tới một `CollectionStatus.id` trong
  `statuses` của collection chứa nó.

**Bất biến:** mỗi Task thuộc **đúng một** container — hoặc `sprintId` (sprint task) hoặc
`collectionId` (collection item), cái kia `null`. Collection-item **không dùng** `status`
(todo/in_progress/done), `estimate`, `assigneeId`, `dependsOn` — chỉ dùng `startDate`/`dueDate`
(đã có) + `collectionStatusId`.

### Cách ly khỏi sprint engine
Scheduler, capacity banner, rollover, per-sprint `sequence` — đều **query theo `sprintId`** nên
collection-item (`sprintId = null`) tự động không bị đụng tới. Không cần sửa logic scheduling.

### Schema versioning (v9)
- Thêm table `collections` (index `id, projectId, order`); `sections` nhúng.
- `tasks`: thêm index `collectionId`; `sectionId` / `collectionStatusId` là field non-indexed (như
  `boardOrder`/`listOrder`, không cần đổi index cho chúng).
- **Upgrade callback:** task cũ backfill `collectionId = null` (giữ nguyên là sprint task). Không
  mất dữ liệu.
- Export/import: thêm `collections` vào payload; bump `ExportPayload.version`. Import file cũ vẫn work.

## Implementation
- **`db.ts`** — interface `Collection`/`Section`; `version(9).stores(...).upgrade(...)`;
  CRUD: `createCollection(projectId, name)`, `renameCollection`, `deleteCollection`,
  `addSection(collectionId, name)`, `renameSection`, `deleteSection`,
  `moveCollectionItem(taskId, sectionId, listOrder)` (đổi section + đặt lại thứ tự trong 1 update;
  tái dùng `orderBetween`/`renormalizeListOrder` sẵn có);
  `addStatus(collectionId, name, color)`, `renameStatus`, `recolorStatus`, `deleteStatus`;
  `addCollectionItem(collectionId, sectionId, patch)`; cập nhật export/import +
  `seedFresh` (seed status mặc định cho collection mới).
  > Lưu ý: `reorderCollection` và `reorderStatus` **không được implement** — status reordering bị descope.
- **`CollectionView.tsx`** — view (`list`/`calendar`) là **controlled prop** do `App.tsx` truyền
  từ top-bar toggle (không còn `tab` state nội bộ, không còn `Segmented` hay sub-header); identity
  (`CollectionBarIdentity`) + `StatusEditor` được export để top bar render. List render card-per-section **bám sát
  list-view của sprint**: cùng layout flex + bộ hằng `COL` (lead grip-gutter · dot · title flex-1 ·
  Start `w-28` · End `w-28` · Status `w-28`), cùng column-header `bg-canvas-sunk/40` + nhãn
  `text-[11px] text-ink-faint`, các row trong `divide-y divide-border`. **Title luôn ở chế độ sửa**
  (tap-to-edit qua `<textarea>` `field-sizing:content`, Enter để commit — không còn double-click).
  **Add item inline** (gõ + Enter ngay trong card, không dùng `window.prompt`). **Kéo-thả item =
  pointer-based** (dùng chung `useDragHandle`/`RowDrag` với sprint list): drag-owner sống ở
  `CollectionView` (bao trùm mọi SectionCard) để hit-test **xuyên bảng** — reorder trong bảng *và*
  chuyển section cùng một cử chỉ; item-row mang `data-item-id`, card mang `data-section-id`, thả
  vào vùng bảng rỗng = thả cuối bảng. Thứ tự natural sort theo `effOrder = listOrder ?? sequence`
  (khớp sprint). Drop gọi `moveCollectionItem`. Reorder chỉ bật khi sort = off. **Xoá item:** chấm-màu
  đầu dòng hoán thành `Trash2` khi hover row → `deleteTask` ngay. Status vẫn là pill click-to-assign
  (popover) theo bộ status per-collection.
- **`CollectionCalendar.tsx`** — month grid + lane packing + segment-theo-tuần + chevron đa tháng +
  Soft bar; nav tháng; dùng lại token màu status.
- **`App.tsx`** — sidebar mục SPRINTS / COLLECTIONS; tạo collection qua `NewCollectionDialog`
  (modal name-only, dùng lại layout của `NewSprintDialog`/`NewProjectDialog`); xoá collection
  (hover X + confirm); state
  container hiện tại (sprint vs collection) persist qua **hai** localStorage key:
  - `plan-up:selKind` — `'sprint'` | `'collection'`
  - `plan-up:selCollectionId` — ID của collection đang chọn
  - `plan-up:collectionView` — `'list'` | `'calendar'` (view của collection, lái bởi top-bar toggle)
  - Top bar dùng **một** `ViewToggle` adaptive (nhận `options` theo container) + render
    `CollectionBarIdentity` / `StatusEditor` bên phải khi `selKind === 'collection'`.
  - (Collapse state của từng section dùng `plan-up:collCollapsed:<collectionId>:<sectionId>`.)
- Tái dùng: `DatePickCell` (shared editable date), status pill, list card, drag-reorder.

## Rules & edge cases
- **Tạo collection** → tự có 1 section "All".
- **Add item** → vào section vừa bấm "Add item"; default `collectionStatusId` = status **đầu tiên**
  của collection (hoặc `null` nếu collection chưa có status nào), `startDate=today`, `dueDate=null`,
  `sprintId=null`.
- **Xoá status** đang được item dùng → confirm; item đó về `collectionStatusId=null` (hiện ô Status
  trống), không mất item. Không bắt buộc collection phải có ≥1 status.
- **Xoá section** còn item → confirm; item **dồn về section đầu** (không mất). Không cho xoá
  section cuối cùng (luôn còn ≥1).
- **Xoá collection** → confirm (liệt kê số item); xoá collection + toàn bộ item của nó (destructive,
  có confirm — theo §6.4 design-system).
- **Kéo-thả item** (pointer-based): reorder trong bảng đặt lại `listOrder`; chuyển sang bảng khác
  đổi `sectionId` + `listOrder` cùng lúc (`moveCollectionItem`). Arrangement — không log như task
  change-log. Chỉ bật khi sort = off (natural order).
- **Xoá item:** hover row → chấm-màu đầu dòng hoán thành nút thùng rác → xoá ngay (không confirm;
  item lẻ nhẹ). Khác với xoá bảng/status/collection (có confirm) vì mức độ thấp hơn nhiều.
- **Calendar:** lane assignment **deterministic** (sort start, dài-trước) để render ổn định.
- **Status không ràng buộc thời lượng** — item ở status nào cũng có thể 1 ngày hoặc nhiều ngày; item
  1 ngày hiện End "—".

## Future / open questions
- **Sắp xếp status** (drag-reorder) trong bộ status của collection — chưa build (descoped); có thể
  thêm sau nếu cần.
- Tô màu thanh Calendar **theo section** (thay vì theo status) — option sau.
- Lọc Calendar **theo status** (vd chỉ xem các item một status), hoặc ẩn một số status khỏi Calendar.
- Xoá collection: có nên cho **"move items sang collection khác"** trước khi xoá, thay vì xoá luôn?
- **Hợp nhất hoàn toàn** `sprints` vào một table `lists` (type=sprint|collection) — sạch hơn về
  mental model nhưng migration nặng (đổi `sprintId→listId` khắp nơi). Defer; bản này giữ `sprints`
  riêng, thêm `collections` song song.
