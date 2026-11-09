# Desktop native feel (macOS)

**Status:** Implemented
**Last updated:** 2026-11-09 (**security**: File ▸ Import… dùng `pick_import_file`, Rust tự mở panel và đọc file). Trước đó: 2026-11-09
**Code:** `app/src/native-shell.ts` (menu bar, menu chuột phải, chặn context menu WebKit,
đồng bộ theme cửa sổ), `app/src/App.tsx` (nối lệnh menu vào state), `app/src/index.css`
(`html.desktop`, `html.native-vibrancy`), `app/src-tauri/` (window-state, vibrancy, ẩn
cửa sổ khi ⌘W)

## Purpose

Bản Mac (xem [desktop-app-tauri.md](./desktop-app-tauri.md)) đã có overlay title bar,
auto update, auto backup, nhưng vẫn còn nhiều dấu hiệu "đây là trang web bọc lại":
không có menu bar riêng, con trỏ bàn tay trên nút, bôi đen được chữ giao diện, cả trang
nảy khi cuộn quá, chuột phải hiện menu WebKit, mở lại luôn về 1280×800, sidebar chỉ làm
mờ nền canvas chứ không thấy desktop phía sau. Feature này xử lý 5 điểm đó. Web build
không đổi gì.

## 1. Menu bar thật

Dựng bằng JS Menu API của Tauri (`@tauri-apps/api/menu`, import động như mọi API Tauri
khác) và `setAsAppMenu()` khi app mount. Action của từng item gọi thẳng vào hàm React
qua một ref (`cmdRef`), không đi qua event Rust.

| Menu | Item | Phím |
|---|---|---|
| **plan-up** | About plan-up | |
| | Settings… (mở Project settings) | ⌘, |
| | Services · Hide plan-up · Hide Others · Show All | ⌘H, ⌥⌘H |
| | Quit plan-up | ⌘Q |
| **File** | New Sprint… | ⌘N |
| | New Project… | ⇧⌘N |
| | Import… | ⌘O |
| | Export This Project | ⌘E |
| | Export All (Full Backup) | ⇧⌘E |
| | Auto Backup… | |
| | Close Window | ⌘W |
| **Edit** | Undo · Redo · Cut · Copy · Paste · Select All (predefined) | chuẩn |
| | Find Task… (mở palette, như ⌘K) | ⌘F |
| **View** | List / Board / Timeline / Calendar (check = view đang xem) | ⌘1 ⌘2 ⌘3 ⌘4 |
| | Show/Hide Sidebar | ⌘\ |
| | Sprint Activity | |
| | Dark Mode (check) | ⇧⌘D |
| | Enter Full Screen (predefined) | ⌃⌘F |
| **Window** | Minimize · Zoom · Bring All to Front (`setAsWindowsMenuForNSApp`) | ⌘M |
| **Help** | plan-up on GitHub (`setAsHelpMenuForNSApp` → macOS tự thêm ô search menu) | |

- **Enabled theo ngữ cảnh**, cùng guard với phím tắt sẵn có: Find Task / Sprint
  Activity chỉ khi đang xem sprint (không ở settings); Board/Timeline chỉ khi xem
  sprint, Calendar chỉ khi xem collection; New Sprint chỉ khi đang ở sprint. Item
  disabled thì action cũng tự kiểm lại guard (phòng trạng thái lệch một nhịp).
- **Edit menu bắt buộc phải có predefined items**: thay app menu mặc định của Tauri mà
  thiếu Cut/Copy/Paste thì ⌘C/⌘V trong ô nhập sẽ chết trên macOS.
- **Phím trùng giữa menu và JS:** WKWebView đưa key equivalent cho trang web trước;
  handler JS gọi `preventDefault()` thì menu không chạy, không gọi thì menu chạy sau.
  Các handler ⌘K, ⌘\, ⇧⌘D trong `App.tsx` đều `preventDefault()`. Phòng hờ, mọi lệnh
  dạng toggle (sidebar, dark mode) đi qua `shouldRun(id)`: bỏ qua nếu cùng lệnh vừa chạy
  trong 300ms, nên dù cả hai đường cùng bắn thì cũng chỉ đổi một lần.
- **File ▸ Import… dùng open panel native**, không dùng `<input type=file>`: action của
  menu tới trang qua IPC, không có user gesture, mà WebKit chỉ mở file chooser trong
  một gesture. Rust command `pick_import_file` tự mở panel (lọc `.json`) **và** đọc đúng
  file được chọn (chỉ file thường đuôi `.json`, tối đa 200 MB). Trang không bao giờ gửi
  đường dẫn: bản trước có `read_import_file(path)`, cho phép script trong webview đọc bất kỳ
  file `.json` nào trên máy (2026-11-09). Nội dung đi
  vào đúng luồng import cũ (`importText` trong `App.tsx`). Nút Import trên toolbar giữ
  nguyên `<input type=file>`.
- Phím `n` (New Sprint không modifier) giữ nguyên trong JS; menu dùng ⌘N vì key
  equivalent không modifier sẽ cướp chữ "n" khi gõ.
- Tooltip nút dark mode ở icon rail sửa từ "⌘⇧L" (sai) thành "⇧⌘D" cho khớp phím thật.

### ⌘W ẩn cửa sổ, không thoát app

Giống Notes/Reminders: đóng cửa sổ (nút đỏ hoặc ⌘W) chỉ **ẩn** cửa sổ, app vẫn chạy
(auto backup vẫn chạy). Bấm icon trên Dock (`RunEvent::Reopen`) thì cửa sổ hiện lại.
Thoát hẳn bằng ⌘Q. Làm ở Rust (`on_window_event` `CloseRequested` → `prevent_close` +
`hide`).

## 2. Bỏ dấu hiệu của web

Class `desktop` gắn lên `<html>` khi `DESKTOP_CHROME` (Tauri thật hoặc preview
`?desktop=1`), CSS trong `index.css` khoá theo class đó:

- **Con trỏ:** nút và hàng bấm được dùng con trỏ mũi tên như control native
  (`.cursor-pointer` → `default`). Link thật (`a[href]`) giữ bàn tay. Con trỏ chuyên dụng
  (`col-resize`, `grab`, `text` trong ô nhập) giữ nguyên.
- **Không bôi đen chữ giao diện:** `user-select: none` ở `body`; mở lại cho `input`,
  `textarea`, `[contenteditable]`, `.editable` và mọi phần tử có class `select-text`.
- **Không nảy cả trang:** `overscroll-behavior: none` trên `html, body`. Vùng cuộn bên
  trong vẫn nảy như NSScrollView.
- **Không kéo được ảnh/link ra ngoài:** `-webkit-user-drag: none` cho `img`, `a`.

Riêng Tauri (`IS_TAURI`, không áp cho preview để còn Inspect Element):

- **Chặn context menu của WebKit** (Reload / Inspect…). Vẫn để menu mặc định khi chuột
  phải trong ô nhập (cần Cut/Copy/Paste/Spelling) hoặc khi đang có vùng chọn chữ.

## 3. Nhớ kích thước và vị trí cửa sổ

`tauri-plugin-window-state` (chỉ phía Rust, không cần quyền JS), ghim `~2.4`: bản 2.5
đòi tauri 2.12, sẽ kéo crate `tauri` lệch minor với `@tauri-apps/api` 2.11 và
`tauri build` báo lỗi version mismatch. Lưu khi thoát, khôi
phục khi mở: `SIZE | POSITION | MAXIMIZED | FULLSCREEN`. **Không** lưu `DECORATIONS` và
`VISIBLE`: khôi phục decorations có thể đè overlay title bar; khôi phục visible có thể
mở app ở trạng thái ẩn (vì ⌘W giờ là ẩn). Lần mở đầu tiên vẫn 1280×800.

## 4. Vibrancy thật cho sidebar

Thay vì CSS `backdrop-filter` làm mờ nền canvas, sidebar dùng `NSVisualEffectView`
material **sidebar** của macOS, thấy hình nền desktop phía sau như Finder:

- `tauri.conf.json`: `app.macOSPrivateApi: true` (Cargo feature `macos-private-api`),
  cửa sổ `transparent: true` + `windowEffects { effects: ["sidebar"], state:
  "followsWindowActiveState" }`: cửa sổ không active thì material chuyển xám phẳng,
  giống Finder.
- Web: class `native-vibrancy` trên `<html>` (chỉ `IS_TAURI`). Khi đó `html`, `body` và
  root shell trong suốt; **cột chính** mang `.ambient-canvas` (trước đây là root) nên
  nội dung và các card kính vẫn nằm trên canvas đục như cũ. `.vibrancy` (sidebar + icon
  rail) bỏ nền và blur để lộ material native.
- **Dark mode của app ≠ appearance hệ thống:** material native theo `NSAppearance` của
  cửa sổ, không theo class `dark`. Mỗi khi đổi dark mode, app gọi
  `getCurrentWindow().setTheme('dark' | 'light')` (quyền `core:window:allow-set-theme`).
  Lợi thêm: menu chuột phải, menu bar dropdown, hộp thoại hệ thống cũng theo theme của
  app.
- Popover kính đè lên vùng sidebar không làm mờ được material native (WKWebView chỉ
  blur nội dung web). Chấp nhận: `--color-glass-thick` 0.78 đủ đục.
- `macOSPrivateApi` khiến app không lên được Mac App Store. Không sao: app phát hành
  qua DMG trên GitHub Releases.

## 5. Menu chuột phải native trên task

Chuột phải lên một task ở **List** (`[data-task-id]`) hoặc **Board** (`article[data-id]`)
mở menu native (`Menu.popup()`):

- **Status ▸** To do · In progress · Done (check ở trạng thái hiện tại)
- **Priority ▸** Urgent · High · Normal · Low · None (check ở mức hiện tại). Đây là chỗ
  đầu tiên trong List/Board đổi được priority trực tiếp.
- **Duplicate:** tạo task mới cùng sprint/assignee/priority/effort/start, title giữ
  nguyên, status về To do, không mang prereq. Đi qua `addSprintTask` (đúng
  `sequence`, có log "created"). Task con giữ cùng group.
- **Delete…:** hỏi xác nhận bằng `ConfirmDialog` như xoá từ selection bar ("Delete 1
  task?" + tên task), rồi `deleteTask`.

Quy tắc:
- Task **cha** (group có con): Status bị disable (status của cha là suy ra), Duplicate
  bị disable (nhân bản cả group là việc khác).
- Đổi Status/Priority đi qua `updateTask` (funnel chuẩn, có change log).
- Một listener `contextmenu` duy nhất ở `document` (cài trong `App`), tìm task qua
  `closest(...)` rồi đọc task từ Dexie, không phải luồn props qua các row đã `memo`.
- Chỉ trên Tauri. Web vẫn giữ menu mặc định của trình duyệt.

## Non-goals

- Menu chuột phải cho Timeline/Collection (để sau).
- Thông báo, badge Dock, Save panel cho Export, ký app với Apple: xem mục *Future* của
  [desktop-app-tauri.md](./desktop-app-tauri.md).
