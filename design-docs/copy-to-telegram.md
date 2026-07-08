# Copy sprint → Telegram (text)

**Status:** Implemented
**Last updated:** 2026-07-08
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
- Bấm → mở popover **"Copy cho Telegram"** (dùng `ModalSheet`): chọn **phạm vi**
  (Cả sprint / một member), xem **preview** trong bong bóng Telegram giả (bong
  bóng **theo theme app** — `html.dark` → Telegram-dark, sáng → Telegram-light),
  **đếm ký tự** `/4096`, nút **Copy**.
- Copy → ghi clipboard (`navigator.clipboard.writeText`, fallback `execCommand`),
  nút đổi "Copied ✓" 1.4 s. Dán vào Telegram ra đúng text preview.

## Format — "Tree" (chốt)

Cây phân cấp kiểu lệnh `tree`: **người → task → subtask**. Ví dụ:

```
📋 Sprint 12 · Checkout revamp  ·  Jul 8 → Jul 19
│
├─ 👤 An
│  ├─ #12 Payment gateway integration — Đang làm · Jul 15
│  │  ├─ Idempotency keys — Xong
│  │  └─ Webhook retry logic — Chưa làm
│  └─ #14 Refund API — Chưa làm · Jul 18
│
└─ 👤 Chưa gán
   └─ #18 QA regression pass — Chưa làm
```

Quy tắc grammar:
- **Dòng đầu**: `📋 {sprint.name}  ·  {formatSprintRange}`.
- **Nhánh**: `├─`/`└─` (cuối), continuation `│  `/`   `. Ký tự cây nằm **đầu
  dòng** nên đọc ra phân cấp cả trên font tỉ lệ của Telegram (đường `│` có thể
  lệch nhẹ theo bề rộng chữ — chấp nhận được, không phải căn cột).
- **Task**: `#{sequence} {title} — {status}[ · {due}]`.
- **Subtask** (child): `{title} — {status}` (không có `#seq`, không due).
- **Status = chữ, KHÔNG ký hiệu**: `Chưa làm` / `Đang làm` / `Xong`
  (`STATUS_TEXT_VI`). Không nhầm với gì khác, không lệ thuộc emoji render khác
  nhau giữa iOS/Android/Desktop.
- **KHÔNG hiện priority** (chốt) — giữ dòng ngắn.
- **Due**: `formatShortDate` (định dạng app "MMM d", vd `Jul 15`); task không due
  thì bỏ.
- **Emoji** chỉ để định vị (📋 sprint, 👤 member), không mang nghĩa status.

## Grouping (khớp List/PNG)

Tái dùng `groupTasksByMember` (đã test, xem [export-png.md](./export-png.md)) để
lane theo `compareMembersByOrder` (order → name → id), bucket "Chưa gán" cuối,
bỏ lane rỗng. Trong mỗi lane, **child (task có `parentId` trỏ tới task cùng
lane) nest dưới parent** — mirror `flattenDisplayOrder`. Child khác assignee với
parent thì hiện như task top-level ở lane của chính nó (đúng như List).

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
- **D3 Status tiếng Việt** — team dùng tiếng Việt; title task vẫn giữ nguyên
  ngôn ngữ user nhập. Đổi sang English (dùng `STATUS_LABEL`) là 1 dòng nếu cần.
- **D4 Formatter thuần, tách UI** — `telegram-export.ts` không import React/DOM,
  unit-test bằng vitest (executable spec cho grammar). Clipboard là glue ở
  component.

## Files

- **`app/src/telegram-export.ts`** — `STATUS_TEXT_VI`, `formatSprintTree(sprint,
  members, tasks, { memberId? })`, `membersWithTasks(members, tasks)` helper cho
  scope picker.
- **`app/src/telegram-export.test.ts`** — grammar: header, nhánh mid/last, nest
  child, status text, due bỏ khi null, scope 1 member, sprint rỗng.
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
  — NOT the fixed `STATUS_TEXT_VI`. Item with no status → status omitted.
- **Dates = a `start → end` range** (`startDate`/`dueDate`, `formatShortDate`) —
  collection items carry both mounts (range-mode date picker). One side only →
  just that date; neither → omitted. No sprint date range on the header line
  (just `📋 {collection.name}`).
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
