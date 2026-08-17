# Project holidays — ngày nghỉ chung toàn project

**Status:** Implemented
**Last updated:** 2026-08-17 (bản đầu)
**Code:** `app/src/types.ts` (`Holiday`, `Project.holidays`), `app/src/scheduling.ts`
(`expandHolidays`, `projectHolidayMap`, `ProjectHolidayMap`, `leafPlan` union,
`recomputeDates`, `recomputeAllDates`), `app/src/scheduling-context.ts`
(`ProjectHolidaysContext`, `useProjectHolidays`), `app/src/db.ts`
(`setProjectHolidays`), `app/src/lib.ts` (`holidayWorkDays`),
`app/src/DatePicker.tsx` (`CalendarGrid` controlled-month props),
`app/src/ProjectHolidays.tsx` (`ProjectHolidaysButton`),
`app/src/App.tsx` + `app/src/ProjectSettingsView.tsx` (2 chỗ mount)

## Purpose

Trước đây chỉ có **[days-off theo từng member](./members-and-days-off.md)**. Nghỉ Tết,
Quốc khánh, offsite cả team → phải mở từng member, click từng ngày: `N member × M ngày`
lần thao tác, và **member mới join sau không có** những ngày đã set.

Ngày lễ là thuộc tính của **project**, không phải của người. Feature này cho set **một
lần cho cả project**, scheduler tự union vào mọi member.

## User-facing behavior

- **Trigger** — pill dạng lịch, có ở **2 chỗ** (cùng một component, `MemberDaysOffButton`
  đã có tiền lệ này):
  - **Sprint toolbar** (`hideWhenEmpty`) — **chỉ hiện khi sprint đang xem thật sự mất
    ngày** (`2d holidays`), bấm vào để sửa. Không có ngày lễ nào → **không render gì**.
    Lý do: ngày lễ set 1–2 lần một **năm**, để một nút "thêm" thường trú trên top bar là
    trượt checklist affordance-density (design-system §9.2) — và top bar đã chật với
    Roll over / Search / Share.
  - **Project settings** — `variant="metric"`, luôn hiện, đếm **toàn bộ** (không scope
    theo sprint). **Đây là nơi tạo mới** và là đường discovery, y hệt cách days-off của
    member sống trong settings.
- **Popover** — `glass-popover`, **lịch 2 tháng cạnh nhau**, dưới là danh sách kỳ nghỉ
  đã lưu.
- **Chọn dải = bấm 2 lần** (không phím phụ):
  1. Bấm ngày bắt đầu → hint đổi thành `Feb 3 – …`
  2. Rê chuột → dải **hiện preview live** theo con trỏ
  3. Bấm ngày thứ hai → chốt dải, hiện ô nhập tên + nút Save
  - Bấm vào ngày **trước** ngày bắt đầu = **đổi ngày bắt đầu**, không phải lỗi.
  - `Esc` bỏ dải đang chọn (không đóng popover ở nhịp đó — xem *Rules*).
- **Ngày đã lưu** hiện bằng **chấm cam** dưới ô — đúng idiom `daysOff` mà `CalendarGrid`
  đã dùng sẵn. Cố ý **không** tô accent đặc: trong mọi picker khác của app, accent đặc
  nghĩa là *dải đang chọn*. Hai trạng thái, hai visual, không đụng nhau.
- **Xoá** — hover dòng trong danh sách dưới lịch → nút X (giống hệt cách xoá một ngày
  trong popover days-off). Không confirm: §6.4 chỉ bắt confirm cho delete
  member/task/import, và thêm lại chỉ mất 2 cú bấm.
- **Đếm ngày công** — badge hiện số **ngày công** mất đi, đã trừ T7/CN: Tết 9 ngày lịch
  mà rơi 2 ngày cuối tuần thì hiện `7d`.
- **Empty state** — *"Chưa có ngày nghỉ chung. Cuối tuần đã tự động nghỉ sẵn."*

### Lịch 2 tháng dùng lại `CalendarGrid`, không nhân bản

`CalendarGrid` vốn tự giữ tháng trong state riêng. Thêm 4 prop optional —
`month` / `onMonthChange` (controlled) + `nav` (`'both' | 'prev' | 'next'`) +
`autoFocus` — để hai grid **bước cùng nhau** thay vì trôi khác tháng. Grid trái chỉ vẽ
mũi tên lùi, grid phải chỉ vẽ mũi tên tiến; mũi tên bị ẩn giữ nguyên ô 28px
(`invisible`, không unmount) để tiêu đề tháng vẫn cân quang học. Mọi caller cũ không
truyền `month` → giữ nguyên hành vi tự-quản-tháng.

### Vì sao 2 tháng, vì sao bấm-2-lần

Chốt qua demo `demo/project-holidays-range-input.html` (4 cách, đo số thao tác thật):

| Cách | Tết 9 ngày | Vắt 2 tháng | Touch | Code |
|---|---|---|---|---|
| **Bấm 2 lần** ✅ | 2 bấm | OK | OK | **đã có sẵn** |
| Kéo | 1 cử chỉ | **tắc** | không | vừa |
| Bấm + số ngày | 2 thao tác | OK | OK | vừa |
| Bấm từng ngày | 9 bấm | OK | OK | ít |

- **Bấm 2 lần thắng vì gần như không phải viết mới** — `CalendarGrid` (`DatePicker.tsx`)
  đã nhận `rangeStart`/`rangeEnd`/`selectingEnd` và tự vẽ hover preview;
  `DateRangePopover` đã chạy đúng state machine đó cho Start/End của collection. Đây là
  **tái dùng**, không phải idiom mới → không đẻ thêm cách làm thứ hai (§8.3).
- **Kéo bị loại vì ca vắt 2 tháng**: đang giữ chuột thì không bấm được nút lật tháng →
  nghỉ bù 31/12–3/1 nhập không nổi. Thêm nữa: không có affordance, và touch thì thua.
- **Lịch 2 tháng** để ca vắt tháng khỏi phải lật. Đổi lại popover rộng 248 → ~506px.

## Data

`Project.holidays?: Holiday[]` — **optional + non-indexed** ⇒ **không bump Dexie
version**, không migration (cùng pattern `Project.description` / `color` / `icon`; xem
[data-model.md](./data-model.md)). Row cũ đọc ra `undefined` = không có ngày lễ.

```ts
interface Holiday {
  id: string
  name: string
  /** yyyy-mm-dd, inclusive. */
  from: string
  /** yyyy-mm-dd, inclusive. `to === from` = một ngày. */
  to: string
  /** Nửa ngày — CHỈ hợp lệ khi from === to. */
  half?: 'am' | 'pm'
}
```

**Lưu theo dải, không theo từng ngày.** Vì kỳ nghỉ có **tên** ("Tết", "Quốc khánh") và
tên đó thuộc về cả dải; lưu 9 dòng rời thì tên bị nhân bản 9 lần và không có cách nào
sửa/xoá cả kỳ trong một thao tác.

`holidays` đi kèm cả export toàn bộ (`exportAll` dump nguyên row `projects`) lẫn export
một project (`exportProject` trả nguyên `project`), **không cần bump `ExportPayload.version`**.

## Implementation

### Scheduler — union tại `leafPlan`

`expandHolidays(holidays)` (`scheduling.ts`) nở `Holiday[]` thành `DayOff[]` (mỗi ngày
một entry); `projectHolidayMap(projects)` gom thành `Map<projectId, DayOff[]>`.

Map đó thread qua `planFor` → `leafPlan`. `leafPlan` **không** còn đọc thẳng
`member.daysOff` nữa mà dựng **2 set `offAm` / `offPm`** từ *cả hai* nguồn:

| Nguồn | Ghi vào |
|---|---|
| `member.daysOff` cả ngày | `offAm` + `offPm` |
| `member.daysOff` half `am` | `offAm` |
| project holiday cả ngày | `offAm` + `offPm` |
| project holiday half `pm` | `offPm` |

```
dayContrib(date) = 0                  nếu weekend, hoặc offAm ∧ offPm
                 = 0.5                nếu đúng một trong hai
                 = 1                  còn lại
```

**Union = "nghỉ nhiều hơn thắng"**, và 2 set tách rời xử lý đúng ca chồng chéo mà một
con số `0 | 0.5` không làm được: member nghỉ **sáng** + lễ nghỉ **chiều** cùng ngày ⇒
`offAm ∧ offPm` ⇒ nghỉ **cả ngày**, không phải 0.5. Với data chỉ-có-member thì hành vi
**y hệt trước**, nên test scheduling cũ pass nguyên.

### Ai truyền map vào

Signature công khai thêm **1 tham số optional cuối** (`holidays?: ProjectHolidayMap`) —
gọi thiếu vẫn chạy như cũ:
`computeWorkingPlan` · `computeAllWorkingPlans` · `computeStartEnd`.

- **View**: `App.tsx` dựng map một lần (`useMemo`, key theo `project.id` +
  `project.holidays` — đổi tên/màu project **không** invalidate mọi memo lịch bên dưới)
  và đẩy xuống qua **`ProjectHolidaysContext`** bọc cả 3 view. `SprintView` /
  `BoardView` / `GanttView` đọc bằng `useProjectHolidays()`.
  Dùng context thay vì prop vì hàng chục component lá vẫn giữ fallback
  `planById.get(id) ?? computeWorkingPlan(...)`; thread map qua từng chuỗi prop là
  nhiễu, mà một fallback lặng lẽ tính **không có** ngày lễ sẽ lệch với chính dòng bên
  cạnh nó. `scheduling.ts` giữ nguyên tính framework-free (test import không cần
  React) — chỗ nối React nằm ở `scheduling-context.ts`.
- **`recomputeDates` / `recomputeAllDates`**: transaction thêm `db.projects`, tự đọc
  **toàn bộ** projects và dựng map. Key theo `projectId` (không phải một mảng phẳng) để
  một walk chạm task khác project vẫn ăn đúng lịch nghỉ của project đó.

### Ghi

`setProjectHolidays(projectId, holidays)` (`db.ts`) — cùng shape với
`setMemberDaysOff`: chuẩn hoá (drop ngày sai format, `to < from` thì swap, `half` chỉ
giữ khi `from === to`, sort theo `from`), rồi **một transaction** ghi project + recompute
**mọi task trong project**.

> Khác `setMemberDaysOff` ở scope recompute: days-off cá nhân chỉ đụng task của member
> đó; ngày lễ đụng **cả project**, kể cả task chưa assign.

**Hệ quả lên transaction scope:** `recomputeDates` giờ đọc `db.projects`, mà Dexie bắt
sub-transaction phải là **tập con** của scope cha. Nên **mọi rw transaction có
`db.tasks` đều khai thêm `db.projects`** — chỉ là khai báo lock, không đổi hành vi, và
để recompute lồng trong tương lai không vỡ. (Bỏ sót chỗ nào → `SubTransactionError:
Table projects not included in parent transaction`.) Dexie chỉ nhận tối đa 4 bảng ở
dạng tham số rời; chỗ nhiều hơn phải chuyển sang dạng mảng.

### Task chưa assign

Days-off cá nhân không áp được cho task `assigneeId = null` (không có member để đọc).
Ngày lễ thì **có** — union nằm ở `leafPlan` theo `task.projectId`, không đi qua member.
Đây là khác biệt cố ý: ngày lễ là của project nên áp cho mọi task trong project.

## Rules & edge cases

- **Lễ ≠ phép, không trộn nguồn.** Trong popover days-off của member, ngày lễ hiện ở
  **trên vạch, mờ hơn, tag `project`, không có nút X** — read-only. Sửa lễ chỉ có một
  nơi (§8.3 không hai cách làm cùng một việc).
- **Không có override per-member.** Member không đánh dấu "vẫn đi làm ngày lễ" được.
  Cần thì thêm sau (`Member.worksOn?: string[]`), không làm trước.
- **Không preset lễ VN.** Không danh sách Tết/Quốc khánh dựng sẵn, không auto-fill,
  không nhãn "dự kiến" — **user tự gõ từng kỳ**. Lịch nghỉ chính thức do Thủ tướng
  quyết từng năm và mỗi công ty nghỉ khác nhau; preset chỉ tạo cảm giác sai là app biết
  lịch, rồi lệch năm sau.
- **Cuối tuần vẫn tự nghỉ** — `isWeekend()` không đổi. Ngày lễ rơi vào T7/CN **không**
  cộng thêm ngày công nào; badge chỉ đếm ngày công nên nó không hiện lên.
- **Half-day chỉ cho dải 1 ngày.** Dải nhiều ngày mà kèm `half` là vô nghĩa (nghỉ chiều
  suốt 5 ngày?) → `setProjectHolidays` **drop** `half` khi `to !== from`.
- **Dải chồng nhau** không bị chặn — 2 kỳ đè lên nhau thì ngày chung vẫn chỉ nghỉ một
  lần (`offAm`/`offPm` là Set). Danh sách vẫn hiện 2 kỳ; tổng "ngày công" của từng kỳ
  cộng lại có thể lớn hơn số ngày thực mất. Chấp nhận: chặn chồng chéo đắt hơn giá trị.
- **Esc** bỏ dải đang chọn trước, bấm lần nữa mới đóng popover (overlay keyboard
  contract, design-system §6.5 — Esc chỉ đóng tầng trên cùng). Một cú mis-click không
  bắt phải mở lại popover rồi lật về đúng tháng.
- **Chốt xong dải → focus tự nhảy vào ô tên**, vì tên là thứ duy nhất còn thiếu.

## Future / open questions

- **Chip trên header member** đang gộp: `3d off` = 1 ngày phép + 2 ngày lễ. Tách thành
  `1d off · 2d lễ` thì đúng hơn nhưng header vốn đã chật. Chưa chốt.
- **Cảnh báo sprint đè kỳ nghỉ** ("Sprint 45 chồng Tết — mất 7 ngày công") — chưa làm.
  Không có nó thì ngày lễ **âm thầm** đẩy ngày, không ai biết vì sao lịch trượt.
- **Dùng chung nhiều project**: hiện mỗi project set riêng. Muốn một lịch lễ quốc gia
  cho mọi project thì phải lưu global — nhưng khi đó nó **không đi kèm file export**
  của từng project nữa. Tradeoff chưa chọn.
