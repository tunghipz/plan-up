# Mobile layout

**Status:** Implemented (v1: sprint List + Board + shell; Collections để sau)
**Last updated:** 2026-11-13 (**v2 List gọn**: task card ~58pt thay vì ~97pt, meta một dòng có dấu `·`, group thành chữ cuối meta, header member một dòng; xem *List view* và *Header card member*)
**Code:** `app/src/useIsMobile.ts`, `app/src/MobileActionSheet.tsx`, `app/src/App.tsx` (drawer,
toolbar), `app/src/SprintView.tsx` (class `lc-*` trên từng cột), `app/src/BoardView.tsx`,
`app/src/ModalSheet.tsx`, `app/src/DatePicker.tsx`, `app/src/index.css` (khối *Mobile layout*).

> **Quyết định 2026-11-13:** chọn **hướng A · Drawer + task card** từ demo
> `demo/mobile-layout.html` (3 hướng A/B/C). Nguyên văn user: "A".
>
> **Quyết định 2026-11-13 (v2):** sau khi dùng trên iPhone, user thấy "layout mobile khó nhìn quá"
> (ảnh chụp: mỗi task cao ~97pt, meta giãn lệch, chip group lặp mọi dòng, header member hai dòng).
> Demo `demo/mobile-list-v2.html` có 3 hướng: A gọn lại giữ bố cục, B agenda theo ngày, C một dòng +
> sheet chi tiết. User chọn **A** ("A").

## Purpose

App hiện chỉ dựng cho desktop. Mở trên điện thoại gần như không dùng được. Số đo ngày
2026-11-13 bằng Playwright ở khung iPhone 13 (390×664), sprint có 4 member và 10 task:

| Đo | Sidebar mở (mặc định) | Sidebar gập tay |
|---|---|---|
| Bề rộng sidebar | 248px (cố định) | 0 |
| Bề rộng nội dung chính | **142px** (36% màn hình) | 390px |
| Bảng task: hiện / thật | 94px / 826px | 342px / 830px |
| Chữ < 12px | 26 / 119 node, nhỏ nhất 8px | như trái |
| Nút < 32px | 10 / 16 (nhiều nút 24×24) | như trái |
| Toolbar nổi đáy | 721px trong khung 374px, bị cắt | như trái |

Code chỉ có khoảng 14 class responsive (`sm:`/`md:`/`lg:`), phần lớn là padding và grid.

Mục tiêu: **xem và cập nhật nhanh trên điện thoại** (đổi status, sửa title, xem ai đang làm
gì, thêm task). Lên kế hoạch nặng (kéo thả, dependency, Timeline chỉnh sửa) vẫn để desktop.

## Phạm vi

**Có:**
- Shell: sidebar thành drawer, toolbar gọn lại.
- List view: row task dạng card hai dòng, không cuộn ngang.
- Board view: mỗi cột rộng gần bằng màn hình, vuốt ngang có snap.
- Vùng bấm tối thiểu 44px trên màn hình cảm ứng, chữ tối thiểu 12px.
- Modal (`ModalSheet`) thành bottom sheet.

**Không (để sau):**
- Timeline chỉnh sửa trên mobile: chỉ xem, cuộn ngang như hiện tại.
- Drag-to-reorder trong List trên mobile: tắt (sort theo cột vẫn có, qua menu).
- PWA / cài lên màn hình chính, offline cache: tách thành doc riêng nếu cần.
- Panel Claude (desktop-only sẵn rồi).

## Breakpoint

Một breakpoint duy nhất: **`< 768px` = mobile** (Tailwind `md`). Từ 768px trở lên giữ
nguyên layout desktop hiện tại, không đổi gì. Vùng bấm 44px gắn theo
`@media (pointer: coarse)` chứ không theo bề rộng, để iPad cảm ứng cũng được nút to.

## Hướng thiết kế (đã chọn A)

Ba hướng trong `demo/mobile-layout.html`, cùng dữ liệu mẫu để so trực tiếp:

### A · Drawer + task card
- Sidebar thành **drawer trượt từ trái** (nút ☰ ở toolbar, bấm nền tối hoặc vuốt trái để đóng).
  Mặc định đóng trên mobile. Chọn sprint xong drawer tự đóng.
- Toolbar còn: ☰ · tên sprint · nút Search · nút `⋯` (gom Roll over, Activity, Share,
  Export/Import, Telegram).
- Page header gọn: title, ngày, capacity thu thành một dòng.
- Mỗi task là **card hai dòng**: dòng 1 = status circle + title (wrap tối đa 2 dòng);
  dòng 2 = ngày `Start → End` · effort · priority chip · prereq. Card member giữ
  nguyên (header + danh sách), không còn cột.
- Toggle List/Board/Timeline nằm trong page header dạng segmented control nhỏ.
- **Công build:** vừa. Đụng shell + row List.

### B · Tab bar iOS + màn hình xếp chồng
- Không có sidebar. **Tab bar dưới đáy**: Sprints · Collections · Search · Settings.
- Tab Sprints là danh sách sprint (như sidebar hiện tại); bấm một sprint thì **push** sang
  màn sprint với nút `‹ Sprints` ở góc trên trái.
- Màn sprint dùng card task như hướng A.
- Đổi project ở đầu tab Sprints.
- **Công build:** lớn nhất. Cần lớp điều hướng riêng cho mobile (stack + tab), tách khỏi shell
  desktop.

### C · Giữ bảng, ghim cột Task
- Sidebar thành drawer như A.
- List **vẫn là bảng**, nhưng ẩn cột Effort và Prereq, **ghim cột Status + Task** bên trái;
  các cột ngày cuộn ngang sau đó.
- **Công build:** nhỏ nhất. Nhưng vẫn phải cuộn ngang để xem ngày, đọc chậm hơn A.

**Đề xuất:** A. Hợp DNA "speed > breadth" (xem và đổi status trong một lần bấm), giữ một shell
cho cả hai cỡ màn hình, công build vừa phải. B đẹp kiểu native nhưng tốn gấp đôi và khiến
hai bản điều hướng lệch nhau theo thời gian.

## User-facing behavior

Mọi điều dưới đây chỉ áp dụng khi viewport **< 768px**. App desktop (Tauri) có `minWidth` 900 nên
không bao giờ vào layout này.

### Shell
- **Sidebar thành drawer.** Nằm đè lên nội dung (`fixed`, rộng `min(84vw, 320px)`), trượt từ trái,
  nền tối mờ phía sau. Mặc định đóng mỗi lần tải trang. Mở bằng nút ☰ (44×44) ở đầu toolbar. Đóng
  khi: bấm nền tối, bấm Escape, hoặc **chọn sprint / collection / project** (drawer tự đóng để
  thấy ngay nội dung vừa chọn). Không kéo đổi bề rộng được (ẩn tay nắm resize).
- Drawer dùng state riêng, **không** đụng `plan-up:sidebarCollapsed` của desktop.
- **Toolbar** (capsule kính như desktop) còn: ☰ · tên sprint (hoặc identity của collection) ·
  Roll over (nếu có task dở, chỉ icon + số) · Search · `⋯`. Mọi nút cao 44px.
- **Nút `⋯`** mở **action sheet** kiểu iOS từ đáy màn hình: Activity log (sprint), Share
  (collection), Export this project, Export all, Import. Có nút Huỷ riêng; bấm nền hoặc Escape để đóng.
- **Toggle List / Board / Timeline** rời toolbar, nằm thành một dòng ngay dưới page header của
  sprint (collection: đầu vùng nội dung), giãn hết bề ngang.
- Lề nội dung: `px-3` (desktop `px-6`); page header sprint `mx-3`.

### List view — task card hai dòng (v2 gọn)
Không còn bảng cột. Mỗi row tự xuống dòng bằng CSS, **vẫn dùng đúng các ô sửa của desktop**, nên mọi
thứ sửa được trên desktop thì trên mobile cũng sửa được (title, ngày, effort, prereq, người làm):
- **Dòng 1:** status circle (vùng bấm vẫn 44×44 nhưng chỉ chiếm 32px chiều cao) + title (16px, xuống
  dòng thoải mái, bấm để sửa).
- **Dòng 2** (thụt vào thẳng hàng với title, chữ 13px, **một dòng**, các ô cách nhau bằng `·`):
  `#số` · người làm (chỉ ở chế độ All / Unassigned) · effort liền đơn vị (`2.5d`, ô nhập rộng theo số)
  · `Start → End` (milestone: một ngày) · `sau #3` (prereq) · tên group. Mỗi ô cao 28px. Dòng quá dài
  thì tên group (ô cuối) bị cắt `…`, các ô trước giữ nguyên.
- **Group của task** (trước là chip `↳ #12 build 1: 2 games` cạnh tiêu đề) thành **chữ nhạt cuối dòng
  meta**. Desktop giữ chip.
- Một task không có prereq/ngày trống cao khoảng **58pt** (v1: ~97pt).
- Ô ngày trống hiện luôn pill `＋ Start` / `＋ Due` (desktop chỉ hiện khi hover).
- Màn hình cảm ứng (`hover: none`) không tô nền ô sửa khi "hover", vì iOS giữ trạng thái hover sau
  khi chạm làm ô tiêu đề dính nền xám.
- Ẩn trên mobile: thanh tiêu đề cột (nên **không sort được** trên mobile; sort đã chọn trên desktop vẫn
  áp dụng), cột Status dạng pill (trùng với status circle), checkbox chọn nhiều, tay nắm kéo thả, tam giác
  cảnh báo trùng lịch.
- Group head dùng cùng bố cục: dòng 1 là chấm status + nút thu gọn + title + `x/y`, dòng 2 là ngày roll-up.
- Dòng **Add task** chỉ còn icon `+` và ô nhập.

### Header card member
**Một dòng** (v2): avatar + tên + `x/y` bên trái; bên phải các chip `N today`, `N overdue`,
`N trùng lịch` và nút Days off chỉ còn icon lịch (đã đặt ngày nghỉ thì vẫn ghi `2d off`). Ẩn trên
mobile: chức danh member và chữ `due Nov 13`. Nhiều chip quá thì phần phải xuống dòng. Tay nắm kéo
đổi thứ tự lane bị ẩn trên mobile.

### Board view
Ba cột xếp **ngang, mỗi cột rộng 86%** màn hình, vuốt ngang có snap từng cột (thấy mép cột kế bên
để biết còn cột). Kéo thả card giữa cột không có trên cảm ứng (HTML5 drag) nên đổi status làm ở List.

### Timeline
Không đổi: bảng cuộn ngang như desktop, dùng để xem.

### Dialog
`ModalSheet` (mọi dialog "New …") thành **bottom sheet**: bám đáy, bo hai góc trên, rộng hết màn hình.

### Collections
v1 chưa làm lại: chỉ được hưởng drawer, toolbar và dialog. Bảng collection vẫn cuộn ngang.

## Data

Không đổi schema, không thêm key `localStorage`. Drawer mobile **không** dùng chung
`plan-up:sidebarCollapsed` với desktop (mở lại trên desktop không bị kẹt ở trạng thái gập do lần
dùng mobile).

## Implementation

- `useIsMobile()` (`useIsMobile.ts`): `matchMedia('(max-width: 767px)')`, cập nhật khi xoay máy hay
  đổi cỡ cửa sổ. Dùng ở chỗ phải đổi **hành vi** (drawer, menu `⋯`). Chỗ chỉ đổi **hình** dùng CSS
  (`md:` của Tailwind hoặc media query trong `index.css`).
- List: mỗi hằng `COL.*` trong `SprintView.tsx` mang thêm một class ngữ nghĩa `lc-<cột>`
  (`lc-dot`, `lc-title`, `lc-seq`, `lc-assignee`, `lc-effort`, `lc-start`, `lc-due`, `lc-milestone`,
  `lc-status`, `lc-prereq`, `lc-lead`). Khối *Mobile layout* trong `index.css` cho `.task-row` và
  `.task-add-row` `flex-wrap`, dùng `order` để xếp dòng 1 / dòng 2, ẩn cột thừa, `:empty` để bỏ ô
  rỗng. Desktop không đổi một pixel nào vì mọi rule nằm trong `@media (max-width: 767px)`.
- `min-w-[820px|896px|960px]` của bảng thành `md:min-w-[…]`; thanh tiêu đề cột bọc `hidden md:block`.
- Tay nắm kéo (row và lane member) bị ẩn qua selector `[aria-label='Drag to reorder']`; pill gợi ý
  ngày trống có class `empty-hint-hover` để CSS mobile bật lên (Tailwind v4 chỉ áp `hover:` trên
  thiết bị có hover, nên trên cảm ứng pill này không bao giờ hiện nếu không có rule riêng).
- Drawer không dùng effect để tự đóng: state lưu **key của lựa chọn lúc mở**
  (`project|kind|sprint|collection`); chọn thứ khác thì key đổi nên drawer coi như đóng. Bấm lại
  sprint / collection đang mở thì gọi đóng trực tiếp.
- `ViewToggle` có prop `fill` (giãn hết bề ngang, cao 36px), dùng cho dòng List/Board/Timeline và
  toggle `Group by` của List trên mobile.
- Header card member (`GroupHeader`) `flex-wrap` trên mobile: số liệu (trùng lịch, overdue, due,
  Days off) xuống dòng riêng dưới tên, chữ 12px.
- Ô nhập trong row (title, effort, prereq, Add task) là 16px trên mobile để iOS Safari không tự
  zoom khi focus.
- Board: container `flex overflow-x-auto snap-x` trên mobile, `md:grid md:grid-cols-3` trên desktop;
  mỗi cột `basis-[86%] snap-start`.

## Kiểm tra (2026-11-13)

Playwright, khung iPhone 13 (390×664), đo bằng DOM:
- Trang không cuộn ngang (`scrollWidth` 390) ở List, Board, Timeline.
- Chữ nhỏ nhất 12px. Status circle, ☰, Search, `⋯` đều 44×44; mục trong action sheet cao 54px.
- Drawer: mở → `left: 0`, có nền tối; chọn sprint → đóng, `inert`.
- Row task: dòng 1 = status 44px + title 308px; dòng 2 = `#số · effort d · Start → End · Pre`.
- Desktop (1280px và 800px): vị trí và kích thước mọi row, card, header, cột Board **khớp từng pixel**
  với bản trước khi sửa.

## Rules & edge cases

- Từ 768px trở lên: không có thay đổi gì so với hiện tại.
- Bàn phím ảo che input: các input inline và composer phải cuộn vào vùng nhìn thấy khi focus.
- Hover-reveal (nút xóa, archive) không có trên cảm ứng: chuyển vào menu `⋯` của row hoặc
  menu nhấn giữ.
- Tooltip chỉ hiện khi hover thì cần đường khác trên mobile (bấm để mở) hoặc bỏ.
- Phím tắt không áp dụng; không được có chức năng nào chỉ có qua phím tắt.
- `env(safe-area-inset-*)` cho notch và home indicator.
