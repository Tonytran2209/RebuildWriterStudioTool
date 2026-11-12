# REQUIREMENTS — Tích hợp Telemetry cho Writer Studio

> Phạm vi: gửi số liệu mỗi lần chạy Main Job **"Writer article"** về Dashboard Performance.
> Tham chiếu: `intercom-writer-studio/backend/telemetry.ts` (mẫu zero-config sender).

## 1. Phạm vi nghiệp vụ

| Mục | Giá trị |
|---|---|
| Tool | Writer Studio (repo `Tonytran2209/RebuildWriterStudioTool`) |
| `toolSlug` | `writer-studio` |
| Main Job (`jobName`) | `Writer article` — dùng hằng `ARTICLE_JOB` trong `backend/batchSteps.ts` |
| Đơn vị đo (1 run) | 1 bài viết SEO hoàn chỉnh kèm ảnh AI minh họa |
| `workload` mặc định | `1 article` (có thể kèm số ảnh, vd. `1 article / 3 images`) |

**Trong phạm vi**
- Chạy batch (`runBatchArticle` trong `backend/index.ts`) và chạy từng bước (single) — cả hai đều báo về cùng Main Job.
- 11 sub-jobs (stages) bên dưới, bao gồm các bước ảnh chạy trong worker (`backend/imageWorkers.ts`).
- Ghi nhận cả run thành công và run lỗi (kèm stage lỗi).

**Ngoài phạm vi**
- Thay đổi logic sinh nội dung/ảnh.
- Thay thế hệ thống ghi nhận nội bộ hiện có (`recordRun`, `batchStepRuns`, AI Agent Lab `labProfile`) — telemetry chạy **song song**, không thay thế.
- Đo KPI phía trình duyệt (ui-kpi-v2) — chỉ nhận giá trị nếu đã có, không đo mới.

## 2. Danh sách 11 stages

Mã `code` = `BatchStepKey`; `name` = `batchStepLabels[key]` (không nhân bản chuỗi, import từ `batchSteps.ts`).

| # | `code` | `name` (VI) | `nameEn` | Nơi chạy |
|---|---|---|---|---|
| 1 | `plan` | Nhận bài từ Content Plan | Article Selection | batch runner |
| 2 | `seo` | Nghiên cứu từ khóa SEO | SEO Research | batch runner |
| 3 | `spec` | Article Spec & Core Idea | Article Spec | batch runner |
| 4 | `outline` | Lập outline | Outline Generation | batch runner |
| 5 | `draft` | Viết draft | Draft Writing | batch runner |
| 6 | `quality` | Kiểm tra chất lượng | Quality Check | batch runner |
| 7 | `imageStyleSave` | Lưu phong cách ảnh | Save Image Style | imageWorkers |
| 8 | `imageStyleApprove` | Duyệt phong cách ảnh | Approve Image Style | imageWorkers |
| 9 | `imageStyleSync` | Đồng bộ thư viện ảnh | Sync Image Library | imageWorkers |
| 10 | `imageGenerate` | Tạo ảnh minh họa | Generate Illustration | imageWorkers (hàng đợi) |
| 11 | `imageInsert` | Chèn ảnh vào bài | Insert Image into Draft | imageWorkers |

Đề xuất: thêm `batchStepLabelsEn: Record<BatchStepKey, string>` vào `batchSteps.ts` để TypeScript bắt thiếu key.

## 3. Yêu cầu kỹ thuật

### 3.1 Module
- File mới: `backend/telemetry.ts`, không phụ thuộc thư viện ngoài (dùng `fetch` + `AbortController` của Node ≥ 18).
- Export tối thiểu:
  - `sendArticleRunTelemetry(options): Promise<boolean>` — gửi 1 payload, **không bao giờ throw**.
  - `fromBatchStepRuns(stepRuns: BatchStepRun[]): Stage[]` — chuyển `batchStepRuns` sẵn có thành `stages` (tận dụng `startedAt/endedAt/status`, không đo lại).

### 3.2 Cấu hình (zero-config)
| Biến môi trường | Bắt buộc | Mặc định |
|---|---|---|
| `FLEARNING_DASHBOARD_URL` | Không | `https://dashboard-tool-performance.up.railway.app` (cắt `/` cuối) |
| `FLEARNING_TELEMETRY_SECRET` | Không* | — ; có thì gửi `Authorization: Bearer <secret>` |

\* Thiếu secret vẫn gửi (xem mục 4.2).

### 3.3 Endpoint
- `POST {baseUrl}/api/telemetry`, `Content-Type: application/json`.
- Ghi chú: mẫu intercom dùng `/api/webhooks/telemetry/{slug}` rồi fallback `/api/telemetry/{slug}`; Dashboard hiện có cả `/api/telemetry` và `/api/telemetry/[toolId]`. Writer Studio dùng `/api/telemetry` theo yêu cầu; fallback `/api/telemetry/writer-studio` chỉ khi nhận 404.

### 3.4 Payload (schema 2.0)
```json
{
  "schemaVersion": "2.0",
  "toolSlug": "writer-studio",
  "jobName": "Writer article",
  "runId": "<id run nội bộ, ổn định>",
  "workload": "1 article",
  "stages": [
    { "code": "plan", "name": "Nhận bài từ Content Plan", "nameEn": "Article Selection", "durationMs": 1200, "status": "SUCCESS" }
  ],
  "status": "SUCCESS",
  "errorMessage": null,
  "responseTimeMs": 180,
  "clickLatencyMs": 95,
  "durationMs": 754000
}
```
| Trường | Quy tắc |
|---|---|
| `runId` | Dùng id run nội bộ (parent run của bài) để Dashboard khử trùng lặp khi gửi lại; fallback `run_<timestamp>` |
| `stages[]` | Theo thứ tự pipeline; chỉ gồm stage **đã thực sự chạy** |
| `stages[].durationMs` | `endedAt - startedAt`, số nguyên ≥ 0 |
| `stages[].status` | `completed` → `SUCCESS`; `failed` → `ERROR` |
| `status` | `ERROR` nếu bất kỳ stage nào `ERROR` hoặc run bị đánh dấu `failed`; ngược lại `SUCCESS` |
| `durationMs` | Wall-clock từ đầu run đến kết thúc (không cộng dồn stage, vì ảnh chạy song song/hàng đợi) |
| `responseTimeMs`, `clickLatencyMs` | Lấy từ KPI ui-kpi-v2 nếu có; không có thì **bỏ trường** thay vì gán số giả (khác mẫu intercom dùng 180/95) |
| `errorMessage` | Mã lỗi ngắn (vd. `STYLE_SAVE_FAILED`, `DRAFT_CHANGED`), cắt ≤ 500 ký tự, không chứa nội dung bài/secret |

### 3.5 Fail-safe (bắt buộc)
- Toàn bộ thân hàm bọc `try/catch`; trả `false` khi lỗi, không throw, không reject.
- Timeout **3000 ms** qua `AbortController`; `clearTimeout` trong `finally`.
- Gọi kiểu fire-and-forget (`void sendArticleRunTelemetry(...)`) — **không `await`** trên đường chính, không làm chậm checkpoint/response.
- Không retry đồng bộ. Không log secret; log lỗi tối đa 1 dòng `console.warn` (có thể tắt).
- Telemetry lỗi không được đổi trạng thái bài, `batchStatus`, hay kết quả `recordRun` (giống nguyên tắc trong `taskUsage.test.ts`: "telemetry failure cannot replace a successful business result").

### 3.6 Điểm gắn (hook points)
1. **Batch runner** — trong `saveStepCheckpoint` khi `status === "done"` hoặc `batchStatus` thành `completed`/`failed`: gửi 1 payload từ `stepRuns`.
2. **Bước ảnh (worker)** — các bước 7–11 kết thúc ở process/thời điểm khác batch runner. Chọn 1 trong 2 (cần chốt):
   - **A (đề xuất):** gửi telemetry khi bài đạt trạng thái cuối (ảnh đã chèn hoặc lỗi), gom stage từ bảng `recordRun` theo parent run → 1 payload đầy đủ 11 stage.
   - **B:** gửi payload riêng cho phần ảnh cùng `runId` — chỉ dùng nếu Dashboard hỗ trợ merge theo `runId`.
3. **Chế độ single (từng bước)** — dùng cùng hàm, `workload` ghi rõ `1 article (single)`.

## 4. Trường hợp biên

### 4.1 Timeout / lỗi mạng
- Dashboard chậm > 3s → abort, trả `false`, run vẫn hoàn tất bình thường.
- DNS lỗi, ECONNREFUSED, TLS lỗi, Dashboard trả 4xx/5xx → trả `false`, không throw.
- 404 ở `/api/telemetry` → thử fallback 1 lần (dùng chung timeout 3s tổng).
- Không có hàng đợi gửi lại ở phiên bản đầu; payload mất được chấp nhận.

### 4.2 Thiếu biến môi trường
- Thiếu `FLEARNING_TELEMETRY_SECRET` → gửi không header Authorization; Dashboard trả 401 thì coi như lỗi gửi (trả `false`), không crash.
- Thiếu `FLEARNING_DASHBOARD_URL` → dùng URL mặc định.
- URL sai định dạng → `fetch` throw, được `catch`, trả `false`.
- Môi trường test/CI (Playwright, `node --test`) → không gửi ra mạng thật: tắt bằng `FLEARNING_TELEMETRY_DISABLED=1` hoặc khi `NODE_ENV=test`.

### 4.3 Bài viết fail giữa chừng
- Stage đang chạy khi lỗi → ghi `status: "ERROR"`, `durationMs` tính đến thời điểm lỗi.
- Các stage **chưa chạy** sau đó → **không** đưa vào `stages` (không gán 0ms SUCCESS).
- Run `status = "ERROR"`, `errorMessage` = mã lỗi của stage fail.
- Ví dụ: `draft` lỗi → `stages` = `plan, seo, spec, outline` (SUCCESS) + `draft` (ERROR).

### 4.4 Khác
- **Resume/retry:** attempt resume chỉ ghi stage chạy lại (đúng hành vi hiện tại của `stepRuns`); mỗi attempt gửi 1 payload, dùng `runId` riêng theo attempt hoặc thêm hậu tố `#<attempt>`.
- **Pause/stop thủ công** (`controller.paused`) → không gửi tới khi run kết thúc thực sự.
- **Gửi trùng:** `saveStepCheckpoint` được gọi nhiều lần → cần cờ `telemetrySent` để mỗi attempt chỉ gửi 1 lần.
- **Stage lặp** (vd. `imageGenerate` nhiều ảnh): gộp thành 1 stage, `durationMs` = từ ảnh đầu bắt đầu đến ảnh cuối kết thúc, `ERROR` nếu có ảnh lỗi.
- **Stage `endedAt = null`** (process chết): bỏ qua stage đó hoặc tính đến thời điểm gửi và đánh `ERROR`.
- **Đồng hồ:** dùng ISO timestamp đã lưu; `durationMs` âm (lệch đồng hồ giữa worker) → kẹp về 0.

## 5. Tiêu chí nghiệm thu
- [ ] Unit test: payload đúng schema 2.0 cho run thành công đủ 11 stage.
- [ ] Unit test: run fail ở `draft` → đúng 5 stage, stage cuối `ERROR`, run `ERROR`.
- [ ] Unit test: `fetch` treo > 3s → hàm trả `false` trong ≤ ~3.1s, không throw.
- [ ] Unit test: `fetch` throw / trả 500 / 401 → trả `false`.
- [ ] Unit test: thiếu secret → không có header Authorization; có secret → `Bearer <secret>`.
- [ ] Integration: gọi batch với Dashboard không truy cập được → bài vẫn `done`, thời gian chạy không tăng đáng kể.
- [ ] Mỗi attempt chỉ gửi đúng 1 payload.
- [ ] Không log hoặc gửi secret, nội dung bài viết.

## 6. Câu hỏi cần chốt
1. Phương án A hay B cho các bước ảnh (mục 3.6)?
2. Dashboard có khử trùng lặp/merge theo `runId` không?
3. `responseTimeMs`/`clickLatencyMs`: bỏ trường khi không có, hay Dashboard bắt buộc có giá trị?
