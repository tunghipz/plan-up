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
3. **Init dự án (sanity gate)** — từ `app/`: `npx tsc --noEmit && npm run build && npx vitest run`. Phải pass hết mới đi tiếp; fail thì dừng, báo user, không push.
4. **Commit** — commit mọi thay đổi đang chờ (docs + code) với message rõ ràng + trailer.
5. **Push git** — `git push` lên remote (branch hiện tại).

## Data model

4 IndexedDB tables in `app/src/db.ts`: `projects`, `members`, `sprints`, `tasks`.
Chi tiết đầy đủ (fields, schema versioning v1..v8, indexes) ở
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
