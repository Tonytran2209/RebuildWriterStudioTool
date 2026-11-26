# Thiết kế: Tài liệu Gate v2 (4 nhóm Storage, Standards dùng để tự duyệt, Settings là nguồn duy nhất cho con số)

Trạng thái: **giai đoạn 1–3 đã làm** (2026-11-26). Khác với bản nháp:
- G3 không có công tắc "Tự duyệt": AI Review ở G3 luôn chạy vì là điều kiện để bài thành AI Approved; chỉ chỉnh được số lượt sửa.
- Chưa có nút "Kiểm tra lại G1/G2" riêng: tự duyệt chạy mỗi khi G1/G2 được tạo hoặc tạo lại.
- Chưa thêm `prompt_cache_key` cho OpenAI (OpenAI vẫn tự cache phần đầu giống nhau).
- "Tiêu chí nào chặn xuất bản" chưa thành thiết lập: giữ quy tắc hiện tại (`blocksPublication`).
- Lỗi của sub-job tự duyệt được ghi ở `article.gateReviews[step].error` và sub-job là `failed`; bản ghi bước (`batchStepRuns`) chưa có mã lỗi riêng, như các bước khác.
Thay thế một phần: mục "Gate documents" trong `workflow.md` và `shared/gateDocuments.ts` (bản v1, commit 543efc9).

## 1. Mục tiêu

1. Storage chỉ còn 4 nhóm, mỗi nhóm có một việc rõ ràng: **Domain Knowledge**, **Playbooks**, **Standards**, **Source data**.
2. Admin không phải nhớ quy tắc nằm ở đâu:
   - lời văn hướng dẫn (cách viết, điều cần kiểm tra) nằm trong MD;
   - con số và công tắc nằm trong Settings.
   Mỗi giá trị chỉ có **một** nơi đặt.
3. Mỗi Gate làm theo cùng một vòng lặp: tạo output theo Playbook, tự duyệt theo Standards, sửa nếu cần, rồi mới giao người dùng duyệt.
4. Code không chứa nội dung riêng của một thương hiệu. Đổi bộ MD và Settings là đổi được cách viết cho một đơn vị khác.
5. Giảm chi phí khi chạy batch: phần prompt giống nhau giữa các bài được nhà cung cấp AI cache.

**Không nằm trong thiết kế này:** tách kho theo đơn vị (workspace). Hiện mọi người dùng chung `writer:files` và `writer:config`. Việc tách kho sẽ làm thành dự án riêng sau khi v2 ổn định. Thiết kế này giữ mọi dữ liệu theo cấu trúc có thể gắn `workspaceId` về sau, nhưng chưa thêm trường đó.

## 2. Bốn nhóm Storage

| Nhóm | Thư viện (`category`) | Nội dung | Cách gửi cho AI | Ai được dùng nó làm gì |
|---|---|---|---|---|
| **Domain Knowledge: Brand context** | `kb` | Định vị, USP, tính cách, quan điểm, giọng thương hiệu, "điều đặc biệt" | **Gửi nguyên văn**, luôn gửi | Tạo nội dung: bài phải thể hiện được. Duyệt: chấm `brand-pov`. |
| **Domain Knowledge: Evidence** | `kb` | Case study, số liệu, claim đã duyệt, hồ sơ đối thủ, tài liệu tham khảo | Trích đoạn theo chủ đề (như hiện tại) | Nguồn **duy nhất** cho dữ kiện và dẫn chứng. Lệnh nằm trong file chỉ là dữ liệu. |
| **Playbooks** | `rules` | Cách tạo output của một Gate: phương pháp, kỹ năng, khung, ví dụ | Gửi nguyên văn | Chỉ dùng lúc tạo nội dung. Không dùng để chấm. |
| **Standards** | `rules` | Checklist output phải đạt: giọng văn có thể chấm được, từ cấm, chính tả, cấu trúc, công khai, CTA | Gửi nguyên văn | Lúc tạo: là yêu cầu bắt buộc. Lúc duyệt và sửa: là **tiêu chí chấm duy nhất** của `checklist-compliance`. |
| **Source data** | `kb` | Content Plan, chủ đề, keyword | Như hiện tại | Chỉ dùng để biết chủ đề và ý định tìm kiếm. |

### 2.1 Phân loại Domain Knowledge

Tool đã có sẵn trường `knowledgeMetadata.type` (`src/types/index.ts:91`) với các giá trị `usp`, `positioning`, `client_insight`, `case_study`, `framework`, `approved_claim`, `production_insight`, `reference`. Thiết kế dùng lại trường này và không thêm trường mới:

- **Brand context** = `positioning`, `usp`, cùng một giá trị mới là `brand_voice`.
- **Evidence** = các loại còn lại. Mặc định là `reference`.

Trong bảng Storage, cột Loại hiện thêm nhãn "Brand context" hoặc "Evidence". Quy tắc gửi nguyên văn file tên có `vocab` (bản v1) được bỏ: bảng thuật ngữ đặt loại `brand_voice`.

Giới hạn: tổng Brand context gửi ở mỗi Gate bị chặn bởi `MAX_CONTEXT_CHARS` như hiện nay. Phần xem trước trong Settings cảnh báo khi Brand context vượt 25% giới hạn này.

### 2.2 Bỏ nhóm Voice & Style

Nội dung loại Voice được tách làm hai, như sau:
- phần mô tả tính cách và giọng thương hiệu, kèm ví dụ: chuyển thành Domain Knowledge loại `brand_voice`;
- phần quy tắc chấm được (từ cấm, em dash, chính tả, xưng hô): chuyển vào Standards.

Code không tự tách được nội dung một file. Vì vậy khi chuyển dữ liệu (mục 8), file Voice cũ **được chuyển sang Standards**, vì cùng thư viện `rules` nên không phải đổi `category`. Sau đó admin tự chuyển phần mô tả sang Domain Knowledge.

### 2.3 Nhóm phải được gán rõ

- `storageGroupOf` (`shared/gateDocuments.ts`) vẫn đoán theo tên khi chưa gán nhóm, nhưng trả về thêm `guessed: true`.
- Storage hiển thị nhóm đoán bằng nhãn "Đoán theo tên — bấm để xác nhận".
- Settings › Workflow rules liệt kê các file đang ở nhóm đoán, cho từng Gate.
- Tool không chặn chạy batch, để không làm hỏng dữ liệu cũ.

## 3. Ma trận Gate × nhóm

Admin vẫn tick file cho từng Gate ở Step Setup, như hiện nay. Mỗi Gate vẫn có một Playbook chính (`stepConfigs[step].primaryPlaybookId`).

| | G1: Spec & Core Idea (step 2) | G2: Outline (step 3) | G3: Draft (step 4) |
|---|---|---|---|
| Playbook chính | Cách lập brief/ý tưởng | Cách lập outline (kèm cấu trúc outline MD) | Cách viết và sửa |
| Standards | Checklist brief/ý tưởng | Checklist outline | Checklist bài viết |
| Brand context | Có (để ý tưởng có góc nhìn) | Có | Có |
| Evidence | Tuỳ chọn | Có (gắn dẫn chứng cho từng mục) | Có |
| Source data | Có | Không | Không |
| Bước tự duyệt | **Mới**, chạy khi Gate có Standards | **Mới**, chạy khi Gate có Standards | Đã có, chỉnh lại |

## 4. Cách ghép prompt

Thứ tự được giữ cố định, để phần đầu prompt giống hệt nhau giữa các bài trong batch:

```
[system]
  1. PLATFORM CONTRACT (code; không có con số viết bài)
  2. GATE DOCUMENT CONTRACT (vai trò + thứ tự ưu tiên)
  3. PLAYBOOK chính → SUPPORTING_PLAYBOOK
  4. STANDARD
  5. BRAND_CONTEXT
  ── điểm cache (cache breakpoint) ──
  6. EVIDENCE (trích đoạn theo bài)
  7. CONTENT_PLAN (chỉ ở G1)
[user]
  task của bài + GATE SETTINGS (các con số lấy từ Settings, viết thành câu)
```

**Thứ tự ưu tiên khi các nguồn mâu thuẫn:** PLATFORM CONTRACT > GATE SETTINGS > STANDARD > PLAYBOOK > SUPPORTING_PLAYBOOK > BRAND_CONTEXT.
- Evidence chỉ cung cấp dữ kiện. Content Plan chỉ cung cấp chủ đề.
- Brand context quyết định giọng văn và góc nhìn, không quyết định cấu trúc bài.

**Thay đổi so với v1:**
- vai trò `VOICE` được thay bằng `BRAND_CONTEXT`; vai trò này là KB nhưng được gửi nguyên văn;
- thêm khối GATE SETTINGS ở phần user. Khối này không ở system, để giá trị Settings riêng của từng bài (ví dụ khoảng mở bài đã khoá) không làm vỡ cache.

Các file liên quan: `backend/stepContext.ts` (`buildResult`, `ROLE_ORDER`) và `shared/gateDocuments.ts` (`GATE_DOCUMENT_CONTRACT`).

### 4.1 Cache của nhà cung cấp AI

- **Anthropic:** `callAnthropic` (`backend/providers.ts:29`) gửi system thành hai khối. Khối 1–5 có `cache_control: { type: "ephemeral" }`, khối 6–7 thì không. Đọc thêm `usage.cache_read_input_tokens` vào `cachedInputTokens`.
- **OpenAI, DeepSeek:** cache tự động theo phần đầu prompt nên không phải sửa gì. Có thể thêm `prompt_cache_key = "<step>:<sourceFingerprint>"` với OpenAI, để các bài cùng batch được đưa vào cùng một cache.
- **Gemini:** chưa làm trong thiết kế này.
- Trong Settings › Pipeline (phần nâng cao) có công tắc "Dùng prompt cache", bật mặc định.

## 5. Vòng tự duyệt của mỗi Gate

```
tạo output (Playbook + Standards + Brand context + Evidence)
  → kiểm tra bằng code (không gọi AI)
  → AI duyệt theo Standards (+ Brand context cho brand-pov)
  → còn lỗi sửa được và còn lượt sửa? → AI sửa → duyệt lại
  → lưu kết quả, chuyển cho người dùng duyệt
```

### 5.1 G3 (đã có, chỉnh lại)

- `step4ChecklistDocs` (`src/lib/qualityPolicy.ts:33`) **chỉ lấy file nhóm Standards** đã tick ở G3. Không lấy Playbook, không lấy file nguồn của cấu trúc outline.
- Lượt duyệt AI hiện chạy với `skipDocumentContext: true` (`backend/index.ts:2879`), nên lúc chấm `brand-pov` người duyệt không thấy tài liệu thương hiệu. Thiết kế mới gửi kèm Brand context cho lượt duyệt, nhưng không gửi Evidence. Evidence đã có sẵn dưới dạng registry và mapping dẫn chứng.
- Câu lệnh `checklistReviewInstruction` đổi "SEO CHECKLIST" thành "GATE STANDARDS". Hướng dẫn "các giới hạn đo được thì bỏ qua" vẫn giữ.
- Fingerprint của semantic review thêm danh sách Standards và Brand context (tên và nội dung). Bài cũ cần chấm lại một lần.

### 5.2 G1 và G2 (mới)

- **Sub-job mới:** "Kiểm tra Core Idea" (chạy ngay sau "Article Spec & Core Idea") và "Kiểm tra outline" (chạy ngay sau "Lập outline").
- **Điều kiện chạy:** Gate có ít nhất một file Standards được tick **và** Settings bật "Tự duyệt" cho Gate đó. Thiếu một trong hai thì không gọi AI, và không ghi lần chạy.
- **Output của lượt duyệt:** `{ checks: [{ item, status: pass|warning|fail, reason, location, fixable }] }`, dùng JSON schema giống cách G3 đang làm.
- **Lượt sửa:** chỉ sửa đúng các mục `fail` có `fixable`. Không đổi phần đã đạt. Sửa xong thì duyệt lại.
- **Kết quả:**
  - lưu `article.gateReviews[step] = { checks, rounds, fingerprint, reviewedAt }`;
  - hiện trong khung duyệt của Gate (G1 Core Idea, G2 Outline), dùng box-row và tag theo `design.md`;
  - lỗi `fail` còn lại không chặn người dùng duyệt G1/G2 nhưng hiện cảnh báo. Chỉ G3 chặn xuất bản, như hiện nay.

## 6. Settings: nguồn duy nhất cho con số và công tắc

Bỏ việc đọc con số từ đầu file MD (`readFrontMatter`, `resolveGateParameters` của v1). Mọi giá trị sau đây nằm trong `writer:config.gateSettings`, chia theo Gate:

| Thiết lập | Gate | Mức | Mặc định | Đang nằm ở đâu |
|---|---|---|---|---|
| Playbook chính | mọi Gate | Cơ bản | không có | `stepConfigs[step].primaryPlaybookId` (giữ nguyên) |
| Tự duyệt bằng AI (bật/tắt) | G1, G2, G3 | Cơ bản | G1/G2 tắt, G3 bật | mới |
| Số lượt sửa tối đa | G1, G2, G3 | Nâng cao | 1 | G3 đang cố định trong code |
| Số keyword nghiên cứu | G1 | Cơ bản | 10 | `GATE_PARAMETERS` |
| Số ý tưởng | G1 | Cơ bản | 3 | `GATE_PARAMETERS` |
| Số section tối thiểu | G2 | Cơ bản | 4 | `GATE_PARAMETERS` |
| Số từ mục tiêu | G3 | Cơ bản | 1500 | `pipeline` (giữ nguyên chỗ) |
| Mở bài: số từ tối thiểu, tối đa | G3 | Cơ bản | 60–85 | `GATE_PARAMETERS` |
| Mở bài: số đoạn | G3 | Nâng cao | 1 | cố định trong `introductionPolicy.ts` |
| Kết luận (%) | G3 | Cơ bản | 7 | `GATE_PARAMETERS` |
| Tiêu đề mục kết luận | G3 | Nâng cao | "Conclusion" | cố định trong `index.ts:2054`, `universalQuality.ts:79` |
| Số câu tối đa mỗi đoạn | G3 | Nâng cao | 5 | `GATE_PARAMETERS` |
| H1 phải chứa keyword chính | G3 | Nâng cao | bật | cố định (`title-keyword`) |
| Tiêu chí nào chặn xuất bản | G3 | Nâng cao | như hiện nay | cố định (`blocksPublication`) |
| Dùng prompt cache | mọi Gate | Nâng cao | bật | mới |
| Model, số bài chạy song song | Pipeline | như hiện nay | như hiện nay | giữ nguyên |

**Giao diện** (Settings › Workflow rules), viết lại `src/crm/WorkflowRules.tsx`:
- mỗi Gate là một khối box-row. Phần cơ bản luôn hiện, phần "Nâng cao" thu gọn;
- mỗi khối hiện: Playbook chính, danh sách Standards đang tick, Brand context, các con số;
- giữ "Xem prompt AI nhận ở gate này", hiện đúng thứ tự gửi ở mục 4 và đánh dấu chỗ đặt điểm cache;
- mọi ô số có giới hạn min/max và được kiểm tra cả ở server, không chỉ ở form.

**Ngôn ngữ và thị trường không nằm trong v2.** Hiện tool đếm "English words" và mặc định thị trường "Global / USA". Đổi phần này phải sửa cách đếm từ, chữ trong prompt và QC, nên sẽ làm ở giai đoạn sau (mục 10).

## 7. Monitoring

Main Job `Writer article`, thứ tự mới trong `batchStepLabels` (`backend/batchSteps.ts`):

```
Phân loại Content Plan → Nhận bài từ Content Plan → Nghiên cứu từ khóa SEO → Article Spec & Core Idea
→ Kiểm tra Core Idea (mới) → Lập outline → Kiểm tra outline (mới) → Viết draft → Kiểm tra chất lượng
```

- **Key mới** trong `BatchStepKey`: `specReview` và `outlineReview`. Mỗi key được ghi như các bước khác, qua `beginStep`, với `runId`, `parentRunId`, `status`, `startedAt` (ghi ngay trước lượt gọi AI đầu tiên) và `endedAt`.
- **Khi bước bị bỏ qua** (không có Standards, hoặc tắt "Tự duyệt"): không ghi lần chạy, để tỷ lệ lỗi không bị kéo thấp giả tạo.
- **Mã lỗi:** dùng lại `AI_PROVIDER_ERROR` và `DATABASE_ERROR`. Thêm `REVIEW_SCHEMA_ERROR` cho trường hợp AI trả lời sai cấu trúc.
- **Bài chạy lẻ (step-by-step):** nút "Kiểm tra lại G1/G2" là thao tác giao việc cho server. Đo bằng `trackHandoff` (ui-kpi-v2), và cập nhật `kpiDescriptions`.
- **Test:** thêm vào `backend/jobHistory.test.ts` cho 2 sub-job mới, gồm các trường hợp thành công, lỗi, đang chạy và thiếu `startedAt`. Kiểm tra `/internal/monitoring` ở máy.
- **Riêng tư:** log không chứa nội dung Standards hay output, chỉ chứa số mục pass/warning/fail.

## 8. Chuyển dữ liệu

Việc chuyển dữ liệu chạy một lần, tự động khi server khởi động. Có cờ `writer:config.gateDocumentsVersion = 2` để không chạy lại.

1. File có `storageGroup: "Voice & Style"`, hoặc được đoán là Voice: đặt `storageGroup` thành `"Standards"`.
2. File KB tên có `vocab`, chưa có `knowledgeMetadata`: đặt `type` thành `brand_voice`.
3. Con số: `gateSettings` được ghi bằng giá trị mà v1 đang dùng (front matter của Playbook hoặc Standards, rồi Settings cũ, rồi mặc định). Như vậy bài chạy sau khi chuyển dùng đúng số cũ. Production hiện không có giá trị tuỳ chỉnh nào, nên ở đó sẽ ghi giá trị mặc định.
4. **Không xoá gì.** `workflowRules[*].stageOverrides[*].parameters` cũ được giữ nhưng không còn được đọc.

**Tương thích với dữ liệu cũ:**
- bài đã khoá `introductionBudget` vẫn dùng khoảng đó;
- cache AI của các bước bị bỏ một lần, vì fingerprint quy tắc thay đổi;
- bài cũ cần "Chấm lại AI" một lần, vì fingerprint của semantic review thay đổi.

## 9. Kiểm thử

- `backend/gateDocuments.test.ts`:
  - kiểm tra vai trò theo nhóm và loại KB (Brand context được gửi nguyên văn, Evidence được trích đoạn);
  - kiểm tra thứ tự gửi;
  - nhóm đoán theo tên trả về `guessed`.
- `backend/checklistQuality.test.ts`: bước duyệt chỉ nhận Standards; Playbook không lọt vào checklist.
- **Test mới cho vòng tự duyệt G1/G2:**
  - không có Standards thì không gọi AI;
  - lỗi `fixable` thì có 1 lượt sửa rồi duyệt lại;
  - hết lượt sửa thì lưu kết quả còn lỗi và không chặn.
- **Test chuyển dữ liệu:** Voice chuyển thành Standards, `vocab` thành `brand_voice`, con số được giữ nguyên; chạy lần hai không đổi gì.
- **Provider:** Anthropic gửi hai khối system, khối đầu có `cache_control`.
- **Lệnh chạy:** `npm --prefix backend test` và `npm run check`.
- **Kiểm tra trên trình duyệt** (không gọi AI production): Settings theo từng Gate, phần xem trước prompt, nhãn "Đoán theo tên" trong Storage, khung kết quả duyệt ở G1 và G2.

## 10. Giai đoạn triển khai

Mỗi giai đoạn merge riêng và chạy được độc lập.

| Giai đoạn | Nội dung | Bước xử lý mới? | Rủi ro |
|---|---|---|---|
| **1** | Bốn nhóm, Brand context/Evidence, bỏ Voice, nhãn nhóm đoán; bước duyệt G3 chỉ dùng Standards và nhận Brand context; cache cho Anthropic | Không | Thấp. Bài cũ chấm lại một lần |
| **2** | `gateSettings` thành nguồn duy nhất cho con số; viết lại giao diện Settings (cơ bản/nâng cao); bỏ front matter; chuyển dữ liệu | Không | Trung bình. Cần đối chiếu đủ mọi chỗ đang đọc con số |
| **3** | Tự duyệt và sửa ở G1, G2 với 2 sub-job mới | **Có**, theo mục 7 | Trung bình. Tốn thêm 1–3 lượt gọi AI mỗi Gate khi bật |
| **4** (sau) | Ngôn ngữ, thị trường; Playbook theo dạng bài | Không | Cao (cách đếm từ, QC) |
| **5** (dự án riêng) | Tách kho theo đơn vị (workspace) | Có | Cao |

## 11. Điều cần chủ dự án quyết định

1. **G1/G2 tự duyệt mặc định tắt** (thiết kế đề xuất) hay bật. Bật thì chất lượng tốt hơn, nhưng mỗi bài tốn thêm lượt gọi AI.
2. **Lỗi còn lại sau khi tự duyệt G1/G2 có chặn chuyển Gate không.** Thiết kế đề xuất chỉ cảnh báo, không chặn.
3. **Brand context có gửi cho lượt duyệt G3 không.** Thiết kế đề xuất có gửi, để `brand-pov` có căn cứ, đổi lại tốn thêm token đầu vào nhưng được cache.
4. **Bỏ hẳn front matter** (thiết kế đề xuất), hay giữ để đọc làm giá trị gợi ý khi nhập file.
