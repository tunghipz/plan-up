# Desktop auto update (macOS)

**Status:** Implemented
**Last updated:** 2026-07-08
**Code:** `app/src-tauri/` (updater + process plugins, `tauri.conf.json`),
`app/src/VersionFooter.tsx` (`TauriVersionFooter`), `.github/workflows/release.yml`

## Purpose

Bản Mac (Tauri 2) trước đây chỉ update bằng cách tải DMG mới thủ công. Auto
update để desktop ngang bằng web: app tự phát hiện release mới trên GitHub,
user bấm 1 nút là tải + cài + relaunch — cùng idiom update-pill của bản web.

## Architecture

- **`tauri-plugin-updater`** — check/download/install. **`tauri-plugin-process`**
  — relaunch sau khi cài.
- **Endpoint:** GitHub Releases (repo public):
  `https://github.com/tunghipz/plan-up/releases/latest/download/latest.json`
  `latest.json` do `tauri-action` sinh tự động khi updater active (kèm chữ ký +
  URL file `.app.tar.gz`).
- **Signing (bắt buộc):** minisign keypair riêng của Tauri updater — KHÔNG phải
  Apple codesign. Update artifact được ký khi build; app verify bằng `pubkey`
  nhúng trong `tauri.conf.json` trước khi cài. App unsigned với Apple vẫn OK
  (Gatekeeper chỉ chặn lần tải DMG đầu, không chặn app tự thay bundle).
  - Private key: `~/.tauri/plan-up-updater.key` (máy dev; passphrase rỗng).
    **Mất key = mất khả năng ship update** — backup ra password manager.
  - GH Actions secret: `TAURI_SIGNING_PRIVATE_KEY` (nội dung file key).
- **Config** (`tauri.conf.json`):
  - `bundle.createUpdaterArtifacts: true` → build sinh `.app.tar.gz` + `.sig`.
  - `plugins.updater.pubkey` + `endpoints`.
- **Capabilities:** thêm `updater:default`, `process:allow-restart`.

## UI (VersionFooter)

`TauriVersionFooter` thay footer tĩnh cũ của bản desktop — mirror đúng DNA
update-pill của `SwVersionFooter` (version-and-updates.md):

- Rest: `plan-up · v{version}` calm text.
- Check `check()` lúc mount + mỗi 6h (long-running app). Import
  `@tauri-apps/plugin-updater` **dynamic** — web bundle không phình, chunk chỉ
  load khi `IS_TAURI`.
- Có update → pill accent `Update · v{next}` (cùng class `update-pill brand-btn`).
- Click → `downloadAndInstall()` (label "Updating…" + spinner) → `relaunch()`.
- Lỗi check/tải (offline, release chưa publish…) → nuốt lặng, footer giữ calm —
  update là tiện ích, không phải alert.

## Release flow

1. Bump version + tag `v*` push → workflow build universal DMG **+ updater
   artifacts** (`.app.tar.gz` + `.sig` + `latest.json`), ký bằng secret.
2. Release tạo ở trạng thái **draft** — `latest.json` chỉ resolve sau khi
   **publish release**. Publish = phát hành update cho mọi user.
3. App đang chạy check thấy version mới → pill → user update tại chỗ.

## Rules & edge cases

- Repo phải **public** (chốt 2026-07-08) — endpoint `releases/latest/download`
  của repo private đòi auth, updater không tải được.
- `latest.json` chỉ trỏ release **mới nhất đã publish**; draft/prerelease bị bỏ
  qua. Muốn rollback: publish lại release cũ hơn với version cao hơn.
- DMG cài tay lần đầu vẫn cần right-click → Open (unsigned với Apple, như cũ).
- Updater so version semver: chỉ hiện pill khi remote > local.
- Web build không đổi: `SwVersionFooter` giữ nguyên; switch `IS_TAURI` như cũ.

## Non-goals

- Không auto-install ngầm (user luôn bấm nút — giống web).
- Không Apple notarization/codesign (việc riêng, cần Apple Developer ID).
- Không delta update / kênh beta.
