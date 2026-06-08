# plan-up · Design System

Single source of truth cho UI/UX. Mọi feature mới phải tuân theo file này. Khi chưa rõ, đọc lại đây trước khi code.

> **v2 · Cupertino DNA (2026-06)** — design language đổi từ "Jira/rust" sang **Apple Cupertino**: SF Pro, canvas xám Apple, accent xanh hệ thống, bo góc lớn mềm, vibrancy sidebar, depth thay vì đường kẻ. Phần **brand/typography/layout/component-visual** viết lại theo DNA này; phần **hành vi** (smart defaults, native picker, schema, keyboard, state) giữ nguyên vì vẫn đúng. Bản rust cũ nằm trong git history.

## 0. Aesthetic DNA — "Cupertino"

App là một **precision tool mang cảm giác native macOS app** (Reminders / Things-on-Mac / Notes). Triết lý hình ảnh:

- **Calm & premium** — thoáng, ít chrome, để nội dung thở. Không "wow", không trang trí.
- **Depth, không phải line** — phân tách bằng **bóng mềm + nền phân tầng** (canvas xám → thẻ trắng), hairline chỉ dùng bên trong thẻ. Hạn chế viền đậm.
- **Bo góc lớn, liên tục** — mọi bề mặt bo mềm (14px thẻ, full-pill cho control nhỏ).
- **Một accent xanh hệ thống**, phần còn lại là greyscale Apple. Màu = semantic, không trang trí.
- **Vibrancy** — sidebar mờ kính (translucent + blur), gợi chiều sâu vật liệu.

## 1. Sản phẩm DNA (giữ trong đầu mọi lúc)

- **"ClickUp without the seat tax"** — single-user / virtual members / no auth.
- **Speed > breadth.** Mỗi action ≤ 1 click hoặc 1 keystroke.
- **Local-first.** IndexedDB là nhà. Export/Import là backup. Không bao giờ block trên network.
- **Calm utility.** Tool dùng hàng ngày, calm > cute.

Feature không support 1 trong 4 cái trên → defer hoặc cut.

## 2. Brand spec

### 2.1 Accent · System Blue `#0071E3`

Một accent **duy nhất** (Apple marketing/system blue). Không thêm accent thứ hai. Dùng cho:

| Element | Token (light) | Ghi chú |
|---|---|---|
| Active sidebar row | `--color-accent` (nền đầy, chữ trắng) | highlight bo tròn kiểu macOS sidebar |
| In-progress status | `--color-status-progress` (= accent) | chip + status icon |
| Link / toolbar action (Export/Import/Roll over) | `--color-accent` text | ghost, không nền |
| Focus ring / active border | `--color-accent` | `ring`/`border` |
| Dependency chip, "Add task" | `--color-accent` trên `--color-accent-soft` | |
| Selected segment indicator | trắng nổi trên track xám (không phải accent) | segmented control |

**Cấm**: gradient accent toàn khối, dùng accent làm trang trí. Accent là **tín hiệu**, không phải nền.

### 2.2 Neutrals — Apple system grey

Greyscale theo **hệ xám Apple** (lệch nhẹ cool, gần neutral). CSS variables ở `src/index.css`:

| Token | Light | Dark | Dùng cho |
|---|---|---|---|
| `--color-canvas` | `#F5F5F7` | `#1C1C1E` | Background tổng (xám Apple) |
| `--color-surface` | `#FFFFFF` | `#2C2C2E` | Thẻ, header, dialog |
| `--color-surface-hover` | `rgba(0,0,0,0.02)` | `rgba(255,255,255,0.04)` | Hover row |
| `--color-vibrancy` | `rgba(248,248,250,0.72)` | `rgba(30,30,32,0.62)` | Sidebar mờ kính (+ backdrop-blur) |
| `--color-separator` | `#E5E5EA` | `rgba(255,255,255,0.10)` | Hairline bên trong thẻ |
| `--color-separator-soft` | `rgba(0,0,0,0.055)` | `rgba(255,255,255,0.06)` | Đường rất nhẹ |
| `--color-ink` | `#1D1D1F` | `#F5F5F7` | Text chính |
| `--color-ink-muted` | `#6E6E73` | `#AEAEB2` | Secondary |
| `--color-ink-faint` | `#A1A1A6` | `#8E8E93` | Tertiary (count, label, icon idle) |

**Quy tắc**: không hardcode hex trong JSX. Đụng màu → thêm token.

### 2.3 Status & Priority — hệ màu Apple

Cố định, không sửa tùy hứng (dùng đúng system colors để cảm giác "native"):

```
status-todo      #8E8E93  (system grey)
status-progress  #0071E3  (= accent — tâm điểm workflow)
status-done      #34C759  (system green / dark #30D158)
overdue          #FF3B30  (system red / dark #FF453A)

priority-urgent  #FF3B30  (system red, soft bg rgba(255,59,48,.12))
priority-high    #FF9500  (system orange, soft bg rgba(255,149,0,.14))
priority-normal  —        (không hiển thị tag — silent default)
priority-low     #8E8E93  (grey, hiển thị tiết chế)
```

Done là **xanh lá** (Apple green), không phải accent — done = "thoát khỏi context".

### 2.4 Avatar palette — Apple system colors

Màu avatar deterministic theo `colorForName(name)`, palette = **hệ màu Apple** (không random, không user-pick):

```
#AF52DE purple · #34C759 green · #FF9500 orange · #0071E3 blue
#FF2D55 pink · #5AC8FA teal · #5856D6 indigo · #FF6482 salmon
```

Avatar = **vòng tròn đặc** màu trên, chữ trắng first-letter.

## 3. Typography

- **Font family: SF Pro (hệ thống Apple).** Stack: `-apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif`. **Bỏ DM Sans + Geist Mono.** Trên máy Apple render SF Pro thật; non-Apple fallback system sans.
- **KHÔNG dùng monospace cho dữ liệu.** Số (ID, ngày, effort, count, capacity) dùng SF với `font-variant-numeric: tabular-nums` (`font-feature-settings: 'tnum'`) để thẳng cột. Đây là cách Apple typeset số — khác hẳn bản mono trước.
- **Kích thước**:
  - Large title (project name): `text-[21px]` (≈21px) `font-bold tracking-[-0.022em]`
  - Sprint title (header): `text-[18px] font-bold tracking-[-0.018em]`
  - Group/section heading: `text-[15.5px] font-semibold tracking-[-0.01em]`
  - Body / task title: `text-[14.5px]` `tracking-[-0.006em]`
  - Metadata (date, effort, count): `text-[13px]`
  - Micro label / column header: `text-[11px] font-semibold` (KHÔNG uppercase tracked kiểu mono nữa — Apple dùng label thường, nhỏ, xám)
- **Weights**: 400 (text), 500 (medium/label), 600 (heading), 700 (large title). Heading lớn → `tracking-tight`.
- **Antialias**: `-webkit-font-smoothing: antialiased` ở body.

## 4. Layout principles

### 4.1 Inset-grouped cards trên canvas xám

**Đúng**: canvas xám `--color-canvas`; mỗi member là 1 **thẻ trắng bo 14px nổi nhẹ** (soft shadow), gap `space-y-4` (16px). Đây là "inset grouped" của macOS — depth tách group, không phải border.

**Sai**: bọc tất cả trong 1 thẻ lớn rồi `divide-y`; hoặc thẻ có viền đậm + không shadow (đó là ledger/flat, không phải Cupertino).

### 4.2 Depth tokens (shadow)

| Cấp | Shadow | Dùng cho |
|---|---|---|
| Card | `0 1px 2px rgba(0,0,0,0.04), 0 8px 22px rgba(0,0,0,0.05)` | Group card |
| Floating (popover, segmented pill) | `0 1px 3px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.04)` | Selected segment, dropdown |
| Window | `0 30px 80px rgba(0,0,0,0.34)` | (chỉ demo desktop window) |

Dark mode: shadow nhạt hơn nhiều, dựa vào separator + surface contrast.

### 4.3 Vibrancy sidebar

Icon rail + sprint panel dùng `background: var(--color-vibrancy)` + `backdrop-filter: blur(24px) saturate(180%)`. Border phải = `--color-separator-soft` (hairline). Đây là điểm "native macOS" — **được phép blur** ở sidebar (khác bản Jira cũ cấm blur header).

### 4.4 Max-width & spacing

- Main content `max-w-5xl`.
- Card padding: row `px-[18px] py-[11px]`, header `px-[18px] py-[13px]`.
- Between cards `space-y-4` (16px). Generous hơn bản cũ — Apple thoáng.

### 4.5 Radius scale (bắt buộc nhất quán)

| Phần tử | Radius |
|---|---|
| Group card, dialog | `rounded-[14px]` |
| Button, input, segmented track/segment, project icon tile | `rounded-[8px]` |
| Pill (search, status chip, priority tag, date pill, dependency) | `rounded-full` |
| Avatar, status circle, sidebar dot | `rounded-full` |

### 4.6 Segmented control (List / Board)

Track xám `rgba(0,0,0,0.06)` bo 9px + segment chọn = **nền trắng nổi** (floating shadow). Đây là control chuẩn Apple, thay cho 2 nút toggle rời.

### 4.7 Capacity = thanh tròn + label SF

Thanh `rounded-full` xếp tầng (done xanh / assigned accent / free xám), kèm legend SF tabular ("8 days done", "18 of 30 assigned · 60%"). Vẫn là **product feature**, không ẩn sau toggle. Sprint empty → gọi action.

## 5. Component rules

### 5.1 Avatar
- 1 chữ first-letter. `colorForName` (§2.4). **Không** random/user-pick.
- Vòng tròn đặc. Sizes: `w-7 h-7` group header, `w-6 h-6` task row.

### 5.2 Status circle (Reminders-style) + status pill
- **StatusCircle** (đầu row): vòng tròn click → cycle todo → in_progress → done.
  - todo: vòng viền xám rỗng `#C7C7CC`
  - in_progress: viền accent + nửa trong đầy accent (pie 50%)
  - done: tròn đặc xanh `#34C759` + check trắng
- **Status pill** (cột Status): `rounded-full` nền soft-tint + dot + label ("To Do" / "In Progress" / "Done"). todo grey-soft, in-progress accent-soft, done green-soft.
- Hai cái cùng tồn tại: circle = quick toggle 1 click, pill = trạng thái rõ + chọn arbitrary.

### 5.3 Priority — tag pill soft, chỉ urgent/high
- `rounded-full` soft-tint: Urgent (đỏ-soft) / High (cam-soft). Normal/Low/None **không** hiện tag (silent).
- Đặt trước task title. Không sticker vuông đậm.

### 5.3.1 Smart defaults khi tạo task *(giữ nguyên — hành vi)*

| Field | Default | Lý do |
|---|---|---|
| `status` | `todo` | Mới = chưa làm |
| `priority` | `normal` | Trung tính |
| `startDate` | `sprint.startDate` | Task thuộc sprint nào → bắt đầu cùng sprint |
| `dueDate` | `null` | Đừng giả định hạn |
| `assigneeId` | Member của group đang Add | Inline Add trong group nào → assign member đó |
| `estimate` | `null` | Optional |

Prop drilling `App → SprintView → MemberCard → AddTaskRow`. Default tốn 1 click override mỗi lần = tax.

### 5.4 Date — Apple-native `MMM d` *(ĐỔI so với bản cũ)*
- Hiển thị **"MMM d"** (vd `May 19`, `Jun 1`); range `MMM d – MMM d`; có năm khi cần `MMM d, yyyy`. SF tabular-nums.
- **Lý do đổi từ `dd/mm/yy`**: feel native Apple, tên tháng dễ đọc; vẫn nhất quán (luôn cùng format). Tháng viết tắt locale-independent (en).
- Overdue (past + not done) → `--color-overdue` đỏ + `font-semibold`. Empty → mặc định dấu "—" nhạt.
- **Empty = quiet dashed pill (opt-in).** `DatePickCell` có prop `emptyHint` → ô trống render **pill viền đứt** `＋ {hint}` (hover thành accent) thay cho "—", để "đọc ra bấm được" (idiom days-off). `emptyHintHover` → pill chỉ hiện khi hover row (`group/row`) — dùng cho hàng dày như sprint List để không nhiễu. **Không** áp cho ô `locked` (scheduler tính). Collection rows luôn hiện pill; sprint List chỉ hover + chỉ ô unlocked.
- ⚠️ *Đây là decision có thể revert về dd/mm/yy nếu user thích — flag trong commit.*

### 5.5 Pickers
- **Chọn 1 trong tập nhỏ** (assignee/priority/status): `<select>` ẩn — label + `<select className="absolute inset-0 opacity-0">`. Native, keyboard sẵn, ít chrome (dùng cho cả per-column sort của Board).
- **Ngày tháng**: **custom Cupertino calendar popover** (`DatePicker.tsx`: `DatePickCell`, `DateField`) — KHÔNG còn `<input type=date>` native. Lý do đổi: native là chrome trình duyệt, không nhất quán/không dark-aware/không hiện được context lịch. Calendar mới: Mon-start, today ring, selected fill, cuối tuần mờ-nhưng-chọn-được, **chấm day-off của assignee** (cam, nửa chấm = half-day), out-of-range (min/max) bị mờ/khoá, footer Today/Clear, keyboard ←→↑↓/Enter/Esc. Portal + outside-click, theo float-shadow §4.2. Chi tiết: [`design-docs/date-picker.md`](design-docs/date-picker.md).

### 5.6 Hover-reveal delete *(giữ nguyên — hành vi)*
- `opacity-0 group-hover/<scope>:opacity-100`. Scope `card` (member delete) + `row` (task delete). `confirm()` cho member (cascade), không cho task.

### 5.7 Inline edit là default
- Title/assignee/date/priority/status inline. Không modal cho task detail. Cần thêm field → expand row inline.
- **Rename = single-click + ✎ hover** (không double-click ẩn). Tên sprint / collection / table: click 1 lần vào tên → ô input inline; hover hiện icon ✎ nhạt báo "sửa được". Đồng bộ với task title (luôn-sửa-được). Bỏ pattern double-click + gạch chân chấm.

### 5.8 Column system — mọi task row align *(widths cập nhật theo Cupertino)*
Có column header → mọi row dùng cùng `COL` widths trong `SprintView.tsx`. Gap `gap-[13px]`, padding `px-[18px] py-[11px]`. Khi đổi 1 cột → đổi header + mọi consumer cùng commit. Date cells dùng chung `DatePickCell`. Hide column header khi sprint 0 task.

### 5.9 Collapse/expand per-group *(giữ nguyên — hành vi)*
Click cả `GroupHeader` row để collapse; ChevronDown rotate; persist localStorage `plan-up:collapsed:{sprintId}`; reset khi đổi sprint; delete dùng `stopPropagation`.

### 5.10 Ghost / toolbar actions
**Chrome-level actions** — "Roll over", "Export/Import" → **text xanh ghost** (Apple toolbar). Solid accent fill chỉ cho primary action trong dialog ("Create"/"Save"). "+ " trong sidebar = icon xanh mảnh. *(Lưu ý: "Add item/task" là inline-add row — §5.7, không phải ghost button; "Add table/member" là add-group slot — §5.11.)*

### 5.11 Add-a-group button (dashed slot) *(thống nhất 2026-06-08)*
Hành động **thêm một group-card mới** vào list card-per-group — Collection "Add table", Sprint "Add member" — dùng **chung một** affordance: nút full-width **viền đứt** (dashed slot = "một card sẽ xuất hiện ở đây"), **calm lúc nghỉ, accent khi có ý định**.

- Component dùng chung: **`AddGroupButton`** (`app/src/AddGroupButton.tsx`) — props `icon` (lucide) + `label` + `onClick`. Không copy-paste class, một nguồn sự thật để không lệch lại.
- Class: `w-full flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold text-ink-muted border border-dashed border-border rounded-[14px] transition hover:text-accent hover:border-accent/40 hover:bg-accent-soft`.
- **Lúc nghỉ:** `text-ink-muted` + viền đứt xám — bình tĩnh, **không** tô accent (accent là *tín hiệu*, không phải chrome — §2.1). **Hover:** text + viền + nền chuyển accent-soft → accent xuất hiện đúng lúc tay với tới.
- **Radius = `rounded-[14px]`** (radius của *group card*, không phải button 8px ở §4.5) — vì nó là **placeholder cho một card sắp tạo**, không phải nút toolbar.
- Icon lucide `size={14}`; glyph theo ngữ cảnh (`Plus` cho table, `UserPlus` cho member) nhưng *treatment* (size/màu/vị trí) đồng nhất.
- Đây cũng là việc gỡ **trùng affordance** (§8.3): trước đây Add table = accent dashed loud, Add member = ghost xám quiet — cùng một việc mà hai kiểu.

## 6. Interaction rules *(giữ nguyên)*

### 6.1 Keyboard shortcuts
`/` focus search · `n` new sprint · `Esc` clear search · `⌘⇧D`/`Ctrl⇧D` toggle dark. Phím đơn chỉ khi không trong input; combo cho global; mỗi shortcut mới phải tránh conflict OS + có hint.

### 6.2 Persistence
IndexedDB: data. localStorage: chỉ UI pref (`plan-up:dark`, collapse, `plan-up:sidebarWidth`, `plan-up:view`, `plan-up:currentProjectId`). URL: chưa dùng.

**Sidebar resize**: panel sprint kéo được (drag handle mép phải, clamp 200–460px, lưu `plan-up:sidebarWidth`). Icon rail giữ cố định (dải icon). Drag dùng document-level mousemove/up + khoá `userSelect`/`cursor` khi kéo.

### 6.3 Form submit
Inline input: Enter commit, Escape cancel khi add-mode. Click outside KHÔNG cancel.

### 6.4 Confirm trước destructive
Delete member / delete task / import (replace). Không confirm cho toggle status, change priority, clear date.

**Cách hiện confirm — KHÔNG dùng `window.confirm()`** (dialog OS xám phá DNA, §8). Dùng in-DNA:
- **Cupertino confirm sheet** (mặc định cho cascade nặng / cross-cutting): scrim `bg-black/25 backdrop-blur-md` + sheet trắng `rounded-[16px]`, nút Cancel (ghost) + nút hành động (đỏ nếu destructive). Dùng qua **`useConfirm()`** (provider `ConfirmDialog.tsx` bọc `<App>`): `if (!(await confirm({title, message, confirmLabel, destructive}))) return`. Drop-in thay cho `confirm()`.
- **Inline confirm** (cho hành động cục bộ trong 1 card/row — vd xoá table/status của collection): thanh nền đỏ nhạt Delete/Cancel ngay tại chỗ, không bật modal.

## 7. State & data rules *(giữ nguyên)*
- `useLiveQuery` cho mọi DB read. Không tự subscribe.
- Không cần optimistic (Dexie local sub-ms).
- Async setup idempotent + race-safe (StrictMode mount 2 lần).
- **Schema migration**: update interface → bump `version().upgrade()` → backfill data cũ + import legacy → update seedFresh + tests + ExportPayload.version. Import file cũ luôn phải work.

## 8. Anti-patterns (cấm tuyệt)

### 8.1 AI slop
- ❌ Gradient nền (purple/blue), neon, glassmorphism màu mè. *(Vibrancy sidebar trắng/xám OK — đó là material Apple, không phải gradient slop.)*
- ❌ Emoji as icon trong UI chính.
- ❌ Generic Tailwind `bg-blue-500` — dùng `--color-accent` (`#0071E3`).
- ❌ Stock illustration / decorative image.
- ❌ **Monospace cho data** — Cupertino dùng SF tabular-nums. Mono = sai DNA.

### 8.2 Sai DNA Cupertino (mới)
- ❌ Viền đậm + flat không shadow (đó là ledger). Phải có **depth**.
- ❌ Bo góc nhỏ/vuông cho card. Card luôn ≥ 14px mềm.
- ❌ Đường kẻ ô dày phân tách group (dùng khoảng trắng + shadow).
- ❌ Hardcode color trong JSX — luôn token.

### 8.3 Trùng affordance / premature
- ❌ Hai cách làm cùng 1 thing. Settings page sớm.
- ❌ Tags/sub-tasks/custom fields chưa cần. Multi-tenant/real-time. Animation > 300ms.

## 9. Decision checklist cho feature mới
1. **Wedge**: support 1 trong 4 DNA (no-auth/speed/local-first/calm)?
2. **Affordance density**: chiếm real estate xứng tần suất dùng?
3. **Keyboard path**: trigger bằng phím được?
4. **Empty state**: handle 0 records?
5. **Dark mode**: dùng token, không hardcode?
6. **Cupertino check**: SF (không mono)? depth (không flat)? radius ≥ rule? accent là tín hiệu (không trang trí)?
7. **Schema impact**: cần version bump + migration test?

≥ 2 câu "không" → revisit.

## 10. File map

```
plan-up/
├── design.md              ← product spec
├── design-system.md       ← FILE NÀY (UI/UX constitution · Cupertino DNA)
├── CLAUDE.md              ← code layout rule
└── app/src/
    ├── index.css      ← @theme tokens (Cupertino) + dark mode + SF stack
    ├── lib.ts         ← formatShortDate (MMM d), isOverdue, useDarkMode
    ├── db.ts          ← Dexie schema, colorForName (Apple palette), export/import, seed
    ├── App.tsx        ← rail, vibrancy panel, toolbar header, capacity, segmented control
    ├── SprintView.tsx ← inset-grouped MemberCard, StatusCircle, status pill, TaskRow + COL
    └── BoardView.tsx  ← board (Cupertino restyle)
```

## 11. Khi nào update file này
- Đổi accent / 1 trong 4 DNA / aesthetic DNA → update + commit giải thích.
- Thêm component pattern → section 5. Thêm shortcut → 6.1.
- Ai code ngược file này → push back, không silent merge.

File này là **constitution**. Nó định nghĩa cái gì là plan-up và cái gì không.
