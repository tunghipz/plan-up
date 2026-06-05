# Collections (task ngoài sprint)

**Status:** Planned
**Last updated:** 2026-06-05
**Code (planned):** `app/src/db.ts` (schema v9, `collections` table, CRUD),
`app/src/CollectionView.tsx` (List card-per-section), `app/src/CollectionCalendar.tsx`
(month grid + thanh liên tục), `app/src/App.tsx` (sidebar Sprints / Collections)

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
row (tên + số item). `+` cạnh "COLLECTIONS" → nhập tên → tạo collection mới. Đổi tên / xoá
collection từ row (hover) hoặc trong nó.

### Nhiều "bảng" (sections) trong một collection
Một collection chứa **nhiều bảng tự đặt tên** (sections), xếp dọc — tổng quát hoá đúng cơ chế
"card-per-group" của [list-view.md](./list-view.md) (sprint nhóm theo assignee; collection nhóm
theo section do user tạo). Mỗi bảng:
- Header: chấm màu + tên + đếm + collapse (click header) + ✎ đổi tên (hover) + ⋯ menu.
- Cột: **Name · Start · End · Status**. **Không** có Assignee / Effort / Prereq.
- "＋ Add item" riêng từng bảng; "＋ Add table" ở cuối để thêm bảng.
- Kéo-thả item **giữa các bảng** để chuyển section (dùng lại drag-reorder hiện có).

### Hai view: List | Calendar
Segmented control góc phải (chỉ 2 nút, **bỏ Board**).
- **List:** card-per-section như trên.
- **Calendar:** lịch tháng (Mon-start), **thanh event liền mạch** (xem phần Calendar bên dưới).

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
  `changeLog`/`boardOrder`, không cần đổi index cho chúng).
- **Upgrade callback:** task cũ backfill `collectionId = null` (giữ nguyên là sprint task). Không
  mất dữ liệu.
- Export/import: thêm `collections` vào payload; bump `ExportPayload.version`. Import file cũ vẫn work.

## Implementation (planned)
- **`db.ts`** — interface `Collection`/`Section`; `version(9).stores(...).upgrade(...)`;
  CRUD: `addCollection(name)`, `renameCollection`, `deleteCollection`, `reorderCollection`,
  `addSection(collectionId, name)`, `renameSection`, `deleteSection`, `moveTaskToSection`;
  `addStatus(collectionId, name, color)`, `renameStatus`, `recolorStatus`, `deleteStatus`,
  `reorderStatus`; `addCollectionItem(collectionId, sectionId, patch)`; cập nhật export/import +
  `seedFresh` (seed status mặc định cho collection mới).
- **`CollectionView.tsx`** — segmented List/Calendar; List render card-per-section (tái dùng
  group-card + COL của list-view, bỏ các cột scheduling; drag item giữa section).
- **`CollectionCalendar.tsx`** — month grid + lane packing + segment-theo-tuần + chevron đa tháng +
  Soft bar; nav tháng; dùng lại token màu status.
- **`App.tsx`** — sidebar mục SPRINTS / COLLECTIONS; state container hiện tại (sprint vs collection)
  + persist `plan-up:currentContainer` localStorage.
- Tái dùng: `DatePicker.tsx`, status pill, list card, drag-reorder.

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
- **Kéo-thả item** giữa section: chỉ đổi `sectionId` (arrangement, không log như drag-reorder list).
- **Calendar:** lane assignment **deterministic** (sort start, dài-trước) để render ổn định.
- **Status không ràng buộc thời lượng** — item ở status nào cũng có thể 1 ngày hoặc nhiều ngày; item
  1 ngày hiện End "—".

## Future / open questions
- Tô màu thanh Calendar **theo section** (thay vì theo status) — option sau.
- Lọc Calendar **theo status** (vd chỉ xem các item một status), hoặc ẩn một số status khỏi Calendar.
- Xoá collection: có nên cho **"move items sang collection khác"** trước khi xoá, thay vì xoá luôn?
- **Hợp nhất hoàn toàn** `sprints` vào một table `lists` (type=sprint|collection) — sạch hơn về
  mental model nhưng migration nặng (đổi `sprintId→listId` khắp nơi). Defer; bản này giữ `sprints`
  riêng, thêm `collections` song song.
