# Chuyển đổi Writer Studio sang AI Content Pipeline (3 gate)

> Trạng thái: **đề xuất, chưa triển khai**. Ngày tổng hợp: 2026-11-13.
> Nguồn:
> - BA doc "re-BA Comparision Content Articles" (2 bản: Business Objective, và Workflow Logic).
> - Sơ đồ "Request → Batch → 3 Gate → AI approval → Human review → Google Docs".
> - Sơ đồ "SEO Content Production Workflow: Before vs After".
> - Prototype "SEO Writer Studio" (claude.ai artifact `3JjUrd4Qki9WgMVXFZqpVa`).
>
> Chưa đọc được: tài liệu Root Cause (link Google Docs nội bộ trong BA doc).

## 1. Tóm tắt

Hiện tại, Writer Studio là **công cụ để writer viết từng bài**. Mỗi bước, AI tạo một kết quả, con người đọc và chỉnh sửa. Sau đó SEO Technical và Marketing Lead review từ 1 đến 2 vòng.

Mô hình mới là **một dây chuyền tự chạy**:
1. Content Operator đưa vào một Content Plan.
2. Hệ thống tự chia plan thành batch.
3. Mỗi bài tự đi qua 3 gate. Tại mỗi gate:
   - **Executor Agent** tạo nhiều option.
   - **Reviewer Agent** chấm từng option theo checklist và chọn option tốt nhất đạt ngưỡng.
4. Bài nào đạt checklist thì được **AI Approved**. Con người chỉ review ngẫu nhiên một số bài ở cuối, sau đó copy sang Google Docs.

**Mục tiêu kinh doanh**

| Chỉ số | Hiện tại | Mục tiêu |
|---|---|---|
| Sản lượng | ~4 bài/tuần | 30 bài/ngày (batch) |
| Thời gian writer | 6–8 giờ/bài | Giảm việc viết và sửa thủ công |
| Review SEO | 1 giờ/bài | AI chấm theo checklist |
| Review của Marketing Lead | 1 giờ/bài | Review ngẫu nhiên ở đầu ra |
| Số vòng sửa | 1–2 | 1 |
| KPI chính | — | First-pass Approval Rate (chưa có baseline) |

## 2. Từ điển thuật ngữ chuẩn hoá

Từ nay dùng thống nhất các tên ở cột "Thuật ngữ" trong code, giao diện và tài liệu.

| Thuật ngữ | Định nghĩa | Tương ứng trong Writer Studio hiện tại |
|---|---|---|
| **Content Plan** | Danh sách **topic** (hướng chủ đề, chưa có title), kèm keyword, loại bài và internal link gợi ý | Content Plan import → phân loại (`importContentPlan`) |
| **Topic** và **Title** | Topic là đầu vào từ plan. Title được chọn ở Gate 1 và trở thành tiêu đề bài | Topic → Core Idea `title` |
| **Article type** | `A` so sánh format với format · `B` so sánh khái niệm · `C` so sánh nhiều lựa chọn · `ED` Editorial (Content Writing Model) | `activityType` (`comparison-seo` / `editorial-originality`) và cấu trúc MD của outline |
| **Batch** | Nhóm bài được tạo **tự động** từ plan (mặc định 5 bài/batch), có lịch chạy và giới hạn số batch chạy song song | Batch activity 5/10/15/20 do người dùng chọn, mỗi activity chạy 2 bài song song |
| **Gate** | Một bước có cổng kiểm soát: tạo option → chấm → chọn → chuyển tiếp. Gồm Gate 1 Research/Topic, Gate 2 Outline, Gate 3 Final Article | Bước 1 Core Idea, Bước 2 Outline, Bước 3 Draft |
| **Option** | Một phương án do Executor tạo tại một gate (prototype tạo 3 option: A/B/C) | Chỉ Core Idea có nhiều phương án; Outline và Draft có 1 |
| **Executor Agent** | Lượt gọi AI tạo option, dùng Executor package | Các lượt gọi AI generate hiện có |
| **Reviewer Agent** | Lượt gọi AI chấm option theo checklist và chọn option tốt nhất | Semantic review của Universal QC (chỉ ở bước Draft) |
| **Checklist** | Danh sách tiêu chí chấm cho từng gate. Gate 3 gồm 3 nhóm SEO, GEO, E-E-A-T | Universal QC (khoảng 18 check tự động, 7 check semantic) cùng checklist của Step 4 |
| **Score / Threshold** | Score là tỉ lệ % tiêu chí đạt. Threshold là ngưỡng đạt (prototype tạm đặt 90%, **chưa chốt**) | Chưa có, QC chỉ có pass/warning/fail |
| **Revision round** | Khi option tốt nhất vẫn dưới ngưỡng thì cho sửa một vòng (mục tiêu: 1 vòng) | Re-check & Fix (1 lần vá, tối đa 8 chỗ) |
| **No-pass Logic** | Cách xử lý khi không option nào đạt, kể cả sau vòng sửa. **Chưa chốt** | Draft được lưu kèm danh sách lỗi QC |
| **AI Approval** | Bài đạt checklist ở cuối Gate 3. Đây là điều kiện để coi bài là **Completed** | "Đánh dấu hoàn thành" do người bấm |
| **Human review** | Trạng thái riêng: `Not Reviewed` / `Approved` / `Needs Revision` (bắt buộc có comment). **Không chặn** việc bài hoàn thành. Review theo kiểu lấy mẫu ngẫu nhiên | Chưa có |
| **Review Workspace** | Thư viện các bài đã AI Approved. Reviewer chọn bất kỳ bài nào, không cần chờ phân công | Chưa có |
| **Storage** | Kho tài liệu chia 5 nhóm: Domain Knowledge, Playbooks, Standards, Voice & Style, Source data | Knowledge Base và Skills & Rules |
| **Shipper** | Quy tắc xác định gate nào lấy tài liệu nào | `stepConfigs[n].fileAccess` (cấp file theo từng bước) |
| **Package** | Bộ ngữ cảnh đã đóng gói. Executor package dùng để viết, Reviewer package (checklist) dùng để chấm | Context của từng bước (`resolveStepContext`) |
| **Content Operator** | Người nhập plan, chạy pipeline và nhận bài | Writer |
| **SEO Technical / Marketing Lead** | Người review mẫu ở cuối | Admin |

## 3. Luồng chuẩn

### 3.1 Luồng người dùng

```
Add Plan → Auto Split Batches → Generate → Track Progress → Open Article → (AI Review / History) → Copy to Docs
Review Workspace (độc lập): chọn bài bất kỳ → Approve | Request Revision (+comment)
```

### 3.2 Trạng thái một bài

```
Pending → Queued → G1 Research/Topic → G2 Outline → G3 Final Article → AI Approval → Completed (AI Approved)
                     └──────────── bất kỳ gate nào không có option đạt → Failed (No-pass) → Retry từ gate đó
Human review (song song, không chặn): Not Reviewed → Approved | Needs Revision
```

Các quy tắc phải giữ:
- Mỗi bài chạy độc lập với các bài khác.
- Batch chạy song song đến giới hạn `maxParallel` (prototype đặt 2). Khi một batch xong hoặc dừng thì batch kế tiếp bắt đầu.
- Output được chọn ở gate trước là input duy nhất của gate sau.
- Retry chỉ chạy lại **từ gate bị lỗi**, không chạy lại cả bài.
- "Request Revision" của người review chỉ ghi lại feedback và **không** gửi bài lại cho AI (theo prototype).

### 3.3 Đặc tả từng gate

| Gate | Executor tạo | Executor package | Reviewer package | Output chuyển tiếp |
|---|---|---|---|---|
| **1 Research / Topic** | 3 phương án title và angle từ topic | Content Plan, Topic priority list, Concept Ownership, Principles & Client Cases, Company Positioning | Checklist Gate 1–2 (**chưa có**, tạm dùng tiêu chí của Outline Generator bước 1–7), Outline Generator | Title, angle, ICP/intent/funnel, case dẫn chứng, claim |
| **2 Outline** | 3 outline (Deep/Light hoặc khác form) | Article types & sample outlines (chỉ phần của type A/B/C, hoặc Content Writing Model nếu là ED), Outline Generator, Writing Patterns, Approved Articles | Checklist Gate 1–2 (tạm dùng Outline Generator bước 8 và Content Writing Model), playbook của type tương ứng | Outline đã chọn |
| **3 Final Article** | 3 draft | Draft Writer, Writing Patterns, Approved Articles, Tone of Voice, Concept Ownership, Vocabulary (tối đa 6 thuật ngữ khớp topic), Internal Link Map | SEO, GEO, E-E-A-T Checklist, Tone of Voice | Bài đã chọn kèm kết quả AI Review |
| **Final output** | Xuất bài đúng format (meta title, meta description, nội dung) | Quy tắc chỉnh sửa (**chưa có**), Quy tắc upload (Checklist Đăng Bài) | — | Bài sẵn sàng copy sang Docs |

Nguyên tắc Shipper: **chỉ nạp phần tài liệu cần cho gate đó, không bao giờ nạp cả thư viện**. Ví dụ, chỉ nạp phần playbook của đúng article type đang viết. Writing Patterns là tài liệu tham khảo, không phải quy tắc bắt buộc. Approved Articles chỉ được dùng khi bài đó đã có người xác nhận duyệt.

### 3.4 Checklist Gate 3 (theo prototype)

Prototype chấm 31 tiêu chí theo 3 nhóm. Score = số tiêu chí đạt chia cho 31.

- **SEO (11):**
  - Title tag (55–65 ký tự, có keyword).
  - Sapo: trả lời ngay, có keyword trong 25–50 từ đầu, gồm 2 đoạn ngắn.
  - Meta description.
  - Cấu trúc heading.
  - Độ phủ keyword.
  - Khớp search intent.
  - Alt text cho ảnh.
  - Internal links.
  - External links.
  - Schema markup.
  - Độ mới của nội dung.
- **GEO (10):**
  - Mở bài trả lời câu hỏi chính ngay (AI-first intro).
  - Khối Key takeaways (3–5 ý).
  - Chia nhỏ nội dung, mỗi phần một câu hỏi.
  - Các khẳng định có thể trích dẫn độc lập.
  - Semantic HTML.
  - Mục FAQ.
  - Định nghĩa rõ ràng.
  - Thực thể (entity) rõ ràng.
  - Cấu trúc thuận tiện cho việc so sánh.
  - Trả lời đầy đủ câu hỏi chính và câu hỏi tiếp theo.
- **E-E-A-T (10):**
  - Author bio và người duyệt.
  - Dấu hiệu kinh nghiệm thực tế.
  - Dấu hiệu chuyên môn.
  - Trích dẫn nguồn uy tín.
  - Dấu hiệu tin cậy.
  - Độ chính xác.
  - Độ mới.
  - Social proof.
  - Minh bạch.
  - Giá trị đặt người đọc lên trước.

## 4. Storage: phân loại chuẩn và mức sẵn sàng

| Nhóm | Tài liệu | Trạng thái (theo prototype) | Trong Writer Studio hiện tại |
|---|---|---|---|
| Domain Knowledge | Concept Ownership Library | Có | Có thể nằm trong KB |
| | Principles & Client Cases | Có | KB |
| | Company Positioning | Có | KB |
| | Vocabulary Library | Có trong prototype, nhưng đánh dấu "chưa có" ở Storage gốc | — |
| Playbooks | Article types & sample outlines (A/B/C) | Có | File cấu trúc MD của outline (Skills & Rules) |
| | Outline Generator | Có | Rules |
| | Draft Writer | Có | Rules |
| | Writing Patterns | Mẫu đề xuất, chưa phải bản duyệt | — |
| | Approved Articles | **Chưa có bài nào được người xác nhận** | — |
| Standards | SEO / GEO / E-E-A-T Checklist | Có | Checklist của Step 4 (đang gộp chung, không chia nhóm) |
| | Checklist Gate 1–2 | **Chưa có** | — |
| | Internal Link Map | Có | Website Inventory |
| | Quy tắc chỉnh sửa | **Chưa có** | — |
| | Quy tắc upload (Checklist Đăng Bài) | Có | — |
| Voice & Style | Tone of Voice & Style | Có | Rules |
| Source data | Integrated Action Plan, Topic priority list | Có | Content Plan |

## 5. Đối chiếu năng lực (gap analysis)

Mức độ: ✅ đã có · 🟡 có một phần · ❌ chưa có.

| Năng lực | Hiện tại | Mức | Ghi chú và vị trí trong code |
|---|---|---|---|
| Nhập Content Plan | Dán nội dung hoặc file, có phân loại | ✅ | `ActivityLauncher.tsx`, `importContentPlan` |
| Tự chia plan thành batch và xếp lịch | Người dùng tự chọn batch 5–20 bài, không có lịch | ❌ | `ActivityLauncher.tsx:235` |
| Giới hạn song song | 2 bài mỗi batch activity | 🟡 | `runBatch` → `runWithConcurrency(articles, 2)`. Cần chuyển sang giới hạn theo số batch hoặc toàn hệ thống |
| Gate 1: nhiều option, chấm, chọn | AI tạo N Core Idea có điểm 0–10, batch chọn ý tưởng `overall` cao nhất | 🟡 | `backend/index.ts:2230–2300`. Điểm do chính Executor tự chấm, không có Reviewer riêng và không theo checklist |
| Gate 2: nhiều option outline | Mỗi lần chỉ tạo 1 outline | ❌ | `Step3Outline.tsx`, batch `outline` |
| Gate 3: nhiều option draft | Mỗi lần chỉ tạo 1 draft | ❌ | `Step4Draft.tsx`, batch `draft` |
| Reviewer Agent riêng cho từng gate | Chỉ có semantic review ở Draft | 🟡 | `qualityPolicy.ts`, `SEMANTIC_IDS` |
| Score % và threshold | Chỉ có pass/warning/fail | ❌ | Cần thêm trường lưu score theo option |
| Checklist SEO/GEO/E-E-A-T chia nhóm | Một checklist chung ở Step 4 với 1 tiêu chí `checklist-compliance` | 🟡 | `step4ChecklistDocs`, `checklistReviewInstruction` |
| Revision round khi dưới ngưỡng | Re-check & Fix một lần do người bấm | 🟡 | Cần chạy tự động trong pipeline |
| No-pass → Failed → Retry từ gate | Batch có trạng thái failed và retry cả bài | 🟡 | Cần retry từ gate bị lỗi |
| AI Approval là điều kiện Completed | Người bấm "Hoàn thành" | ❌ | `qualityAllowsCompletion`, `onToggleComplete` |
| Human review (Approved / Needs Revision kèm comment) | Không có | ❌ | Cần trường dữ liệu và màn hình mới |
| Review Workspace (lọc theo plan, batch, trạng thái) | Không có | ❌ | — |
| Generation History theo gate (option, điểm, option được chọn) | Có lịch sử phiên bản outline/draft, nhưng không có option và điểm | 🟡 | `GenerationHistory` |
| Storage chia 5 nhóm, có "Used at" | KB và Rules, cấp quyền file theo từng bước | 🟡 | `TabKnowledgeBase.tsx`, `TabStepSetup.tsx` |
| Shipper/Package theo article type | Cấp quyền file theo bước, chưa theo type | 🟡 | `stepContext.ts` (`allowedRules`) |
| Retrieval có chọn lọc (6 thuật ngữ, pattern theo type và bước) | Chưa có | ❌ | — |
| Approved Articles có cờ người duyệt | Chưa có | ❌ | — |
| Meta title, meta description | Chưa có | ❌ | Prototype xuất kèm bài |
| Copy sang Google Docs giữ heading, bảng, link | Có | ✅ | `formatDraftExport`, `markdownToHtml` |
| Ảnh minh họa | Có (image worker) | ✅ | BA doc không nhắc đến. Cần quyết định có giữ trong pipeline 3 gate không |
| Monitoring và telemetry theo sub-job | Có 11 sub-job | ✅ | `batchSteps.ts`, `telemetry.ts`. Sẽ phải khai báo lại theo gate |

## 6. Các thay đổi cần thiết

### 6.1 Dữ liệu
- `Plan`: thêm `perBatch` (mặc định 5), `maxParallel` (mặc định 2) và trạng thái.
- `Batch`: thêm `idx`, `started` và lịch chạy.
- `Article`:
  - `batchIndex`.
  - `gate`, nhận một trong các giá trị `research | outline | article | approval`.
  - `status`, nhận một trong các giá trị `pending | queued | running | failed | completed`.
  - `failReason`.
- `GateRun` lưu theo từng bài và từng gate:
  - Danh sách `options[]`, mỗi option gồm `id`, `output`, `score`, `criteriaMet`.
  - `selectedId`, `rounds`, `executorPackage[]`, `reviewerPackage[]`.
- `AIReview`: `score`, `pass`, `threshold`, `items[]` (gồm `section`, `name`, `pass`, `note`).
- `HumanReview`: `status`, `comment`, `reviewer`, `reviewedAt`.
- `StorageDoc`: thêm `group` (5 nhóm), `usedAt[]`, `appliesToTypes[]`. Riêng Approved Articles cần thêm `humanApprovedBy` và `humanApprovedAt`.
- Cần migration SQL và tăng `QUALITY_VERSION`.

### 6.2 Backend pipeline
1. **Bộ lập lịch batch:** tự chia plan theo `perBatch` và chạy tối đa `maxParallel` batch cùng lúc. Có thể tái dùng `runBatch` và `serializeByKey`.
2. **Hàm chạy gate dùng chung:** `runGate(article, gate)` làm 4 việc:
   - Gọi Executor N lần để tạo N option.
   - Gọi Reviewer với checklist của gate.
   - Chọn option có điểm cao nhất mà đạt threshold.
   - Nếu chưa option nào đạt thì sửa 1 vòng; vẫn không đạt thì xử lý theo No-pass.
3. **Thay thế các bước cố định:** các bước `spec`, `outline`, `draft`, `quality` trong `runBatchArticle` được thay bằng `runGate` cho Gate 1, 2, 3, cộng thêm bước AI Approval.
4. **Giữ Universal QC tất định:** các check này chạy như tiền lọc rẻ trước Reviewer AI, để loại sớm option hỏng cấu trúc mà không tốn lượt gọi AI.
5. **Shipper:** mở rộng `resolveStepContext` để lọc tài liệu theo gate, article type và nhóm Storage, và tách riêng Executor package với Reviewer package.
6. **Completed** do AI Approval quyết định. Human review chỉ ghi trạng thái, không chặn.

### 6.3 Giao diện (theo prototype)
- **Plans:** thẻ plan kèm tiến độ; nút "+ Add Plan" (dán danh sách topic, chọn số bài mỗi batch).
- **Plan → Batches:** bảng batch gồm lịch chạy, trạng thái và tiến độ.
- **Batch → Articles:** mỗi bài có thanh tiến trình 4 bước, trạng thái và nút Retry.
- **Article:** 3 tab:
  - Final Article.
  - AI Review: score, ngưỡng, option được chọn, số vòng sửa, bảng SEO/GEO/E-E-A-T.
  - Generation History: mỗi gate hiện Executor package, Reviewer package, tài liệu được truy xuất, bảng option kèm điểm.
- **Review Workspace:** bộ lọc theo plan, batch và trạng thái review; màn hình review chia đôi (bài viết bên trái, kết quả AI review và form review bên phải).
- **Storage:** danh sách tài liệu theo 5 nhóm, mục "Used at", và hộp "Open gaps" liệt kê tài liệu còn thiếu.
- **Giữ lại** 3 bước chỉnh tay hiện có ở dạng "chế độ thủ công" để sửa bài bị Failed. Đây là đề xuất, cần chốt.

### 6.4 Vai trò
| Vai trò | Quyền |
|---|---|
| Content Operator (`user`) | Add Plan, chạy pipeline, xem bài, Retry, Copy |
| Reviewer (SEO Technical / Marketing Lead) | Dùng Review Workspace, Approve hoặc Request Revision, đánh dấu Approved Articles |
| Admin | Storage, Shipper mapping, model, threshold, `perBatch` và `maxParallel` |

Hiện tại chỉ có 2 role là `user` và `admin`. Cần thêm role `reviewer`, hoặc cho admin kiêm luôn vai trò này.

### 6.5 Monitoring
Theo `AGENTS.md`, mọi bước xử lý mới phải được khai báo là sub-job. Cần cập nhật `batchStepLabels` và `labProfile` theo cấu trúc mới:
- `plan` (Chia batch).
- `gate1`, `gate2`, `gate3`, mỗi gate có hai lượt Executor và Reviewer.
- `approval`, `humanReview`.
- Các bước ảnh, nếu giữ lại.

Mỗi option và mỗi lượt sửa được tính là một `items`. Telemetry (`backend/telemetry.ts`) phải đổi danh sách stage theo.

## 7. Mâu thuẫn với quy tắc hiện tại (cần chốt bên thắng)

| Chủ đề | Quy tắc hiện tại (code) | Yêu cầu mới (checklist trong prototype) |
|---|---|---|
| Mở bài | Đúng 1 đoạn, 60–85 từ (`INTRODUCTION_BUDGET`) | Sapo gồm 2 đoạn ngắn, có keyword trong 25–50 từ đầu |
| Cấu trúc bài | Bám đúng outline, đúng một Conclusion | Bắt buộc có thêm Key takeaways, FAQ, author bio, meta title và meta description |
| Title | H1 chứa keyword | Title tag dài 55–65 ký tự |
| External links | Chỉ dùng internal link đã duyệt, không có quy tắc external | Bắt buộc có external link uy tín cho các khẳng định |
| Hoàn thành | Người bấm, khi không còn check chặn | AI Approval ≥ threshold, không cần người |
| Dẫn chứng | Chỉ trích từ KB, cấm bịa | Case lấy từ thư viện; nếu thiếu thì để placeholder chờ AM/PM xác nhận (prototype) |

## 8. Các quyết định còn mở

1. **No-pass Logic:** khi không option nào đạt thì làm gì: dừng ở trạng thái Failed và chờ người, lấy option điểm cao nhất kèm cờ cảnh báo, hay tạo lại?
2. **Threshold:** prototype tạm đặt 90%, chưa có số chốt. Cần biết ngưỡng chung hay riêng theo gate, và có tiêu chí "chặn cứng" không (ví dụ không được bịa số liệu).
3. **Checklist Gate 1–2:** chưa có. Đến lúc đó tạm dùng tiêu chí của Outline Generator.
4. **Số option mỗi gate:** prototype dùng 3. Chi phí AI tăng khoảng N lần ở mỗi gate, cộng thêm lượt Reviewer.
5. **Số vòng sửa tối đa:** mục tiêu 1. Prototype có trường hợp 2 vòng ở Gate 1–2.
6. **Tỉ lệ review ngẫu nhiên:** bao nhiêu % bài, và chọn mẫu theo cách nào.
7. **"Needs Revision" thì sao:** chỉ ghi feedback như prototype, hay đẩy bài về chế độ thủ công / chạy lại gate?
8. **Ảnh minh họa:** có giữ trong pipeline mới không, và chạy ở bước nào.
9. **Tài liệu còn thiếu trong Storage:** Quy tắc chỉnh sửa, Vocabulary, Writing Patterns (đang là bản đề xuất), Approved Articles (chưa bài nào được người xác nhận).
10. **Năng lực đạt 30 bài/ngày:** với giới hạn song song `c` và khung thời gian chạy `T`, mỗi bài phải xong trong khoảng `c × T / 30`. Ví dụ c = 2, T = 24 giờ thì mỗi bài ≤ 96 phút; nếu T = 8 giờ thì ≤ 32 phút. Cần đo thời gian thực của 1 bài khi chạy 3 option × 3 gate, đồng thời xem rate limit và chi phí của provider.

## 9. Lộ trình đề xuất

| Giai đoạn | Nội dung | Tái dùng |
|---|---|---|
| **P0 Chốt quyết định** | Mục 7 và 8; bổ sung Checklist Gate 1–2 và Quy tắc chỉnh sửa | — |
| **P1 Reviewer và điểm số** | Chấm score % và threshold cho output hiện có (1 option); chia checklist SEO/GEO/E-E-A-T; thêm meta title và meta description; AI Approval làm điều kiện Completed | Universal QC, `checklistReviewInstruction` |
| **P2 Nhiều option** | `runGate` cho Gate 2 và 3, sau đó chuẩn hoá Gate 1 (hiện là Core Idea có điểm) | Batch runner, chọn ý tưởng theo `overall` |
| **P3 Plan, batch, review** | Tự chia batch và lập lịch; màn hình Plans/Batches; Review Workspace và Human review | `ActivityLauncher`, `BatchActivity` |
| **P4 Storage và Shipper** | 5 nhóm, "Used at", package theo type, retrieval có chọn lọc, Approved Articles | `stepContext.ts`, `TabStepSetup` |

Mỗi giai đoạn khi xong cần đo First-pass Approval Rate và chi phí AI cho mỗi bài, để so với baseline.
