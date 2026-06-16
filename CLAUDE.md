# plan-up — Project Conventions

## File layout

- **`/` (root)** — chỉ chứa documentation và meta files: `design.md`, `CLAUDE.md`, `README.md` (nếu có).
- **`/app`** — toàn bộ source code, config, dependencies của web app. Mọi file code (TS/TSX/CSS/HTML), config (vite, tsconfig, eslint), package.json, node_modules đều nằm trong `app/`.

**Rule:** Khi tạo file mới:
- Nếu là code / app config → đặt trong `app/` (ví dụ `app/src/...`, `app/vite.config.ts`).
- Nếu là tài liệu thiết kế / spec / note → đặt trong root (ví dụ `design.md`, `notes-*.md`).
- Design doc theo từng tính năng → đặt trong `design-docs/` (mỗi tính năng 1 file).

## Design docs — doc-first (BẮT BUỘC)

`design-docs/` chứa spec theo từng tính năng (1 file / tính năng); xem `design-docs/README.md` (index + template).

**Quy tắc: mọi thay đổi tính năng phải có doc TRƯỚC khi implement.**
- Tính năng mới → tạo `design-docs/<feature>.md` trước, rồi mới code.
- Sửa tính năng có sẵn → cập nhật file doc tương ứng (bump *Last updated*) trước, rồi mới code.
- Code là nguồn sự thật cho *how*; doc là nguồn sự thật cho *what & why*. Giữ doc đồng bộ khi thực tế lệch.

## Demo UI/UX — chỉ dùng HTML

**Khi demo UI/UX hay giao diện → luôn xuất ra file HTML (mở/tương tác được trong trình duyệt), KHÔNG dùng ảnh PNG.**
- Demo đặt trong `demo/` (đã gitignore). HTML để user hover/click/so sánh trực tiếp, không phải ảnh tĩnh.
- PNG chỉ được dùng nội bộ để mình tự verify (screenshot kiểm tra), không phải là sản phẩm demo giao cho user.

### Verify UI — TIẾT KIỆM TOKEN (BẮT BUỘC)

Mỗi ảnh đọc vào hội thoại biến thành block base64 nằm trong context và **bị gửi lại làm
input token ở MỌI lượt kế tiếp** cho tới khi compaction. Chụp hàng loạt screenshot full-res
để "nhìn cho chắc" là nguyên nhân chính đốt usage (một session từng nhảy +24% chỉ vì ~250 ảnh
re-bill trên Opus). Quy tắc:

1. **Mặc định KHÔNG đọc ảnh — verify bằng text.** Dùng Playwright `page.evaluate` để dump DOM
   (vị trí/kích thước element, text, computed style, số lượng node, lỗi console) rồi assert
   bằng số. Text rẻ hơn ảnh nhiều bậc và kiểm tra được chính xác hơn "nhìn bằng mắt".
2. **Screenshot ghi ra đĩa, KHÔNG nhất thiết đọc lại.** Lưu vào `demo/` (hoặc `/tmp` nếu là
   ảnh vứt đi) làm artifact để *user* mở xem — bản thân mình không cần đọc file ảnh đó vào model.
3. **Khi buộc phải nhìn:** `deviceScaleFactor: 1` + viewport nhỏ nhất đủ thấy (đừng 2x), và
   **chỉ đọc 1–2 ảnh** chốt hạ — không đọc cả loạt before/after/light/dark cùng lúc.
4. **Đừng feed full-res PNG vào model.** Nếu cần so sánh nhiều phương án → để trong 1 file HTML
   (`demo/*.html`) cho user tự xem, không phải N ảnh đọc vào hội thoại.

## Stack

React 19 + TypeScript + Vite + Tailwind v4 + Dexie (IndexedDB) + TanStack Table + lucide-react.

## Run

```bash
cd app
npm install   # nếu chưa
npm run dev   # http://localhost:5173
```

## Git workflow

- **Không bao giờ `git push` khi user chưa confirm.** Commit local thoải mái sau khi
  feature hoàn thành (tsc + tests pass), nhưng push lên remote phải đợi user nói
  "push" / "đẩy lên" / OK explicit.
- `git commit` được phép tự chạy sau mỗi feature done.
- Force push / reset --hard / delete branch → luôn phải hỏi.

### Quy trình khi user nói "push git" (BẮT BUỘC, theo đúng thứ tự)

Khi user nói **"push git"** / "push" / "đẩy lên", chạy lần lượt:

1. **Update README** — đồng bộ `README.md` với các tính năng/đổi mới chưa phản ánh.
2. **Update document liên quan** — rà & cập nhật mọi doc liên quan tới thay đổi cho khớp code mới nhất: `design-docs/<feature>.md` (bump *Last updated*), `design.md`, `design-system.md`, `design-docs/data-model.md`, `design-docs/README.md` (index) nếu có động tới. Đảm bảo doc là nguồn sự thật mới nhất, không lệch với code.
3. **Bump version (BẮT BUỘC mỗi lần push)** — từ `app/`: `npm version patch --no-git-tag-version` (vd `0.0.0` → `0.0.1`). Tăng **patch** mặc định; chỉ tăng **minor**/**major** (`npm version minor|major --no-git-tag-version`) khi user nói rõ. `--no-git-tag-version` để chỉ sửa `package.json` (không tự tạo commit/tag) — version mới sẽ đi cùng commit ở bước 5. Version này hiện ở footer sidebar (`__APP_VERSION__`, xem `app-shell-and-navigation.md`).
4. **Init dự án (sanity gate)** — từ `app/`: `npx tsc --noEmit && npm run build && npx vitest run`. Phải pass hết mới đi tiếp; fail thì dừng, báo user, không push.
5. **Commit** — commit mọi thay đổi đang chờ (docs + code + `package.json` version) với message rõ ràng + trailer.
6. **Push git** — `git push` lên remote (branch hiện tại).

## Data model

6 IndexedDB tables in `app/src/db.ts`: `projects`, `members`, `sprints`, `tasks`, `collections`, `events`.
Chi tiết đầy đủ (fields, schema versioning v1..v11, indexes) ở
[`design-docs/data-model.md`](design-docs/data-model.md).

Schema versioning qua Dexie's `version().stores()` — bump version + thêm upgrade callback khi đổi schema.

## Design philosophy

- `design.md` — product spec (premises, scope, success criteria, schema migration).
- **`design-system.md` — UI/UX constitution.** Đọc TRƯỚC KHI code component mới. Định nghĩa: brand spec (rust `#C04A1A`), typography, layout principles (card-per-group), component rules (avatar/status/priority/date), interaction (keyboard, persistence), anti-patterns, decision checklist 7 câu.

Tóm tắt DNA:
- Single-user web app, no auth, no backend ("ClickUp without seat tax").
- Speed > breadth (mỗi action ≤ 1 click hoặc 1 keystroke).
- Local-first (IndexedDB nhà; export/import là backup).
- Calm utility (calm > cute).
