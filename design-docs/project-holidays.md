# Project holidays — ngày nghỉ chung toàn project

**Status:** Implemented
**Last updated:** 2026-08-18 (bản đầu; + fix popover tràn đáy màn hình và popover không
tự đóng khi đóng drawer settings; + **bỏ pill khỏi top bar, chuyển xuống hàng `Holidays`
riêng trong sprint header card, hiện TÊN kỳ nghỉ + nút `+`** — phương án D, chốt qua
`demo/holiday-in-sprint-header.html`; + **chip `Nd holiday` trên header member card, chỉ
hiện khi kỳ nghỉ chồng lên khoảng ngày task của người đó** — phương án D, chốt qua
`demo/holiday-on-member-card.html`; + **hatch ngày lễ trong Timeline**; + **fix từ
`/review`: chip union theo ngày thay vì cộng từng kỳ, guard ngày sai định dạng, clip
expansion về đúng cửa sổ Timeline**)
**Code:** `app/src/types.ts` (`Holiday`, `Project.holidays`), `app/src/scheduling.ts`
(`expandHolidays`, `projectHolidayMap`, `ProjectHolidayMap`, `leafPlan` union,
`recomputeDates`, `recomputeAllDates`), `app/src/scheduling-context.ts`
(`ProjectHolidaysContext`, `useProjectHolidays`), `app/src/db.ts`
(`setProjectHolidays`), `app/src/lib.ts` (`holidayWorkDays`, `holidayLoadInSpan`),
`app/src/members.tsx` (`MemberDaysOffButton` — chip `Nd holiday`),
`app/src/GanttView.tsx` (hatch ngày lễ trong lane),
`app/src/DatePicker.tsx` (`CalendarGrid` controlled-month props),
`app/src/ProjectHolidays.tsx` (`ProjectHolidaysButton`),
`app/src/usePinnedPopover.ts` (tự đóng khi trigger bị ẩn),
`app/src/App.tsx` (`SprintPageHeader` — hàng `Holidays`) + `app/src/ProjectSettingsView.tsx` (2 chỗ mount)

## Purpose

Trước đây chỉ có **[days-off theo từng member](./members-and-days-off.md)**. Nghỉ Tết,
Quốc khánh, offsite cả team → phải mở từng member, click từng ngày: `N member × M ngày`
lần thao tác, và **member mới join sau không có** những ngày đã set.

Ngày lễ là thuộc tính của **project**, không phải của người. Feature này cho set **một
lần cho cả project**, scheduler tự union vào mọi member.

## User-facing behavior

- **Trigger** — cùng một component ở **2 chỗ** (`MemberDaysOffButton` đã có tiền lệ):
  - **Sprint header card** (`variant="row"`) — **một hàng riêng ngay dưới hàng `Dates`**,
    mượn nguyên grammar của nó: nhãn xám `🗓 Holidays` + các pill giá trị. Pill hiện
    **TÊN kỳ nghỉ + khoảng ngày** (`Nghỉ hè công ty · Aug 24 – Aug 28`), không phải con
    số gộp — tên là thứ người ta nhớ, và là thứ phân biệt "nghỉ lễ" với "team offsite";
    đọc là hiểu, không cần bấm. Nút `+` cuối hàng để thêm. Rỗng → pill viền đứt
    `Add holiday`. **Chỉ hiện kỳ nghỉ chồng sprint đang xem** (scope như
    `MemberDaysOffButton`); popover thì vẫn liệt kê toàn bộ.
  - **Project settings** — `variant="metric"`, luôn hiện, đếm **toàn bộ** (không scope
    theo sprint).

  **Không đặt trên top bar.** Từng làm vậy (pill `2d holidays` cạnh Roll over) rồi bỏ:
  top bar đã chật Roll over / Search / Export / Import, và ngày lễ set 1–2 lần một
  **năm** nên chiếm real estate thường trú ở đó là trượt checklist affordance-density
  (design-system §9.2). Trong sprint header card thì có chỗ, và nó nằm cạnh đúng thứ nó
  nói về — khoảng ngày của sprint.
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

### Chip `Nd holiday` trên header member card

Header member card có thêm chip **mờ, không viền**, đứng **trước** chip days-off:
`🗓 3d holiday`. Nó **chỉ hiện khi kỳ nghỉ chồng lên khoảng ngày task của chính member
đó** — người xong hết task trước kỳ nghỉ thì card sạch, không có chip.

- **Cửa sổ xét là task span của member** (`earliestDate…latestDate` — computed start/due
  của **mọi** task họ giữ trong sprint, kể cả parent; đúng cái span đã dùng để nới cửa sổ
  days-off), **không phải** cửa sổ sprint. Đây là khác biệt cố ý với chip days-off: hỏi
  "kỳ nghỉ này có chạm vào việc của người này không", không phải "kỳ nghỉ có trong sprint
  không".
- **Số trên chip là ngày công bị mất trong phần giao nhau**, đã trừ T7/CN
  (`holidayLoadInSpan`). Kỳ nghỉ rơi trọn cuối tuần ⇒ 0 ⇒ **không có chip** (khớp luật
  "badge chỉ đếm ngày công" ở dưới).
- **Union theo NGÀY, không cộng từng kỳ.** Hai kỳ chồng nhau (được phép — xem *Rules*)
  mà cộng rời thì chip báo `10d` trong khi scheduler chỉ bỏ `8d`, và nó nằm **ngay cạnh**
  dải hatch Timeline đếm đúng 8 — hai con số đá nhau trên cùng màn hình. `holidayLoadInSpan`
  vì thế dựng `Map<date, part>` rồi mới cộng, đúng luật `offAm`/`offPm` của scheduler:
  AM + PM cùng ngày = **1 ngày**, hai kỳ cùng ngày = **1 ngày**. Đo thật: lễ 24–26 Aug +
  offsite 26–28 Aug ⇒ chip `5d holiday`, Timeline hatch đúng 5 cột.
- **`half` quyết trên dải GỐC**, không phải dải đã clip — giống `expandHolidays`. Một kỳ
  nhiều ngày mang `half` (chỉ vào được qua import sửa tay) là chuỗi ngày nghỉ **nguyên
  ngày**; clip nó xuống 1 ngày không được làm sống lại nửa ngày.
- **Member không có task** (lane "members with no tasks") ⇒ không có span ⇒ không chip.
- **Chip mở đúng popover days-off** đang có — nơi từng ngày lễ đã nằm sẵn ở khối trên,
  mờ, tag `project`, read-only. Không đẻ popover thứ hai (§8.3).
- **Tooltip mang luật**: `Nghỉ hè công ty · Aug 19 – Aug 21 — chồng lên lịch task của
  Alice`. Đây là chỗ trả giá của phương án D: luật "chỉ hiện khi chạm" là **luật ẩn** —
  hai card cạnh nhau, một có chip một không, người dùng không tự đoán ra. Tooltip là
  chỗ duy nhất nói ra luật, nên nó bắt buộc phải có.
- **Chip days-off vẫn chỉ đếm ngày nghỉ cá nhân.** Hai nguồn, hai chip, hai thứ bậc thị
  giác: của-mình thì đậm và sửa được, kế-thừa-từ-project thì mờ và read-only.
- `variant="metric"` (drawer settings) **không** có chip: ở đó không có sprint, không có
  task span, và trang settings đã có card `Holidays` riêng.
- **Giới hạn đã biết — kỳ nghỉ *đẩy* task thì chip im lặng.** Ngày computed không bao giờ
  rơi vào ngày nghỉ, nên một task 1 ngày bị lễ đẩy sang hôm sau có span **né đúng cái lễ
  đã đẩy nó**. App ghi đè `startDate` bằng ngày computed (`recomputeDates`) nên cũng không
  còn "ý định gốc" để so. Chấp nhận: ca thường gặp là kỳ nghỉ **nằm giữa** khoảng làm việc
  nhiều ngày — chỗ đó chip chạy đúng; đo thật: task 8d từ 17 Aug + lễ 24–26 Aug ⇒
  `3d holiday`, due đẩy 26 Aug → 31 Aug.

**Vì sao không gộp thành một chip** (`5d off` = 2 phép + 3 lễ), phương án A trong
`demo/holiday-on-member-card.html`: con số đúng về capacity nhưng sai về "ai làm gì" —
member không tự set ngày nào vẫn hiện `3d off`, phải bấm vào mới hiểu đó là lễ.

**Vì sao không hiện chip trên mọi card** (phương án B): ngày lễ là dữ kiện của
**project**, giống hệt nhau trên mọi card. In nó N lần ngay dưới hàng `Holidays` của
sprint header (đã in một lần rồi) là data slop — đúng nhưng không earn its place.
Điều kiện "chạm task" cắt phần lặp vô nghĩa, chỉ giữ lại lần in **có tin**.

**Vì sao không đổi thành số ngày công còn lại** (`0/15 · 9d công`, phương án C): trả lời
đúng câu manager hỏi hơn, nhưng thêm một **khái niệm mới** phải dạy, và giấu mất nguyên
nhân (nhìn card không biết vì sao 12 rơi xuống 9). Để ngỏ.

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

### Timeline — hatch phủ mọi lane

Timeline vốn chỉ hatch `member.daysOff`, nên một bar vắt qua Tết trông **liền một mạch** —
đọc thành "làm suốt 4 ngày" trong khi thực tế nghỉ 3. Giờ band lấy **union**
`member.daysOff ∪ Project.holidays`, và vì lễ là của cả project nên nó hatch **mọi lane**,
kể cả lane của người không set ngày nghỉ nào.

- **Cùng một hatch cho cả hai nguồn.** Đọc một bar thì câu hỏi duy nhất là "chỗ này có làm
  việc không"; thêm pattern thứ hai không trả lời thêm gì mà lại tốn một quy ước phải học
  (§9.2). Phân biệt nằm ở **tooltip**: lễ hiện **tên** (`Tết`), nghỉ cá nhân hiện `Day off`.
  Hai kỳ nghỉ chồng ngày ⇒ tooltip nối tên bằng `·`.
- **Union giống scheduler**: member nghỉ sáng + lễ nghỉ chiều ⇒ band **cả cột**, không phải
  hai nửa rời.
- **Đọc thẳng `project.holidays`**, không dùng `ProjectHolidayMap` của context: map đó cố ý
  không mang tên (scheduler chỉ cần ngày), mà tooltip thì cần tên.
- **Expansion clip về đúng cửa sổ đang vẽ** (`workdays[0]…workdays[N-1]`) rồi mới nở ngày,
  và tra theo từng cột trong `workdays.forEach` thay vì duyệt cả map mỗi lane. Chi phí chặn
  bởi bề rộng sprint, không phải bởi độ dài kỳ nghỉ.
- **Nhãn tooltip: người ghi sau thắng.** Pass ngày nghỉ cá nhân chạy trước, pass ngày lễ
  chạy sau, nên tên kỳ nghỉ luôn đè `Day off` mà không cần so chuỗi (`DAY_OFF_LABEL` là
  hằng dùng chung với legend).

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
  lần (`offAm`/`offPm` là Set). Danh sách vẫn hiện 2 kỳ, và **badge từng kỳ** trong
  popover vẫn là ngày công của riêng kỳ đó (cộng lại có thể lớn hơn số ngày thực mất —
  chấp nhận, vì mỗi badge nói về một kỳ). Nhưng **mọi con số TỔNG phải union theo ngày**:
  chip `Nd holiday` union trước khi cộng (`holidayLoadInSpan`).
- **Ngày sai định dạng phải bị chặn ở mọi vòng lặp ngày.** `d <= h.to` so sánh chuỗi, mà
  `'TBD'` / `'2027-2-3'` sort **trên** mọi ngày ISO ⇒ vòng lặp không bao giờ dừng, chạy tới
  điểm bất động của `addDays` (`addDays('9999-12-31', 1) === '+010000-01'`, rồi `addDays`
  của chuỗi đó ra chính nó) ⇒ **tab đơ, không throw, không log**. `importAll` (`io.ts`) ghi
  thẳng row project vào Dexie **không qua `setProjectHolidays`**, nên guard `ISO_DATE` ở
  `expandHolidays`, `holidayLoadInSpan` và `holidayByDate` (Gantt) là cửa duy nhất.
  Đo thật: trước khi guard, `expandHolidays({to:'nope'})` chạy tới **hết heap (OOM)**.
- **Esc** bỏ dải đang chọn trước, bấm lần nữa mới đóng popover (overlay keyboard
  contract, design-system §6.5 — Esc chỉ đóng tầng trên cùng). Một cú mis-click không
  bắt phải mở lại popover rồi lật về đúng tháng.
- **Chốt xong dải → focus tự nhảy vào ô tên**, vì tên là thứ duy nhất còn thiếu.
- **Hàng `Holidays` có nhiều trigger, một popover.** Mỗi pill tên + nút `+` đều mở cùng
  popover; anchor là **cả hàng** (một wrapper span), không phải từng pill, nên popover
  không nhảy chỗ tuỳ theo bấm vào đâu. Bấm vào pill tên thì lịch **mở sẵn ở tháng của kỳ
  nghỉ đó**; bấm `+` thì mở ở tháng hiện tại. Anchor căn **trái** (`left`) theo **nhóm
  pill** (không phải mép hàng — nó lệch đúng bề rộng nhãn `Holidays`), khác `metric`
  trong drawer settings căn **phải**; cả hai đều clamp 8px để popover 520px không tràn
  mép cửa sổ hẹp.
- **Popover lật lên khi không đủ chỗ phía dưới.** Lịch 2 tháng + danh sách kỳ nghỉ cao
  ~414px; pin cứng `top = rect.bottom + 6` thì phần rơi khỏi màn hình đúng là **footer**
  — ô nhập tên + nút Add, tức là đúng phần cần để làm xong việc. `place()` đo chiều cao
  thật rồi lật lên trên trigger; không vừa cả hai chiều thì ghim ở mép và để
  `max-h-[calc(100vh-16px)] overflow-y-auto` của chính popover lo phần còn lại.
  Đo thật: viewport 520px → popover 98–512, nút Add nằm trong tầm nhìn.
- **Popover tự đóng khi trigger bị ẩn** (`usePinnedPopover`). Drawer settings và drawer
  activity **không unmount** lúc đóng — chúng trượt ra bằng `translate-x-full` + `inert`
  để animate được. Popover mở từ trong drawer vì thế giữ nguyên `open`, mà nó lại portal
  ra `<body>`, nên nó **treo lơ lửng trên app ở toạ độ fixed cũ, không còn nút nào để
  tắt**. Hook giờ kiểm mỗi render (đúng lúc drawer đổi state là subtree re-render):
  anchor mất kết nối / nằm trong `[inert]` / `checkVisibility()` false ⇒ đóng.
  Sửa ở hook nên **mọi popover trong drawer** (days-off, avatar picker) hết luôn bug này,
  không riêng holidays.

## Future / open questions

- **Validate `holidays` ở tầng import.** `importAll` bulkAdd nguyên row project, chỉ check
  `Array.isArray(data.projects)`. File backup sửa tay/hỏng có thể mang `from: '2027-2-3'`
  hoặc dải 2027→9999. Guard ở các vòng lặp đã chặn treo máy, nhưng nơi đúng để chặn là lúc
  **ghi**: tách phần chuẩn hoá của `setProjectHolidays` ra dùng chung cho import, + cap độ
  dài một kỳ (vd 366 ngày). Chưa làm.
- **`addDays('9999-12-31', 1)` là điểm bất động** (`'+010000-01'` → chính nó). Mọi vòng
  `for (d = a; d <= b; d = addDays(d, 1))` trong app đều treo nếu chạm mốc đó. Nên cho
  `addDays` throw khi kết quả không còn là `yyyy-mm-dd` — treo im lặng tệ hơn crash. Chưa làm.

- **Số ngày công còn lại trên header member** (`0/15 · 9d công` — đã trừ cuối tuần, lễ,
  phép) là phương án C trong `demo/holiday-on-member-card.html`. Trả lời đúng câu hỏi
  manager thật sự hỏi, nhưng là khái niệm mới và giấu nguyên nhân. Chưa làm.
- **Cảnh báo sprint đè kỳ nghỉ** ("Sprint 45 chồng Tết — mất 7 ngày công") — chưa làm.
  Không có nó thì ngày lễ **âm thầm** đẩy ngày, không ai biết vì sao lịch trượt.
- **Dùng chung nhiều project**: hiện mỗi project set riêng. Muốn một lịch lễ quốc gia
  cho mọi project thì phải lưu global — nhưng khi đó nó **không đi kèm file export**
  của từng project nữa. Tradeoff chưa chọn.
