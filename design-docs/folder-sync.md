# Đồng bộ Mac ↔ iPhone qua folder iCloud

**Status:** Implemented
**Last updated:** 2026-11-13
**Code:** `app/src/sync-stamp.ts` (dấu thời gian + tombstone), `app/src/sync.ts` (gộp dữ liệu, lịch chạy),
`app/src/SyncSection.tsx` (công tắc + trạng thái), transport trong `app/src/backup-tauri.ts`
(`desktopSyncTransport`) và `app/src/backup-folder-mobile.ts` (`mobileSyncTransport`),
`app/src/BackupSettingsModal.tsx` (Mac), `app/src/BackupFolderModal.tsx` (iPhone), `app/src/App.tsx`, `app/src-tauri/src/lib.rs` (`is_sync_filename`, subfolder `sync`),
`app/src-tauri/plugins/backup-folder/` (lệnh `write`)

## Purpose

User dùng plan-up trên Mac và iPhone, muốn sửa trên máy nào cũng được và máy kia thấy. Hai máy đã
cùng trỏ vào một folder iCloud Drive (`10-work-vng/plan-up-backup`: Mac auto backup vào đó, iPhone
mở bản backup từ đó, [ios-backup-folder.md](./ios-backup-folder.md)). Trước đây iPhone chỉ đọc folder
nên sửa trên iPhone không về Mac.

> **Quyết định 2026-11-13:** user chọn **cách 2 · đồng bộ thật** ("trên iphone tao cũng chọn folder
> trên icloud để mở xem, mac và iphone sync qua folder đó, cách 2"), không chọn cách 1 (ghi qua lại
> cả bản, mỗi lần mở là thay toàn bộ).

Không có server: iCloud Drive chỉ chuyển file. Việc gộp do app làm.

## Cách hoạt động

- Mỗi máy có một **mã máy** (`mac-xxxxxx`, `iphone-xxxxxx`) và chỉ ghi **một file của riêng nó**:
  `<folder>/sync/plan-up-sync-<mã máy>.json.gz`, chứa toàn bộ dữ liệu của máy đó. Không có hai máy
  cùng ghi một file, nên iCloud không sinh file xung đột ("file 2.json").
- Mỗi bản ghi (project, member, sprint, collection, task, event, people, share) có **`modifiedAt`**:
  thời điểm sửa lần cuối (ms), app tự gắn ở mọi lần ghi. Xoá một bản ghi để lại **tombstone**
  (`bảng:id → deletedAt`) để máy kia biết mà xoá theo, không phải tưởng là thiếu rồi chép lại.
- **Đồng bộ một lượt:** đọc file của các máy khác, gộp từng bản ghi theo **bản sửa sau cùng thắng**
  (so `modifiedAt`; xoá thắng nếu xoá sau lần sửa cuối), rồi ghi file của mình.
- Hai máy cùng sửa **một task** trước khi kịp đồng bộ: bản sửa sau cùng (theo giờ máy) thắng cả task,
  bản kia mất. Sửa **hai task khác nhau** thì cả hai đều giữ.
- Hai máy cùng tạo task mới trong một sprint có thể trùng số `#`: sau khi gộp, task tạo sau được đổi
  sang số kế tiếp (prereq lưu theo id nên không lệch).

## User-facing behavior

### Bật

- **Mac:** Export → *Auto backup…* → bật **Đồng bộ qua folder này** (cần đã chọn folder backup).
- **iPhone:** `⋯ → Folder backup…` → bật **Đồng bộ qua folder này** (cần đã chọn folder).
- **Máy bật sau** (thường là iPhone, khi folder đã có file đồng bộ của máy khác): hỏi xác nhận
  "Lấy dữ liệu từ Mac?", rồi lưu dữ liệu hiện tại ra file an toàn (iPhone: Files › plan-up;
  Mac: `versions/`), sau đó **thay bằng dữ liệu của máy kia**. Không gộp ở lần đầu: bản ghi cũ chưa có
  `modifiedAt` nên không biết bản nào mới hơn.

### Khi đang bật

- Đồng bộ chạy: lúc mở app, khi app quay lại foreground, mỗi 60 giây, và 5 giây sau mỗi lần sửa.
- Dòng trạng thái trong hai sheet trên: "Đồng bộ lúc 15:32 · iPhone (15:30)" hoặc lỗi màu đỏ.
- iCloud cần vài giây đến vài phút để chuyển file giữa hai máy, nên thay đổi không hiện tức thì.
- Mở một bản backup cũ (Restore trên Mac, *Mở bản này* trên iPhone) **cũng được đồng bộ**: máy kia
  sẽ thành bản đó. Hộp xác nhận nói rõ điều này khi đồng bộ đang bật.
- Auto backup của Mac (file ngày + `versions/`) vẫn chạy như cũ, độc lập với đồng bộ.

### Tắt

Tắt thì ngừng đọc ghi; file đồng bộ của máy này giữ nguyên trong folder.

## Data

- **Không đổi schema Dexie** (v15). `modifiedAt?: number` là field thêm vào bản ghi, không index.
  Bản ghi cũ không có thì tính là 0.
- Tombstone lưu trong localStorage `plan-up:syncTombstones` (`{ "tasks:<id>": deletedAt }`), bỏ sau
  90 ngày. Tombstone của một transaction gom trong bộ nhớ và chỉ lưu một lần khi transaction commit.
- localStorage: `plan-up:syncDeviceId`, `plan-up:syncEnabled`, `plan-up:syncStatus`.
- File đồng bộ (gzip JSON):
  `{ format: 1, deviceId, deviceName, writtenAt, schema: 15, tables: { projects: [...], ... },
  tombstones: { "tasks:<id>": deletedAt } }`.
- Export / backup có thêm `modifiedAt` trong mỗi bản ghi; Import đọc được cả file cũ.

## Implementation

- **`sync-stamp.ts`**: hook Dexie `creating` / `updating` trên 8 bảng gắn `modifiedAt` từ đồng hồ
  tăng dần (không bao giờ trùng hay lùi trong một máy); `deleting` ghi tombstone. Transaction của
  bước gộp được đánh dấu (`markSyncTx`) để hook bỏ qua: bản ghi lấy từ máy kia giữ nguyên
  `modifiedAt` gốc. Mỗi lần ghi không phải từ đồng bộ báo cho `sync.ts` (hẹn đồng bộ sau 5 giây).
- **Import thay toàn bộ** (`importAll`): `clear()` gọi hook `deleting` cho từng bản ghi nên mọi bản ghi
  cũ có tombstone; bản ghi mới nhận `modifiedAt` mới hơn. Kết quả: đồng bộ sang máy kia đúng như một
  lần sửa lớn.
- **`sync.ts`**: `mergeSnapshots` (pure, có test) quyết định bản ghi nào put / delete; `syncNow` chạy
  một lượt có khoá (không chạy chồng), áp dụng trong một transaction đánh dấu, sửa trùng số `#`, ghi
  file của mình. Hoà (cùng `modifiedAt`) thì chọn bản có JSON lớn hơn theo thứ tự chuỗi, để hai máy ra
  cùng kết quả. File của máy khác có `schema` mới hơn app này thì bỏ qua và báo "cập nhật app".
- **Transport** (đăng ký trong `App.tsx` theo nền tảng): Mac gọi `list_backups` / `read_backup` /
  `write_backup` với subfolder `sync` (Rust gzip/gunzip theo đuôi `.gz`, ghi file tạm rồi đổi tên);
  iPhone gọi `backup_folder_list` / `_read` / `_write`.
- **`SyncSection.tsx`**: công tắc, dòng trạng thái, nút *Đồng bộ ngay*; bật lần đầu mà folder đã có
  file của máy khác thì hỏi, lưu bản an toàn, lấy dữ liệu máy kia rồi tải lại app.
- `projectPlanSignature` (so nội dung plan cho Undo của Claude) bỏ qua `modifiedAt`.
- **Rust:** subfolder cho phép thêm `sync`; tên file trong `sync/` phải khớp `is_sync_filename`
  (`plan-up-sync-[a-z0-9-]{4,40}.json.gz`). Tên backup và tên sync không dùng lẫn thư mục của nhau.
- **Swift:** lệnh `write { fileName, subdir, data }` (chỉ `sync`), tạo `sync/` nếu chưa có, ghi qua
  `NSFileCoordinator` (forWriting) với `.atomic`.

## Rules & edge cases

- "Sau cùng thắng" dựa vào giờ của từng máy. Giờ máy lệch nhiều phút có thể làm bản sửa trước thắng.
- Mất tombstone (xoá rồi tắt app ngay trước khi ghi xong) thì bản ghi đã xoá có thể quay lại từ máy kia.
- Máy đã gỡ app vẫn để lại file trong `sync/`; dữ liệu của nó cũ hơn nên không đè gì, có thể xoá tay.
- Chỉ app Mac (Tauri) và app iPhone đồng bộ. Bản web trong trình duyệt không có folder nên không đồng bộ.
- Hai bản app phải cùng version schema; khác thì máy cũ hơn báo cần cập nhật và không gộp.
