# Share link — read-only snapshot

**Status:** Implemented
**Last updated:** 2026-07-14 (payload rewritten to **compact v2** — columnar + enum +
member-index + date-as-day-offset, avatar-image dropped, dates **frozen**; **Import
feature removed** — viewer is now purely read-only)
**Code:** `app/src/share-snapshot.ts` (`buildSnapshot` + pack/encode/decode/parse,
pure) + `app/src/share-snapshot.test.ts`, `app/src/StatusPill.tsx` (shared read-only
status pill), `app/src/ShareLinkModal.tsx` (sender popover), `app/src/SnapshotViewer.tsx`
(recipient read-only view), `app/src/main.tsx` (boot intercept), `SprintPageHeader` +
`ShareLinkModal` wiring in `app/src/App.tsx`.
Dep: `lz-string`. Demo: `demo/share-link-snapshot.html` + review `demo/share-link-review-v2.html`.

## Purpose

Chia sẻ một sprint cho người khác **xem** mà không cần server, account, hay bắt họ
cài app — mở rộng lane "social" cạnh [copy-to-telegram.md](./copy-to-telegram.md)
(text) và [export-png.md](./export-png.md) (ảnh). Khác biệt: đây là **board tương
tác, read-only** dựng lại từ chính cái link. **Chỉ để xem** — không import, không
ghi gì vào máy người nhận.

Giữ đúng DNA local-first: **toàn bộ dữ liệu nằm trong URL fragment** (sau dấu `#`),
trình duyệt **không bao giờ gửi fragment lên server** → dù app host trên static
host, snapshot chỉ tồn tại trong trình duyệt của 2 người. Không backend, không DB
phía server, không auth.

## User-facing behavior

### Sender (người gửi)
- Nút **Share** (icon link) ở header sprint (`SprintPageHeader`), **ngay cạnh nút
  Copy** — cùng nhóm "share sprint này". Chỉ hiện khi sprint có task.
- Bấm → popover **"Share link"** (dùng `ModalSheet`, giống `CopyTelegramModal`):
  - **Summary line**: `{sprint.name} · {project.name}` + `{N} tasks · {M} members` +
    kích thước — người gửi biết chính xác đang gửi gì.
  - **Members checklist**: **luôn whole sprint**, mặc định tick hết; mỗi member 1 dòng
    (checkbox + avatar + tên + **số task**). Untick để bỏ member đó khỏi link; link
    "Chọn / Bỏ chọn tất cả". Task **không gán ai** luôn được giữ (không có member để
    untick). Bỏ hết member → còn task unassigned; hết sạch task → nút Copy khoá.
    (Không còn scope-chip từng-người, không còn preview "người nhận thấy" — viewer
    đã là read-only.)
  - **Link** read-only, **truncate giữa** (hiển thị gọn; Copy vẫn lấy full URL).
  - **Size meter**: `X KB / ~8 KB` — xanh khi vừa, đỏ khi vượt.
  - Nút **Copy link** → clipboard, đổi "Copied ✓" 1.4 s.
- **Quá lớn** (payload > ngưỡng ~8 KB): size meter chuyển **đỏ** + thẻ cảnh báo
  "một số chat cắt link dài; thu nhỏ scope theo 1 member hoặc tách sprint". Nút Copy
  đổi thành **"Copy link anyway"** — vẫn cho copy (tôn trọng user), không chặn cứng.
  Payload đã nén **compact v2** (xem *Data*) nên hiếm khi chạm ngưỡng; xuất `.html`
  không giới hạn size là **Future**.
- **Không có QR** (chốt 2026-07-14 — cân nhắc sau, xem Future).

### Recipient (người nhận)
- Mở URL `…/#v=2&s=<blob>` → app phát hiện fragment lúc boot → **không vào app
  thường**, render `SnapshotViewer`:
  - **Banner** đầu trang (nền accent-soft): 🔒 "Read-only snapshot · từ
    {project.name} · **snapshot {ngày}** (từ `data.exportedAt`) · dữ liệu của bạn
    không bị đụng tới". **Không có nút Import** — chỉ để xem.
  - **Pulse strip**: progress bar 3 màu + đếm `Done / In progress / To do` trên toàn
    sprint — đọc "sprint sao rồi" ngay đầu.
  - **Board đóng băng xếp giống Export PNG** (khung `PngExportCard`): **một bảng
    hairline** — Member gutter (rowSpan: avatar + tên + `done/total`) · cột **# ·
    Task · Start · End · Effort · Status**, đánh số liên tục 1..N, separator 2px giữa
    block member. Task: `↳` indent cho subtask, done gạch ngang, priority pill
    (`PRIORITY_TAG`), `◆ Milestone` khi effort 0. **Status = pill công thức List**
    (`StatusPill`, color-mix 15%/78% trên `STATUS_META`). Task trong mỗi lane (và
    subtask trong mỗi parent) **tự sort theo end date** (`byEnd`, undated cuối).
    Không edit, không ghi DB; data chỉ in-memory từ fragment.
- Link hỏng / giải mã lỗi → viewer hiện trạng thái "Link không hợp lệ hoặc đã hỏng"
  + nút mở plan-up bình thường. Không crash.

**Snapshot, không sync**: ngày/giờ **đóng băng** tại thời điểm copy (viewer hiện
đúng start/end đã tính sẵn, không chạy lại scheduling). Sender sửa sprint sau đó
**không** đổi link đã gửi (tradeoff có chủ đích — không làm realtime collab).

**Vì sao bỏ Import**: snapshot là ảnh chụp đóng băng, không phải "chuyển giao
project". Bỏ Import cho phép payload chỉ chở đúng field cần **hiển thị** (không cần
id thật, `dependsOn`, `estimate` để dựng lại project chạy được) → link nhỏ hơn nhiều
(xem *Data*). Người nhận muốn dùng thật thì tạo project của họ, không phải nhân bản
qua link.

## Data

Không thêm bảng. Payload **không** phải `ProjectBundle` nữa — vì viewer chỉ **hiển
thị** (không import), payload chỉ chở đúng field cần vẽ board.

**`SnapshotData`** — shape đã chuẩn hoá mà cả sender lẫn viewer dùng (in-memory):
`exportedAt`, `project {name}`, `sprint {name, startDate, endDate}`, `members[]`
(chỉ `name/color/avatarEmoji` — **bỏ `avatarImage`** vì data-URL ảnh nặng nhất
payload), `tasks[]` (chỉ field board vẽ: `title/status/priority/estimate/startDate/
dueDate/assigneeId/parentId`, id + assignee + parent đổi thành **index tổng hợp**
`m0..`/`t0..`, thứ tự mảng = thứ tự hiển thị nên `sequence` = index để `byEnd`
tie-break đúng). `buildSnapshot(...)` dựng thẳng shape này (chuẩn hoá luôn) nên
encode→decode là **round-trip thuần**.

**Wire format compact v2** (`packSnapshot` → JSON → lz-string): thay vì mảng object
lặp key, đóng gói **columnar** + mã hoá chặt:
- `mb`: `[[name, color, avatarEmoji], …]` (member 1 lần, task trỏ **index**).
- Task đóng thành các **cột song song** (mảng cùng độ dài N): `ti` titles,
  `ss` status **enum** (0 todo · 1 in_progress · 2 done), `pp` priority **enum**
  (`['none','low','normal','high','urgent']`), `am` assignee member-index (−1 =
  unassigned), `pa` parent task-index (−1 = top-level), `ef` estimate (`null` =
  không set, `0` = milestone), `s0`/`s1` start/end **day-offset** từ `sprint.startDate`
  (số nguyên ngày; `null` = không có). Ngày 10 ký tự `"2026-07-21"` co lại còn 1 số.
- Key biến mất khỏi từng task; status/priority/assignee/parent thành số; id 36-char
  bị loại. Kết quả: ~2–3× nhỏ hơn bundle cũ với cùng số task.

- **Encode**: `buildSnapshot(project, sprint, members, tasks, {memberId?})`
  (pure) dựng `SnapshotData` **từ data in-memory App đang render** (không đọc Dexie)
  → `encodeSnapshot` = `packSnapshot` → `JSON.stringify` →
  `lz-string.compressToEncodedURIComponent` → `#v=2&s=<blob>` (URL-safe). Parse
  ngược bằng `parseShareHash` **thủ công** (không `URLSearchParams`: blob chứa `+`
  sẽ bị biến thành space).
- **Decode**: `decodeSnapshot(blob)` → giải nén → `unpackSnapshot` dựng lại
  `SnapshotData` (offset → ngày yyyy-mm-dd, enum → status/priority, index → member/
  parent). Validate `v===2` + mảng cùng độ dài + index trong biên; sai → `null`.
  **Không** dựng lại project chạy được (không có scheduling input) — đúng bản chất
  "ảnh chụp".

## Implementation

- **`share-snapshot.ts`** (pure, no React/DOM — unit-test được):
  - `buildSnapshot(project, sprint, members, tasks, {memberId?}): SnapshotData`.
  - `encodeSnapshot(data: SnapshotData): string` → `packSnapshot` + lz-string blob.
  - `decodeSnapshot(raw: string): SnapshotData | null` → giải nén + `unpackSnapshot`
    + validate; `null` khi hỏng/không đúng shape (không throw ra ngoài).
  - `buildShareUrl(blob)` cho `#v=2&s=…`, `parseShareHash` tách blob.
  - Hằng `SHARE_MAX_BYTES` (~8 KB, conservative) — ngưỡng bật fallback;
    `SNAPSHOT_VERSION = 2`.
- **Boot intercept** trong `main.tsx`: đọc `window.location.hash`; nếu khớp
  `#v=…&s=…` → render `<SnapshotViewer raw=… />` thay cho `<App/>`. Không có router
  (app hiện là single-page) → đây là điểm rẽ nhánh duy nhất; route riêng nghĩa là
  "URL có fragment `s=`", không phải path.
- **`SnapshotViewer.tsx`**: `decodeSnapshot` → nếu null hiện trạng thái lỗi; nếu OK
  render banner + board read-only từ `SnapshotData` **in-memory** (không đọc Dexie).
  Không còn nút Import, không đụng `io`/Dexie.
- **`ShareLinkModal.tsx`**: mirror `CopyTelegramModal` (scope picker → đây là link
  field + size meter + fallback). Clipboard glue giống hệt (writeText + execCommand
  fallback).
- **`SprintPageHeader`** (`App.tsx`): thêm nút **Share** cạnh `onCopy`; state
  `shareOpen`; render `<ShareLinkModal>` với sprint/members/tasks hiện tại.
- **Dep mới**: `lz-string` (~3 KB) — import động nếu muốn giữ bundle web nhẹ.

## Rules & edge cases

- **Fragment không rời máy**: dữ liệu ở sau `#` — không gửi lên server; kể cả app
  chat fetch URL để dựng preview card cũng không thấy fragment (không lộ data,
  cũng không có rich preview).
- **Size gate**: URL thực tế an toàn ~8 KB (một số chat cắt link dài). Vượt ngưỡng
  → fallback `.html` file, **không** tạo link. Meter cảnh báo đỏ trước khi copy.
- **Untrusted input**: `decodeSnapshot` bọc `try/catch`, chặn payload quá dài
  (chống decompress bomb), validate shape trước khi render. Title/nội dung render
  bằng React như **text thuần** (React tự escape) — không `dangerouslySetInnerHTML`,
  không eval → không XSS từ nội dung link.
- **Read-only nghĩa đen**: viewer không mở Dexie, không import `db`/`io`; **không
  ghi gì** vào máy người nhận. Không còn Import.
- **Ngày đóng băng**: viewer hiển thị start/end đã tính sẵn (day-offset giải mã lại),
  **không** chạy `scheduling.ts`. Milestone (effort 0) vẫn hiện ngày ở cột Start,
  End để `—` như List/PNG.
- **Version**: payload gắn `v=2`; `decodeSnapshot`/`parseShareHash` từ chối version
  lạ. Link v1 cũ (bundle) không còn giải mã — chấp nhận được vì tính năng chưa phát
  hành.

## Future / open questions

- **Collection share-link**: cùng cơ chế, bundle thu hẹp về 1 collection; đặt trong
  **Export ▾** cạnh *Copy for Telegram* (collection không có page header). Phase 2.
- **Self-contained `.html` export**: hiện thực nhánh fallback "quá lớn" — xuất 1 file
  HTML tự chứa (viewer + bundle nhúng) gửi qua chat / host bất kỳ, không giới hạn
  size. Dùng chung `SnapshotViewer`.
- **QR**: tạm bỏ (2026-07-14). Nếu làm: render QR từ link cho scan tại chỗ (standup).
- **Expiry/obfuscate**: link không hết hạn (data nằm trong chính nó) — không có cơ
  chế thu hồi. Cân nhắc note rõ cho user khi share dữ liệu nhạy cảm.
