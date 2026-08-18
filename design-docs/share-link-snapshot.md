# Share link — read-only snapshot

> **Companion:** [hosted-share-link.md](./hosted-share-link.md) adds a SECOND share mode —
> a short, updatable `…/view/<slug>-<id>` link backed by a store. This doc describes the
> original **in-URL fragment** link, which is now the **offline fallback** for that mode
> (still fully functional on its own). The pure encode/decode + both viewers here are reused
> verbatim by the hosted mode.

**Status:** Implemented
**Last updated:** 2026-08-18 (+ **fix từ `/review`**: chặn vòng lặp vô hạn khi span
đi quá 9999-12-31 — `hd` là thứ đầu tiên đẩy ngày do người ngoài kiểm soát vào
`holidayLoadInSpan`, và một link 168 ký tự khoá cứng tab; `decodeSnapshot` giờ không
throw nữa; `hd` **clip** theo range nên nhãn và số khớp nhau; bỏ `half` thừa; sort;
cap số dòng; chip có truncate; PNG đổi sang `C.muted` cho đủ contrast; hai bề mặt dùng
chung `holidayChipParts`; thống nhất tiếng Anh. Xem *Ngày nghỉ chung*.
Trước đó cùng ngày: **ngày nghỉ chung của project lên share page** — payload
trước giờ chở `membersOff` (ngày nghỉ *riêng từng người*) nhưng **không** chở project
holidays, nên người nhận link thấy task kéo dài mà không biết vì sao. Thêm wire key
**`hd`** (optional, **không bump version** — theo đúng tiền lệ của `mo`) + một khối trong
**Sprint card** ở rail trái. Chọn *phương án A · cấp project* trong 4 phương án của
`demo/holiday-on-share-page.html`: nói đúng một lần, ngay dưới khoảng ngày, **bảng không
đụng tới**. Xem *Ngày nghỉ chung* bên dưới.) Trước đó: 2026-08-17 (**task title wrap thay vì cắt bằng "…"** — cột Task dùng
`truncate` (1 dòng + ellipsis) trong table `tableLayout: 'fixed'`. Card bảng bị chặn ~892px
(`max-w-[1240px]` + rail 300px, kể cả trên màn 27″) → cột Task chỉ còn ~392px, nên title dài
mất chữ **vĩnh viễn** với người nhận: không hover ra được, và Export PNG chụp đúng bản đã cắt.
Đổi sang **wrap tự do** — title `flex-1 min-w-0 [overflow-wrap:anywhere]`, và hàng title đổi
`items-center → items-start` để priority pill / `◆ Milestone` bám **dòng đầu** thay vì trôi ra
giữa khối 2 dòng. Row cao thấp không đều là tradeoff có chủ đích: mất chữ tệ hơn mất nhịp; các
phương án clamp-2-dòng + tooltip bị loại vì tooltip không cứu được Export PNG. Đối chiếu 5
phương án (kèm số đo cột Task ở từng bề rộng): `demo/share-long-title.html`. *Chưa áp:*
`CollectionSnapshotViewer` (bảng collection, `truncate` cùng kiểu) và `PngExportCard` vẫn cắt.
Trước đó: 2026-07-16 — **parent date span is rolled up at build** — a group head's OWN
dates are ignored in-app (the scheduler spans the children: earliest child start … latest child
due), so a container's raw stored dates [often null] made the share page show "—" while the
sprint shows the span. `buildSnapshot` now bakes `startDate = min(child.startDate)`,
`dueDate = max(child.dueDate)` for a parent [`rollupDates`, mirrors `planFor`], frozen from the
FULL child set. Completes the parent-rollup trio (status + effort + dates), all baked the same
way. Earlier same-day: **parent effort is rolled up at build** — a group head is a
container with no own `estimate`, so the share page showed "—" for effort while the sprint
shows the **sum of children's effort**. `buildSnapshot` now bakes `estimate = hasEffort ?
sum(child.estimate ?? 0) : null` for a parent [`rollupEffort`, mirrors SprintView `GroupRow`],
frozen from the FULL child set like the status rollup — so a trimmed share still shows the right
total. Earlier same-day: **days-off range covers task spans + inline meta** — off-days
were clamped to the sprint window, so a task dated past the sprint end [e.g. a rolled-over
`Jul 16 → Jul 17` task] dropped its overlapping off-day and the gutter showed nothing at all
[not a "too few tasks" layout issue — the day was never in the data]. `buildSnapshot` now
captures each member's off-days within `[min(sprintStart, that member's earliest scoped task
start) … max(sprintEnd, latest task end/due)]`, so any off-day overlapping shown work is carried.
And the recipient gutter folds the off summary onto the **same faint line as `done`** —
`0/1 done · 0.5d off [Jul 16 ½AM]` — so it reads even for a member with a single short row
[no stacked block that depends on gutter height]. Demo: `demo/share-dayoff-fewtasks.html`.
Earlier same-day: **review fixes** — a tech-lead pass on the meta work found two
correctness bugs, both fixed: (1) a parent task's status is now the **rolled-up** status
(`derivedGroupStatus` rule, inlined in `buildSnapshot` since `sprint-logic` pulls in Dexie),
**frozen at build from the FULL child set** — so a trimmed share [where a child is dropped]
still shows the status the sender saw, and the viewer just renders `t.status` [no viewer-side
derive]; (2) the Progress donut now counts **leaf tasks only** [parents excluded], matching the
app's leaf-based pulse + this file's own per-member `done/total` — before, group containers were
double-counted, inflating the denominator. Also: `mo` encode drops unparseable dates + derives
half via `HALF_CODE` [one source both ways]; note-overflow re-measures via `ResizeObserver` +
resets on note change [rail is 300px on lg, full-width stacked below]; added backward-compat +
malformed-`mo` + pm-half-day + parent-rollup tests. Earlier same-day: **days-off detail — dates + half-days (Fix A)** — the days-off
info went from a bare count to the **actual off dates**. The snapshot now carries, per member,
the list of `{date, half?}` entries falling within the sprint range [not just the effective
count]; the recipient renders them as **date chips** grouped under a `"Nghỉ <N> ngày"` label
[the effective count is the group heading, so count ↔ dates read as one block], and a half-day
chip is tagged `½ sáng/chiều` so the fractional total is traceable. Wire `mo` changed shape:
`number[]` [per-member count] → **`[dayOffset, halfCode][][]`** [per member, a list of
`[offset-from-d0, 0=full·1=am·2=pm]`]; the effective count is re-derived in the viewer via
`effectiveDaysOff`. This shape change is safe — the previous `mo` count only existed in
uncommitted work, never shipped; blobs ≤v0.0.47 carry no `mo` at all → empty off list.
Demo: `demo/share-dayoff-v2-fix.html` [variant A]. Earlier same-day: **recipient meta polish**
— the newly-carried title/note/days-off
got a UX pass in `SnapshotViewer`: member gutter merges the two stats onto ONE dot-separated
line [superseded by the chips above for days-off], the role `title` renders at 13.5→**11.5px
`ink-muted`** paired under the name [identity, not a stat], and a 100%-done ratio tints green
[`--color-status-done`, DNA §2.3]. The Sprint card's note gets a hairline separator + a
**"Mục tiêu"** micro-label [matches the card's own "Sprint" eyebrow], bumps to 13px/`leading-relaxed`,
and **clamps to 5 lines** with a "Xem thêm/Thu gọn" toggle so a long goal can't push
Progress/Actions below the fold in the sticky rail. Demo: `demo/share-meta-review.html`.
Earlier same-day: **member days-off in snapshot** — the per-member off info
first travelled here [initially as a rolled-up count, since replaced by the date list above].
Earlier same-day: **sprint note in snapshot** — the optional sprint-goal note
[`Sprint.note`] now travels in the snapshot and renders under the sprint name in the
recipient's Sprint card. Was dropped [`buildSnapshot`/`packSnapshot` only carried
`name/startDate/endDate`], so the share page never showed the goal. Wire gains an optional
`nt` key; **backward-compatible** — old blobs without it decode `note` as `undefined`.
Earlier same-day: **member title in snapshot** — the optional member role
label [`Member.title`, e.g. "Backend Engineer"; see member-title.md] now travels in the
sprint snapshot and renders under the member's name in the recipient board. Was silently
dropped at three layers [`normMember`, the packed `mb` wire row, `SnapshotViewer`], so the
share page never showed a title. Wire `mb` grows a 4th cell `[name, color, avatarEmoji|'',
title|'']`; **backward-compatible** — old blobs with 3-cell rows decode `title` as
`undefined`. Collections carry no members, so unaffected.) Earlier 2026-07-15 (**viewer left-rail layout** — applied to **BOTH** recipient
viewers [sprint `SnapshotViewer` + collection `CollectionSnapshotViewer`, kept in sync]:
recipient page moved from a
centered single column [`max-w-3xl`, empty flanks on wide screens] to a **2-column grid**
[`max-w-[1240px]`]: a **sticky left rail** [~300px] now holds all the meta that used to
stack across the top — brand + Read-only chip, Sprint card [name/project + date range],
a **Progress donut** [replaces the horizontal pulse strip: ring with % done in the
center + vertical legend], and the actions [dark toggle · Export PNG · Mở plan-up]. The
task table gets the whole right column [wider, less vertical scroll]. Stacks back to one
column below `lg` [<1024px] so mobile is unchanged in spirit. The floating glass-toolbar
capsule + full-width sprint breadcrumb are **gone** — their content lives in the rail.
Demo: `demo/snapshot-flanks-layout.html` [layout A]. Earlier 2026-07-15: **collections
share-link** — new `v=3` snapshot format +
`CollectionShareModal` [trim by section] + `CollectionSnapshotViewer` [List + Calendar];
Share button on the collection top bar next to Export; see "Collections (v3)" below.
Earlier 2026-07-14: sender modal **removed the size readout** — the "Link size"
meter + summary KB chip are gone; only a warning banner shows when the link is over the
threshold. `SHARE_MAX_BYTES` recomputed `8000` → **`4000`** chars: the blob is in the URL
fragment [not sent to a server], so the paste target [Telegram ~4096/message] is the real
limit, not the browser. Earlier same-day: viewer header re-arranged — capsule is now **2 zones**
[brand · actions]; the sprint moved to a **full-width breadcrumb line below** the
capsule so its name/date **never truncate or overlap** the Read-only chip / actions
on narrow widths [arrangement A]; the body's `md:hidden` sprint header is gone.
Earlier same-day: sender modal footer got an **Open** button next to Copy — opens the
built read-only link in a new tab to preview it; fixed stale refs after the
sprint-header **Copy for Telegram** button was removed; viewer header redesigned as a
branded glass bar + **Export PNG** button reusing the app's
`ExportImageModal`/`PngExportCard` + **dark-mode toggle** (`useDarkMode`); payload
compact v2 + Import removed)
**Code:** `app/src/share-snapshot.ts` (`buildSnapshot` + pack/encode/decode/parse,
pure) + `app/src/share-snapshot.test.ts`, `app/src/StatusPill.tsx` (shared read-only
status pill), `app/src/ShareLinkModal.tsx` (sender popover), `app/src/SnapshotViewer.tsx`
(recipient read-only view — opens `ExportImageModal` for PNG), `app/src/main.tsx`
(boot intercept), `SprintPageHeader` + `ShareLinkModal` wiring in `app/src/App.tsx`.
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
- Nút **Share** (icon link) ở header sprint (`SprintPageHeader`), cạnh tiêu đề
  sprint — action duy nhất ở đây (nút Copy-for-Telegram đã gỡ 2026-07-14). Chỉ
  hiện khi sprint có task.
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
  - **Không hiển thị size** (bỏ 2026-07-14). Trước đây có "Size meter" `X KB / ~8 KB`
    + chip KB ở dòng summary; đã gỡ cả hai vì con số dung lượng chỉ gây nhiễu — link
    chạy tốt vượt xa giới hạn trình duyệt, cái duy nhất đáng cảnh báo là chat cắt cụt.
    Chỉ còn **thẻ cảnh báo** khi vượt ngưỡng (xem "Quá lớn" bên dưới).
  - **Footer 2 nút**: **Open** (ghost, icon external-link) mở link read-only vừa
    dựng trong **tab mới** (`window.open`, noopener) để tự preview cái người nhận
    sẽ thấy; **Copy link** (primary brand) → clipboard, đổi "Copied ✓" 1.4 s. Cả
    hai khoá khi sprint rỗng.
- **Quá lớn** (payload > ngưỡng `SHARE_MAX_BYTES` = **4000 ký tự**): bung thẻ cảnh báo
  "một số chat (Telegram/Zalo) có thể cắt cụt; bỏ tick member nặng hoặc tách sprint".
  Nút Copy đổi thành **"Copy link anyway"** — vẫn cho copy (tôn trọng user), không chặn cứng.
  Payload đã nén **compact v2** (xem *Data*) nên hiếm khi chạm ngưỡng; xuất `.html`
  không giới hạn size là **Future**.
- **Không có QR** (chốt 2026-07-14 — cân nhắc sau, xem Future).

### Recipient (người nhận)
- Mở URL `…/#v=2&s=<blob>` → app phát hiện fragment lúc boot → **không vào app
  thường**, render `SnapshotViewer`:
  - **Layout = 2 cột** (`max-w-[1240px]`, giữa canvas): **rail trái sticky** (~300px)
    + **bảng chiếm cột phải** (rộng, cuộn dọc ngắn hơn). Dưới `lg` (<1024px) rail
    **xếp lại thành 1 cột trên bảng** (mobile như cũ). *(Quyết định 2026-07-15,
    arrangement A: bản cũ là 1 cột căn giữa `max-w-3xl` → màn rộng trống 2 bên; dồn
    meta vào rail trái để lấp flank + cho bảng thở. Bỏ hẳn capsule glass-toolbar nổi
    + dòng breadcrumb full-width — nội dung của chúng chuyển vào rail.)*
  - **Rail trái** (sticky `top`, các khối xếp dọc):
    - **Brand + read-only**: **app icon** (`/favicon.svg`) + wordmark **plan-up** +
      subline "shared snapshot · {ngày}" (từ `data.exportedAt`); **dark-mode toggle**
      (Sun/Moon) nằm cuối hàng brand; chip **🔒 Read-only** ngay dưới.
    - **Sprint card** (`glass-card`): label `SPRINT` + `📋 {sprint.name} ·
      {project.name}` + pill ngày `{range}` (start → end, `whitespace-nowrap`) +
      **khối ngày nghỉ chung** (chỉ khi có) — xem *Ngày nghỉ chung*.
    - **Progress card** (`glass-card`, chỉ khi có task): label `PROGRESS` + **donut**
      (ring 3 màu theo `PULSE_ORDER`, tâm hiện **% done** + "done") + **legend dọc**
      (`{N} tasks` + Done / In progress / To do, số căn phải). *(Thay cho pulse strip
      ngang cũ — donut hợp cột hẹp hơn, đọc "% done" ngay.)*
    - **Actions**: **Export PNG** (`brand-btn`, full-width) + **Mở plan-up** (ghost
      accent, full-width). **Không có Import** — chỉ để xem.
  - **Dark mode**: viewer chạy `useDarkMode` (init theo `prefers-color-scheme` của
    người nhận, hoặc `plan-up:dark` đã lưu; toggle `.dark` trên `<html>` + lưu lại).
    Toàn bộ token, `ambient-canvas`, `glass-card` (màn lỗi), pulse, `StatusPill` đều
    theme-aware. **Không** chạy `useBrandTheme` → accent = blue mặc định (không fire
    gradient), khớp bản đã ship.
  - **Export PNG**: mở `ExportImageModal` (dùng lại của app) → `PngExportCard` render
    đúng bảng member-gutter, có **Copy image** + **Download PNG** + preview thu nhỏ.
    Vì snapshot **đóng băng ngày**, viewer truyền `planById` **rỗng** → card fallback
    về `startDate/dueDate` đã đóng băng trên task; `today` = ngày snapshot
    (`exportedAt`, dùng cho stamp + so overdue "tại thời điểm chụp").
  - **Board = 1 glass card** (`.glass-card` bo 18px) ở cột phải, nổi trên
    `ambient-canvas` (DNA §4.1), chứa **bảng + watermark** (pulse đã chuyển sang
    Progress card ở rail trái — board không còn strip đầu bảng).
  - **Board đóng băng xếp giống Export PNG** (bảng hairline như `PngExportCard`, trên
    màn bọc trong glass card; PNG xuất ra vẫn là card trắng riêng): **một bảng
    hairline** — Member gutter (rowSpan: avatar + tên + `done/total`) · cột **# ·
    Task · Start · End · Effort · Status**, đánh số liên tục 1..N, separator 2px giữa
    block member. Task: `↳` indent cho subtask, done gạch ngang, priority pill
    (`PRIORITY_TAG`), `◆ Milestone` khi effort 0. **Status = pill công thức List**
    (`StatusPill`, color-mix 15%/78% trên `STATUS_META`). Task trong mỗi lane (và
    subtask trong mỗi parent) **tự sort theo end date** (`byEnd`, undated cuối).
    Không edit, không ghi DB; data chỉ in-memory từ fragment.
  - **Title dài → xuống dòng, không bao giờ cắt** (2026-08-17). Cột Task hẹp (~392px do
    `max-w-[1240px]` + rail 300px), nên title `flex-1 min-w-0 [overflow-wrap:anywhere]`
    và **không** `truncate`. Hàng title là `items-start` (không phải `items-center`) để
    priority pill / `◆ Milestone` neo ở **dòng đầu** khi title chạy 2+ dòng. Lý do bỏ
    ellipsis: người nhận share link **không có cách nào** lấy lại phần chữ mất (không phải
    app của họ, không hover ra full text), và Export PNG đóng băng đúng khung hình đã cắt.
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
`exportedAt`, `project {name}`, `sprint {name, startDate, endDate, note?}`, `members[]`
(chỉ `name/color/avatarEmoji/title` — **bỏ `avatarImage`** vì data-URL ảnh nặng nhất
payload), `tasks[]` (chỉ field board vẽ: `title/status/priority/estimate/startDate/
dueDate/assigneeId/parentId`, id + assignee + parent đổi thành **index tổng hợp**
`m0..`/`t0..`, thứ tự mảng = thứ tự hiển thị nên `sequence` = index để `byEnd`
tie-break đúng), `membersOff` (mảng `{date, half?}` off/member trong range sprint — song song
`members`, trim lúc build), `holidays` (mảng `Holiday` của project **giao với range sprint** —
xem *Ngày nghỉ chung*). `buildSnapshot(...)` dựng thẳng shape này (chuẩn hoá luôn) nên
encode→decode là **round-trip thuần**.

**Wire format compact v2** (`packSnapshot` → JSON → lz-string): thay vì mảng object
lặp key, đóng gói **columnar** + mã hoá chặt:
- `mb`: `[[name, color, avatarEmoji, title], …]` (member 1 lần, task trỏ **index**;
  `avatarEmoji`/`title` là `''` khi trống. Blob cũ 3 ô đọc `title`→`undefined`, tương thích ngược).
- `nt`: sprint-goal note (optional; vắng khi sprint không có note. Blob cũ thiếu key → `undefined`).
- `mo`: `[dayOffset, halfCode][][]` — mỗi member 1 mảng ngày off trong range sprint, mỗi entry
  `[offset từ d0, 0=cả ngày · 1=sáng · 2=chiều]`. Viewer decode ra `{date, half?}`, tự tính số
  ngày hiệu dụng (`effectiveDaysOff`) + vẽ chips. Blob cũ thiếu `mo` → mảng rỗng (không có off).
- `hd`: `[fromOffset, toOffset, halfCode, name][]` — ngày nghỉ **chung cả project**, đã
  **clip** vào range sprint (nên offset **không bao giờ âm**; xem *Clip* bên dưới).
  `halfCode` dùng chung bảng `HALF_CODE` với `mo`. **Optional, `v` vẫn = 2** — y hệt
  cách `mo` từng được thêm: blob cũ thiếu `hd` → mảng rỗng, và viewer đời cũ đọc blob mới chỉ
  đơn giản bỏ qua key nó không biết. Không cần bump version, không cần đường đọc tương thích.
  Lúc decode: cap **64 dòng** (`MAX_HOLIDAYS`) và `half` chỉ sống sót khi `from === to`.
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
  - Hằng `SHARE_MAX_BYTES` (**4000 ký tự**, sát Telegram 4096) — ngưỡng bật cảnh báo;
    `SNAPSHOT_VERSION = 2`.
- **Boot intercept** trong `main.tsx`: đọc `window.location.hash`; nếu khớp
  `#v=…&s=…` → render `<SnapshotViewer raw=… />` thay cho `<App/>`. Không có router
  (app hiện là single-page) → đây là điểm rẽ nhánh duy nhất; route riêng nghĩa là
  "URL có fragment `s=`", không phải path.
- **`SnapshotViewer.tsx`**: `decodeSnapshot` → nếu null hiện trạng thái lỗi; nếu OK
  render header bar 3 vùng + board read-only từ `SnapshotData` **in-memory** (không
  đọc Dexie). Không còn nút Import, không đụng `io`/Dexie. Nút **Export PNG** mở
  `ExportImageModal` với `groups = groupTasksByMember(tasks, members, {nestChildren})`,
  `planById` rỗng (ngày đã đóng băng), `today` = `exportedAt` (yyyy-mm-dd) →
  ảnh PNG **giống hệt** Export PNG trong app.
- **`ShareLinkModal.tsx`**: scope picker (members checklist) + link field + size
  meter + fallback. Clipboard glue (writeText + execCommand fallback). Footer =
  **Open** (`window.open(url, '_blank', 'noopener,noreferrer')`) + **Copy link**.
- **`SprintPageHeader`** (`App.tsx`): nút **Share** cạnh tiêu đề (prop `onShare`);
  state `shareOpen`; render `<ShareLinkModal>` với sprint/members/tasks hiện tại.
- **Dep mới**: `lz-string` (~3 KB) — import động nếu muốn giữ bundle web nhẹ.

## Ngày nghỉ chung (project holidays)

**Vấn đề:** payload chở `membersOff` — ngày nghỉ *riêng của từng người* — và viewer vẽ nó
thành chip trong cột member. Nhưng ngày nghỉ **chung cả project** (Tết, Quốc khánh, offsite)
thì không có trong payload chút nào. Người nhận link thấy task từ 31/8 kéo tới 4/9 mà không
biết 2–3/9 cả team nghỉ, nên đọc thành "task này làm 5 ngày".

**Chọn phương án A · cấp project** (4 phương án trong `demo/holiday-on-share-page.html`, xếp
trên đúng một trục: *ngày nghỉ được nói ở độ mịn nào*):

| | Độ mịn | Ở đâu | Vì sao không chọn |
| --- | --- | --- | --- |
| **A** ✅ | project | 1 khối trong Sprint card, dưới pill ngày | — |
| B | phép tính | pill ngày thành `7.5 ngày công · 10 − 2.5 nghỉ` | Thêm một số phái sinh phải đúng tuyệt đối; lệch 0.5d so với Timeline là mất lòng tin cả trang |
| C | member | A + chip ở member bị chồng ngày (giống app) | In một sự thật chung **N+1 lần**; meta line vốn đã có `3/5 done` + pill off + chip ngày |
| D | task | A + hatch ở ô End của task bắc qua ngày nghỉ | Đụng từng dòng của bảng — thứ dày nhất trang; nhiều task cùng bắc qua thì hatch lặp rất nhiều |

A rẻ nhất, không rủi ro, và là **nền của cả C lẫn D** nếu sau này muốn đi sâu hơn.

**Phát hiện lúc thiết kế** (đáng ghi lại vì nó loại một ý tưởng nghe rất hợp lý): *không*
đánh dấu ô Start/End rơi trúng ngày nghỉ được — scheduler coi ngày nghỉ là ngày không làm
việc nên **start/end không bao giờ rơi vào đó**, dấu hiệu sẽ không bao giờ kích hoạt. Tín
hiệu thật là task **bắc qua** kỳ nghỉ. Đó là lý do D (nếu làm) phải đánh dấu *span*, không
phải *ô ngày*.

**Phạm vi = range sprint, không nới, và CLIP vào đó.** Ngày nghỉ chung được lọc theo
`[startDate, endDate ?? startDate]` rồi **cắt đúng vào range**, khác với `membersOff` (nới
theo task của chính người đó, vì task rollover có thể nằm ngoài sprint).

Vì sao clip, chứ không chỉ lọc: `holidayLoadInSpan` **tự clip khi đếm**. Nếu wire chở
nguyên kỳ nghỉ thì chip in `Jun 29 – Jul 7` cạnh con số `2d` — chữ và số nói khác nhau
trên cùng một dòng. Tệ hơn: clip có thể biến kỳ 4 ngày thành 1 ngày, mà `half` chỉ có
nghĩa khi 1 ngày — nên kỳ `22–25/7` mang `half` đọc **1d** trên share page trong khi app
đọc **0.5d** cho đúng dữ liệu đó. Clip trước rồi mới quyết `half` là cách duy nhất để hai
bên trùng nhau. Clip cũng bỏ luôn phần payload không ai nhìn thấy và xoá sạch offset âm.

Sender và viewer tính ra **cùng con số** vì dùng chung hàm **và** chung span (`d0`/`d1`, cả
hai bên đều có nguyên vẹn). ⚠️ **Chung hàm thôi thì chưa đủ**: chip trên member card gọi
đúng hàm đó nhưng trên **task span của người đó**, cố ý — nên nó *được phép* khác. Bảo đảm
này chỉ áp cho share page ↔ PNG ↔ badge sprint của ProjectHolidays.

**Số ngày do viewer tự tính**, không chở trên wire: `holidayLoadInSpan(holidays, {start, end})`
trong `lib.ts` — **đúng hàm mà member card và ProjectHolidays trong app đang dùng**. Nên con số
trên share page bằng con số trong app *do cấu tạo*, không phải do trùng hợp: cùng union theo
ngày (2 kỳ nghỉ chồng ngày không cộng đôi), cùng bỏ cuối tuần, cùng quy tắc nửa ngày. Wire chỉ
chở dữ liệu thô. `share-snapshot.ts` **không** import `lib.ts` (giữ module sạch React/DOM) —
việc tính nằm ở viewer, nơi đã import `lib` sẵn.

**Hiển thị** (`SnapshotViewer`, trong Sprint card, ngăn bằng `border-t` như khối Goal):
- Dòng tổng: `{fmtDays(days)}d` (màu `warn-ink`, đúng màu pill `Xd off` của member) +
  `nghỉ chung cả team`.
- Chips từng kỳ: **tên trước** (thứ người ta nhớ) rồi `{from} – {to}`, dùng lại đúng style
  chip ngày của member off (`bg-fill rounded-[6px]`, cùng `10px/gap-1/px-[6px]` — không còn
  near-miss), nửa ngày gắn badge `½AM/½PM`. Tên có `truncate` + `title`: `whitespace-nowrap`
  trên chuỗi user tự gõ **tràn rail 300px mất 47px** ở tên 44 ký tự (pill trong app thủ sẵn
  bằng `max-w-[280px] truncate`, lúc đầu không mang sang).
- Luật `range`/`half` nằm trong **`holidayChipParts` (lib.ts)** dùng chung với PNG, nên hai
  bề mặt không thể lệch **luật** dù style vẫn riêng. Trước khi tách, cả hai đều in badge theo
  `h.half` đơn thuần → kỳ 5 ngày mang `half` sót in `½AM` cạnh tổng 5 ngày nguyên.
- Không có ngày nghỉ → **cả khối biến mất**, Sprint card về đúng hình dạng cũ. Chi phí bằng 0
  cho sprint bình thường, đó là trạng thái hay gặp nhất. Kỳ nghỉ rơi trọn vào cuối tuần cũng
  ẩn (tốn 0 ngày công) — đúng luật chip member card.
- **Tiếng Anh** (`2.5d team off`), khớp mọi nhãn khác trong card (Sprint / Goal / Progress /
  `N done` / `Nd off`) **và** khớp tấm PNG do chính trang này xuất ra — trước đó cùng một con
  số được dán nhãn hai ngôn ngữ cách nhau một cú click. Dùng đúng pill của member `Nd off`
  (`bg-priority-high/15 rounded-full`), chỉ khác danh từ: một cách vẽ cho một ngữ nghĩa.

Không dùng icon lịch cho khối này: pill ngày ngay trên đã có một icon lịch rồi, thêm cái thứ
hai đọc thành "một control bị lặp" (cùng lý do chip holiday trong app không mang icon — xem
[project-holidays.md](./project-holidays.md)).

### Biên tin cậy (blob là dữ liệu của người lạ)

Blob đi trong URL fragment hoặc nằm trong KV store tra bằng id công khai — tức **hoàn toàn do
người gửi link kiểm soát**. Trước `/review`, `hd` mở ra hai lỗ:

1. **Treo tab bằng link 168 ký tự.** `ISO_DATE` chỉ kiểm *hình dạng*, không kiểm *độ lớn* —
   `0001-01-01 … 9999-12-31` hợp lệ và dài 3.65 triệu ngày. Vòng đếm trong `holidayLoadInSpan`
   đi bằng **successor chuỗi**, mà quá `9999-12-31` thì `toISOString()` đổi sang dạng năm mở
   rộng `+010000-01` — vừa là fixed point vừa sort **dưới** mọi ngày thật (`+` = 0x2B, `9` =
   0x39), nên `d <= to` đúng vĩnh viễn. Không throw, không phình bộ nhớ (fixed point đọc ra
   cuối tuần nên không vào Map): **treo trắng, im lặng**, không có ErrorBoundary.
   → Vòng lặp giờ chạy bằng **timestamp** (luôn kết thúc) + cap `MAX_WALK_DAYS = 4000`, đặt
   trong `lib.ts` nên **mọi caller cùng hưởng** — member card, ProjectHolidays, share page, PNG.
   `nextISODate` bị xoá hẳn để không ai dựng lại vòng lặp chuỗi.
   Đây đúng fixed point mà `scheduling.ts` đã cho `addDays` throw; `lib.ts` là **bản sao thứ
   hai** của cùng vòng lặp và bản vá chưa bao giờ với tới.
2. **`decodeSnapshot` throw thay vì trả `null`**, phá chính contract nó ghi. `unpackSnapshot`
   nằm ngoài cả hai `try`, và `fromOffset` kết thúc bằng `new Date(...).toISOString()` — ném
   `RangeError` với offset ngoài dải Date (`JSON.parse('1e999')` là `Infinity`, tới được).
   Viewer gọi decode trong `useMemo` lúc render ⇒ **trang trắng**. Lỗ này có sẵn qua `s0`/`s1`/
   `mo`; `hd` thêm hai cửa.
   → `fromOffset` fail-closed (`Number.isFinite` + `|t| <= 8.64e15`), và cả `decodeSnapshot`
   lẫn `decodeCollectionSnapshot` bọc `unpack` trong `try/catch`. Hỏng **một field** thì bỏ
   đúng field đó, phần còn lại của board vẫn hiện.

Thêm: `d0`/`d1` phải khớp `ISO_DATE_RE` mới decode; `hd` cap 64 dòng (`MAX_BLOB_LEN` chỉ chặn
kích thước **đã nén** — lz-string đạt ~150:1 trên dòng lặp lại nên không bao giờ đủ một mình).

Test ở `share-snapshot.test.ts`: *"a hostile link can neither hang nor crash the viewer"*.

### ⚠️ Người nhận có thể xem bản viewer cũ rất lâu (chưa fix)

Phát hiện lúc `/review`, **không sửa trong lần này** vì nó nằm ngoài feature và là một
quyết định UX riêng. Ghi lại để không ai giả định "recipient thấy ngay".

`vite.config.ts` đặt `registerType: 'prompt'` + `injectRegister: null` — service worker mới
**không bao giờ tự activate**, phải có người bấm nút update. Nút đó nằm trong `VersionFooter`
(`useRegisterSW`), mà `VersionFooter` **chỉ mount trong `<App/>`** (`App.tsx:1550`). Trong khi
`main.tsx` cho link share đi thẳng vào `HostedViewer` / `SnapshotViewer` / `CollectionSnapshotViewer`,
**thay cho** `<App/>`. Cộng thêm `navigateFallback: '/index.html'` phục vụ route `/view/*` từ
`index.html` đã precache.

Nghĩa là: **người chỉ mở link share, không bao giờ mở app, không có đường nào nhận bản mới.**
SW mới chỉ activate khi mọi tab đang bị điều khiển đã đóng hết.

Cắn đúng vào luồng hosted mà feature này phục vụ: sender thêm ngày nghỉ → bấm **Cập nhật**
(blob mới có `hd`, URL không đổi) → recipient mở lại đúng link đó và thấy board **không có**
ngày nghỉ — chính cái "task kéo dài mà không biết vì sao" mà feature sinh ra để chữa. Còn
sender thì cả share page lẫn PNG của mình đều hiện dải, nên **không có cách nào tự phát hiện**.

Hai hướng, phải chọn: mount đường update vào route viewer (nhưng có nên hiện pill update trên
một trang read-only không?), hoặc chấp nhận và nói rõ độ trễ ở chỗ nút Cập nhật.

**Collections (v3) không có** khối này: collection không thuộc sprint và không có range để
ngày nghỉ bám vào.

## Rules & edge cases

- **Desktop (Tauri)** — hai điều chỉnh vì webview không phải browser web (`share-runtime.ts`):
  - **Base URL**: origin của bản desktop đóng gói là `tauri://localhost` (prod) —
    người nhận không mở được. Nên **PROD desktop** trỏ link vào web đã deploy
    (`https://plan-up-eta.vercel.app/`); bản web và Tauri **dev** dùng `location.origin`
    (dev = `localhost:5173`, chạy được ngay trên máy dev). Quyết định qua
    `IS_TAURI && import.meta.env.PROD`.
  - **Nút Open**: `window.open` là **no-op trong webview Tauri** → dùng
    `@tauri-apps/plugin-opener` (`openUrl`) để mở link ở **browser hệ thống**
    (plugin đăng ký ở `lib.rs`). Capability cần **cả hai**: `opener:allow-open-url`
    (bật command) **và** `opener:allow-default-urls` (cấp scope `http/https/mailto/tel`)
    — chỉ `allow-open-url` thì scope rỗng, mọi URL bị chặn → `openUrl` throw → Open im.
    Web vẫn `window.open`. Copy link dùng `navigator.clipboard` (chạy tốt trong webview).
- **Fragment không rời máy**: dữ liệu ở sau `#` — không gửi lên server; kể cả app
  chat fetch URL để dựng preview card cũng không thấy fragment (không lộ data,
  cũng không có rich preview).
- **Size gate**: blob ở fragment nên trình duyệt xử lý được URL rất dài; chặn thật là
  **chỗ paste** (Telegram ~4096 ký tự/message). Ngưỡng `SHARE_MAX_BYTES = 4000` sát mức
  đó. Vượt → thẻ cảnh báo (không hiển thị số KB), Copy vẫn cho phép; `.html` không giới
  hạn size là fallback (Future).
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

## Collections (v3)

Collection cũng share được, **cùng cơ chế URL-fragment**, nhưng snapshot là **format
riêng `v=3`** vì collection khác sprint về bản chất: nhóm theo **section** (không có
member/assignee), status **do user tự tạo** (mỗi status có màu riêng), item chỉ có
date-range (không giờ, không effort/priority/prereq). v2 (sprint) giữ nguyên; hai format
sống song song, boot chọn viewer theo `version`.

### Sender — `CollectionShareModal`
- Nút **Share** nằm ở **top bar, ngang hàng nút Export** (không nhét trong menu) — chỉ
  hiện khi collection có ≥1 item. (Sprint có nút Share ở page-header; collection không có
  page-header nên đặt ở context bar.)
- Modal mirror `ShareLinkModal` nhưng đơn vị tỉa là **section**: checklist mỗi row = ô
  vuông bo màu-section + tên bảng + số item; untick để bỏ bảng khỏi link. Summary đếm
  **items · sections** + dải chấm màu = bộ status của collection. Cùng luật size: **không
  hiện KB**, chỉ cảnh báo khi vượt `SHARE_MAX_BYTES = 4000`; footer **Open** + **Copy link**.

### Recipient — `CollectionSnapshotViewer`
- **Layout = left-rail 2 cột, y hệt `SnapshotViewer`** (2026-07-15, arrangement A —
  `max-w-[1240px]`, rail trái sticky ~300px, board cột phải, xếp dọc <`lg`). Không còn
  capsule glass-toolbar nổi + breadcrumb full-width. **Rail trái** (xếp dọc):
  - **Brand + dark toggle** (Sun/Moon cuối hàng) + subline "shared snapshot · {ngày}";
    chip **🔒 Read-only** dưới.
  - **Collection card** (`glass-card`): label `COLLECTION` + `📚 {collection} · {project}`
    + pill `{N} items` (không dải ngày — collection không time-boxed).
  - **Status legend card** (`glass-card`, chỉ khi có status): label `STATUSES` + list dọc
    mỗi status (chấm màu + tên) — bộ status user tự tạo. Dùng chung cho cả List & Calendar
    nên sống ở rail (bỏ legend inline cũ trong từng board).
  - **List | Calendar** toggle (segmented, persist qua `plan-up:snapshotCollView`).
  - **Actions**: **Export PNG** (`brand-btn`) + **Mở plan-up** (ghost), full-width.
- **Board (cột phải)**:
  - **List** — card-per-section (Name · Start · End · Status); status = pill soft-tint màu
    riêng; item không status → pill viền đứt. Item không ngày → cột hiện `—`.
  - **Calendar** — tái dùng `buildMonthGrid`/`assignLanes`/`computeBarSegments` (lib.ts) như
    `CollectionCalendar`: lưới tháng Mon-start, bar liền mạch màu theo status, khay
    **Unscheduled** cho item không ngày. Read-only: bar không mở popover. **Thanh điều hướng
    tháng** (`Today ‹ {Month Year} ›`) nằm ở **đầu cột phải** (không vào rail) vì là
    interaction riêng của view Calendar; legend đã chuyển sang rail. Demo:
    `demo/collection-snapshot-flanks.html`.
- **Export PNG** dựng lại `Collection` + `Task[]` tổng hợp từ snapshot rồi tái dùng
  `CollectionImageModal`/`CollectionPngCard` (nhóm theo section).

### Data (v3 wire — columnar)
`CollectionSnapshotData` → `packCollection` (`v:3`): `pj` (project), `cn` (collection name),
`se: [name,color][]` (sections), `st: [name,color][]` (statuses — **giữ đủ bộ** để legend
đúng), `ti` titles, `sc` section-index/item (-1), `xi` status-index/item (-1), `a0`/`a1`
start/due **yyyy-mm-dd tuyệt đối** (collection không có mốc `startDate` để neo offset như
sprint). id section/status là synthetic (`s0…`/`x0…`). `decodeCollectionSnapshot` từ chối gì
sai shape / `v≠3` (trả `null` → "Link không hợp lệ").

### Wiring
- `parseShareHash` giờ trả `{ version, blob }` (không phải chỉ blob); chỉ nhận version
  **known** (2, 3). `buildShareUrl(blob, base?, version)` thêm tham số version.
- `main.tsx`: `version === 3` → `<CollectionSnapshotViewer>`, còn lại → `<SnapshotViewer>`.

## Future / open questions

- **Self-contained `.html` export**: hiện thực nhánh fallback "quá lớn" — xuất 1 file
  HTML tự chứa (viewer + bundle nhúng) gửi qua chat / host bất kỳ, không giới hạn
  size. Dùng chung `SnapshotViewer`.
- **QR**: tạm bỏ (2026-07-14). Nếu làm: render QR từ link cho scan tại chỗ (standup).
- **Expiry/obfuscate**: link không hết hạn (data nằm trong chính nó) — không có cơ
  chế thu hồi. Cân nhắc note rõ cho user khi share dữ liệu nhạy cảm.
