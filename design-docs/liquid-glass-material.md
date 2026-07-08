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
| `--color-glass` | `rgba(255,255,255,0.62)` | `rgba(44,44,50,0.58)` |
| `--glass-edge` (specular trên) | `rgba(255,255,255,0.62)` | `rgba(255,255,255,0.14)` |
| `--glass-ring` (viền 0.5px) | `rgba(255,255,255,0.35)` | `rgba(255,255,255,0.08)` |
| `--ambient-tint` | `color-mix(accent 6%, transparent)` | `color-mix(accent 9%, transparent)` |

Utility classes:

- **`.glass-card`** — `background: var(--color-glass)` +
  `backdrop-filter: blur(22px) saturate(180%)` + drop shadow cũ của card +
  `inset 0 1px 0 var(--glass-edge)` + `inset 0 0 0 0.5px var(--glass-ring)`.
  Thay cho `bg-surface + shadow-[0_1px_2px…0_8px_22px…]`.
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

**Phase 2 (chưa làm):** popover/menu/dialog/toast sang glass; sidebar vibrancy
đồng bộ recipe; đo lại contrast AA của `ink-faint` trên glass khi wallpaper
đậm hơn.

## Trade-offs đã cân nhắc

- `backdrop-filter` nhiều card = GPU cost — chấp nhận vì nội dung sau card là
  canvas tĩnh (blur rẻ), không phải scroll content; theo dõi trên máy yếu.
- Glass bg light giữ 0.62 opacity (đậm hơn demo 0.55) để text muted không rớt
  AA trên ambient tint.
- `background-attachment: fixed` trên WKWebView (Tauri) OK; nếu browser nào
  không support thì tint chỉ lệch nhẹ, không vỡ.
