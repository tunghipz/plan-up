# Hosted share link — short `/view/<slug>-<id>`, updatable

**Status:** Implemented (backend needs a Vercel KV/Upstash store bound to the project;
without it the API returns 503 and the modal falls back to the in-URL link)
**Last updated:** 2026-07-15
**Code:** `app/api/share/index.ts` (POST create) + `app/api/share/[id].ts` (GET/PUT/DELETE)
— **self-contained** (each inlines its helpers, imports only Node builtins + `fetch`): a
relative `../_kv` import crashed the ESM function at load (missing `.js` →
FUNCTION_INVOCATION_FAILED), and the `@vercel/node` `.status()`/`.json()` helpers are
avoided in favour of the raw `res.statusCode`/`end` API. Talks to Upstash over its REST API
via the built-in `fetch` (no npm client). `app/vercel.json` (`/view/*` → SPA) ·
`app/src/share-hosted.ts` (runtime client + `slugify`/`suffixFromPath`) ·
`app/src/HostedShareControls.tsx` (Create/Copy/Update/Revoke UI + offline fallback) ·
`app/src/schema.ts` (Dexie **v14** `shares` table) · `app/src/db.ts` (facade
`getShareForRef`/`saveShareRecord`/`deleteShareRecord`) · `app/src/io.ts` (backup v6) ·
`app/src/ShareLinkModal.tsx` + `app/src/CollectionShareModal.tsx` (embed the controls) ·
`app/src/main.tsx` + `app/src/HostedViewer.tsx` (`/view/:id` fetch + render) · reuse
`app/src/share-snapshot.ts`, `app/src/SnapshotViewer.tsx`,
`app/src/CollectionSnapshotViewer.tsx` (unchanged). Tests: `app/src/share-hosted.test.ts`.
Demo: `demo/share-stable-link.html`.

## Purpose

Cái đau của [share-link-snapshot.md](./share-link-snapshot.md): **toàn bộ data nằm
trong URL fragment** → link dài theo kích thước data (collection lớn chạm ngưỡng
`SHARE_MAX_BYTES = 4000`), và **link đóng băng** — sửa plan xong phải gen link mới +
gửi lại.

Tính năng này thêm một chế độ share **thứ hai** đứng cạnh (không thay thế): data đẩy
lên một **store nhỏ**, link chỉ mang một **id ngắn cố định**:

```
plan-up-eta.vercel.app/view/q3-launch-a7k2p9
```

- **Ngắn + cố định** — ~42 ký tự, không phụ thuộc data to nhỏ.
- **Update tại chỗ** — sửa plan → bấm **Cập nhật** → cùng link ra data mới. Người nhận
  mở lại URL cũ thấy bản mới nhất. **Không push git, không deploy** (chỉ 1 request runtime).
- **Có Revoke** — thu hồi link (xoá khỏi store).

## Decisions (chốt — kèm lý do)

1. **Server đọc được (không mã hoá).** User chốt "không cần giấu". Đổi lại: link ngắn +
   đường dẫn `/view` đẹp, khỏi nhét key 22–43 ký tự vào URL. (Muốn riêng tư thì phải
   zero-knowledge, sàn ~53 ký tự — đã loại.) Blob vẫn nén lz-string như hiện tại, nhưng
   coi như **đọc được** (nén ≠ mã hoá). ⚠️ Note cho user khi share dữ liệu nhạy cảm.
2. **id = `<slug>-<suffix>`.** `slug` = tên plan slugify (bỏ dấu, `[a-z0-9-]`, ≤40 ký tự),
   `suffix` = 6 ký tự base32 ngẫu nhiên. **Chỉ `suffix` là key thật** tra store; `slug`
   thuần trang trí → **đổi tên plan không làm chết link** (suffix không đổi), gõ sai phần
   slug vẫn mở đúng. Server tách suffix = đoạn sau dấu `-` cuối.
3. **Store = Vercel KV** (Upstash Redis, free tier) trong cùng project. Data runtime,
   tách khỏi repo. (GitHub Gist loại: ghi cần nhét GitHub token vào client → lộ token.)
4. **Ghi có token, đọc mở.** `POST /api/share` (tạo) trả về `{ id, url, writeToken }`.
   `PUT`/`DELETE` bắt buộc header `x-write-token`; `GET` mở tự do ("anyone with link").
   `writeToken` lưu **chỉ ở máy** (Dexie `shares` + đi theo backup). Chống người lạ ghi
   đè/xoá share của mình dù API công khai.
5. **TTL 90 ngày, reset mỗi lần ghi.** Link còn update thì còn sống; bỏ quên thì tự dọn
   (store không phình). Đọc **không** gia hạn (đơn giản, dễ đoán).
6. **In-URL vẫn là fallback.** Offline / store lỗi / user chọn → vẫn tạo được link
   fragment dài kiểu cũ (bulletproof, offline, nhưng không update được). Giữ nguyên
   `share-snapshot.ts` + 2 viewer; không xoá gì.

## User-facing behavior

### Sender — nút Share thông minh
Cùng chỗ đặt như hiện tại (sprint: page-header; collection: top-bar cạnh Export). Modal
(`ShareLinkModal` / `CollectionShareModal`) giữ nguyên checklist tỉa member/section +
summary + cảnh báo. Thêm state theo `shares`:

- **Chưa share** → nút **Tạo link chia sẻ**. Bấm → encode blob (như hiện tại) → `POST`
  lên store → nhận id + writeToken → lưu `shares` → hiện link ngắn.
- **Đã share** → hiện **Copy link** + **Cập nhật** + **Thu hồi**:
  - **Cập nhật** — re-encode blob hiện tại → `PUT` cùng id (reset TTL). Link không đổi.
    Badge "đồng bộ / đang giữ bản cũ" như demo.
  - **Thu hồi** — `DELETE` id → xoá `shares` row → link chết (viewer báo hết hạn).
- **Offline / lỗi mạng** khi Tạo/Cập nhật → toast + tự rơi về **link fragment kiểu cũ**
  (dài, không update). Không chặn cứng.

### Recipient — mở `…/view/<slug>-<id>`
- `main.tsx` phát hiện `location.pathname` bắt đầu `/view/` → tách suffix → `GET
  /api/share/:id` → nhận `{ v, blob, kind }` → decode như hiện tại → render
  `SnapshotViewer` (v2 sprint) hoặc `CollectionSnapshotViewer` (v3 collection). **Không
  đổi gì trong 2 viewer** — chúng nhận `SnapshotData` giải mã, không quan tâm blob đến
  từ `#` hay từ fetch.
- Trạng thái: **loading** (đang fetch) · **not-found/expired** (404 → "Link đã thu hồi
  hoặc hết hạn") · **ok** (render board). Không crash.
- Link fragment cũ (`#v=2…`/`#v=3…`) vẫn chạy song song (boot vẫn đọc hash trước).

## Data

### Dexie **v14** — bảng mới `shares` (local, máy sender)
Map plan cục bộ → hosted share, để nút Share biết đã share chưa + để Update/Revoke.

```
shares: 'id, refId, projectId'
```
Fields: `id` (**= suffix**, key KV) · `refId` (sprintId **hoặc** collectionId — indexed để
tra "plan này đã share?") · `kind` (`'sprint' | 'collection'`) · `slug` · `writeToken`
(**secret, chỉ local**) · `url` (full) · `createdAt` · `updatedAt` · `projectId`.
Upgrade: bump version, thêm store; **không backfill** (chưa ai có share). Carry-forward mọi
bảng v13. → cập nhật [data-model.md](./data-model.md).

`shares` **nằm trong backup/export** (`io.ts`) → đổi máy / restore vẫn giữ `writeToken`
để update link cũ. Mất `shares` (xoá IndexedDB, không có backup) = không update được link
đó nữa (phải tạo link mới); read link vẫn sống tới khi TTL hết.

### Store (Vercel KV) — value theo key `share:<suffix>`
```jsonc
{ "v": 3, "blob": "<lz-string>", "kind": "collection",
  "wt": "<sha256(writeToken)>", "updatedAt": 1752… }
```
`blob` = **đúng chuỗi** `encodeSnapshot`/`encodeCollectionSnapshot` sinh ra hôm nay (tái
dùng nguyên si). `wt` = hash của writeToken (không lưu token thô). TTL 90 ngày set lúc
`POST`/`PUT`.

### API (Vercel Functions, deployed cùng project)
- `POST /api/share` — body `{ blob, kind, slug }`. Server: validate size (≤512 KB) → gen
  `suffix` (retry nếu trùng) + `writeToken` → lưu KV + TTL → trả `{ id, url, writeToken }`.
- `GET /api/share/:id` — trả `{ v, blob, kind, updatedAt }`. **Mở**, không token. 404 nếu
  không có / hết hạn.
- `PUT /api/share/:id` — header `x-write-token` (hash khớp `wt`) + body `{ blob }` → ghi
  đè + reset TTL. 403 nếu token sai.
- `DELETE /api/share/:id` — header `x-write-token` → xoá. 403 nếu sai.

## Implementation (phân pha)

1. **Backend** — bật Vercel KV trên project (env `KV_REST_API_*` auto-inject); 4 function
   trong `app/api/share/`; `vercel.json` rewrite `/view/*` → SPA. Deploy 1 lần. Test curl.
2. **Runtime client** `share-hosted.ts` — `createShare/getShare/updateShare/revokeShare`
   (fetch wrapper) + `slugify()` + base API (web = `location.origin`; prod desktop =
   `DEPLOYED_BASE`, dùng lại logic `share-runtime.ts`). Pure encode/decode giữ nguyên ở
   `share-snapshot.ts`.
3. **Dexie v14** `shares` + facade `db.ts` + include trong `io.ts` backup/export/import.
4. **Smart Share button** — mở rộng `ShareLinkModal` + `CollectionShareModal`:
   Create/Copy/Update/Revoke + badge đồng bộ + fallback in-URL khi offline.
5. **Viewer routing** — `main.tsx` nhánh `/view/:id`: loading → fetch → decode → render
   viewer sẵn có; state not-found/expired. Giữ nhánh hash cũ.
6. **Tests + docs + gate** — unit: `slugify`, tách suffix, `share-hosted` (mock fetch),
   schema v14 upgrade; bump doc; `tsc + build + vitest` (+ curl API thủ công).

## Rules & edge cases

- **Đổi tên plan** → slug URL lệch tên nhưng link vẫn mở (chỉ suffix tra store). Có thể
  "refresh" URL hiển thị khi Copy (dựng lại slug mới + suffix cũ) — cosmetic.
- **Trùng suffix** → server retry gen tới khi trống. Slug trùng nhau vô hại (suffix phân biệt).
- **Ghi trái phép** → API công khai nhưng `PUT`/`DELETE` cần `writeToken` đúng → người lạ
  không sửa/xoá được share của mình. Đoán suffix chỉ cho **đọc** (đã chấp nhận công khai).
- **Size** → cap 512 KB ở server (KV value có hạn); blob nén nên collection rất lớn mới chạm.
- **Untrusted input** → decode vẫn qua `decodeSnapshot`/`decodeCollectionSnapshot` (try/catch,
  validate shape, chống decompress bomb). Render bằng React text thuần → không XSS. Không đổi.
- **Desktop (Tauri)** → link base = `DEPLOYED_BASE` (prod), API gọi cùng origin đó; mở link
  ở browser hệ thống qua `openExternal` (đã có). Offline → fallback in-URL.
- **Privacy** → server (người vận hành Vercel) đọc được blob. Task planner độ nhạy thấp,
  đã chốt. Note rõ ở modal khi cần.

## Future / open questions

- **Zero-knowledge (option D)** — nếu sau này cần riêng tư: encrypt client, key trong
  `#fragment`, link ~53 ký tự. Đã thiết kế nhưng loại vì "không cần giấu".
- **QR** từ link ngắn (giờ ngắn nên QR gọn) — cân nhắc.
- **Gia hạn TTL khi có người đọc** — hiện chỉ reset khi ghi; có thể touch TTL trên `GET`.
- **Dọn share khi xoá plan** — xoá collection/sprint nên `DELETE` share tương ứng (hoặc để TTL lo).
