# iOS app (cài qua cáp)

**Status:** Implemented (đã cài và chạy trên iPhone Air, 2026-11-13)
**Last updated:** 2026-11-13
**Code:** `app/src-tauri/` (`lib.rs`, `Cargo.toml`, `capabilities/mobile.json`,
`tauri.ios.conf.json`, `Info.ios.plist`, `gen/apple/`), `app/src/platform.ts` (`IS_TAURI`,
`IS_NATIVE_SHELL`, `IS_NATIVE_MOBILE`), `app/src/native-save.ts`, `app/src/lib.ts` (`downloadJson`),
`app/src/png-export.ts` (`downloadPng`), `app/scripts/ios-install.mjs`

## Purpose

User muốn plan-up là **app thật trên iPhone**, cắm cáp vào Mac là build và cài được, không phải
"Add to Home Screen". Dùng lại shell Tauri 2 của bản macOS (Tauri 2 hỗ trợ iOS), nên toàn bộ UI
là code web hiện có cùng layout điện thoại ở [mobile-layout.md](./mobile-layout.md).

> **Quyết định 2026-11-13:** ký bằng team công ty **ZINGPLAY INTERNATIONAL PTE. LTD**
> (Team ID `RSUB2XWLVS`, profile hạn khoảng một năm). User chọn "Team ZINGPLAY" thay vì Apple ID
> cá nhân (app hết hạn sau 7 ngày) hay PWA.

## User-facing behavior

- Cắm iPhone (mở khoá, bấm "Trust" nếu được hỏi), chạy `npm run ios:device` trong `app/`: build
  bản release, ký, cài lên máy, mở app. Đã build rồi thì chỉ cần `npm run ios:install`.
- App tên **plan-up**, icon giống bản macOS, mở toàn màn hình, nội dung tránh tai thỏ và thanh
  Home (safe area).
- Trên iPhone app chạy **như bản web trên điện thoại**: drawer, task card hai dòng, Board vuốt
  ngang, menu `⋯`. Không có những thứ chỉ desktop mới có: menu bar, auto update, panel Claude,
  auto backup ra folder, nhớ kích thước cửa sổ.
- **Dữ liệu nằm trong app**, tách hẳn với Mac và với Safari. Lần đầu mở: dữ liệu demo. Muốn có plan
  đang làm: Export trên Mac, gửi file sang iPhone (AirDrop, Files), rồi trong app `⋯ → Import`.
- **Export trên iPhone** (`⋯ → Export…`, Export PNG): file được ghi vào **Files › On My iPhone ›
  plan-up**, kèm thông báo tên file. (Trong app, tải file kiểu trình duyệt không chạy.)
- **Share link:** link trỏ về bản web đã deploy (`plan-up-eta.vercel.app`), như bản macOS, vì
  origin của app là `tauri://localhost`, người nhận không mở được.

## Implementation

**Rust (`src-tauri/`):**
- Plugin chỉ có trên desktop (`window-state`, `updater`, `process`, `dialog` dùng cho chọn folder)
  khai báo trong `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`.
- `run()` tách hai nhánh `#[cfg(desktop)]` / `#[cfg(mobile)]`, mỗi nhánh một `invoke_handler`.
  Nhánh mobile chỉ có plugin `opener` và lệnh `save_export`. Module `claude` và các lệnh backup
  chỉ biên dịch cho desktop.
- `save_export(file_name, text | base64)`: ghi vào thư mục Documents của app; `Info.plist` bật
  `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` để thư mục đó hiện trong app Files.
  Tên file được kiểm tra (không `/`, không `..`).
- Capabilities tách theo `platforms`: `default.json` (macOS/Windows/Linux, như cũ) và
  `mobile.json` (iOS/Android: `core:default`, opener).
- `tauri.ios.conf.json` (merge vào `tauri.conf.json` khi build iOS): identifier
  `com.planup.mobile`, `bundle.iOS.developmentTeam` = `RSUB2XWLVS`, bỏ updater artifacts.

**Frontend:**
- `platform.ts` (không import gì, tránh vòng lặp): `IS_TAURI` giờ nghĩa là **Tauri desktop** (mọi
  chỗ đang gate tính năng desktop giữ nguyên nghĩa; `backup.ts` re-export). Thêm `IS_NATIVE_SHELL`
  (mọi bản Tauri, kể cả iOS: base URL của share link, API hosted share, mở link ngoài qua opener) và
  `IS_NATIVE_MOBILE` (Tauri trên iPhone/iPad/Android, nhận theo user agent; iPadOS tự xưng là Mac
  nên xét thêm `maxTouchPoints`).
- `downloadJson` / `downloadPng`: trên `IS_NATIVE_MOBILE` gọi `save_export` thay vì anchor download.
- `index.html`: `viewport-fit=cover`; shell chính đệm `env(safe-area-inset-*)`.

**Script (`package.json`):**
- `ios:build`: `tauri ios build --export-method debugging`, ra
  `src-tauri/gen/apple/build/arm64/plan-up.ipa`.
- `ios:install`: `scripts/ios-install.mjs` tìm iPhone đang cắm qua `xcrun devicectl`, cài `.app`, mở app.
- `ios:device`: hai lệnh trên nối nhau.

**Icon:** `Assets.xcassets/AppIcon.appiconset` sinh từ `icon-source.png`. Ô xanh của icon macOS
được cắt tràn viền, góc nền xanh `#0071E3`, vì iOS tự bo góc (để nguyên icon macOS thì thành ô nhỏ
nằm trong khung trắng).

## Rules & edge cases

- Build iOS cần: Xcode, Rust target `aarch64-apple-ios`, `xcodegen` + `cocoapods` (Homebrew), và
  **`rustup component add llvm-tools`**. Với **Xcode 27** cần `swift-rs` ≥ 1.0.9 (đã nâng trong
  `Cargo.lock`): bản 1.0.7 biên dịch phần Swift của Tauri bằng SDK macOS; 1.0.9 sửa chuyện đó và
  dùng `llvm-objcopy` để đưa các symbol `@_cdecl` ra global, thiếu `llvm-tools` thì link lỗi
  "Undefined symbols … init_plugin_dialog".
- **iOS 27 bắt app dùng UIScene lifecycle**: app không khai báo scene bị dừng ngay khi mở
  (`EXC_BREAKPOINT` trong `UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Cần
  **Tauri ≥ 2.12** (kéo theo tao 0.37, có `TaoSceneDelegate`) và `UIApplicationSceneManifest` trong
  `Info.ios.plist` (một scene, delegate `TaoSceneDelegate`). Đã nâng Tauri 2.11 → 2.12.5, plugin
  và `@tauri-apps/*` lên cùng minor; `tauri-plugin-window-state` bỏ ghim `~2.4`.
- Lần đầu trên iPhone: bật **Developer Mode** (Settings › Privacy & Security), khởi động lại máy.
- Profile ký app (team ZINGPLAY) đã có UDID của iPhone Air `00008150-001251E10244401C`. Máy khác
  phải được thêm vào team trước.
- Không đổi schema. IndexedDB của app nằm trong container của app (WKWebView), xoá app là mất dữ
  liệu: Export định kỳ.
- `gen/apple/` (project Xcode sinh ra) được commit, như Tauri khuyên, để build lại không phải init.
- Bản desktop không được đổi hành vi: mọi chỗ trước đây dùng `IS_TAURI` vẫn đúng như cũ trên Mac.
