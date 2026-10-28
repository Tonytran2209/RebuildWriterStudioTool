---
id: writer-studio-user-guide
layer: design
status: canonical
projectId: writer-studio
verified_source_commit: 1970c3201ccdb6f7e0dd7c83711a569b0dca6963
verified_on: 2026-10-28
source_paths: [src/App.tsx, src/components/ActivityLauncher.tsx, src/components/workspace/Step2CoreIdea.tsx, src/components/workspace/Step3Outline.tsx, src/components/workspace/Step4Draft.tsx, src/components/BatchActivity.tsx]
---
# Hướng dẫn sử dụng Writer Studio

## Luồng chính
Writer Studio hỗ trợ **Content Plan → Article Spec / Core Idea → Outline → Draft & Audit/QC**. Giao diện bài viết hiển thị ba bước; tên component và số bước lưu trữ cũ không phải số bước người dùng cần làm. Có thể viết từng bài hoặc chạy batch từ Content Plan.

Hướng dẫn đối chiếu source ở commit ghi trên; không mô tả các màn hình EB/Gate của Intercom Writer Studio. Hai app có thư viện và workflow riêng.

## 1. Đăng nhập và chuẩn bị
- Đăng nhập tài khoản của app. Nếu quên mật khẩu, dùng chức năng khôi phục được cung cấp hoặc liên hệ người quản trị; không gửi mật khẩu/API key trong feedback.
- Trong Settings, **Workflow AI** chọn model và context cho từng bước; **AI Models** quản lý model/provider; **Knowledge & Rules** quản lý kiến thức, quy tắc và Website Inventory.
- Chuẩn bị Knowledge Base đúng chủ đề và nguồn tin trước khi viết. Content Plan định hướng bài; Rules hướng dẫn cách viết; chúng không tự trở thành bằng chứng cho các khẳng định thực tế.

## 2. New activity và Content Plan
1. Mở **New activity**, nhập Content Plan bằng cách dán nội dung hoặc nguồn/file được giao diện hỗ trợ. Chọn đúng loại bài, như comparison SEO hoặc editorial originality.
2. Kiểm tra các mục đã nhập rồi chọn bài cần viết. Nguồn Google Docs/Sheets cần có quyền truy cập thích hợp; chỉ nhập URL không bảo đảm app đọc được nội dung.
3. Mở bài từ Content Plan để vào pipeline. Nếu mục đã có bài liên kết, mở lại kết quả thay vì tạo một bài mới chỉ để đọc.
4. Có thể xem lại lịch sử Content Plan. Đọc xác nhận trước khi xóa; plan đã có bài liên kết có thể bị chặn xóa để bảo toàn dữ liệu.

## 3. Bước 1: Article Spec và Core Idea
- Kiểm tra yêu cầu bài, từ khóa, loại nội dung và nguồn được dùng. Bấm **Lấy đề xuất / Đề xuất lại** để tạo các ý tưởng phù hợp dữ liệu hiện tại.
- Đọc đề xuất, chọn **Chọn ý tưởng này** để lưu lựa chọn. Lựa chọn đã lưu là đầu vào cho outline.
- Nếu đổi nguồn, model hoặc ý tưởng sau khi đã có kết quả, xem cảnh báo kết quả cũ và chủ động tạo lại bước phụ thuộc khi cần. Không hiểu một output cũ là đã cập nhật theo cấu hình mới.
- Khi chỉ một phần đề xuất hợp lệ, kiểm tra phần đã có và điều kiện tiếp tục được app hiển thị, thay vì mặc định mọi kết quả đều mất.

## 4. Bước 2: Outline
- Bấm **Tạo outline / Tạo lại outline**, đọc bố cục và chỉnh sửa các mục cần thiết.
- Đối chiếu nguồn, luận điểm và bằng chứng trong outline trước khi viết. Không bổ sung số liệu hoặc liên kết chỉ vì AI gợi ý mà chưa có nguồn phù hợp.
- Với luồng editorial originality, hoàn tất **Phê duyệt outline** trước khi tạo draft.
- Khi tạo lại thất bại, kết quả đã lưu có thể vẫn còn; phân biệt bản cũ với kết quả mới và trạng thái đang chạy.

## 5. Bước 3: Draft và kiểm tra chất lượng
1. Tạo draft từ ý tưởng/outline đã chọn. Đọc toàn bài rồi mở chế độ chỉnh sửa khi cần.
2. Kiểm tra **Universal QC**, mở chi tiết mục cảnh báo hoặc chưa đạt. QC và semantic review có thể ở trạng thái thiếu, cũ hoặc chưa hoàn tất; tải lại trang không tự khắc phục nguyên nhân.
3. Dùng kiểm tra lại hoặc sửa có chủ đích sau khi bổ sung nguồn/sửa nội dung. Mỗi lần tạo hoặc sửa bằng AI có thể phát sinh chi phí; tránh gửi lại liên tục khi một lượt đang chạy.
4. Chỉ đánh dấu hoàn tất khi các kiểm tra bắt buộc của bản hiện tại đã đạt và trạng thái đã được lưu. Cảnh báo tham khảo không mặc định đồng nghĩa chặn hoàn tất; xem loại và thông báo thực tế.

Phần mở đầu được hiển thị đầy đủ. Quy tắc viết hướng đến một đoạn 60–85 từ tiếng Anh, thường khoảng 5–6 dòng desktop; số dòng thay đổi theo chiều rộng màn hình, không phải cơ chế cắt dữ liệu. Việc đổi dấu “—” thành “-” khi hiển thị/copy/TXT không tự ghi đè text gốc đã lưu.

## 6. Copy, xuất và mở lại bài
- **Copy nội dung** sao chép bài; **Copy bài + SEO brief** kèm phần brief; **Tải .txt** tải nội dung text. Thao tác copy không tự xuất bản lên website hay tạo Google Doc.
- Khi đang chỉnh sửa, kiểm tra nội dung trước khi copy/export; app dùng bản chỉnh sửa hiện hành theo luồng của Draft.
- Mở lại bài đã lưu từ sidebar/lịch sử hoặc mục Content Plan liên kết để xem ý tưởng, outline, draft và QC. Không cần generate lại chỉ để xem kết quả.
- Nếu dữ liệu sau reload khác bản vừa thao tác, kiểm tra trạng thái lưu và thông báo lỗi trước khi tiếp tục chỉnh hoặc chạy AI.

## 7. Chạy nhiều bài bằng batch
- Chọn các mục trong Content Plan và kích thước batch được cung cấp: **5 / 10 / 15 / 20**.
- Theo dõi trạng thái từng mục: queued, running, paused, failed, completed. Tổng trạng thái batch không thay thế kết quả của từng bài.
- **Pause / Resume** cần chờ server xác nhận. Trong lúc batch đang sở hữu bài, app hạn chế thao tác AI thủ công trùng để tránh ghi đè.
- Retry mục lỗi thay vì chạy lại toàn bộ mục đã xong. Mở pipeline của từng bài để đọc/sửa khi trạng thái cho phép; tải draft khi đã có kết quả.

## 8. Quản lý Knowledge & Rules
- Đưa tài liệu factual vào Knowledge Base; hướng dẫn giọng văn, cấu trúc và quy tắc vào Skills & Rules theo mục nhập của giao diện. Website Inventory cung cấp nguồn liên kết nội bộ hợp lệ.
- Chọn file/nguồn thuộc định dạng app hỗ trợ. Nhiều file được xử lý theo từng file; kiểm tra trạng thái thành công/thất bại riêng và thử lại file lỗi.
- Upload lưu tài liệu theo luồng server của app. Đóng Settings rồi kiểm tra danh sách/nguồn cập nhật trước khi chạy bài; lưu một cài đặt không liên quan không có nghĩa đã nhập lại thư viện.
- Sau khi đổi thư viện, bài/QC cũ có thể cần kiểm tra lại theo context mới. Không giả định mọi bài đã được tự viết lại.

## 9. Khi gặp lỗi
- Không chạy được AI: kiểm tra model của đúng bước, cấu hình provider và thông báo kết nối; giữ kết quả đã lưu.
- Thiếu bằng chứng hoặc internal links: bổ sung nguồn phù hợp vào thư viện, sửa claim hoặc yêu cầu cụ thể; không dùng nguồn giả để vượt QC.
- Lỗi lưu/mất phản hồi: tải lại và đối chiếu trạng thái đã lưu trước khi retry. Không gửi đồng thời nhiều thao tác lên cùng bài.
- Feedback nên ghi tên/mã bài, bước, thao tác, điều mong muốn, trạng thái QC và ảnh đã loại dữ liệu nhạy cảm. Không gửi token hay toàn bộ dữ liệu riêng tư.

## Đối chiếu source cho AI Agent Lab
| Nội dung | Source |
| --- | --- |
| Đăng nhập, lưu/mở bài, điều phối pipeline | `src/App.tsx` |
| Content Plan, lịch sử và batch | `src/components/ActivityLauncher.tsx`, `src/components/BatchActivity.tsx` |
| Article Spec / Core Idea | `src/components/workspace/Step2CoreIdea.tsx` |
| Outline | `src/components/workspace/Step3Outline.tsx` |
| Draft, QC, copy/export | `src/components/workspace/Step4Draft.tsx` |
| Cấu hình model và thư viện | `src/components/config/ConfigModal.tsx` |

Khi thay đổi hành vi, cập nhật hướng dẫn này cùng flow/API canonical liên quan. Tài liệu mô tả cách sử dụng, không cấp quyền sửa code/deploy hoặc thay thế việc kiểm tra source hiện tại.
