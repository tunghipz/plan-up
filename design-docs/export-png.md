# Export as image (PNG)

**Status:** Implemented
**Last updated:** 2026-07-09 (sprint PNG: member sections → one hairline table, member
gutter column rowspan + continuous numbering — option B of `demo/export-table-layout.html`)
**Code:** `app/src/png-export.ts` (shared render/copy/download glue), sprint card
`app/src/PngExportCard.tsx` + `app/src/ExportImageModal.tsx` (wired from `App.tsx`),
collection card `app/src/CollectionPngCard.tsx` + `app/src/CollectionImageModal.tsx`
(wired from the context-aware Export ▾ menu in `App.tsx`)

## Collection variant

Collections export the same "one PNG for chat" but section-shaped: `CollectionPngCard`
renders each section as a `Name · Start · End · Status` table (custom-status pills
tinted from `CollectionStatus.color`; nested subtasks), no Effort/Assignee/prereq
columns. `CollectionImageModal` reuses the same modal shell + `png-export.ts` glue.
The text sibling (Copy for Telegram) lives in the same Export ▾ menu — see
[copy-to-telegram.md](./copy-to-telegram.md).

## Purpose

Bàn giao / nhắc việc cho member nhanh bằng **một tấm ảnh** dán thẳng vào chat
(Zalo/Slack/Telegram) — không cần gửi link hay bắt member mở app. Ảnh liệt kê
task của view đang xem, **gom nhóm theo người được giao**, để mỗi người thấy
ngay phần của mình.

Đây là bổ sung "share nhẹ" bên cạnh export/import JSON (backup) và per-project
export (bàn giao dữ liệu). PNG là *người đọc*, JSON là *máy đọc*.

## User-facing behavior

- Menu **Export** (header dropdown) có thêm mục **"Export as image…"** (icon
  `Image`), đặt trên cùng nhóm — vì đây là hành vi share thường dùng nhất.
- Bấm → mở **modal preview** (ModalSheet):
  - Vùng preview render đúng tấm ảnh sẽ xuất (thu nhỏ vừa khung).
  - Nút **Copy image** — copy PNG vào clipboard (dán thẳng vào chat). Hiện
    trạng thái "Copied ✓" 2s.
  - Nút **Download PNG** — tải file `plan-up-<tên view>-<yyyy-mm-dd>.png`.
  - Nút **Done** đóng modal.
- Ảnh **luôn dùng theme sáng** bất kể app đang light/dark — ảnh gửi đi cần
  đoán trước được và đọc rõ trên nền chat.

### Nội dung ảnh

- **Header ảnh:** tên project · tên view (Sprint N) · ngày xuất · tổng số task.
- **Thứ tự khớp List view 1:1**: lanes sắp theo `compareMembersByOrder`; task
  trong lane sắp bằng `compareTasks` theo **đúng sort đang chọn** (`loadSort()`,
  mặc định neutral → `listOrder ?? sequence`); subtask nest dưới parent qua
  `flattenDisplayOrder`. Cùng dùng module `task-sort.ts` với List (tách ra từ
  SprintView) nên không lệch. Task có assignee đã xoá → rơi vào Unassigned
  (giống orphan lane của List).
- **Một bảng duy nhất kiểu Cupertino hairline** (2026-07-09, option B của
  `demo/export-table-layout.html`; thay layout cũ mỗi-member-1-card):
  - **Column header** (in hoa nhạt): MEMBER · # · TASK · START · END ·
    EFFORT (DAY) · STATUS. Không cột Assignee riêng (member là gutter),
    không Prereq.
  - **Cột Member bên trái rowspan** cho cả block task của member (sắp theo
    `Member.order` như lane List): avatar 24px + tên đậm, dưới là dòng stats
    nhỏ `done/total done` (leaf tasks, bỏ parent), thêm chip đỏ `N overdue`
    khi >0 và `Nd off` nhạt khi có days off trong sprint range
    (`effectiveDaysOff` / `daysOffInRange`). Không còn progress ring / next due.
  - **`#` là số thứ tự liên tục toàn ảnh** (1..N theo thứ tự in), KHÔNG phải
    `Task.sequence` — để đọc/điểm danh nhanh trong chat.
  - Kẻ: **không kẻ dọc**; hairline ngang 1px giữa row; **vách nhóm 2px xám
    (#c9c9cf)** ở row đầu mỗi member (trừ nhóm đầu — thead border đảm nhiệm).
  - Row task: `# · title[+ pill/tag] · start · end · effort · status`.
    - **Title** kèm **Priority pill** (chỉ `urgent`/`high` — đúng
      `PRIORITY_TAG`), **◆ Milestone tag** (khi `estimate === 0`),
      **subtask thụt lề** (`↳`, khi parent nằm cùng lane).
    - **Effort** = `fmtDays(estimate)` số trần, căn giữa; milestone (0) & chưa
      ước lượng (null) → `—`.
    - **Start / End** = ngày computed từ scheduling (`computeAllWorkingPlans`
      → `WorkingPlan.startDate/dueDate`), in kiểu ngắn `Jun 15`. Milestone:
      Start = mốc, End = `—`.
    - **Status** = dot + label (To do / In progress / Done), pill soft-tint.
    - Quá hạn (End < hôm nay và chưa done; milestone dùng Start) → ngày đỏ.
- **Bucket "Unassigned"** (task `assigneeId === null` hoặc member đã xoá) xuống
  cuối, chỉ hiện khi có; gutter avatar `?` xám, stats chỉ `done/total`.
- Section không có task → **ẩn** (không in member rảnh việc cho đỡ nhiễu).
- Footer ảnh: "Made with plan-up" watermark nhạt.

## Data

Chỉ **đọc**, không ghi DB. Nguồn:

- `tasks` của **sprint đang xem** (`db.tasks.where('sprintId')`) — dùng đúng mảng
  `tasks` App đã load. **v1 chỉ hỗ trợ sprint view.** Collection dùng custom
  status (`collectionStatusId`) khác model `Status` nên để Future; menu item
  disable khi đang ở collection view.
- `paletteMembers` (members của project) để resolve `assigneeId` → tên/avatar/màu,
  và `Member.order` để sắp section.
- `currentProject`, `currentSprint`/collection cho header ảnh.
- Status/priority nhãn: `STATUS_LABEL` / `PRIORITY_LABEL` (`lib.ts`).
- **Start/End dates:** `computeAllWorkingPlans(tasks, tasksById, memberById)`
  (`scheduling.ts`) → `Map<taskId, WorkingPlan>`, tính khi mở modal và truyền
  vào card. Effort đọc thẳng `Task.estimate` (`fmtDays`).

Xem [data-model.md](./data-model.md) cho `Task` / `Member`.

## Implementation

### `png-export.ts` (pure/glue, lazy import lib)

- `groupTasksByMember(tasks, members, opts?)` — pure: trả mảng `{ member | null,
  tasks }` khớp List (member order, `compareTasks` theo `opts.sort`, nest
  subtask khi `opts.nestChildren`, unassigned cuối, bỏ lane rỗng). Reuse
  `compareTasks`/`buildDateSortKeys` từ `task-sort.ts` + `flattenDisplayOrder`
  từ `lib.ts`. **Unit-tested.**
- `pngFilename(viewName, dateISO)` — slug an toàn + ngày local.
- `renderNodeToPng(node, scale=2)` — dynamic `import('modern-screenshot')`
  → `domToPng(node, { scale, backgroundColor: '#ffffff' })`; trả data-URL.
- `copyPngToClipboard(node)` — `domToBlob` → `navigator.clipboard.write([
  new ClipboardItem({ 'image/png': blob })])`; trả `boolean` (false nếu trình
  duyệt chặn / không hỗ trợ → UI fallback sang Download).
- `downloadPng(dataUrl, filename)` — anchor click.

### `PngExportCard.tsx`

Component **thuần trình bày**, **inline style bằng hex** (không dùng class
Tailwind / CSS var / oklch) để screenshot không phụ thuộc cascade và không vỡ
màu. Nhận `{ project, viewName, groups, planById, sprintStart/End, today }`.
Cố định bề rộng (≈ 940px) cho khung ảnh ổn định. Render bằng **HTML `<table>`
+ `rowSpan`** (không grid) — member gutter span đúng số row của block.
Palette light hard-code khớp token light: accent `#0071e3`, ink `#1d1d1f`,
muted `#6e6e73`, overdue `#ff3b30`, status done `#34c759` / progress
`#0071e3` / todo `#8e8e93`. Không còn group box glass rim (layout cũ) —
bảng phẳng trên nền trắng.

### `ExportImageModal.tsx`

`ModalSheet`. Render `PngExportCard` ẩn (off-screen, `ref`) + 1 bản preview
qua **`ScaledPreview`** (`ScaledPreview.tsx`, dùng chung với
`CollectionImageModal`): đo bề rộng khung bằng ResizeObserver rồi `zoom =
width/cardWidth` — card luôn khít khung (scale lên/xuống đều được, zoom
re-rasterize DOM không mờ), thay zoom hard-code cũ bị lệch khi đổi bề rộng
card. Nút Copy/Download gọi glue ở trên. Copy fail → disable nút + hint
"Trình duyệt không cho copy ảnh — dùng Download".

### Wiring `App.tsx`

- State `exportImageOpen`. Menu item mới trong dropdown Export (App.tsx ~1489).
- Truyền `tasks`, `paletteMembers`, `currentProject`, tên view (sprint/collection).
- Chỉ mở được khi có view + có task (disable + hint nếu rỗng).

### Dependency

`modern-screenshot` (deps, dynamic-imported → không phình initial bundle). Chọn
thay `html2canvas` vì html2canvas đời cũ không parse `oklch()`; và vì ta render
card inline-hex riêng nên rủi ro thấp.

## Rules & edge cases

- **Theme:** ảnh luôn light. App dark vẫn ra ảnh sáng.
- **Avatar image** là data-URL sẵn trong DB → nhúng trực tiếp, screenshot không
  cần fetch mạng (modern-screenshot vẫn safe nếu có).
- **Clipboard** cần secure context (https / localhost / Tauri). Không hỗ trợ →
  ẩn/disable Copy, vẫn Download được.
- **View rỗng / chưa chọn sprint** → menu item disabled.
- **Task rất nhiều** → ảnh dài (không phân trang v1); chấp nhận, ghi vào Future.
- Không đọc file ảnh vào hội thoại khi verify (theo CLAUDE.md) — verify bằng
  DOM/text: đếm section, đếm row, assert số.

## Future / open questions

- **Collection view** (custom statuses) — xuất ảnh riêng cho collection.
- Chọn lọc member trước khi xuất (checkbox) / xuất mỗi member 1 ảnh riêng.
- Phân trang ảnh khi quá dài (A4 tiles).
- Tuỳ chọn theme tối cho ảnh.
- Xuất cả Board/Gantt snapshot.
