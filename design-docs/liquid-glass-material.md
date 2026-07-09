# Liquid Glass material (Tempered) — iOS 26 DNA, phase 1

*Last updated: 2026-07-08*

## What & why

Nâng **vật liệu** của app theo ngôn ngữ iOS 26 "Liquid Glass" — phương án
**B · Tempered** chọn từ demo `demo/dna-ios26-liquid-glass.html` (phương án A
"Full Liquid" — floating islands — bị loại vì đổi cấu trúc layout, effort lớn).

Tempered = **giữ nguyên layout hiện tại** (sidebar dính cạnh, canvas Apple grey,
inset-grouped cards), chỉ đổi 3 thứ:

1. **Ambient tint** — canvas có một vệt radial accent rất nhạt góc trên-phải,
   cho lớp kính có cái để khúc xạ. Tint derive từ `--color-accent` qua
   `color-mix` nên **tự đổi theo brand theme** (Fire → vermilion, Cupertino →
   blue).
2. **Toolbar → capsule kính** — header 54px bờ thẳng + border-b đổi thành
   capsule `rounded-full` nổi có margin, vật liệu glass (blur + saturate +
   specular edge).
3. **Content cards → glass** — group card / sprint header / gantt / collection /
   dashboard / settings sections: nền translucent + `backdrop-filter` + edge
   highlight, radius 14px → **18px**.

Mọi thứ khác giữ nguyên: SF Pro + tabular nums, accent duy nhất, status circle
Reminders, capacity bar, semantic colors, hành vi (1-click, keyboard).

## Material recipe (tokens trong `app/src/index.css`)

| Token | Light | Dark |
|---|---|---|
| `--color-glass` | `rgba(255,255,255,0.5)` | `rgba(44,44,50,0.52)` |
| `--glass-edge` (specular trên) | `rgba(255,255,255,0.9)` | `rgba(255,255,255,0.14)` |
| `--glass-ring` (viền 0.5px) | `rgba(0,0,0,0.06)` **(đen — rim trắng chìm trên nền sáng)** | `rgba(255,255,255,0.08)` |
| `--ambient-tint` (góc trên-phải) | `color-mix(accent 10%, transparent)` | `color-mix(accent 16%, transparent)` |
| `--ambient-tint-2` (góc dưới-trái) | `color-mix(accent 5.5%, transparent)` | `color-mix(accent 8%, transparent)` |

Light theme đi theo **option D** của `demo/liquid-light-fix.html` (2026-07-08):
dark rim + trong hơn + ambient đậm — vì rim specular trắng vô hình trên canvas
sáng, cạnh light theme cần hairline tối làm optical edge. Dark theme lộ rim
trắng tự nhiên nên giữ nguyên. `.glass-flush` = cùng bg + blur, không shadow,
cho sticky cell bên trong card kính (gantt date header, member gutter).

Utility classes:

- **`.glass-card`** — `background: var(--color-glass)` +
  `backdrop-filter: blur(22px) saturate(180%)` + drop shadow cũ của card.
  Thay cho `bg-surface + shadow-[0_1px_2px…0_8px_22px…]`.
  **Viền specular nằm trên overlay `::after`** (`inset 0`, `border-radius:
  inherit`, `z-index: 30`, `pointer-events: none`) chứ KHÔNG nằm trong
  box-shadow của card — để children che mép (sticky flush header/gutter
  trong gantt) không nuốt mất rim. Card nào cũng tự có viền, không cần
  từng view tự lo. Hệ quả: `.glass-card` là `position: relative`.
- **`.glass-toolbar`** — như trên, blur 24px, shadow nhẹ hơn (floating tier).
- **`.ambient-canvas`** — `radial-gradient(ambient-tint góc trên-phải)` chồng
  lên `var(--color-canvas)`, `background-attachment: fixed` để sticky bar
  trong SprintView dùng cùng class là gradient **khớp pixel** với root
  (cả hai vẽ theo viewport).

## Radius scale (đổi)

| Phần tử | Cũ | Mới |
|---|---|---|
| Group card, sprint header card, dashboard/settings section | 14px | **18px** |
| Toolbar | 0 (bar) | **full capsule** |
| Popover, dialog, toast | 14px | 14px (giữ — phase 2) |
| Button/input/segmented | 8px | 8px (giữ) |
| Pill/avatar | full | full (giữ) |

## Áp dụng ở đâu (phase 1)

- `App.tsx` — root `ambient-canvas`; header thành capsule `glass-toolbar`.
- `SprintView.tsx` — `Card` component (mọi group card) + sticky bar
  `ambient-canvas`.
- `GanttView.tsx`, `CollectionView.tsx`, `CollectionCalendar.tsx`,
  `ActivityLog.tsx`, `HomeDashboard.tsx`, `ProjectSettingsView.tsx` — swap
  shadow string → `glass-card`.

**Đã làm thêm (2026-07-08):** `ModalSheet` sang **`.glass-modal`**
(`--color-glass-thick` 0.78 cả 2 theme, blur 28, rim trong box-shadow riêng —
mép dialog không bao giờ bị children che nên không cần `::after`); board task
card + drag ghost nhận rim (`inset var(--glass-edge)/var(--glass-ring)`) nhưng
nền vẫn solid; `PngExportCard` group box có **rim tĩnh inline hex** (PNG
pipeline không render được backdrop-filter, card cố tình token-free);
**3 dlg-sheet tự dựng ngoài ModalSheet** — search palette ⌘K (App.tsx),
rollover popover (App.tsx), `ConfirmDialog` — cũng sang `.glass-modal`;
selection bar (SprintView) nhận rim trắng hardcode (bar tối cả 2 theme,
token light là ring đen sẽ chìm); **sticky column header của List** đổi
từ dải `ambient-canvas` đục full-bleed sang **capsule kính nổi**
(`.glass-toolbar rounded-full`, sticky top-2, `TaskColumnHeader bare`
bỏ border-b vì rim capsule là edge) — option C của
`demo/liquid-column-header.html`.

**Phase 2 — popover (2026-07-08):** utility **`.glass-popover`**
(`--color-glass-thick`, blur 24, popover-tier shadow + rim trong
box-shadow — mép popover không bị children che). Swap 11 shell:
DatePicker ×2 (calendar), members ×3 (member editor, color menu,
days-off), BoardView (Schedule), GanttView + CollectionCalendar
(task popover), HomeDashboard (project menu), App ×2 (sidebar
dropdown, Export menu). **Còn lại:** toast (đang solid + ring,
chấp nhận); sidebar vibrancy.

## Gotcha build (2026-07-08)

Trong mỗi block glass, **`-webkit-backdrop-filter` phải đứng TRƯỚC
`backdrop-filter`**. LightningCSS (minifier của Tailwind v4) coi dòng
prefix đứng sau là "đè" dòng chuẩn và xoá `backdrop-filter` khỏi bundle
prod — Chromium không apply bản `-webkit-` nên mặt kính mất blur trên
bản deploy (dev serve CSS thô nên không lộ). Prefix-first giữ cả hai.

## Gotcha backdrop root (2026-07-09)

Element có `backdrop-filter` là **backdrop root**: descendant có
backdrop-filter chỉ blur được nội dung BÊN TRONG root đó, không xuyên ra
page phía sau. Hệ quả: popover `.glass-popover` đặt lồng trong
`.glass-toolbar` (menu Export cũ, absolute trong header) hiện trong suốt
không mờ. Fix: **portal popover ra `document.body`** (idiom
`usePinnedPopover` + `createPortal` mà DatePicker/members đã dùng —
vì thế chúng không dính). Quy tắc: KHÔNG bao giờ đặt glass popover là
con DOM của một surface glass khác.

## Trade-offs đã cân nhắc

- `backdrop-filter` nhiều card = GPU cost — chấp nhận vì nội dung sau card là
  canvas tĩnh (blur rẻ), không phải scroll content; theo dõi trên máy yếu.
- Glass light 0.5 opacity: `ink-faint` trên vùng tint đo ~4.1:1, body kính
  ~4.4:1 — ngang precedent đã chấp nhận ở design-system §2.2 (ink-faint trên
  canvas 4.15 "sát AA"); tint chỉ chiếm 2 góc, không phủ vùng đọc chính.
- `background-attachment: fixed` trên WKWebView (Tauri) OK; nếu browser nào
  không support thì tint chỉ lệch nhẹ, không vỡ.
