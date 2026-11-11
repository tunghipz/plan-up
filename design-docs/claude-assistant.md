# Claude assistant (desktop)

**Status:** Implemented
**Last updated:** 2026-11-11 (bôi đen và copy được chữ trong hội thoại). Trước đó: 2026-11-10 (kéo đổi bề rộng panel; task, người, sprint trong câu trả lời bấm được để nhảy tới trong plan). Trước đó: 2026-11-09
**Code:** `app/src-tauri/src/claude.rs`, `app/src/claude-run.ts`, `app/src/claude-context.ts`,
`app/src/claude-prompt.ts`, `app/src/claude-actions.ts`, `app/src/claude-deck.ts`,
`app/src/ClaudePanel.tsx`, `app/src/App.tsx`, `app/src/native-shell.ts`

## Purpose

Hỏi Claude về dự án đang mở bằng lời thường, dùng subscription Claude Pro/Max của chính
mình (không cần API key). User yêu cầu ngày 2026-11-09, nguyên văn: *"gắn được claude subs
vào không để tao có thể nói nó tạo slide hay làm theo yêu cầu của tạo dựa trên thông tin dự
án"*, rồi chọn: *"làm cả 2 phần, slide xuất HTML"*.

Hai việc:

1. **Đọc và viết:** hỏi đáp, tóm tắt, báo cáo, và **tạo slide** từ số liệu dự án, xuất ra một
   file HTML tự chứa.
2. **Làm theo yêu cầu có sửa dữ liệu:** "dời task của An sang sprint sau", "tạo task từ ghi
   chú này", "đặt hạn cho mấy task chưa có hạn". Claude chỉ **đề xuất** danh sách thay đổi;
   user xem từng dòng rồi bấm Apply mới ghi vào DB.

## Chỉ có trên bản desktop

- Bản desktop (Tauri) chạy CLI `claude` gốc trên máy ở chế độ headless. CLI dùng tài khoản
  Claude Code đang đăng nhập, nên tính vào giới hạn 5 giờ và giới hạn tuần của subscription.
- Bản web (Vercel, `npm run dev`) **không có** tính năng này: trình duyệt không chạy được
  lệnh `claude`, và đưa token subscription lên server là trái điều khoản. Nút và menu đều ẩn
  khi `IS_TAURI` là false.
- Điều khoản: Anthropic cho người dùng chạy bản `claude` gốc bằng subscription của chính
  mình. App không đọc, không lưu token đăng nhập. Dùng cá nhân; nếu phát hành app cho người
  khác thì phải xem lại điều khoản.
- Cách chạy CLI chép từ cll-space (`telegram-ai/app/tauri/src/claude.rs`), đã chạy ổn ở đó.

## User-facing behavior

### Mở panel

- Nút **✦ Claude** (lucide `Sparkles`) trên toolbar, cạnh nút Activity. Phím **⌘J** bật/tắt.
  Menu **View ▸ Ask Claude** (⌘J).
- Panel là **cột inspector bên phải**, mặc định rộng 412px (thẻ trắng bo 18px, cách mép 12px), mở ra
  thì đẩy cột chính hẹp lại chứ không đè lên board, không có scrim: board vẫn bấm và cuộn
  được, thấy ngay thay đổi vừa Apply. Mở/đóng trượt bề rộng như sidebar trái (300ms, tắt khi
  `prefers-reduced-motion`). Đóng bằng Esc, ⌘J hoặc nút ×. Mở app lên thì panel đóng (không
  lưu trạng thái mở).
- **Đổi bề rộng** (2026-11-10, user: *"cho thay đổi size kích thước của cửa số claude"*):
  kéo mép trái của panel, giống mép phải của sidebar (vạch accent hiện khi rê chuột, con trỏ
  `col-resize`, không có animation trong lúc kéo). Kẹp từ 340px tới 760px, và không quá 60%
  bề rộng cửa sổ. Lưu `plan-up:claudeWidth`. Double-click mép thì về 412px. Bàn phím: focus
  vào mép rồi ← rộng ra, → hẹp lại, mỗi lần 16px.
- Panel theo project: mỗi project có cuộc hội thoại riêng, giữ trong bộ nhớ suốt phiên chạy
  app (đóng app là mất; slide đã lưu thì còn trên đĩa). Không ghi chat vào IndexedDB.

### Bố cục panel

- **Header:** tiêu đề "Claude", dòng phạm vi "Reads *Tên project* · 3 sprints · 48 tasks",
  segmented model **Sonnet | Opus** (lưu `plan-up:claudeModel`, mặc định Sonnet), nút
  **New chat** (xoá hội thoại của project này), nút ×.
- **Khi chưa có tin nào:** vài gợi ý bấm được (gửi luôn):
  "Làm slide tổng kết sprint này", "Tóm tắt tiến độ theo từng người",
  "Task nào đang trễ hoặc sắp trễ?", "Ai đang quá tải trong sprint này?". Gợi ý viết tiếng
  Việt vì đó là lời user gửi đi; phần chrome của panel giữ tiếng Anh như cả app.
- **Hội thoại:** tin của user là bong bóng xám bên phải. Câu trả lời của Claude là văn bản
  markdown gọn (đoạn, gạch đầu dòng, `**đậm**`), hiện dần trong lúc Claude viết.
- **Bôi đen và copy** (2026-11-11, user: *"panel AI không bôi đen và copy được text"*). Chữ
  trong hội thoại (tin của user, câu trả lời, thẻ deck, thẻ Proposed changes) bôi đen và copy
  được. Bản desktop tắt chọn chữ toàn app (`desktop-native-feel.md` §2), nên vùng hội thoại
  gắn class `select-text` để mở lại. Header và các gợi ý lúc chưa có tin vẫn không chọn được
  vì đó là chrome.
- **Link trong câu trả lời** (2026-11-10, user: *"có thể làm highlight tên và task để bấm vào
  thì show trong plan không"*). Task, người và sprint Claude nhắc tới hiện thành link:
  - **Task** `#12 Login API`: chữ accent, đậm vừa. Bấm thì chọn sprint của task (nếu khác
    sprint đang xem), chuyển sang List, cuộn tới dòng đó và nháy viền accent (giống chọn kết
    quả ở search palette). Thẻ của người giữ task đang thu gọn thì mở ra; bảng All đang lọc
    người khác thì bỏ lọc. Task nằm trong task group đang thu gọn thì nháy dòng đầu group.
  - **Người**: avatar nhỏ + tên, chữ đậm vừa. Bấm thì chuyển sang List của sprint đang xem.
    Chế độ By member: mở thẻ của người đó nếu đang thu gọn, cuộn tới và nháy viền accent quanh
    thẻ. Người chưa có task trong sprint thì mở mục "N members with no tasks" rồi nháy thẻ của họ
    trong đó. Chế độ All: lọc bảng theo người đó (giống bấm chip của họ).
  - **Sprint**: chữ accent. Bấm thì chọn sprint đó.
  - Task hoặc người đã bị xoá: link mờ, không bấm được, rê chuột thấy "No longer in this
    project".
  - Tiêu đề task trong thẻ Proposed changes (dòng Edit, Move, Delete, Prereqs của task có
    sẵn) cũng bấm được như link task.
  - Cách làm: prompt bảo Claude viết mỗi task, người, sprint nhắc tới thành link Markdown trỏ
    vào handle: `[#12 "Login API"](t12)`, `[An](m1)`, `[Sprint 22](s3)`. Lúc gửi câu hỏi,
    app lưu bảng handle → id của snapshot đó vào lượt trả lời (`refs`), nên link đúng cả khi
    về sau task bị đánh số lại. Lúc kể lại các lượt trước trong prompt mới, link bị bỏ còn
    nhãn (handle cũ có thể trỏ sai trong snapshot mới). Deck và lý do của từng đề xuất là chữ
    thường: link (nếu có) bị bỏ còn nhãn.
- **Ô soạn:** textarea dưới đáy. Enter gửi, Shift+Enter xuống dòng. Khi đang chạy, nút gửi
  thành **Stop** (huỷ tiến trình `claude`).
- **Trạng thái chạy:** "Reading project…" tới khi có chữ đầu tiên, rồi chữ chảy ra. Sau 8
  giây chưa có dòng nào từ CLI thì hiện thêm gợi ý "macOS có thể đang chờ bạn cho phép truy
  cập Documents" (xem Rules).

### Slide (deck)

Khi user xin slide/thuyết trình, câu trả lời có thêm **thẻ deck** dưới phần chữ: tên deck,
số slide, ba nút:

- **Preview** mở sheet lớn hiện file deck trong iframe `srcdoc` có `sandbox` (không chạy
  script), cuộn dọc qua các slide. Bản preview bỏ thẻ `<script>` và thanh Present.
- **Open in browser** ghi file vào thư mục deck của app
  (`~/Library/Application Support/<bundle id>/decks/`) rồi mở bằng trình duyệt mặc định.
- **Save as…** mở hộp thoại lưu file native, ghi file `.html`, rồi mở nó.

Claude **không viết HTML**. Claude trả nội dung deck dạng JSON (tiêu đề, bullet, số liệu,
bảng), app đổ vào một template cố định (`claude-deck.ts`). Lý do: deck lần nào cũng đúng
style plan-up; tốn ít token hơn; và không có HTML/JS do model viết chạy trên máy.

**File deck:**

- Một file HTML tự chứa, không tải gì từ mạng (font hệ thống SF Pro, không ảnh ngoài).
- Style Cupertino của app: nền xám `#F5F5F7`, slide trắng 16:9 bo 18px, accent `#0071E3`,
  màu status đúng §2.3 của `design-system.md` (done xanh lá, in progress xanh, overdue đỏ).
- Không có JS vẫn xem được: các slide xếp dọc. Có JS thì thêm chế độ trình chiếu: ←/→,
  Space, PageUp/PageDown chuyển slide, F toàn màn hình, số trang góc dưới.
- In (⌘P) ra mỗi slide một trang ngang 16×9 in, để xuất PDF.
- **Co chữ cho vừa slide:** slide dày chữ (bảng 10 dòng, 12 thanh tiến độ, bullet dài) được
  thu nhỏ phần thân bằng CSS `zoom` để không đè lên footer. Lúc render, app ước lượng mức zoom
  từ nội dung (`slideZoom`, chạy được cả khi không có JS, tức bản preview). Mở bằng trình duyệt
  thì script đo thật và dò nhị phân mức zoom lớn nhất còn vừa (0.5 tới 1). Ước lượng cố ý dè
  dặt (bề rộng ký tự 0.52em): preview có thể nhỏ chữ hơn cần, nhưng không tràn ở khổ
  800–1280px.
- Layout slide: `title` (bìa), `section` (ngăn chương), `bullets`, `stats` (2–4 ô số lớn),
  `progress` (thanh tiến độ theo người hoặc theo nhóm), `table`, `timeline` (mốc ngày với
  trạng thái), `columns` (2–3 cột bullet, ví dụ Done / Next). Mỗi slide có thể có
  `notes` (ghi chú người nói), in ra dưới slide khi xem không có JS và ẩn khi trình chiếu.

### Đề xuất thay đổi dữ liệu

Khi user nhờ sửa dữ liệu, câu trả lời có thêm **thẻ Proposed changes** liệt kê từng thay đổi
một dòng, kèm checkbox (mặc định bật):

- `+ Create` "Tiêu đề" → Sprint 13 · An · due Nov 14
- `Edit` #12 "Login API": status To Do → Done, due — → Nov 12
- `Move` #7 "Payment" → Sprint 14
- `Delete` #9 "Old spike" (chữ đỏ)
- `Prereqs` #15 ← #12, #13
- `Note` Sprint 13: "…"

Mỗi dòng có thể kèm lý do ngắn của Claude (chữ xám). Dòng không hợp lệ (task không tồn tại,
ngày sai định dạng, sprint archived) hiện mờ, không chọn được, ghi lý do.

- **Apply N changes** (nút brand) ghi các dòng đang chọn theo thứ tự. Xong thì thẻ chuyển
  thành "Applied N changes" kèm nút **Undo**.
- **Discard** bỏ đề xuất.
- **Undo** đưa task và sprint của project về đúng trạng thái ngay trước Apply. Nếu từ lúc
  Apply tới giờ đã có sửa khác trong project, hỏi lại bằng ConfirmDialog ("Undo will also
  revert edits made after Apply") trước khi khôi phục.
- Có xoá task trong đề xuất thì Apply hỏi lại bằng ConfirmDialog (§6.4), giống xoá tay.
- Lần hỏi sau, Claude được biết đề xuất trước đã được Apply (bao nhiêu dòng), bị Discard,
  hay chưa xử lý.

## Data

- Không đổi schema, không bump Dexie version.
- Thay đổi Claude đề xuất đi qua đúng các hàm DB mà UI dùng (`addSprintTask`, `updateTask`,
  `reassignTasks`, `deleteTask`, `setDependencies`, `setSprintNote`, `recomputeDates`), nên
  activity log, scheduler và auto backup chạy y như sửa tay.
- Thêm `moveTasksToSprint(taskIds, targetSprintId)` trong `db.ts` cho thao tác Move (dùng lại
  luật của rollover, xem Rules).
- Thêm `snapshotProjectPlan(projectId)` / `restoreProjectPlan(snapshot)` cho Undo: chụp và
  ghi lại toàn bộ `tasks`, `sprints`, `events` của một project.
- localStorage: `plan-up:claudeModel` (`sonnet` | `opus`).

## Implementation

### Chạy Claude Code (Rust, `claude.rs`)

Command `claude_stream(requestId, model, systemPrompt, prompt, jsonSchema, onEvent)`:

- Model chỉ nhận `sonnet` | `opus` (allowlist). Mọi cờ CLI cố định trong Rust; webview chỉ
  gửi model, system prompt, prompt và schema.
- `claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --model <m> --system-prompt <…> --tools "" --setting-sources ""
  --strict-mcp-config --disable-slash-commands --no-session-persistence --json-schema <…>`
  - `--tools ""`: Claude không có tool nào (không đọc file, không chạy lệnh). Dữ liệu dự án
    chỉ đi vào qua prompt; sửa dữ liệu chỉ xảy ra khi app tự Apply.
  - `--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`: không nạp
    hook, plugin, MCP, skill, `CLAUDE.md` của user.
  - Không dùng `--bare` vì chế độ đó bỏ qua đăng nhập subscription.
- Xoá `ANTHROPIC_API_KEY` khỏi môi trường tiến trình con, để CLI dùng subscription.
- Chạy trong thư mục tạm riêng `$TMPDIR/plan-up-claude`.
- App mở từ Finder không có `PATH` và biến của `.zshrc`: chạy một lần `$SHELL -lic` (lúc app
  khởi động, `warm_claude_env`) để lấy đường dẫn `claude` và `CLAUDE_CONFIG_DIR`. Không thấy
  thì thử `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`.
- Prompt ghi vào stdin trên thread riêng; stdout đọc từng dòng, gửi về webview qua
  `Channel` (`{type:'line'}` rồi cuối cùng `{type:'exit', code, stderr}`).
- `claude_cancel(requestId)` kill tiến trình. Huỷ tới trước khi tiến trình đăng ký thì được
  nhớ lại và kill ngay khi spawn.
- Chờ dòng stdout đầu tiên tối đa 45 giây rồi kill, báo lỗi gợi ý trả lời hộp thoại quyền
  macOS (đã gặp ở cll-space: tiến trình đọc `CLAUDE_CONFIG_DIR` trong `~/Documents` bị treo
  khi hộp thoại quyền đang chờ).

Command lưu deck:

- `open_deck(fileName, html)`: ghi vào `<app data>/decks/<fileName>`, mở bằng app mặc định.
- `save_deck(fileName, html)`: mở save panel native **từ Rust** (giống `pick_import_file`),
  ghi file user chọn, mở nó, trả đường dẫn (None khi huỷ).
- Cả hai chỉ nhận tên `*.html` đã làm sạch (không `/`, không `..`), HTML ≤ 5 MB. Webview
  không bao giờ gửi đường dẫn cho Rust.

### Webview

- `claude-run.ts`: gọi `claude_stream`, parse từng dòng stream-json. Kết quả nằm ở
  `structured_output` của dòng `result`. Để chữ chảy ra trong lúc chạy, gom các
  `input_json_delta` của tool `StructuredOutput` và cắt dần giá trị chuỗi của khoá `reply`
  (`readPartialJsonString`, tự giải escape JSON, dừng ở escape còn dở).
- `claude-context.ts`: dựng snapshot dự án thành text gọn + bảng handle. Handle ngắn
  (`m1` member, `s1` sprint, `t1` task) để Claude trích dẫn; app tự đổi về id thật. Nội dung:
  hôm nay, project (tên, mô tả, holiday), member (title, days off), mọi sprint (ngày,
  archived, note, đếm task), task của mọi sprint (số #, status, priority, assignee, start →
  due, effort, prereq, group), collection (chỉ đọc, không có handle), 40 activity gần nhất của
  sprint đang xem. Tiêu đề task bỏ marker rich text (`stripRich`). Quá 1500 task thì task
  của sprint archived chỉ còn số đếm.
- `claude-prompt.ts`: system prompt + JSON schema của câu trả lời:
  `{ reply: string, actions: Action[], deck?: Deck }`. `reply` đứng đầu để stream được.
- Mỗi lượt hỏi, prompt = snapshot mới nhất (đặt đầu, vì dữ liệu có thể vừa đổi sau Apply) +
  các lượt trước (lời user, lời Claude, ghi chú deck/đề xuất đã xử lý ra sao) + câu hỏi mới.
- `claude-actions.ts`: kiểm và mô tả từng action (`resolveActions`), Apply tuần tự
  (`applyActions`), chụp/khôi phục cho Undo.
- `claude-deck.ts`: `sanitizeDeck` (bỏ mọi thứ sai shape, tối đa 30 slide),
  `renderDeckHtml(deck, { script })` → chuỗi HTML, `slideZoom`, `deckFileName`. Mọi chữ của
  Claude đi qua `escapeHtml`; inline `**đậm**` đổi thành `<strong>` sau khi escape.
- `claude-chat.ts`: store hội thoại theo project (module store + `useSyncExternalStore`, để
  câu trả lời vẫn ghi vào đúng chat khi panel đóng hay đổi project), `ask`, `stop`, `retry`,
  Apply/Discard/Undo, gọi `open_deck`/`save_deck`.
- `ClaudePanel.tsx`: UI panel, thẻ deck, thẻ đề xuất, preview sheet, markdown tối giản
  (đoạn, `-` bullet, `1.` list, heading, `` `code` ``, phần inline dùng `RichText`).
- `App.tsx`: state `claudeOpen`, nút toolbar, ⌘J (dùng `shouldRun('claude')` để phím và
  key equivalent của menu không bật hai lần), Esc (đóng sau palette, activity, settings), cột
  `<aside aria-label="Claude">`. `native-shell.ts`: lệnh menu `claude`.
- Textarea không gửi khi đang gõ dở bằng bộ gõ tiếng Việt (`isComposing` / keyCode 229).
- Test: `src/claude.test.ts` (context, prompt, resolve/apply, move, undo, deck), test Rust
  trong `claude.rs` (tên file deck, ghi deck).

## Rules & edge cases

- **Action set (v1):** `create_task`, `update_task`, `move_task`, `delete_task`,
  `set_dependencies`, `set_sprint_note`. Chỉ đụng **task trong sprint**; collection chỉ đọc.
  Không tạo/xoá sprint, member, project; không sửa days off, holiday.
- **Create:** vào sprint chỉ định (mặc định sprint đang xem), start mặc định = ngày đầu
  sprint (đúng smart default §5.3.1). `ref` (vd `n1`) cho phép action sau trỏ vào task vừa
  tạo, ví dụ đặt prereq.
- **Update:** title, status, priority, assignee, start, due, estimate. Đổi assignee đi qua
  `reassignTasks(..., { keepOrder: true })` như picker từng dòng. Sau mỗi thay đổi ngày/effort
  /assignee chạy `recomputeDates`; ngày do scheduler sở hữu (task có prereq + effort) vẫn do
  scheduler quyết, giống sửa tay.
- **Move:** dùng luật rollover (`sprint-rollover.md`): đánh số lại theo sprint đích, giữ
  ngày, task con đi theo group cha, task con đi một mình thì rời group, prereq nối sang task
  ở lại sprint cũ thì bỏ (cả hai chiều). Ghi event `rolled_over` vào sprint đích.
- **Delete** hỏi lại bằng ConfirmDialog; task con được đẩy lên top-level như xoá tay.
- Action không resolve được (handle sai, sprint archived, ngày sai) không chạy, hiện lý do.
  Một action lỗi giữa chừng khi Apply: dừng, báo lỗi, các action trước đó vẫn giữ (Undo
  được).
- **Bảo mật:** Claude không có tool, không ghi được gì. Dữ liệu chỉ đổi khi user bấm Apply.
  Deck là template cố định, chữ được escape. File deck chỉ ghi vào thư mục của app hoặc chỗ
  user chọn trong save panel.
- **Lỗi thường gặp** (hiện trong panel, chữ đỏ nhạt):
  - Không tìm thấy `claude` → "Claude Code isn't installed. Install it from claude.com/code,
    then run `claude` once in Terminal to log in."
  - Lỗi đăng nhập (`oauth`, `authenticate`, `/login`) → "Claude Code isn't logged in. Run
    `claude` in Terminal and log in with your Claude account."
  - Hết giới hạn subscription: hiện nguyên câu báo của CLI.
- Esc đóng panel chỉ khi không có palette/drawer khác đang mở (đóng tầng trên cùng trước).
  Đang chạy mà đóng panel thì tiến trình vẫn chạy tiếp; mở lại thấy kết quả.
- Đổi project khi đang chạy: kết quả vẫn ghi vào hội thoại của project cũ.

## Future / open questions

- Sửa collection item, days off, holiday qua đề xuất.
- Đính kèm file (ảnh, PDF) vào câu hỏi.
- Lưu lịch sử chat vào IndexedDB nếu thấy cần.
