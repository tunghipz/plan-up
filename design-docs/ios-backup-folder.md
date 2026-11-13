# Mở từ folder backup trên iPhone

**Status:** Implemented
**Last updated:** 2026-11-13
**Code:** `app/src-tauri/plugins/backup-folder/` (plugin Swift), `app/src-tauri/src/lib.rs`
(`backup_folder_*`), `app/src/backup-folder-mobile.ts`, `app/src/BackupFolderModal.tsx`,
`app/src/BackupSettingsModal.tsx` (`RestoreSection` dùng chung), `app/src/App.tsx` (menu `⋯`)

## Purpose

Bản Mac tự backup vào một folder ([auto-backup.md](./auto-backup.md)). User để folder đó trong
iCloud Drive (`iCloud Drive/10-work-vng/plan-up-backup`). App iPhone ([ios-app.md](./ios-app.md))
có dữ liệu riêng, trước đây muốn có plan của Mac phải Export → AirDrop → Import bằng tay.
Tính năng này cho iPhone **chọn folder backup đó một lần**, sau đó mở bản mới nhất (hoặc một
bản cũ trong `versions/`) ngay trong app.

> **Quyết định 2026-11-13:** user chọn hướng **1** ("1"): iPhone chỉ **đọc** folder backup của
> Mac, không ghi. Hướng 2 (iPhone cũng auto backup vào folder) bị loại vì hai máy cùng ghi một
> folder sẽ đè file của nhau. App không có đồng bộ thật.

## User-facing behavior

- Chỉ có trên **app iPhone** (`IS_NATIVE_MOBILE`). Web và desktop không đổi.
- Menu `⋯` có thêm mục **Folder backup…**. Mục này mở sheet **Folder backup**:
  - Dòng folder: tên folder đã chọn (vd `plan-up-backup`), hoặc "Chưa chọn folder". Nút
    **Chọn folder…** mở trình chọn folder của iOS (Files). Lần đầu chọn
    `iCloud Drive › 10-work-vng › plan-up-backup`. App nhớ folder qua các lần mở.
  - Danh sách các bản trong `versions/` của folder, mới nhất ở trên, nhóm theo ngày, như màn
    "Restore từ version" của Mac ([restore-versions.md](./restore-versions.md)). Bản đầu có nhãn
    **Mới nhất** và được **chọn sẵn**: mở sheet là thấy ngay số project / sprint / task của bản
    đó, bấm **Mở bản này** là xong. Bấm bản khác để xem và mở bản cũ hơn.
  - Bấm **Mở bản này** → hỏi xác nhận `Thay dữ liệu trên iPhone?`. Đồng ý → app lưu dữ liệu
    hiện tại của iPhone thành file `plan-up-iphone-truoc-khi-mo-YYYY-MM-DD-HHMMSS.json` trong
    **Files › On My iPhone › plan-up** (không hiện thông báo), thay toàn bộ dữ liệu bằng bản đã
    chọn, rồi tải lại app. Lưu bản an toàn thất bại thì dừng, dữ liệu không đổi.
- File iCloud chưa tải về iPhone: app tự tải khi đọc, dòng preview hiện "Đang đọc…" lâu hơn.
- Folder bị đổi tên, xoá hoặc mất quyền: sheet báo lỗi, chọn lại folder là chạy tiếp.
- **Chỉ đọc.** iPhone không ghi, không xoá gì trong folder backup. Sửa trên iPhone rồi mở bản
  từ Mac là mất phần sửa đó (đã có file an toàn ở trên để lấy lại bằng Import).

## Data

Không đổi schema. Payload là `ExportPayload` của auto backup (`exportAll()`), restore bằng
`importAll()` như Import. Folder đã chọn được Swift lưu dạng **bookmark** trong `UserDefaults`
của app (`plan-up.backupFolderBookmark`), không nằm trong localStorage.

## Implementation

**Plugin Swift** `app/src-tauri/plugins/backup-folder/` (crate `tauri-plugin-backup-folder`,
chỉ build cho iOS, khai báo trong `[target.'cfg(target_os = "ios")'.dependencies]`):
- `pick`: `UIDocumentPickerViewController(forOpeningContentTypes: [.folder])`, tạo bookmark từ
  URL được chọn, lưu vào `UserDefaults`, trả `{ name }` (hoặc `{ name: null }` khi bấm Cancel).
- `status`: resolve bookmark, trả `{ name }` hoặc `{ name: null }`. Bookmark stale thì tạo lại.
- `list { subdir }`: liệt kê tên file trong folder (hoặc `versions/`), trong
  `startAccessingSecurityScopedResource` + `NSFileCoordinator`. Placeholder iCloud
  (`.ten-file.icloud`) được đổi về tên thật.
- `read { fileName, subdir }`: gọi `startDownloadingUbiquitousItem`, đọc qua
  `NSFileCoordinator` (đọc có điều phối thì iOS tự tải file iCloud), trả bytes dạng base64.
- Mọi đọc ghi chạy trên background queue. Không có lệnh ghi.

**Rust** (`lib.rs`, chỉ iOS): plugin được đăng ký trong `run()` mobile. Bốn command app
`backup_folder_pick / _status / _list / _read` (đều `async`, vì gọi plugin là chờ chặn và
picker cần main thread) gọi plugin qua `PluginHandle::run_mobile_plugin`:
- Tên file đi qua `is_backup_filename` và `subdir` chỉ được `""` hoặc `"versions"` trước khi
  tới Swift, cùng luật với bản Mac. Webview không đưa đường dẫn nào cho native.
- `_list` lọc tên hợp lệ và sắp mới nhất trước. `_read` giải base64, gunzip nếu `.json.gz`
  (dùng chung `decode_backup` với `read_backup_at` của desktop), trả chuỗi JSON.
- `save_export` có thêm `quiet` để lưu bản an toàn không hiện thông báo.

**Frontend:**
- `backup-folder-mobile.ts`: `getFolderName`, `pickFolder`, `listFolderVersions`,
  `readFolderVersion`, `openFolderVersion` (đọc bản đích trước, rồi lưu bản an toàn, rồi
  `importAll`).
- `RestoreSection` trong `BackupSettingsModal.tsx` nhận `source` (list / read / restore + chữ
  trên nút và hộp xác nhận) và `preselectFirst`. Desktop truyền nguồn `versions/` cũ, giữ y
  nguyên hành vi. `BackupFolderModal.tsx` dùng nó với nguồn iCloud.
- Mục `⋯ → Folder backup…` trong `App.tsx`, chỉ khi `IS_NATIVE_MOBILE`.

## Rules & edge cases

- Chỉ liệt kê `versions/`. File ngày `plan-up-YYYY-MM-DD.json` bị bỏ qua giống bản Mac: nội
  dung của nó luôn trùng bản `versions/` mới nhất (versions chỉ bỏ ghi khi nội dung không đổi).
- Bản Mac cần build có tier `versions/` (từ 2026-07-14). Folder chưa có `versions/` thì sheet
  báo "Chưa có version nào".
- iCloud trên Mac đẩy file lên chậm vài giây đến vài phút. Bản "mới nhất" trên iPhone là bản đã
  lên iCloud, chưa chắc là thay đổi cuối cùng trên Mac.
- Bookmark chỉ có hiệu lực cho app này trên máy này. Xoá app là phải chọn lại folder.
