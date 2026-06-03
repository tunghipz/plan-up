# plan-tmp — Project Conventions

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
