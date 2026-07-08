# Export as image (PNG)

**Status:** Planned
**Last updated:** 2026-07-08
**Code:** `app/src/png-export.ts`, `app/src/PngExportCard.tsx`, `app/src/ExportImageModal.tsx`, wired from `app/src/App.tsx`

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

- **Header ảnh:** tên project · tên view (Sprint N / tên collection) · ngày xuất.
- **Mỗi member = 1 section**, sắp theo `Member.order` (thứ tự lane trong List):
  - Hàng tiêu đề: avatar (ảnh/emoji/initial màu) + tên + `title` (role, nếu có)
    + đếm `x/y done` (mini).
  - Danh sách task của member đó, mỗi row:
    `#sequence · title · [status dot + label] · [priority chip] · due date`.
    Quá hạn (dueDate < hôm nay và chưa done) → ngày màu đỏ (`--color-overdue`).
- **Bucket "Unassigned"** (task `assigneeId === null`) xuống cuối, chỉ hiện khi có.
- Section không có task → **ẩn** (không in member rảnh việc cho đỡ nhiễu).
- Footer ảnh: "plan-up" watermark nhạt + tổng số task.

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

Xem [data-model.md](./data-model.md) cho `Task` / `Member`.

## Implementation

### `png-export.ts` (pure/glue, lazy import lib)

- `groupTasksByMember(tasks, members)` — pure: trả mảng `{ member | null, tasks }`
  đã sắp theo `order` (unassigned cuối), bỏ nhóm rỗng, task trong nhóm sắp theo
  `listOrder ?? sequence`. **Unit-tested.**
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
màu. Nhận `{ project, viewName, groups, today }`. Cố định bề rộng (≈ 720px)
cho khung ảnh ổn định. Palette light hard-code khớp token light:
accent `#0071e3`, ink `#1d1d1f`, muted `#6e6e73`, overdue `#ff3b30`,
status done `#34c759` / progress `#0071e3` / todo `#8e8e93`.

### `ExportImageModal.tsx`

`ModalSheet`. Render `PngExportCard` ẩn (off-screen, `ref`) + 1 bản preview thu
nhỏ (`transform: scale`). Nút Copy/Download gọi glue ở trên. Copy fail →
disable nút + hint "Trình duyệt không cho copy ảnh — dùng Download".

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
