# SEO Content QC Checklist – F.Learning

Tiêu chí review draft. Trả kết quả theo định dạng review được yêu cầu (pass / warning / fail cho từng tiêu chí), không viết report hay JSON riêng. Mã `R-…` tham chiếu tới SEO Writing Rules. Dữ kiện đúng nằm trong F.Learning fact sheet và Competitor profiles.

## 1. Nguyên tắc và mức độ

Thứ tự ưu tiên: đúng sự thật > có bằng chứng > an toàn nội dung y tế > nhiệm vụ của người đọc > thông tin mới > kinh nghiệm thực tế của F > link đúng chỗ > liêm chính biên tập.

| Mức | Nghĩa | Kết quả |
| --- | --- | --- |
| P0 | Bịa client, số liệu, rating hay nguồn; nêu tên client không được phép hoặc gắn một case ẩn danh với tên client; trích lời khách hàng; claim y khoa sai; gán portfolio của studio khác cho F | **fail**, không tự sửa |
| P1 | Giá hoặc dữ kiện lệch fact sheet; thiếu disclosure (T2/T4); "best" không có tiêu chí; sai dạng bài; hứa N item nhưng không đủ | **fail** |
| P2 | Decision table cần cải thiện nhưng đã có hướng dẫn ra quyết định tương đương; H3 anh em khác loại; dùng sai micro-template; FAQ viết bằng chữ in đậm thay vì H3 | **warning** |
| P3 | Typo; số H2 hoặc độ dài lệch so với mức tham khảo | **warning** |

Mức bằng chứng: fact sheet và case study đã duyệt (E1) · website của chính công ty, hồ sơ Clutch, hướng dẫn của FDA/NHS (E2) · ghi chú quy trình của F (E3) · nghiên cứu độc lập (E4). Suy luận của AI không phải bằng chứng. Website của một studio chỉ chứng minh studio đó nói gì về mình, không chứng minh họ "tốt nhất".

Mỗi finding ghi: mã luật, vị trí (H2 > H3 > đoạn), trích đoạn, vấn đề, cách sửa.

## 2. Checklist

### A. Intent và mục đích trang · `R-INT1–3`, `R-L1–L3`
- Dạng bài (T1–T4) khớp intent của keyword và khung outline đã chọn.
- Câu 1 trả lời thẳng keyword (`R-L1`).
- H1 hứa gì thì bài làm đúng điều đó: đủ số item, có so sánh, có giá hoặc yếu tố giá (`R-H5`).
- Bài giúp người đọc ra quyết định: decision table (T1/T3), cột "Best fit" (T2/T4).
- **fail khi:** sai dạng bài; trả lời một query khác; hứa N item nhưng không đủ; thiếu phần giúp quyết định.

### B. Cấu trúc · `R-H1–H12`
- Đủ các H2 của khung và đúng thứ tự. FAQ là H2 cuối của outline, trước phần kết tự động theo Settings. Không phạt H2 kết bài chỉ vì nó không có trong outline.
- Đúng 1 H1. Không có H4. H3 anh em cùng loại (`R-H4`).
- Không có dòng in đậm đứng riêng làm heading giả (`R-H7`). Không có heading rỗng (`R-H8`).
- Item lặp lại dùng đúng micro-template (`EX`, `CK`, `CO`, `DF`, `SV`, `CS`).
- Mỗi section có một mục đích riêng. Không có section chỉ để chèn keyword, không lặp ý giữa các section.

### C. Sự thật và bằng chứng · `R-E2`, §0.4 của SEO Writing Rules
- Mọi dữ kiện về F (năm, client, rating, vị thế giá, kết quả case study, liên hệ, offer) khớp fact sheet. Mục fact sheet ghi "Not confirmed" không xuất hiện trong bài. Tên client chỉ lấy từ mục "Clients: who may be named".
- Không có con số, giá, rating hay URL nào ngoài Domain Knowledge. Giá và thời gian có đơn vị (per minute, weeks).
- Thông tin đối thủ khớp Competitor profiles, viết trung lập và có ghi nguồn (`R-C1`). Rating ghi nguồn và thang (`R-C2`).
- Năm trong bài đồng bộ với H1 (`R-M4`).
- Không có superlative không tiêu chí ("best", "top", "leading") ngoài H1 của toplist đã có disclosure.
- Không còn placeholder hay marker (`[CẦN XÁC NHẬN]`, `[IMAGE]`, `[X]`, `{…}`).

### D. Nội dung y tế, dược, thiết bị y tế (YMYL)
- Kiến thức y khoa minh họa trong bài đúng, không đơn giản hóa tới mức sai.
- Không có câu nào đọc như lời khuyên điều trị hay chẩn đoán.
- Quy định (MLR, HIPAA, GDPR, FDA…) nêu đúng phạm vi và đúng khu vực pháp lý.
- Không khẳng định animation "cải thiện kết quả điều trị" hay "giảm X%" nếu Domain Knowledge không có nguồn cho đúng claim đó.
- **fail khi:** có claim y tế hoặc pháp lý quan trọng không có nguồn. Một câu disclaimer chung chung không cứu được claim sai.

### E. E-E-A-T và Trust · `R-E1`, `R-F1–F5`, `R-L4`
- Có ≥3 chi tiết kinh nghiệm thực tế, cụ thể (`R-E1`). Không bịa giai thoại ngôi thứ nhất.
- Mỗi lý do trong section F có proof từ fact sheet (`R-F2`) và lý do của lợi thế (`R-F3`).
- Giới hạn của F được nói thẳng khi liên quan (`R-F4`).
- T2/T4 có disclosure ở cuối đoạn mở bài cuối cùng (`R-F5`).
- Không có cụm rỗng ("expert team", "years of experience", "24/7 support") (`R-P6`).

### F. Nguyên bản và thông tin mới
- Có ít nhất một yếu tố bài đối thủ phổ thông không có: decision table, checklist "Things to settle", dòng "Best for" có quan điểm, chi tiết quy trình của F, đánh đổi nói thẳng.
- Các mục `informationGain` và `contentGaps` của Article Spec có mặt trong bài.
- Không định nghĩa lặp lại nhiều lần, không nhồi chữ cho đủ số từ.
- FAQ không chung chung: câu hỏi lấy từ `questions` của Article Spec, câu trả lời có dữ kiện cụ thể (`R-FAQ1–2`).

### G. Đúng thương hiệu
- Tên thương hiệu viết đúng "F.Learning". Liên hệ, offer, client, thế mạnh và giới hạn khớp fact sheet.
- Giọng văn khớp Brand context (brand voice). Claim nằm trong các proof point đã duyệt. Không định vị F là "general animation studio".
- Bài T1/T3 không đọc như quảng cáo: nội dung về F chỉ nằm trong section F, phần kết và các link đặt đúng chỗ.

### H. SEO và ngữ nghĩa · `R-M1–M4`, `R-K1–K3`
- H1 dùng được làm SEO title, chứa keyword chính.
- Keyword và biến thể xuất hiện tự nhiên ở H1, lede, các H2 chính và FAQ. Không nhồi keyword.
- Entity chuyên ngành (theo `entityMap`) được giải thích đúng ngữ cảnh (`R-K3`).
- Số H2, mật độ keyword và độ dài chỉ là tham khảo: lệch thì **warning**, không fail chỉ vì lý do này.

### I. Link nội bộ · `R-LINK1–6`
- Anchor mô tả, không dùng "here". Link đặt tại chỗ khái niệm được nhắc lần đầu.
- Mỗi link dẫn tới trang phù hợp nhất trong số trang được duyệt, không chỉ là trang có tồn tại.
- Khi inventory có, ưu tiên đủ loại: service, use-case, cost, process/case study, bài anh em (`R-LINK2`, warning nếu thiếu).

### J. Biên tập và dễ đọc · `R-P1–P7`, `R-L6`
- Đoạn 2–4 câu, câu đầu là câu khẳng định. Thuật ngữ nhất quán, không mâu thuẫn trong bài.
- Không có cụm sáo rỗng: "in today's fast-paced world", "whether you are…", "it's important to note", "delve into", "unlock", "game-changer".
- Không có pattern lặp lại: đoạn tóm tắt sau mỗi section, cấu trúc câu giống nhau, CTA chung chung. Flag nào cũng phải nói người đọc bị ảnh hưởng thế nào.
- Không typo. Chính tả UK/US nhất quán. Bold không bị lạm dụng (`R-P2`).

### K. Chuyển đổi
- CTA khớp intent: T1/T3 mời tư vấn hoặc xem portfolio; T2/T4 mời shortlist, hỏi đúng câu, liên hệ.
- Phần kết theo Settings nêu bước tiếp theo cụ thể, liên hệ khớp fact sheet.
- Toplist có tiêu chí lựa chọn minh bạch. CTA không chen vào giữa phần nội dung chuyên môn.

## 3. Chính sách tự sửa

- **Được tự sửa:** chính tả, dấu câu; đổi dòng in đậm giả heading thành bullet có nhãn; sửa bảng vỡ; sửa câu vụng mà không đổi dữ kiện; xóa câu chứa dữ kiện không có trong Domain Knowledge.
- **Không bao giờ tự sửa:** thêm nguồn, client, URL, số liệu hay kinh nghiệm không có trong Domain Knowledge; biến claim chưa chắc thành claim khẳng định; tự chọn giá trị cho mục "Not confirmed"; đổi thứ tự hay mô tả đối thủ trong toplist.

Khi thiếu dữ kiện, cách sửa đúng là **bỏ hoặc viết vòng qua** câu đó, không phải thay bằng một con số.

## 4. Thống nhất phạm vi chấm

- Platform và Gate Settings quyết định thông số đo; không phạt lại trong semantic review khi deterministic check đã xác nhận thông số đó.
- P1/fail: thiếu khối bắt buộc của dạng bài (ví dụ Differences, hướng dẫn lựa chọn, section F, FAQ khi khung đã chọn yêu cầu), sai intent, hoặc không có cơ sở giúp người đọc quyết định.
- P2/warning: đoạn dẫn H2 có H3 vượt 1–3 câu nhưng nội dung vẫn dùng được; câu vụng; format bảng cần sửa; thiếu brand asset riêng lẻ. Chỉ nâng fail nếu chỉ ra hậu quả nội dung nghiêm trọng cụ thể.
- Không phạt cùng một lỗi cấu trúc dưới cả reader-outcome và checklist-compliance. Reader-outcome đánh giá khả năng ra quyết định; checklist-compliance giữ finding về bố cục/biên tập.
- Các giới hạn tiêu đề, mật độ và tổng số heading là tư vấn trừ khi platform có deterministic check bắt buộc.
