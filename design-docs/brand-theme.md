# Brand theme — ZingPlay Fire ↔ Cupertino Blue

**Status:** Implemented (toggle **hidden** since 2026-07-15 — app stays on Fire)
**Last updated:** 2026-07-15 (footer **flame toggle removed** — the app now locks to its
default Fire brand; `useBrandTheme()` still runs for its side-effect [applies `data-brand`,
reads any persisted `plan-up:brand`], so the theme is unchanged and switching is still
possible by hand via localStorage. Removed the `Flame` import + the toggle button.)
**Code:** `app/src/index.css` (token overrides `[data-brand="fire"]` + `.brand-fill`/`.brand-btn`), `app/src/lib.ts` (`useBrandTheme`), `app/src/App.tsx` (calls `useBrandTheme()` for effect; toggle button removed + signature classes)

## Purpose

App chạy trong studio ZingPlay (VNG) — brand chính thức là **fire-fox** (Brand
Guideline EN). Cho phép app mang **màu brand studio** mà không phá DNA
Cupertino: user chọn được 1 trong 2 brand theme, đổi qua lại bất kỳ lúc nào.

- **Fire (default)** — hướng **G · Fire Signature** đã chốt qua demo
  (`demo/color-dna-firefox-3.html`): gradient lửa official **chỉ ở chỗ
  signature** (active sidebar row + primary CTA), accent hệ vermilion, còn lại
  100% greyscale Cupertino sạch.
- **Blue** — Cupertino system blue `#0071E3` nguyên bản (theme cũ, giữ nguyên).

## Official palette (Zing Play Brand Guideline EN, tr.11)

| Vai trò | Hex | Ghi chú |
|---|---|---|
| Primary orange | `#F04E23` | RGB 240/78/35 — "reddish orange" |
| Primary amber | `#FDB913` | RGB 253/185/19 |
| Secondary crimson | `#A71C20` | RGB 167/28/32 |
| Secondary grey | `#6E6E6E` | imagery rule 4.1: cam + xám trung tính |
| Gradient | `#F04E23→#FDB913`, `#A71C20→#F04E23` | official 2-stop |

**AA constraint:** `#F04E23` trên trắng ≈ 3.5:1 → fail text nhỏ. Text-accent
dùng bản đậm hoá `#C93A0F` (~4.9:1); fill/button/gradient giữ đúng official.

## Token mapping (fire, light / dark)

| Token | Light | Dark |
|---|---|---|
| `--color-accent` | `#C93A0F` | `#FF7A4D` |
| `--color-accent-hover` | `#B03209` | `#FF8F66` |
| `--color-accent-soft` | `#FDEAE3` | `#3D1D10` |
| `--color-accent-strong` | `#A5300E` | `#FF9B73` |
| `--color-accent-tint` | `rgba(240,78,35,.12)` | `rgba(255,122,77,.24)` |
| `--color-status-progress` | `#F04E23` | `#FF7A4D` |
| `--color-priority-normal` | `#F04E23` | `#FF7A4D` |

Semantic đỏ (`--color-overdue`, priority-urgent) **giữ Apple red** — đã tách
hue đủ xa vermilion; không đổi để không phá quy ước overdue quen mắt.
Status done/todo, greyscale, canvas: không đổi.

## Signature gradient — chỉ 2 chỗ

Triết lý G: gradient là **chữ ký, không phải sơn**. Hai class trong `index.css`:

- **`.brand-fill`** — fill tĩnh (active sidebar row). Blue → `var(--color-accent)`;
  fire → `linear-gradient(135deg,#F04E23,#F5941A)`.
- **`.brand-btn`** — primary CTA (New project, Create/Save trong dialog). Blue →
  accent + hover accent-hover; fire → `linear-gradient(135deg,#F04E23,#FDB913)`
  + hover `filter: brightness(.94)`.

Component đổi `bg-accent`/`hover:bg-accent-hover` → class tương ứng **chỉ ở 2
nhóm trên**. Mọi chỗ khác (link, focus ring, chip, ghost action) ăn theo token
accent tự động.

## Switch mechanism

- Hook **`useBrandTheme()`** (lib.ts) — mirror `useDarkMode`: state khởi tạo từ
  `safeStorage` key **`plan-up:brand`** (`'fire'` | `'blue'`), effect ghi
  `document.documentElement.dataset.brand` + persist.
- **Default = `fire`** (brand studio; user đổi lại blue được).
- CSS cascade: `@theme (:root)` → `.dark` → `[data-brand="fire"]` →
  `.dark[data-brand="fire"]` (thứ tự file đảm bảo override đúng ở cả 2 mode).
- **Toggle UI:** nút icon **Flame** ở footer sidebar, cạnh nút dark-mode (cùng
  idiom: ghost icon button, không settings page). Fire active → icon tint
  accent; title "Switch to Cupertino Blue" / "Switch to ZingPlay Fire".

## Known gaps (chấp nhận, iteration sau nếu cần)

- **PNG export cards** (`PngExportCard`, `CollectionPngCard`) dùng inline hex
  light palette (accent blue) — screenshot lib cần hex tĩnh. Chưa theo brand.
- **App icon Tauri / favicon** vẫn icon cũ — đổi icon là việc riêng (asset
  pipeline), không thuộc token swap này.
- Không có keyboard shortcut cho brand switch (tần suất thấp).

## Non-goals

- Không thêm theme thứ 3 / theme tuỳ chỉnh.
- Không đổi typography theo brand (Avenir Next) — SF Pro là DNA Cupertino.
- Không nhuộm canvas ấm (đã thử ở demo v1, loại vì nhìn bẩn).
