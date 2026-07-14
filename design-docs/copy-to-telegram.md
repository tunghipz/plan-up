# Copy sprint → Telegram (text)

**Status:** Implemented
**Last updated:** 2026-07-14 (task line now shows a `start → end` range + tasks sort by end date, undated last — both sprint & collection trees, subtasks included)
**Code:** `app/src/telegram-export.ts` (pure formatters + tests), `app/src/CopyTelegramModal.tsx` (generic popover), `SprintPageHeader` in `app/src/App.tsx` (sprint trigger button), the toolbar **Export ▾** menu + collection modals in `app/src/App.tsx` (collection triggers), `app/src/CollectionImageModal.tsx` + `app/src/CollectionPngCard.tsx` (collection PNG)

## Purpose

Chia sẻ nhanh tình trạng sprint vào **Telegram** (hoặc chat bất kỳ) bằng **text
thuần dán thẳng** — không ảnh, không link, không bắt mở app. Bổ sung "share nhẹ"
cạnh [export-png.md](./export-png.md): PNG là ảnh đẹp để nhìn, còn text copy thì
**sửa được sau khi dán**, nhẹ, và search được trong chat.

## User-facing behavior

- Nút **Copy** (icon paper-plane + chữ "Copy") ở góc phải header sprint
  (`SprintPageHeader`), cạnh tiêu đề. Nền `--fill` xám nhạt (calm ở nghỉ, đậm khi
  hover) — không thêm chrome vào toolbar. Chỉ hiện khi sprint có task.
- Bấm → mở popover **"Copy for Telegram"** (dùng `ModalSheet`): chọn **Scope**
  (Whole sprint / một member), xem **Preview** trong bong bóng Telegram giả (bong
  bóng **theo theme app** — `html.dark` → Telegram-dark, sáng → Telegram-light),
  **đếm ký tự** `/4096`, nút **Copy**.
- Copy → ghi clipboard (`navigator.clipboard.writeText`, fallback `execCommand`),
  nút đổi "Copied ✓" 1.4 s. Dán vào Telegram ra đúng text preview.

## Format — "Tree" (chốt)

Cây phân cấp kiểu lệnh `tree`: **người → task → subtask**. Ví dụ:

```
📋 Sprint 12 · Checkout revamp  ·  Jul 5 → Jul 22
│
├─ 👤 An
│  ├─ #14 Refund API — In progress · Jul 5 → Jul 16
│  ├─ #12 Payment gateway integration — In progress · Jul 8 → Jul 22
│  │  ├─ Idempotency keys — Done · Jul 8 → Jul 11
│  │  └─ Webhook retry logic — To do · Jul 12 → Jul 20
│  └─ #21 Load testing — To do
│
└─ 👤 Unassigned
   └─ #18 QA regression pass — To do
```

Tasks trong lane **An** đã sort theo end date: `#14` (Jul 16) trước `#12` (Jul 22),
`#21` (không có end date) xuống cuối.

Quy tắc grammar:
- **Dòng đầu**: `📋 {sprint.name}  ·  {formatSprintRange}`.
- **Nhánh**: `├─`/`└─` (cuối), continuation `│  `/`   `. Ký tự cây nằm **đầu
  dòng** nên đọc ra phân cấp cả trên font tỉ lệ của Telegram (đường `│` có thể
  lệch nhẹ theo bề rộng chữ — chấp nhận được, không phải căn cột).
- **Task**: `#{sequence} {title} — {status}[ · {start → end}]`.
- **Subtask** (child): `{title} — {status}[ · {start → end}]` (giống task, chỉ
  khác là không có `#seq`).
- **Status = chữ, KHÔNG ký hiệu**: `To do` / `In progress` / `Done`
  (reuse app's `STATUS_LABEL`). Không nhầm với gì khác, không lệ thuộc emoji render khác
  nhau giữa iOS/Android/Desktop.
- **KHÔNG hiện priority** (chốt) — giữ dòng ngắn.
- **Dates = khoảng `start → end`** (2026-07-14): `formatShortDate` cả hai đầu (vd
  `Jul 5 → Jul 16`), dùng chung helper `dateRange` với collection. Chỉ có một đầu
  (start hoặc end) → hiện đúng đầu đó; không có đầu nào → bỏ hẳn. `→` khớp
  `formatSprintRange` ở dòng đầu.
- **Sắp xếp theo end date** (2026-07-14): trong mỗi lane, task top-level (và
  subtask trong mỗi parent) sort theo **end date (`dueDate`) tăng dần**; task không
  có end date → xuống **cuối**; tie → List order (`listOrder ?? sequence`). Đây là
  order riêng của copy, **khác** order thủ công của List/PNG.
- **Emoji** chỉ để định vị (📋 sprint, 👤 member), không mang nghĩa status.

## Grouping (khớp List/PNG)

Tái dùng `groupTasksByMember` (đã test, xem [export-png.md](./export-png.md)) để
lane theo `compareMembersByOrder` (order → name → id), bucket "Unassigned" cuối,
bỏ lane rỗng. Trong mỗi lane, **child (task có `parentId` trỏ tới task cùng
lane) nest dưới parent** — mirror `flattenDisplayOrder`. Child khác assignee với
parent thì hiện như task top-level ở lane của chính nó (đúng như List).

**Order trong lane = end date, không phải manual order** (2026-07-14): sau khi
group, copy tự sort lại top-level task (và subtask trong mỗi parent) theo end date
tăng dần (`byEnd`, xem grammar) — chỉ *member order* và *nesting* là khớp List/PNG,
còn thứ tự task trong lane là của riêng copy.

## Constraints Telegram (nghiên cứu)

1. **Paste = plain text** — Telegram không parse `**md**`/`#` khi dán khối text.
   Định dạng phải nằm trong chính ký tự (emoji, xuống dòng, ký hiệu cây).
2. **Font tỉ lệ** → không căn cột ASCII được. Tree dùng ký tự dẫn đầu dòng, không
   dùng bảng/space-pad.
3. **Cap 4096 ký tự/tin** — popover đếm ký tự, đỏ khi vượt (sprint lớn cần tách).

## Decisions

- **D1 Vị trí = header sprint**, không phải menu Export / icon toolbar. Copy là
  hành động thuộc-về-sprint; nút cạnh tiêu đề đọc là "share sprint này". Toolbar
  giữ calm (design-system: accent là tín hiệu, không phải chrome).
- **D2 Chỉ 1 format (Tree)** — không tab nhiều format. Giảm quyết định cho user.
- **D3 Status tiếng Anh** — dùng lại `STATUS_LABEL` của app (To do / In progress /
  Done) để khớp UI; title task vẫn giữ nguyên ngôn ngữ user nhập. Toàn bộ chuỗi UI
  của copy/export (modal title, Scope, Preview, subtitle, "Whole sprint/collection",
  "Unassigned") đều bằng tiếng Anh.
- **D4 Formatter thuần, tách UI** — `telegram-export.ts` không import React/DOM,
  unit-test bằng vitest (executable spec cho grammar). Clipboard là glue ở
  component.

## Files

- **`app/src/telegram-export.ts`** — `formatSprintTree(sprint,
  members, tasks, { memberId? })` (status via app's `STATUS_LABEL`),
  `membersWithTasks(members, tasks)` helper cho scope picker. Shared helpers:
  `dateRange(t)` (`start → end`, một đầu, hoặc rỗng) + `byEnd(a,b)` (sort theo end
  date, undated cuối, tie List order) — dùng cho cả sprint & collection tree.
- **`app/src/telegram-export.test.ts`** — grammar: header, nhánh mid/last, nest
  child, status text, **range `start → end` + một-đầu + rỗng**, **sort theo end
  date (undated cuối)**, scope 1 member, sprint rỗng.
- **`app/src/CopyTelegramModal.tsx`** — popover (ModalSheet): scope picker,
  preview bubble (theo theme app qua `html.dark`), char count, Copy.
- **`app/src/App.tsx`** — `SprintPageHeader` nhận `onCopy`, render nút Copy (khi
  có task); state `copyTgOpen`; render `<CopyTelegramModal>` với
  `currentSprint` / `paletteMembers` / `tasks`.

## Collections (same feature, section-shaped)

Collections get the **same** copy-text (+ a sibling image export), but adapted to
their structure — see the parallel differences:

- **Grouped by section 📁**, not member. `formatCollectionTree(collection, tasks,
  { sectionId? })` walks `collection.sections` in order, buckets items by
  `sectionId`, nests children per section (same as sprint).
- **No `#seq`** — the collection List has no ID column, so items render as
  `{title} — {status}[ · {start → end}]`.
- **Status = the item's custom `CollectionStatus` NAME** (looked up via
  `collectionStatusId` in `collection.statuses`), e.g. `EVENT`, `Idea`, `Shipped`
  — NOT the fixed `STATUS_LABEL`. Item with no status → status omitted.
- **Dates = a `start → end` range** (`startDate`/`dueDate`, `formatShortDate`) —
  collection items carry both mounts (range-mode date picker). One side only →
  just that date; neither → omitted. No sprint date range on the header line
  (just `📋 {collection.name}`).
- **Subtask cũng hiện range** (2026-07-14): child render `— {status}[ · {start →
  end}]` như item cha (trước chỉ hiện status) — khớp sprint tree.
- **Sắp xếp theo end date** (2026-07-14, khớp sprint): items trong mỗi section (và
  subtask trong mỗi parent) sort theo end date (`dueDate`) tăng dần, không end →
  cuối, tie → `listOrder ?? sequence`. **Trước đây** sort thuần theo `listOrder ??
  sequence` (thứ tự List) — nay copy chủ động sort lại theo end date.
- **Scope** = whole collection / one section (`sectionsWithItems` helper).

**Placement:** collections have **no page header** (identity + statuses + view
toggle all live in the context bar), and the toolbar already carries the global
**Export ▾** split-menu — so rather than add a second Export button, that menu is
made **context-aware**: in a collection its top items become *Copy for Telegram*
(opens the shared `CopyTelegramModal`) + *Export as image…* (opens
`CollectionImageModal`), above the unchanged *Export this project / Export all /
Auto backup*. In a sprint the menu keeps its single sprint *Export as image…*
(the sprint text-copy lives in the page-header Copy button instead). Both
collection items are disabled when the collection has no items.

### Collection image export

`CollectionImageModal` + `CollectionPngCard` render the collection as **one PNG**
(sections → a `Name · Start · End · Status` table, custom-status pills, light
palette, `plan-up` brand footer), reusing the `png-export.ts` glue
(`renderNodeToPng` / `copyPngToClipboard` / `downloadPng`). Columns differ from
the sprint PNG (no Effort/Assignee/prereq). See [export-png.md](./export-png.md).

## Non-goals

- Không gửi Telegram API / bot — chỉ copy clipboard, user tự dán.
- Không format khác (Standup/Digest đã cân nhắc, chốt Tree). Xem lịch sử demo.
- Không priority trong output.
