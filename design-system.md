# plan-tmp · Design System

Single source of truth cho UI/UX. Mọi feature mới phải tuân theo file này. Khi chưa rõ, đọc lại đây trước khi code.

## 1. Sản phẩm DNA (giữ trong đầu mọi lúc)

- **"ClickUp without the seat tax"** — single-user / virtual members / no auth.
- **Speed > breadth.** ClickUp chậm là pain point. Mỗi action ≤ 1 click hoặc 1 keystroke.
- **Local-first.** IndexedDB là nhà. Export/Import là backup. Không bao giờ block trên network.
- **Calm utility.** Đây là tool dùng hàng ngày, không phải sản phẩm cần "wow". Calm > cute.

Bất kỳ feature nào không support 1 trong 4 cái trên → defer hoặc cut.

## 2. Brand spec

### 2.1 Accent · Rust `#C04A1A`

Rust là **signature color duy nhất**. Không thêm accent thứ hai. Dùng cho:

| Element | Token | Class |
|---|---|---|
| Logo dot | `--color-accent` | `bg-accent` |
| Primary button | `--color-accent` + hover `--color-accent-hover` | `bg-accent hover:bg-accent-hover` |
| Focus ring | `--color-accent` 40% alpha | `ring-2 ring-accent/40` |
| In-progress status | `--color-status-progress` (= accent) | inline style từ STATUS_META |
| Overdue date | red-500 (đỏ thật, không phải accent) | `text-red-500` |
| Empty-state hint background | `--color-accent-soft` | `bg-accent-soft` |

**Cấm**: gradient với accent. Accent là **chấm** trong calm canvas. Một gradient = phá hỏng signature.

### 2.2 Neutrals (tone warm)

Toàn bộ greyscale **lệch warm**, không phải zinc thuần. CSS variables ở `src/index.css`:

| Token | Light | Dark | Dùng cho |
|---|---|---|---|
| `--color-canvas` | `#fafaf7` | `#0c0c0e` | Background tổng |
| `--color-surface` | `#ffffff` | `#18181b` | Card, header, dialog |
| `--color-surface-hover` | `#f5f5f3` | `#232326` | Hover state |
| `--color-border` | `#e5e5e0` | `#2a2a2d` | Card divider, default border |
| `--color-border-strong` | `#d4d4cf` | `#3a3a3e` | Dashed empty borders |
| `--color-ink` | `#18181b` | `#e4e4e7` | Text chính |
| `--color-ink-muted` | `#71717a` | `#a1a1aa` | Secondary text |
| `--color-ink-faint` | `#a1a1aa` | `#71717a` | Tertiary (count, icon idle) |

**Quy tắc**: không hardcode hex trong JSX. Đụng đến màu → thêm token.

### 2.3 Status & Priority colors

Cố định, không sửa tùy hứng:

```
status-todo      #a1a1aa (= ink-faint)
status-progress  #c04a1a (= accent — đây là "tâm điểm" của workflow)
status-done      #16a34a (green-600)

priority-urgent  #dc2626 (red-600)
priority-high    #ea580c (orange-600)
priority-normal  #3b82f6 (blue-500)
priority-low     #71717a (gray-500)
priority-none    #d4d4d8 (gray-300)
```

Done là xanh lá, không phải accent — vì done = "thoát khỏi context", không phải "đang trong context".

## 3. Typography

- **Một font family duy nhất**: `ui-sans-serif, system-ui` (đã set trong `body`). Không thêm display font nào nữa cho đến khi product đủ trưởng thành để biết mình cần một signature riêng.
- **Kích thước**:
  - App title "Plan": `text-2xl` (24px) `font-semibold tracking-tight`
  - Section heading (dialog title): `text-lg` (18px) `font-semibold`
  - Body: `text-sm` (14px) default
  - Metadata, hint: `text-xs` (12px)
  - Label uppercase (stat banner): `text-[11px] uppercase tracking-wider font-medium`
- **Weights**: 400 (text), 500 (label/medium), 600 (heading). Không dùng 700+.
- **Antialias**: bật ở `body` rồi, không override.

## 4. Layout principles

### 4.1 Card-per-group, không monolithic list

**Đúng**: mỗi member là 1 card riêng, gap `space-y-3` (12px) giữa các card. Card có border + rounded-lg + surface bg.

**Sai**: bọc tất cả trong 1 card lớn rồi `divide-y` giữa các group. Đó là pattern cũ — mọi group trông giống nhau, mắt không scan được nhanh.

### 4.2 Max-width cho main content

`max-w-5xl` (64rem ≈ 1024px). Sprint view không cần rộng hơn. Wider = mắt phải sweep xa, đọc chậm.

### 4.3 Spacing scale

Stick với Tailwind scale, không freelance:
- Inside card padding: `px-4 py-2.5` cho row, `px-4 py-3` cho header
- Between cards: `space-y-3` (12px)
- Section gap: `py-5` cho banner area, `pb-12` cho main bottom

### 4.4 Sticky header

Header `sticky top-0 z-10` + `bg-surface` (opaque). Scroll vẫn thấy sprint dropdown + search. **Không** dùng backdrop-blur trong header — đây là tool work, blur làm text khó đọc khi scroll.

### 4.5 Capacity banner is product, not chrome

3 stat cards (Backlog / Assigned% / Progress%) là **product feature** — biết capacity ngay khi mở app là core value. Không bao giờ ẩn nó behind toggle. Khi sprint empty → card "Backlog" hiện accent color để gọi action.

## 5. Component rules

### 5.1 Avatar

- 1 chữ first-letter, không phải 2. Lý do: 2 chữ làm circle nặng visual, conflict với task title.
- Color deterministic theo `colorForName(name)` (hash → palette 8 màu). **Không** random, **không** user-pick.
- Sizes: `w-7 h-7` cho member header, `w-6 h-6` cho task row.

### 5.2 Status — 2 forms cho 2 affordance

- **StatusDot** (circle border): click → cycle todo → in_progress → done. Quick toggle. Đứng đầu task row.
- **StatusPicker** (text + dropdown): chọn arbitrary state. Đứng cuối task row.

Hai cái cùng tồn tại có chủ ý: dot cho power user (1 click), text cho clarity. Không gộp.

### 5.3 Priority — flag-only

Chỉ icon flag, màu = priority color. Click mở native select dưới opacity-0. **Không** show text "Normal/High" inline — chật.

### 5.3.1 Smart defaults khi tạo task

Khi user gõ "+ Add task" và Enter, field mặc định phải **hữu ích nhất có thể** — không phải null fest. Hiện tại:

| Field | Default | Lý do |
|---|---|---|
| `status` | `todo` | Mới = chưa làm |
| `priority` | `normal` | Trung tính, user dễ điều chỉnh |
| `startDate` | `sprint.startDate` | **Task thuộc sprint nào thì mặc định bắt đầu cùng sprint đó.** User chỉ override khi task có start trễ. |
| `dueDate` | `null` | Quá nhiều task không có hạn cụ thể — đừng giả định |
| `assigneeId` | Member của group đang Add | Inline "+ Add task" trong group nào → assign cho member đó |
| `estimate` | `null` | Optional field, user fill khi cần planning |

**Quy tắc**: default nào tốn 1 click để override mỗi lần thì là tax. Nếu 80% trường hợp đúng → set default. Nếu < 50% → để null.

**Cách thread default qua component tree**: prop drilling từ `App.tsx → SprintView → MemberCard → AddTaskRow`. Không dùng context vì context ẩn data flow; prop explicit dễ trace. Nếu tree sâu > 4 levels thì xem xét context.

### 5.4 Due date — luôn `dd/mm/yy`

Mọi date hiển thị (task start, task due, sprint range) dùng **duy nhất** format `dd/mm/yy` (zero-padded, locale-independent) qua `formatShortDate()` trong `lib.ts`. Không có relative ("Today", "Fri", "2 days ago") nữa — user feedback: nhất quán giá trị hơn nhân-văn-hoá ngày tháng.

- `formatRelativeDate(null) → ''`
- `formatRelativeDate('2026-06-05') → '05/06/26'`
- `formatSprintRange(start, end) → '03/06/26 – 16/06/26'`

**Đừng dùng `toLocaleDateString()` cho format hiển thị** — locale user khác nhau (US: M/D, EU: D/M, JP: Y-M-D) → kết quả không nhất quán giữa máy. Locale chỉ dùng được cho weekday/month name nếu sau này cần.

Overdue (past + not done) → `text-red-500 font-medium`. Empty → Calendar icon nhạt thay placeholder text.

**Lý do bỏ relative format**: tưởng là "thân thiện" nhưng làm cho 2 task cùng tuần khó so sánh (`Fri` vs `Sun` — phải tính trong đầu); và "Today" thay đổi giá trị mỗi ngày (cùng 1 ngày hôm qua là Today, hôm nay là Yesterday) → tracking khó. dd/mm/yy stable + scannable.

### 5.5 Native picker — `<select>` + `<input type=date>` cùng pattern

Khi cần native picker (dropdown / date) nhưng UI muốn custom look (icon-only / chip), có 2 cấu hình theo nhu cầu:

**5.5a · `<select>` ẩn (cho assignee, priority, status):**
```jsx
<label className="relative inline-flex">
  <span>{icon-or-text}</span>
  <select className="absolute inset-0 opacity-0 cursor-pointer">...</select>
</label>
```
Click vào label → input nhận focus → native dropdown mở. Đơn giản, hoạt động trên cả mobile + a11y free.

**5.5b · `<input type=date>` qua button (cho date cells):**

Date picker khác select ở chỗ user nói "khó tap": `<select>` chỉ cần focus thì mở, nhưng `type=date` cần **explicit user gesture** trên input. Pattern button + `showPicker()` chuẩn hơn:

```jsx
<button type="button" onClick={open}>
  <span>{label}</span>
  <input ref={ref} type="date" className="absolute inset-0 opacity-0 pointer-events-none" tabIndex={-1} aria-hidden />
</button>

function open(e) {
  e.preventDefault(); e.stopPropagation()
  const el = ref.current
  if (typeof el.showPicker === 'function') { try { el.showPicker(); return } catch {} }
  el.focus(); el.click()
}
```

**Lý do button thay label cho date:**
1. `showPicker()` (Chrome/Edge/FF/Safari 16+) là API chính thức mở native date picker — gọi explicit reliable hơn `label→input` semantics (Safari iOS bug-prone).
2. Button = touch target lớn rõ ràng (h-8 px-2 + border hover). User biết tap được.
3. `pointer-events-none` trên input → click không bị input "ăn" → mọi click qua button onClick → mở picker.
4. Try/catch fallback `focus + click` cho Safari < 16.

**Affordance bắt buộc cho cell có giá trị:**
- Whole cell là button (w-full h-8 min) — NOT chỉ span text nhỏ.
- `border border-transparent hover:border-border-strong hover:bg-canvas` → chip xuất hiện khi hover, user biết đây là field editable.
- Empty state: icon (Calendar) thay placeholder text → đỡ confused với data.

**Bài học**: span text-xs đứng đơn lẻ trong cell w-20 = touch target ~30×16px. Quá nhỏ cho mobile, quá kín đáo cho desktop. **Cell có thể click PHẢI có visual signal** (border, hover bg, full-width target). Đừng rely vào "user mouse tới đúng text nhỏ".

### 5.6 Hover-reveal delete

Mọi delete button (member, task) dùng `opacity-0 group-hover/<scope>:opacity-100`. Không bao giờ persistent — quá dễ misclick. Luôn có `confirm()` cho member delete (cascade), không cho task (dễ undo bằng tay).

**Quy tắc bắt buộc**: hover-reveal Tailwind cần `group/<scope>` class trên **parent** element. Quên class này → button không bao giờ hiện. Hai scope hiện đang dùng:

| Scope | Parent có class | Button có class |
|---|---|---|
| `card` | `Card` div (`group/card`) | Member delete trong `GroupHeader`: `group-hover/card:opacity-100` |
| `row` | TaskRow div (`group/row`) | Task delete: `group-hover/row:opacity-100` |

Khi thêm scope mới, ghi vào bảng này.

### 5.7 Inline edit là default

Title, assignee, date, priority, status — tất cả inline. **Không** mở modal/drawer cho task detail (chưa đến lúc). Khi cần thêm field (description, attachments) → mở row expand inline, không modal.

### 5.8 Column system — tất cả task row đều phải align

Vì có column header (TaskColumnHeader), mọi row hiện task data PHẢI dùng cùng column widths. Định nghĩa ở `COL` constant trong `SprintView.tsx`:

```
COL.dot       w-4         status dot / + icon
COL.title     flex-1      task title input
COL.assignee  w-7         avatar
COL.start     w-20        start date (relative), right-aligned
COL.due       w-20        due date (relative), right-aligned
COL.priority  w-6         flag icon
COL.status    w-28        status text picker
COL.trash     w-5         hover-reveal delete
```

Gap giữa columns: `gap-3` (12px). Padding row: `px-4 py-2`.

**Quy tắc**: bất kỳ row nào hiện task-shape (TaskRow, AddTaskRow, future bulk-action row...) phải dùng `COL.*` classes. Header và row phải sync — đổi 1 chỗ thì đổi cả 2. Khi thêm column mới (vd: estimate), thêm vào `COL` + `TaskColumnHeader` + tất cả row consumers cùng commit.

**Date cells** (start, due) đều dùng cùng component `DatePickCell` — pass `value`, `onChange`, optional `highlight='overdue'` cho due-only red highlight. Không duplicate code giữa start và due. Khi thêm date-shaped field thứ 3 (vd: completed-at) → vẫn dùng `DatePickCell`.

**Khi nào hide column header**: khi `tasks.length === 0 && unassigned.length === 0` (chưa có task nào trong sprint). Header rỗng treo lơ lửng = visual noise.

### 5.9 Collapse / expand per-group

Group có nhiều task (>5 row) tiêu tốn screen real estate. Pattern collapse:

- **Trigger**: click bất kỳ đâu trên `GroupHeader` row (cursor-pointer, hover bg-surface-hover). KHÔNG dùng riêng chevron — toàn row clickable để hit-target rộng.
- **Visual**: `ChevronDown` icon đứng đầu row, rotate `-rotate-90` khi collapsed. Animated với `transition-transform`.
- **Affordance phân biệt**: khi collapsed, bỏ `border-b` của header để header trông "đóng kín" không hint có gì bên dưới.
- **Delete button trong header**: dùng `e.stopPropagation()` để không trigger collapse khi xóa member.
- **Persistence**: collapse state lưu localStorage key `plan-tmp:collapsed:{sprintId}`, format là array JSON các memberId. Per-sprint key vì user thường có pattern khác nhau giữa các sprint.
- **Reset khi đổi sprint**: state load lại từ localStorage trong `useEffect(() => ..., [sprintId])` — tránh state leak giữa sprint.

**Khi nào group KHÔNG collapsible**: Unassigned card không collapse (orphan task cần visibility). Empty members đã ẩn sau toggle riêng (`Show N members with no tasks`), không cần collapse-in-place.

### 5.8 Ghost buttons cho secondary actions

"+ Add member", "+ Add task", "Show N empty members" → dashed border hoặc text-only. Solid bg-accent chỉ dành cho **primary** action trong dialog ("Create", "Save"). Header buttons (Export/Import/Dark toggle) → ghost.

## 6. Interaction rules

### 6.1 Keyboard shortcuts (đã ship)

| Phím | Action | Khi nào |
|---|---|---|
| `/` | Focus search | Khi không trong input |
| `n` | Mở New Sprint dialog | Khi không trong input |
| `Esc` | Clear search | Khi có search query |
| `⌘⇧D` / `Ctrl⇧D` | Toggle dark mode | Bất cứ đâu |

**Quy tắc mở rộng**: phím đơn (1 ký tự) chỉ bind khi không trong input. Combo `⌘/Ctrl + key` cho global. Mọi shortcut mới phải:
1. Tránh conflict với browser/OS (không bind `⌘N`, `⌘T`).
2. Có visual hint (kbd badge) hoặc list trong dialog "?".

### 6.2 Persistence rules

- IndexedDB: tất cả data (members, sprints, tasks). Schema versioned qua Dexie `version().stores().upgrade()`.
- localStorage: chỉ UI preference (dark mode flag `plan-tmp:dark`). Không bao giờ data.
- URL: hiện chưa dùng. Nếu sau này thêm sprint ID vào URL → query param `?sprint=<id>`, không hash.

### 6.3 Form submit

Mọi inline input phải accept Enter để commit. Escape để cancel khi đang trong "add mode". Click outside KHÔNG cancel — quá dễ mất việc.

### 6.4 Confirm trước destructive action

- Delete member → confirm "tasks become Unassigned".
- Delete task → confirm "Delete this task?".
- Import JSON → confirm "REPLACE all current data".

Không confirm khi: toggle status, change priority, clear date — đều dễ undo bằng tay.

## 7. State & data rules

### 7.1 useLiveQuery cho mọi DB read

Không tự subscribe Dexie events. `useLiveQuery` từ `dexie-react-hooks` đã handle re-render khi DB thay đổi (kể cả từ tab khác). Pass empty array sentinel khi chưa sẵn sàng, không trả `undefined` thẳng.

### 7.2 Optimistic updates không cần

Dexie write là local + sync (sub-ms). Không cần optimistic UI. Trực tiếp `db.x.update()` rồi `useLiveQuery` re-render. Nếu sau này thêm sync layer → revisit.

### 7.3 Race & idempotent

Mọi async setup (seed, migration) phải idempotent + race-safe. Pattern: module-level promise lock như `seedIfEmpty()` trong `db.ts`. StrictMode dev sẽ mount useEffect 2 lần — code phải chịu được.

### 7.4 Schema migration

Khi đổi schema, làm theo thứ tự (đã thực hành v1 → v2 cho `Task.startDate`):

1. **Update interface** (vd: thêm `startDate: string | null` vào `Task`).
2. **Bump version** trong `PlanDB` constructor: `this.version(N+1).upgrade(tx => ...)`. Nếu indexes không đổi (chỉ thêm data field), bỏ qua `.stores({...})` ở version mới — Dexie kế thừa schema cũ.
3. **Backfill cho data cũ**: `.upgrade(tx => tx.table('tasks').toCollection().modify(t => { if (t.X === undefined) t.X = defaultValue }))`.
4. **Backfill cho import legacy**: trong `importAll`, dùng spread `{ defaultValue, ...task }` để fill field thiếu từ export cũ.
5. **Update seedFresh**: include field mới.
6. **Update tests**:
   - Test factories (mọi nơi construct Task literal) thêm field mới.
   - Thêm 1 test "backfills missing X from legacy v1 exports" → đảm bảo import file cũ không break.
7. **ExportPayload.version**: giữ nguyên (= 1) nếu chỉ thêm field optional. Bump khi field bắt buộc và không có default.

Không bao giờ silently change schema. Migration phải reversible-in-spirit: import file cũ vẫn work.

## 8. Anti-patterns (cấm tuyệt)

### 8.1 AI slop

- ❌ Gradient backgrounds (purple/blue), neon, glassmorphism.
- ❌ Emoji as icon trong UI chính (welcome string OK).
- ❌ Generic Tailwind blue `bg-blue-500` cho primary action — đã có `bg-accent`.
- ❌ Stock illustration / Unsplash decorative image.
- ❌ Modal backdrop blur trừ khi đã có lý do.

### 8.2 Trùng affordance

- ❌ Hai cách làm cùng 1 thing (vd: "+ Sprint" button **và** dropdown option). Chọn 1.
- ❌ Settings page sớm. Mỗi setting → hỏi "có thể inline không?". Dark toggle là icon trong header, không phải `/settings`.

### 8.3 Premature feature

- ❌ Tags, labels, sub-tasks, dependencies, custom fields — chưa cần. Wedge là sprint + assignee + status.
- ❌ Multi-tenancy, team collaboration, real-time. Single-user là feature, không phải bug.
- ❌ Animation transitions > 300ms. Productivity tool không màn show off.

### 8.4 Visual debt

- ❌ Inconsistent spacing (mix `gap-2` vs `gap-3` vô lý).
- ❌ Mix `rounded` (mặc định) với `rounded-lg`, `rounded-md` không theo rule (dưới đã thiết lập: `rounded-md` cho input/button, `rounded-lg` cho card, `rounded` cho icon button, `rounded-full` cho avatar/dot).
- ❌ Hardcode color trong JSX (`bg-zinc-100`) — luôn dùng token.

## 9. Decision checklist cho feature mới

Trước khi code, tự hỏi 7 câu:

1. **Wedge alignment**: feature này có support 1 trong 4 DNA (no-auth / speed / local-first / calm) không?
2. **Affordance density**: nó có chiếm visual real estate xứng đáng với tần suất dùng không? (Add member dùng 1/tuần — không xứng 1 row hero.)
3. **Keyboard path**: power user có thể trigger bằng phím được không?
4. **Empty state**: feature này có handle "0 records" gracefully không?
5. **Dark mode**: có dùng token, không hardcode color?
6. **Schema impact**: có cần version bump + migration test không?
7. **Anti-slop check**: có element nào trong section 8 không?

Nếu trả lời "không" cho ≥ 2 câu → revisit thiết kế.

## 10. File map

```
plan-tmp/
├── design.md              ← product spec (premises, scope, success criteria)
├── design-system.md       ← FILE NÀY (UI/UX principles)
├── CLAUDE.md              ← code layout rule (root vs app/)
└── app/
    └── src/
        ├── index.css      ← @theme tokens + dark mode + welcome-pulse keyframe
        ├── lib.ts         ← formatRelativeDate, isOverdue, formatSprintRange, useDarkMode
        ├── db.ts          ← Dexie schema, uid, colorForName, deleteMember, export/import, seed
        ├── App.tsx        ← Header, capacity banner, search, keyboard handler, NewSprintDialog
        ├── SprintView.tsx ← Card layout, MemberCard, UnassignedCard, TaskRow + sub-components
        └── db.test.ts     ← Vitest + fake-indexeddb smoke + race tests
```

## 11. Khi nào update file này

- Khi accent color hoặc 1 trong 4 DNA principle thay đổi → update + commit message giải thích lý do.
- Khi thêm component pattern mới (vd: Drawer, Toast) → thêm vào section 5.
- Khi thêm keyboard shortcut → thêm vào table section 6.1.
- Khi thấy ai (kể cả bản thân) code đi ngược file này → push back, không silent merge.

File này là **constitution**, không phải README. Nó định nghĩa cái gì là plan-tmp và cái gì không.
