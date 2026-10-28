# ChatGPT Desktop–inspired UI Guide cho Codex

Phiên bản hướng dẫn: 1.0 · Ngày đối chiếu tài liệu: 28/10/2026 · Ngôn ngữ: Tiếng Việt.

## 1. Phạm vi và mức độ chính xác

Đây là hướng dẫn triển khai giao diện lấy cảm hứng từ ChatGPT desktop, dùng để Codex thiết kế ứng dụng khác. Đây **không phải design system nội bộ hay thông số pixel chính thức của OpenAI**. “Mới nhất” trong tài liệu nghĩa là đã đối chiếu tài liệu công khai vào ngày trên; không xác nhận số build đang được phân phối cho mọi tài khoản và hệ điều hành.

Phân loại bằng chứng:

- **[DOC]**: hành vi hoặc cấu trúc được tài liệu chính thức xác nhận.
- **[REF]**: giá trị xuất hiện trong phần minh họa tài liệu; không mặc định là token của mọi phiên bản app.
- **[SPEC]**: quy tắc và thông số đề xuất của hướng dẫn này để có một hệ thống nhất quán, khả thi.

Toàn bộ mục 3–13 là **[SPEC]**, trừ chỗ có ghi khác. Chưa đo trực tiếp screenshot của bản app đang cài; không tuyên bố khớp pixel. Khi có screenshot mục tiêu, đo lại và ưu tiên bằng chứng đó cho màu sắc, khoảng cách, typography và bố cục. Giữ tên, logo và nội dung của ứng dụng đích.

## 2. Những gì nguồn chính thức xác nhận

- **[DOC]** Desktop tổ chức công việc qua chat, project hoặc thư mục; có thể mở và xem các loại đầu ra ngay trong workspace. [Desktop overview](https://learn.chatgpt.com/docs/app)
- **[DOC]** Product selector có ChatGPT và Codex; trong ChatGPT có Chat/Work. Minh họa quickstart có sidebar với New chat, Projects, Plugins và danh sách chat. Đây là cấu trúc tham chiếu, không yêu cầu ứng dụng đích phải sao chép các mục này. [Quickstart](https://learn.chatgpt.com/docs/quickstart)
- **[DOC]** Appearance hỗ trợ light/dark/system, chỉnh màu và font. **[REF]** Ví dụ theme mang nhãn Codex hiển thị light background `#FFFFFF`, foreground `#0D0D0D`, accent `#0285FF`; dark background `#181818`, foreground `#FFFFFF`, accent `#339CFF`; UI/code size hiển thị 14px. Không suy ra đây là toàn bộ palette mặc định của ChatGPT. [Settings — Appearance](https://learn.chatgpt.com/docs/app/settings)
- **[DOC]** Có lệnh mở command menu, bật/tắt sidebar và đổi cỡ chữ; một số lệnh phụ thuộc nền tảng và view đang có. [Commands](https://learn.chatgpt.com/docs/app/commands)

## 3. Chỉ thị nền tảng cho agent

Mục tiêu: giao diện desktop bình tĩnh, rõ ràng, tập trung vào nội dung, dùng màu trung tính và phân cấp nhẹ. Người dùng nhận ra thao tác chính trong vài giây.

1. Bảo toàn chức năng, dữ liệu và luồng nghiệp vụ của app đích.
2. Dùng sidebar cho điều hướng, main canvas cho công việc, panel phụ khi cần xem chi tiết.
3. Mỗi vùng có một tác vụ chính nổi bật; tác vụ phụ dùng ghost hoặc secondary button.
4. Ưu tiên khoảng trắng, typography và thay đổi nền nhẹ để phân cấp.
5. Chỉ dùng card khi nội dung thực sự là một đơn vị độc lập. Không bọc mọi đoạn trong card.
6. Dùng accent tiết chế cho focus, link và trạng thái được chọn khi phù hợp.
7. Mọi control phải có hành vi thực, đủ trạng thái và sử dụng được bằng bàn phím.
8. Không thêm chat/composer vào ứng dụng không cần hội thoại. Chuyển tinh thần thiết kế sang nghiệp vụ tương ứng.

## 4. Layout và kích thước

| Thành phần | Mặc định đề xuất | Quy tắc |
|---|---:|---|
| Sidebar | 256px | Cho phép thu gọn; khoảng 224–288px nếu nội dung cần |
| Header vùng nội dung | 52px | Tiêu đề trái, tác vụ liên quan phải |
| Hàng điều hướng | tối thiểu 36px | Padding ngang 10–12px, icon–label cách 8px |
| Gutter main | 24px | Giảm còn 16px trên cửa sổ hẹp |
| Cột nội dung đọc | tối đa 768px | Căn giữa trong vùng main, không tính sidebar |
| Canvas bảng/editor | co giãn | Không ép vào cột đọc 768px |
| Panel chi tiết | 360px | Min 320px; đóng hoặc chuyển drawer khi thiếu chỗ |
| Khoảng cách section | 24–32px | Khoảng cách trong nhóm 8–12px |
| Composer | tối đa 768px | Cùng trục với nội dung hội thoại |

Sơ đồ tham chiếu:

```text
┌──────────────┬─────────────────────────────────┐
│ Product /   │ Header: tiêu đề          tác vụ │
│ Workspace   ├───────────────────────┬─────────┤
│             │                       │ Panel   │
│ Điều hướng  │ Main canvas           │ chi tiết│
│             │                       │ tùy chọn│
│ Danh sách   │                       │         │
│             │                       │         │
│ Tài khoản   │ Composer / action bar │         │
└──────────────┴───────────────────────┴─────────┘
```

- Dùng `minmax(0, 1fr)` cho main để nội dung dài không phá grid.
- App shell dùng `100dvh`; từng vùng cần cuộn có `min-height: 0`.
- Tránh hai scrollbar dọc cho cùng một nội dung. Sidebar và main có thể cuộn độc lập.
- Composer nằm trong main và luôn chừa đủ chỗ cho nội dung cuối. Nếu overlay, tính padding đáy theo chiều cao thực của composer.
- Native desktop dùng titlebar của nền tảng; web app không vẽ nút đóng/thu nhỏ cửa sổ giả.

### Responsive đề xuất

- **≥1280px**: sidebar + main; mở panel nếu main vẫn đủ rộng.
- **900–1279px**: sidebar + main, panel chuyển drawer hoặc thay main theo tác vụ.
- **<900px**: sidebar thành drawer, main chiếm toàn bộ chiều ngang.
- **≤600px**: gutter 16px, action ít quan trọng vào overflow menu, control cảm ứng tối thiểu 44px.

Breakpoint là điểm khởi đầu; nếu bản dịch dài hoặc zoom làm vỡ layout, đổi bố cục sớm hơn. Không thu chữ nhỏ để nhét vừa.

## 5. Design tokens

Đây là palette triển khai **[SPEC]**, không phải palette OpenAI được trích xuất. Các màu `bg`, `text` và `accent` có điểm xuất phát từ ví dụ [REF] ở mục 2; những giá trị còn lại được đề xuất.

```css
:root {
  color-scheme: light;
  --bg: #ffffff;
  --sidebar: #f7f7f8;
  --surface: #ffffff;
  --surface-soft: #f2f2f2;
  --surface-hover: #eaeaea;
  --surface-selected: #e3e3e3;
  --text: #0d0d0d;
  --text-secondary: #5d5d5d;
  --text-muted: #6b6b6b;
  --border: #dedede;
  --control-border: #808080;
  --accent: #0285ff;
  --link: #005fcc;
  --focus: #0066cc;
  --primary-bg: #171717;
  --primary-text: #ffffff;
  --danger: #b42318;
  --success: #166534;
  --warning: #854d0e;
  --overlay: rgb(0 0 0 / 32%);
  --shadow-popover: 0 8px 32px rgb(0 0 0 / 12%);

  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-code: ui-monospace, "SFMono-Regular", Consolas, monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-composer: 24px;
  --radius-pill: 999px;
  --duration-fast: 120ms;
  --duration-normal: 180ms;
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #181818;
  --sidebar: #141414;
  --surface: #202020;
  --surface-soft: #2a2a2a;
  --surface-hover: #333333;
  --surface-selected: #3c3c3c;
  --text: #ffffff;
  --text-secondary: #b8b8b8;
  --text-muted: #a0a0a0;
  --border: #3b3b3b;
  --control-border: #858585;
  --accent: #339cff;
  --link: #78baff;
  --focus: #78baff;
  --primary-bg: #f3f3f3;
  --primary-text: #171717;
  --danger: #ff8a80;
  --success: #86d6a0;
  --warning: #f0ca73;
  --overlay: rgb(0 0 0 / 56%);
  --shadow-popover: 0 8px 32px rgb(0 0 0 / 40%);
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 var(--font-ui);
}

:where(button, input, textarea, select) { font: inherit; }
:where(button, a, input, textarea, select, [tabindex]):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`--border` dùng để chia vùng trang trí; khi đường viền là tín hiệu duy nhất xác định input/control, dùng `--control-border` và kiểm tra tương phản. Không dùng accent làm màu chữ nhỏ trên mọi nền; dùng token link đã tách riêng.

Theme phải hỗ trợ Light / Dark / System, lưu lựa chọn và chỉ theo thay đổi hệ thống khi đang ở System. Tránh chớp sai theme lúc tải trang.

## 6. Typography và icon

| Vai trò | Size / line-height | Weight |
|---|---|---|
| UI mặc định | 14 / 20–22px | 400 |
| Metadata | 12 / 18px | 400 |
| Nhãn control | 14 / 20px | 500 |
| Tiêu đề panel | 16 / 24px | 600 |
| Tiêu đề trang | 24 / 32px | 600 |
| Empty-state heading | 28 / 36px | 500–600 |
| Văn bản đọc dài/chat | 16 / 26px | 400 |
| Code | 13–14 / 20–22px | 400 |

- Dùng font hệ thống để có cảm giác native và hiển thị tiếng Việt tốt. Không khẳng định font độc quyền của ChatGPT.
- Kiểm tra dấu tiếng Việt, chữ đậm, fallback và ký tự kết hợp. Không đặt chiều cao cố định làm cắt dấu.
- Một bộ icon nét thống nhất, kích thước 18–20px; stroke khoảng 1.5–1.75 khi bộ icon hỗ trợ.
- Vùng bấm icon desktop tối thiểu 32×32px; nơi dễ thao tác nhầm dùng 36–40px. Touch dùng 44×44px.
- Icon-only button có accessible name và tooltip khi hover/focus; SVG trang trí có `aria-hidden`.
- Không trộn emoji, icon tô khối và outline ngẫu nhiên trong navigation.

## 7. Quy chuẩn component

### Sidebar

- Trên: tên workspace/product và hành động tạo mới.
- Giữa: điều hướng chính rồi danh sách nội dung gần đây hoặc project.
- Dưới: tài khoản/settings khi phù hợp nghiệp vụ.
- Active row dùng nền trung tính, label rõ; đánh dấu `aria-current` cho route.
- Hover và selected phải khác nhau. Tác vụ phụ có thể hiện khi hover, nhưng cũng phải hiện khi focus hoặc menu mở.
- Tên dài ellipsis một dòng; cung cấp cách xem tên đầy đủ. Không truncate tiêu đề nội dung chính tùy tiện.

### Button

| Variant | Cách dùng | Hình thức |
|---|---|---|
| Primary | Hành động chính | Nền tương phản mạnh, chữ tương phản |
| Secondary | Hành động hỗ trợ | Nền nhẹ hoặc viền |
| Ghost | Toolbar/menu | Trong suốt, hover nền nhẹ |
| Destructive | Xóa/hủy có hậu quả | Màu danger, tên hành động cụ thể |

- Chiều cao mặc định 36px; compact 32px; form/touch 40–44px.
- Radius 8–10px; pill dành cho chip hoặc tác vụ có chủ đích.
- Đủ default, hover, pressed, focus-visible, disabled, loading.
- Loading giữ chiều rộng và ngăn gửi trùng; không làm mất nhãn hành động.

### Input và form

- Label luôn có thể truy cập; placeholder chỉ là ví dụ.
- Height 40px, padding ngang 12px, radius 10px.
- Helper text ở dưới; lỗi nêu vấn đề và cách sửa. Kết nối bằng `aria-describedby`, đánh dấu `aria-invalid` khi lỗi.
- Không chỉ dùng màu để biểu thị required/error/success.
- Form settings dùng hàng label + description + control; trên màn hình hẹp xếp dọc.

### Composer — chỉ khi ứng dụng có hội thoại

- Textarea nhiều dòng, nền nhẹ, radius 24px, padding 12–16px.
- Auto-grow khoảng 48–200px, sau đó cuộn bên trong.
- Attachments ở vùng riêng trước phần nhập; chip có tên, trạng thái và nút gỡ.
- Toolbar dưới: thêm nội dung/công cụ bên trái; gửi hoặc dừng bên phải.
- Gửi bằng Enter và xuống dòng bằng Shift+Enter nếu phù hợp kỳ vọng sản phẩm; hiển thị hướng dẫn khi cần.
- **Không gửi khi IME đang composition**; xử lý `isComposing` để hỗ trợ bộ gõ.
- Disable gửi khi dữ liệu rỗng sau trim; vẫn cho phép gửi attachment hợp lệ nếu nghiệp vụ hỗ trợ.
- Khi đang tạo kết quả, hiển thị Stop có hành vi thật và trạng thái rõ.

### Hội thoại

- Message người dùng có thể dùng bubble trung tính căn phải; giới hạn khoảng 80% cột.
- Câu trả lời ưu tiên typography trên canvas, với khoảng cách giữa lượt đủ rõ.
- Metadata và actions nhỏ, thứ cấp nhưng truy cập được qua bàn phím.
- Markdown có heading, list, link, bảng và code được style thống nhất.
- Code block có header ngôn ngữ/copy; cuộn ngang trong block, không kéo rộng cả trang.
- Tự cuộn khi người dùng đang gần cuối. Nếu họ cuộn lên, giữ vị trí và cung cấp “Xuống cuối”.
- Streaming không liên tục giành focus hoặc thông báo từng token cho screen reader.

### Menu, tooltip, dialog

- Popover: padding 4–6px, item tối thiểu 32px, radius 10–12px; shadow chỉ cho bề mặt nổi.
- Menu hoạt động bằng phím mũi tên, Enter, Escape theo semantics phù hợp.
- Tooltip gọn, xuất hiện cả khi keyboard focus; không chứa thao tác bắt buộc.
- Dialog: width khoảng 440–560px, giới hạn theo viewport, tiêu đề rõ, footer có thứ tự hành động nhất quán.
- Modal quản lý focus, chặn tương tác nền và trả focus về trigger khi đóng.
- Xác nhận xóa nói rõ đối tượng và hậu quả; chỉ thêm bước xác nhận khi mức rủi ro đáng kể.

### Table/list cho app nghiệp vụ

- Giữ thiết kế trung tính: header nhẹ, divider mảnh, row hover kín đáo.
- Mật độ compact 36px/hàng hoặc comfortable 44–48px tùy nội dung.
- Số căn phải, chữ căn trái; trạng thái có label, không chỉ chấm màu.
- Sort/filter/selection có trạng thái rõ. Bảng rộng cuộn trong container.
- Chi tiết bản ghi mở panel khi người dùng cần đối chiếu danh sách.

## 8. Trạng thái và microcopy

Mọi màn hình dữ liệu phải có:

| Trạng thái | Cách thể hiện |
|---|---|
| Loading đầu tiên | Skeleton gần bố cục thật hoặc progress ngắn |
| Empty lần đầu | Một câu giải thích + CTA tạo/nhập dữ liệu |
| Không có kết quả lọc | Giữ bộ lọc, có nút xóa lọc |
| Error | Nêu lỗi phù hợp người dùng, cho retry nếu an toàn |
| Success | Phản hồi gần thao tác; toast khi cần |
| Disabled | Có lý do nhìn thấy hoặc dễ tìm khi nguyên nhân không rõ |
| Offline | Trạng thái kết nối và cách phục hồi, giữ dữ liệu đang nhập |

Microcopy dùng động từ cụ thể: “Tạo dự án”, “Lưu thay đổi”, “Thử lại”. Toast không che composer; lỗi cần xử lý không tự biến mất quá sớm. Không dùng dữ liệu giả trong sản phẩm như thể đã tải thành công.

## 9. Motion, bàn phím và accessibility

- Hover/focus transition 120ms; panel/menu 180ms. Tránh animation phô trương và dịch chuyển layout.
- Hỗ trợ reduced motion và zoom 200%; nội dung quan trọng không bị cắt.
- Mục tiêu tương phản triển khai: 4.5:1 cho chữ thường, 3:1 cho chữ lớn và tín hiệu control cần nhận diện. Phải đo cặp màu thực tế; palette trên không thay thế kiểm tra.
- Tab theo thứ tự thị giác; focus luôn nhìn thấy. Không đặt `tabindex` dương.
- Dùng HTML semantic trước ARIA; chỉ dùng pattern ARIA khi thực hiện đầy đủ hành vi bàn phím tương ứng.
- Dùng live region có chọn lọc cho kết quả thao tác, không đọc lặp toàn bộ màn hình.
- Hỗ trợ command menu nếu app có nhiều thao tác; shortcut thích ứng macOS/Windows/Linux và tránh ghi đè thao tác chỉnh sửa chuẩn.
- Đừng sao chép mọi shortcut ChatGPT sang app khác; chọn theo nhiệm vụ và hiển thị trong menu trợ giúp.

## 10. Áp dụng cho app khác

| Loại app | Chuyển ngôn ngữ thiết kế sang |
|---|---|
| CRM | Sidebar module, danh sách khách hàng, detail panel, toolbar gọn |
| Quản lý công việc | Sidebar project, list/board chính, task panel |
| Ghi chú | Cây tài liệu, editor có cột đọc, metadata thứ cấp |
| Dashboard | Navigation gọn, KPI cần thiết, biểu đồ phẳng; card theo nhóm thông tin |
| Công cụ AI | Chat + composer + output panel theo nhu cầu |
| Settings/admin | Section rõ, form theo nhóm, mô tả ngắn, action lưu có trạng thái |

Giữ bố cục phục vụ nhiệm vụ. Dashboard nhiều dữ liệu không cần bị biến thành trang chat; editor không cần có bubble hội thoại.

## 11. Những lỗi làm mất chất lượng thiết kế

- Gradient tím/xanh phủ rộng, glow, glassmorphism dày hoặc shadow trên mọi block.
- Bo góc pill cho toàn bộ thành phần; mỗi card một kiểu radius.
- Heading quá lớn và khoảng trắng kiểu landing page trong công cụ làm việc.
- Mọi nút đều primary hoặc tất cả control đều nhạt khó nhận diện.
- Cứng chiều rộng desktop gây tràn ở cửa sổ nhỏ.
- Tác vụ chỉ xuất hiện bằng hover, control không có nhãn, focus bị xóa.
- Hardcode màu trong từng component; dark theme chỉ đảo màu sơ sài.
- Nút minh họa không hoạt động, bộ lọc giả, loading vô hạn.
- Dùng logo/nhãn ChatGPT để đại diện ứng dụng đích khi không có yêu cầu.

## 12. Quy trình thực hiện dành cho Codex

1. Đọc hướng dẫn dự án, xác định stack và component system hiện có. Tái sử dụng hợp lý.
2. Kiểm kê màn hình, route, hành động và trạng thái. Xác định workflow chính.
3. Nếu có ảnh tham chiếu: ghi viewport, nền tảng, theme, font scale; đánh dấu vùng chưa biết. Không tự gọi thông số đoán là chính thức.
4. Tạo token semantic cho light/dark trước; map sang theme hiện có nếu dự án đã có hệ thống.
5. Làm app shell và một màn hình đại diện; kiểm tra layout rồi nhân rộng component.
6. Triển khai trạng thái và tương tác thật; giữ API/data contract đang có.
7. Chạy kiểm tra hiện có phù hợp thay đổi, kiểm tra bàn phím và xem screenshot ở các viewport mục tiêu.
8. Sửa lỗi typography, spacing, overflow, focus và contrast trước khi hoàn tất.
9. Báo cáo màn hình đã đổi, kiểm tra đã chạy và phần còn chưa xác minh. Không tuyên bố pixel-perfect nếu không có ảnh đối chiếu.

### Ma trận nghiệm thu

- [ ] Light và dark nhất quán; System theo cài đặt hệ điều hành.
- [ ] Xem tại 1440×900, 1280×800, 1024×768 và 390×844 CSS px nếu hỗ trợ mobile.
- [ ] Main/side panel không vỡ với tên dài, tiếng Việt và dữ liệu rỗng.
- [ ] Không tràn ngang toàn trang; code/table tự quản lý overflow.
- [ ] Tất cả nút, menu, dialog dùng được bằng bàn phím.
- [ ] Focus nhìn thấy; dialog trả focus đúng; tooltip không là nguồn hướng dẫn duy nhất.
- [ ] Loading, empty, error, success đã có và có cách phục hồi hợp lý.
- [ ] Composer không che nội dung, không gửi nhầm khi dùng IME.
- [ ] Tương phản được đo trên các cặp màu thực tế.
- [ ] Zoom 200% và reduced motion hoạt động.
- [ ] Workflow chính không bị thay đổi ngoài yêu cầu.
- [ ] Không thêm thư viện chỉ để giải quyết một chi tiết nhỏ có thể làm bằng hệ thống hiện có.

## 13. Prompt dùng ngay

Sao chép đoạn dưới vào Codex và đính kèm file hướng dẫn này:

```text
Hãy áp dụng CHATGPT-DESKTOP-UI-GUIDE.md cho giao diện ứng dụng hiện tại.

Mục tiêu: giao diện desktop lấy cảm hứng ChatGPT, trung tính, rõ ràng,
gọn và tập trung vào nội dung. Dùng các token và component trong guide
làm baseline; các thông số [SPEC] là đề xuất, không phải số đo OpenAI.

Trước khi sửa, đọc hướng dẫn repository, xem stack, route và hệ thống UI.
Tái sử dụng component đang có. Giữ nguyên chức năng, dữ liệu, API contract
và nhận diện thương hiệu của ứng dụng.

Thực hiện app shell, typography, spacing, light/dark/system theme,
navigation và các màn hình liên quan. Điều chỉnh layout theo nghiệp vụ;
chỉ dùng chat/composer nếu ứng dụng thực sự cần hội thoại.

Triển khai đầy đủ trạng thái, responsive và keyboard accessibility.
Kiểm tra bằng screenshot ở các kích thước trong guide và chạy kiểm tra
hiện có phù hợp. Sửa lỗi layout và tương tác trước khi kết thúc.

Nếu có screenshot mục tiêu được cung cấp, ưu tiên số đo từ ảnh cho
hình thức, ghi rõ nền tảng/theme/viewport và phần chưa xác minh.
Hoàn thành thay đổi trong phạm vi yêu cầu, sau đó báo cáo ngắn gọn
những gì đã đổi, đã kiểm tra và các giới hạn còn lại.
```

## 14. Nguồn và cập nhật

Các nguồn đã mở và đối chiếu ngày 28/10/2026:

1. [ChatGPT desktop app](https://learn.chatgpt.com/docs/app) — mô hình workspace và đầu ra.
2. [Quickstart](https://learn.chatgpt.com/docs/quickstart) — selector, sidebar và Chat/Work.
3. [Settings](https://learn.chatgpt.com/docs/app/settings) — theme/font và ví dụ Appearance.
4. [Commands](https://learn.chatgpt.com/docs/app/commands) — thao tác bàn phím theo nền tảng.

Khi cập nhật guide: mở lại nguồn, ghi ngày đối chiếu mới, so sánh ảnh của cùng nền tảng/theme/viewport nếu có; cập nhật token theo bằng chứng và giữ ranh giới DOC/REF/SPEC. Các trang hướng dẫn có thể thay đổi sau ngày đối chiếu.
