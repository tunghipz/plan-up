# Dấu task hôm nay

**Status:** Implemented
**Last updated:** 2026-11-13
**Code:** `app/src/lib.ts` (`todayMark`), `app/src/SprintView.tsx` (`TaskRow`, `memberHeaderStats`,
`MemberStatsBar`), `app/src/BoardView.tsx` (`BoardCard`), `app/src/index.css` (`.today-live`, `.today-due`)

## Purpose

Mở plan là phải thấy ngay hôm nay làm gì. Trước đây chỉ có task quá hạn được tô đỏ; task đang
chạy hôm nay trông y như mọi task khác, phải đọc cột Start/Due từng dòng.

> **Quyết định 2026-11-13:** user chọn hướng **B "Tô cả dòng"** ("B") trong demo
> `demo/today-marker.html` (3 hướng: A chữ "Hôm nay" trong cột ngày, B tô cả dòng, C cột tuần
> có vạch hôm nay).

## User-facing behavior

- **Task hôm nay** = task chưa Done mà hôm nay nằm trong khoảng **start → due** của plan đang
  hiện (ngày scheduler tính, cùng ngày cột Start/Due hiện). Task chỉ có một trong hai ngày thì
  coi như việc một ngày. Milestone (effort 0) dùng ngày milestone.
- **List view** (mọi lane: member, Unassigned, Group nhiều người, chế độ All):
  - Dòng task hôm nay có **nền xanh nhạt** (accent 6%) và **tiêu đề đậm**.
  - **Hạn hôm nay** (due = hôm nay, hoặc milestone hôm nay): nền đậm hơn (accent 11%) và nhãn
    **Due today** cạnh tiêu đề.
  - Dòng đang được chọn giữ nền chọn (`bg-accent-soft`), không bị nền hôm nay đè.
- **Header card member**: thêm chip xanh **N today** (đếm task hôm nay, chỉ task lá) trước chip
  "N overdue". Không có task hôm nay thì không hiện.
- **Board**: card task hôm nay có cùng nền xanh nhạt; hạn hôm nay nền đậm hơn và nhãn Due today.
- Điện thoại dùng chung các dòng và card trên, nên có cùng dấu.
- Task quá hạn giữ nguyên đỏ, không thành "hôm nay". Task Done không đánh dấu. Group head (dòng
  roll-up) không đánh dấu, chỉ task lá.
- Copy tiếng Anh như phần còn lại của UI ("2 overdue", "due Nov 13").

## Data

Không đổi schema. Chỉ đọc `startDate` / `dueDate` của working plan và `status`.

## Implementation

- `todayMark(start, due, isDone, isMilestone, today = todayLocalISO()) → 'due' | 'live' | null`
  (pure, có test). `'due'` khi ngày kết thúc là hôm nay, `'live'` khi hôm nay nằm giữa.
- `TaskRow`: thêm class `today-live` hoặc `today-live today-due` (không thêm khi selected), nhãn
  Due today trong `trailing` của tiêu đề. Nền và chữ đậm nằm trong `index.css` (CSS thường, nên
  hover cũng phải viết ở đó).
- `memberHeaderStats` đếm `today`; `MemberStatsBar` hiện chip.
- `BoardCard`: cùng class trên card.

## Rules & edge cases

- "Hôm nay" theo giờ máy (`todayLocalISO`). Như dấu overdue, qua nửa đêm dấu chỉ đổi khi view
  render lại (đổi dữ liệu, đổi sprint, mở lại app); không có timer.
- Nhiều task trùng hôm nay thì nhiều dòng xanh: đã chấp nhận khi chọn B.
