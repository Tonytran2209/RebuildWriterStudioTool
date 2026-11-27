# SEO Writing Rules – F.Learning

Áp dụng cho mọi bài blog SEO tiếng Anh trên flearningstudio.com. Khung outline và micro-template của 4 dạng bài nằm trong khung outline đã chọn cho bài. Dữ kiện về F lấy từ **F.Learning fact sheet**; thông tin đối thủ lấy từ **Competitor profiles** (đều thuộc Domain Knowledge).

## 0. Cách dùng

1. Mỗi luật có mã (ví dụ `R-H3`). Khi tự duyệt hoặc báo lỗi, ghi theo mã luật.
2. Mức độ: **MUST** là bắt buộc, vi phạm thì không đạt. **SHOULD** là nên làm, bỏ thì ghi lý do. **MUST NOT** là cấm.
3. Ưu tiên: platform contract > Gate Settings > Standards > khung outline/Playbook. Fact sheet và Evidence đã duyệt quyết định tính đúng của dữ kiện, không ghi đè cấu hình hay schema. Mức fail/warning theo QC Checklist; MUST mô tả yêu cầu, không tự động biến mọi lỗi biên tập thành blocking fail.
4. **Không bịa dữ kiện, và không để placeholder trong bài.** Con số, tên client, rating, giá, năm hay URL nào không có trong Domain Knowledge thì **không viết ra**. Viết vòng qua nó: nêu yếu tố quyết định giá thay vì nêu con số, hoặc bỏ hẳn ô, hàng, câu đó. MUST NOT ghi `[CẦN XÁC NHẬN]`, `[TBD]` hay chuỗi tương tự vào draft. Việc cần chủ sở hữu xác nhận chỉ được ghi trong phần notes của outline, mở đầu bằng "Owner to confirm:".
5. Mục nào fact sheet ghi "Not confirmed" thì coi như chưa có dữ kiện.
6. Chỉ nêu tên client theo mục "Clients: who may be named" của fact sheet. Case ẩn danh trong client insight library chỉ được mô tả theo ngành, không gắn với tên client nào. Không trích lời khách hàng.

## 1. Chọn dạng bài theo search intent

| Mã | Dạng bài | Tín hiệu trong keyword | Intent | Người đọc cần |
| --- | --- | --- | --- | --- |
| `T1` | Pillar Guide | `[topic]`, `what is`, `guide`, `examples`, `types` | Informational | Hiểu toàn cảnh rồi ra quyết định |
| `T2` | Company Toplist | `[X] companies`, `best [X] studios`, `top [X] agencies` | Commercial investigation | Shortlist 2–3 công ty |
| `T3` | Comparison | `X vs Y`, `X or Y`, `difference between`, `is X better than Y` | Cân nhắc giữa 2 phương án | Verdict và khung để chọn |
| `T4` | Service Toplist | `[X] services`, `hire [X]`, `best [X] services` | Commercial, sắp thuê | Chọn route (freelance/studio), giá, định dạng, đơn vị |

- `R-INT1` MUST: mỗi bài chỉ thuộc một dạng. Keyword vừa giống T2 vừa giống T4: người đọc đã chắc sẽ thuê studio → T2; còn phân vân route hoặc giá → T4. Article Spec ghi dạng bài vào `pageType` và lý do vào `pageTypeReason`.
- `R-INT2` MUST: mỗi keyword chính chỉ có một trang đích. Khi có cảnh báo trùng keyword với trang hoặc bài đã có, không viết lặp intent của trang đó.
- `R-INT3` SHOULD: T1 là hub, link xuống T2, T3, T4 cùng chủ đề; T2, T3, T4 link ngược lên T1 (chỉ khi các trang đó có trong Website Inventory).

## 2. Heading (H1–H3)

Bài chỉ có H1, H2 và H3, **không có H4**. Nội dung trong một section là văn xuôi, bảng và bullet, không chứa heading.

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-H1` | MUST | Đúng 1 H1 (Markdown `#`). |
| `R-H2` | MUST | H1 diễn đạt đúng query bằng keyword hoặc biến thể tự nhiên. Nếu Gate Settings bật exact keyword trong H1 thì phải đáp ứng, nhưng viết lại tiêu đề thay vì nối keyword ở cuối. Khoảng 50–65 ký tự là mục tiêu tư vấn (warning khi cần), không là hard limit. Có số khi hứa số item; chỉ thêm năm khi nội dung có tính thời điểm. |
| `R-H3` | MUST | Không nhảy cấp: H3 luôn nằm dưới một H2. |
| `R-H4` | MUST | Các H3 anh em (cùng một H2 cha) cùng loại (cùng là item, lý do hoặc câu hỏi) và cùng cấu trúc ngữ pháp. |
| `R-H5` | MUST | H2 hứa một con số ("7 Things…", "10 Differences…") thì có đúng chừng đó H3, đánh số `1.`…`N.`. Con số trong H1 khớp số item thật. |
| `R-H6` | MUST | Khối con bên trong một H3 (proof, case study) dùng bullet có nhãn `- **Label:** …` hoặc nhãn in đậm đầu đoạn (`**Overview:**`). MUST NOT tạo H4. |
| `R-H7` | MUST NOT | Dùng một dòng in đậm đứng riêng làm heading giả (ví dụ `**1. Is 2D easier…?**` thay cho H3 FAQ). Nhãn in đậm đầu bullet hoặc đầu đoạn theo `R-H6` thì được phép. |
| `R-H8` | MUST | H2 nào có H3 con thì có 1–3 câu dẫn trước H3 đầu tiên. Không có heading nào để trống. |
| `R-H9` | SHOULD | Thường có 6–12 H2, ít nhất 2 H2 chứa keyword chính hoặc biến thể. Chỉ là tín hiệu tham khảo. |
| `R-H10` | SHOULD | H2 viết dạng câu hỏi hoặc lời hứa từ góc người đọc: `How Much Does X Cost?`, `How to Choose the Right X Company`. |
| `R-H11` | MUST | Heading viết Title Case. Không có dấu chấm cuối (trừ `?`). |
| `R-H12` | MUST | Outline **không** có section kết bài. Platform thêm đúng một H2 kết bài vào draft theo Gate Settings `conclusionHeading` (khuyến nghị `Where to Start`). Lệnh cấm thêm kết bài chỉ áp dụng cho outline; H2 kết bài tự động trong draft là hợp lệ dù không có trong outline. |

## 3. Mở bài (lede)

Mở bài là phần trước H2 đầu tiên. Số đoạn và khoảng từ theo Gate Settings, được đóng băng trên bài. Nếu chỉ có một đoạn, gộp câu trả lời, POV và roadmap trong đoạn đó; disclosure của T2/T4 nằm cuối đoạn mở bài cuối cùng.

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-L1` | MUST | Câu 1 in đậm, trả lời hoặc định nghĩa trực tiếp keyword, đứng độc lập và trích nguyên được (dưới 45 từ). |
| `R-L2` | MUST | Câu 2 nêu điểm khác biệt hoặc POV của F, điều mà phần lớn bài khác không nói. |
| `R-L3` | MUST | Phần cuối mở bài là roadmap: người đọc sẽ nhận được gì, theo đúng thứ tự các H2. |
| `R-L4` | MUST | T2/T4 (F có trong danh sách): câu cuối của đoạn mở bài cuối cùng là disclosure in nghiêng theo `R-F5`. Không tạo thêm đoạn ngoài số đoạn cấu hình. |
| `R-L5` | SHOULD | T2/T3/T4: phần roadmap của mở bài có link sang một bài anh em có intent gần, nếu bài đó có trong Website Inventory. |
| `R-L6` | MUST NOT | Mở bài bằng hoài niệm, câu hỏi tu từ, hype ("In today's fast-paced world…") hay định nghĩa kiểu từ điển chung chung. |

Mẫu lede:
> **Medical animation is animated video built to explain anatomy, conditions, procedures, devices, or drug mechanisms accurately enough that a clinician, patient, or regulator can rely on it.** What separates it from ordinary explainer animation is not the visual style but the review process behind every frame.
>
> Below you will find what medical animation is used for, 10 examples across…, what it costs, how to choose between 2D and 3D, and the seven things to settle before you commission one.

## 4. Title, meta, URL, năm

SEO title là H1 của draft. Meta description và schema nằm trong Article Spec (`metaDescription`, `schemaTypes`).

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-M1` | MUST | H1 dùng được làm SEO title (khoảng 60 ký tự). Mẫu: `[Keyword]: [Lời hứa] in [Year]` hoặc `[N] [Keyword] Compared ([Year])`. |
| `R-M2` | MUST | Meta description 150–160 ký tự: viết lại câu trả lời ở `R-L1` cộng với lời hứa của bài. Keyword xuất hiện 1 lần. |
| `R-M3` | SHOULD | Slug chỉ chứa keyword: không năm, không số, không stop word. Ví dụ `/medical-animation-companies/`. |
| `R-M4` | MUST | Mọi năm trong bài khớp với năm trong H1. |
| `R-M5` | SHOULD | Dữ liệu dễ lỗi thời (rating, giá, client của đối thủ) ghi ngày tham chiếu "as of [Month Year]", lấy từ Domain Knowledge. |

## 5. Keyword, entity, đoạn văn

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-K1` | SHOULD | Keyword chính hoặc biến thể tự nhiên xuất hiện ở: H1, câu 1 của lede, ≥2 H2, ≥1 H3 FAQ, meta description. |
| `R-K2` | SHOULD | Dùng biến thể tự nhiên (medical animation / healthcare animation / medical animated video) thay vì lặp nguyên cụm. Mật độ keyword chính không quá khoảng 1,5%. |
| `R-K3` | MUST | Phủ các entity chuyên ngành mà chuyên gia chờ đợi (theo `entityMap` của Article Spec) và giải thích ngắn ngay lần đầu dùng. Ví dụ y khoa: SME sign-off, MLR review, MOA/MOD, HIPAA/GDPR. Ví dụ animation: keyframing, rigging, rendering. |
| `R-P1` | MUST | Đoạn văn 2–4 câu. Câu đầu mỗi section là một câu khẳng định trích được. |
| `R-P2` | MUST | Mỗi section bold tối đa 1–2 cụm, cho kết luận hoặc con số. MUST NOT bold cả đoạn. |
| `R-P3` | MUST | Từ 3 thuộc tính so sánh trở lên thì dùng bảng Markdown. Ngay dưới bảng có 1–2 câu diễn giải ("The common mistake is…"). |
| `R-P4` | MUST | Các item lặp lại trong cùng một H2 dùng chung một micro-template (trong Playbook "Page type outlines"). |
| `R-P5` | MUST | Bullet có nhãn viết theo mẫu `- **Label:** content`. |
| `R-P6` | MUST NOT | Claim rỗng không có bằng chứng: "high quality", "best-in-class", "24/7 support", "cutting-edge". |
| `R-P7` | MUST | Tiếng Anh nhất quán UK hoặc US trong cả bài. Không typo. |
| `R-P8` | MUST | Dùng dấu gạch ngắn (-) hoặc dấu phẩy thay cho em dash (—). |
| `R-P9` | MUST | Bảng tóm tắt đứng trước các mục đánh số thì các hàng dùng đúng tên và đúng thứ tự của các mục đó. |

## 6. Ảnh, video

Bài không có ảnh khi viết. Draft MUST NOT chứa marker ảnh (`[IMAGE …]`), URL ảnh hay câu "below is a video".

- `R-IMG1` SHOULD: trong notes của outline, H2 lớn có thể ghi gợi ý ảnh dạng `Image idea: [mô tả] | alt: [có keyword nếu là ảnh hero]` để editor chèn khi đăng.
- `R-IMG2` MUST: câu chữ trong bài không phụ thuộc vào một ảnh hay video không có trong bài ("as shown in the image above").

## 7. Internal link, CTA

Link nội bộ chỉ lấy từ danh sách trang được duyệt (Website Inventory). Số lượng link theo yêu cầu đi kèm bài; section nào có từ 2 link nội bộ trở lên là lỗi.

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-LINK1` | MUST | Link đặt tại chỗ khái niệm, dịch vụ hay use case được nhắc lần đầu. Anchor là cụm mô tả. MUST NOT dùng anchor "here" hay "click here". |
| `R-LINK2` | SHOULD | Khi Website Inventory có trang tương ứng, ưu tiên đủ loại: 1 trang service, 1 trang use-case, 1 trang cost, 1 trang process hoặc case study, 1–2 bài anh em. |
| `R-LINK3` | MUST | Mỗi H2/H3 có tối đa **1** link nội bộ. Không có khối "Read more" hay danh sách link cuối bài. |
| `R-LINK4` | SHOULD | CTA dẫn tới portfolio hoặc contact gắn UTM: `?utm_source=blog&utm_medium=inline_cta&utm_campaign=<slug>&utm_content=<đích>`. |
| `R-LINK5` | MUST NOT | Bịa URL, kể cả URL service hay use-case. Không có trong Website Inventory thì không link. |
| `R-LINK6` | SHOULD | Link ra ngoài chỉ dẫn tới nguồn gốc (website đối thủ, hồ sơ Clutch, tài nguyên công khai). |

## 8. Section về F, disclosure, đối thủ

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-F1` | MUST | T1/T3: section về F đặt sau toàn bộ phần nội dung trung lập, trước FAQ. T2/T4: F là item số 1 và có disclosure. |
| `R-F2` | MUST | Section F gồm 3 lý do, mỗi lý do có ≥1 proof cụ thể lấy từ fact sheet (năm, tên client được phép nêu, rating có nguồn, kết quả case study đã công bố). Có thể dùng công thức USP: "most providers focus on X; we focus on Y; that matters because Z". |
| `R-F3` | MUST | Mỗi lợi thế kèm lý do vì sao có lợi thế đó. Ví dụ: "The saving comes from where the studio is based, not from cutting the review process." |
| `R-F4` | MUST | Thành thật về giới hạn khi có liên quan. Ví dụ: "Our depth is in 2D… 3D is a newer service." |
| `R-F5` | MUST | Disclosure (T2/T4), in nghiêng, ở cuối đoạn mở bài cuối cùng: *Disclosure: F.Learning publishes this article and is listed first; the list is not a ranking, and the other companies were profiled from their own websites and public sources at the time of writing, so confirm current details directly.* |
| `R-F6` | MUST NOT | Tự gọi F là "the best", "#1" hay "top-rated" bằng giọng của bài. Rating có nguồn ("5.0 on Clutch") thì được. |
| `R-C1` | MUST | Thông tin đối thủ chỉ lấy từ Competitor profiles (Domain Knowledge). Mỗi đối thủ có một "Best fit for" riêng. MUST NOT nói xấu hay so sánh hạ thấp. |
| `R-C2` | MUST | Rating ghi rõ nguồn và thang: "5.0 on Clutch", không viết "5.0+". |

## 9. FAQ, kết bài, E-E-A-T, GEO

Thứ tự cuối bài: section F (T1/T3) → **FAQ là H2 cuối cùng của outline** → H2 kết bài theo Settings (thêm tự động).

| Mã | Mức | Luật |
| --- | --- | --- |
| `R-FAQ1` | MUST | H2 `FAQs About [Keyword]` là H2 cuối của outline, gồm 4–6 câu hỏi. Mỗi câu hỏi là một H3, viết đúng như người dùng gõ (lấy từ `questions` của Article Spec). |
| `R-FAQ2` | MUST | Câu trả lời 2–4 câu. Câu đầu trả lời thẳng và đọc được độc lập. |
| `R-FAQ3` | SHOULD | Schema đề xuất có FAQPage. |
| `R-END1` | MUST | Phần kết theo `conclusionHeading` và ngân sách từ trong Gate Settings: nêu bước tiếp theo cụ thể, rồi kênh liên hệ có bằng chứng được duyệt trong fact sheet. Thiếu kênh nào thì bỏ kênh đó. Không mở đầu bằng "In conclusion". |
| `R-E1` | MUST | Mỗi bài có ≥3 chi tiết kinh nghiệm thực tế (rủi ro, chi phí làm lại, thời điểm duyệt, lỗi khách hay gặp). Ví dụ: "Corrections requested after animation has started are paid for twice." |
| `R-E2` | MUST | Con số nào cũng có trong Domain Knowledge. Không có thì không viết (§0.4). |
| `R-GEO1` | MUST | Đoạn đầu mỗi section là một câu khẳng định ngắn, trích nguyên văn được. Các câu trong `citationTargets` của Article Spec xuất hiện ở section đã được gán. |
| `R-GEO2` | SHOULD | Thông tin so sánh đưa vào bảng và bullet có nhãn. Khi trả lời thì nêu tên thực thể cụ thể (tên công ty, khoảng giá kèm đơn vị nếu có trong Domain Knowledge). |

## 10. Độ dài

Số từ mục tiêu đi kèm từng bài. Phân bổ theo dạng bài:

| Dạng | Phân bổ |
| --- | --- |
| T1 Pillar Guide | Phần Types/Examples chiếm khoảng 35% |
| T2 Company Toplist | Mỗi đối thủ khoảng 80–120 từ |
| T3 Comparison | Bảng khác biệt + phần chọn chiếm khoảng 45% |
| T4 Service Toplist | 4 khối: route, danh sách, giá, định dạng |

`R-LEN1` MUST: độ dài là hệ quả của việc trả lời đủ intent. Section nào không trả lời câu hỏi nào của người đọc thì cắt.

## 11. Danh sách tự duyệt (outline và draft)

- `R-H1` `R-H3` `R-H4` `R-H5` `R-H6` `R-H7` `R-H12`: thứ bậc heading đúng, không H4, không có section kết bài trong outline
- `R-L1`–`R-L4`: lede in đậm trả lời ngay, có roadmap, có disclosure (T2/T4)
- `R-M1`–`R-M4`: H1, meta đúng; năm đồng bộ
- `R-P3` `R-P4`: bảng có câu diễn giải; item dùng chung micro-template
- `R-P6` `R-P8` `R-F6`: không còn claim rỗng, không em dash, F không tự nhận là "best"
- `R-LINK1` `R-LINK3` `R-LINK5`: anchor mô tả, tối đa 1 link mỗi section, không URL bịa
- `R-F2`–`R-F4` `R-C1` `R-C2`: section F có proof và lý do; đối thủ công bằng
- `R-FAQ1` `R-FAQ2`: FAQ là H2 cuối, mỗi câu hỏi là H3, câu đầu trả lời thẳng
- `R-E1` `R-E2` §0.4: ≥3 chi tiết kinh nghiệm; mọi số liệu có trong Domain Knowledge; không placeholder
