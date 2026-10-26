# Writer Studio Auth trên Railway/PostgreSQL

## Kiến trúc và phạm vi

AUTH_PROVIDER mặc định là supabase, độc lập với DATABASE_PROVIDER. Chỉ đổi sang postgres sau migration/import và kiểm thử. Backend mới dùng writer_studio.auth_users/auth_sessions/auth_tokens/auth_audit_events/auth_rate_limits. Không chạy migration tự động khi khởi động và không ghi auth.users nguồn.

Frontend vẫn gọi /api/auth/login, refresh, signup, forgot-password, reset-password. Provider PostgreSQL bổ sung verify-email, resend-verification, logout, logout-all, admin/user và public GET config. Quyền lấy từ auth_users.role; AUTH_PROVIDER=postgres không tự cấp admin theo ADMIN_EMAILS hay dữ liệu frontend. Công cụ auth:scope chỉ dùng ADMIN_EMAILS để gợi ý role cần operator xác minh.

Mật khẩu mới tối thiểu 12 ký tự, tối đa 1024 bytes, scrypt N=32768,r=8,p=1 với salt ngẫu nhiên. Import bcrypt 2a/2b/2y cost 4–14; hash tương thích được nâng cấp sang scrypt sau lần đăng nhập thành công. Mật khẩu legacy ngắn vẫn đăng nhập được để người dùng có thể đổi sau. Không phục hồi plaintext hoặc in hash ra log. Công việc hash đồng thời giới hạn 4/container.

Access token opaque ngẫu nhiên 256 bit hết hạn 15 phút; chỉ lưu hash trong DB và token trong memory frontend. Refresh token cũng 256 bit, cookie HttpOnly/Secure/SameSite=Strict, host-only, path=/api/auth, hết hạn tuyệt đối 30 ngày. Mỗi refresh thay token; dùng lại refresh cũ thu hồi cả family. Browser Web Locks tuần tự hóa refresh giữa các tab khi hỗ trợ. Reload dùng cookie khôi phục session, localStorage chỉ giữ marker/user, không giữ token PostgreSQL. Logout-all, reset hoặc khóa/đổi quyền user thu hồi session; mỗi API kiểm tra trạng thái user/session thực tế.

Mọi POST Auth yêu cầu Origin trùng AUTH_APP_ORIGIN; CORS PostgreSQL chỉ cho origin này. Dùng frontend và API cùng origin HTTPS. Không cấu hình frontend và API ở hai site khác nhau rồi hạ SameSite/CSRF để chạy tạm.

Giới hạn cố định mỗi 15 phút: 12 lần thử login/email, 5 yêu cầu email/account, 150 Auth POST/IP. Bộ đếm lưu PostgreSQL nên không reset khi deploy. Không tin X-Forwarded-For mặc định; AUTH_TRUST_PROXY_HOPS chỉ đặt sau khi xác minh topology ingress và không cho truy cập bypass proxy. Nếu để 0, nhiều user có thể chia sẻ bucket theo IP proxy; cấu hình đúng trước mở rộng traffic.

MFA/SSO/phone-only không được tự chuyển thành login yếu hơn. Import chặn user có MFA verified. Hash không hỗ trợ cần --allow-password-reset rõ ràng và email hoạt động. User bị ban được giữ disabled (kể cả ban vô hạn); không tự mở khóa khi chuyển. Session/JWT Supabase cũ không được nhận; người dùng đăng nhập lại.

## Bước 1: chuẩn bị biến trong RebuildWriterStudioTool

```dotenv
DATABASE_PROVIDER=postgres
DATABASE_URL=${{Postgres-ROYC.DATABASE_URL}}
AUTH_PROVIDER=supabase
AUTH_APP_ORIGIN=https://<domain-app-thuc-te>
AUTH_ALLOW_SIGNUP=false
AUTH_TRUST_PROXY_HOPS=0
AUTH_SMTP_HOST=<SMTP host>
AUTH_SMTP_PORT=465
AUTH_SMTP_USER=<SMTP username>
AUTH_SMTP_PASSWORD=<SMTP password>
AUTH_MAIL_FROM=Writer Studio <verified-sender@example.com>
SOURCE_DATABASE_URL=<Supabase source SQL connection string>
```

Port 465 dùng TLS; port khác bắt buộc STARTTLS. Giữ certificate verification. Sender phải được nhà cung cấp mail xác minh. Không gửi secret vào chat hoặc commit. SMTP chưa cấu hình thì đăng ký/reset/resend trả lỗi rõ ràng; không giả báo gửi thành công. Đăng nhập tài khoản đã import không cần gọi SMTP hoặc Supabase.

## Bước 2: chạy migration Auth riêng

Backup trước; trong Console /app của service Writer Studio:

```sh
npm run auth:migrate
```

Migration Auth có ledger/checksum và khóa giao dịch riêng, không sửa migration database 001 đã áp dụng, không yêu cầu chạy lại db:import.

## Bước 3: xác nhận và chuyển tài khoản

Supabase API bị quota không chứng minh SQL nguồn bị chặn. Dùng SOURCE_DATABASE_URL (database password, Session pooler nếu direct IPv6 không tới được), không dùng API key thay password.

```sh
npm run auth:scope -- --output=/tmp/writer-auth-scope.json
```

File mode 0600 chứa ID/email/role gợi ý, không chứa hash. **Auth Supabase dùng chung ở auth.users dù các app dùng schema dữ liệu riêng.** Chỉ giữ tài khoản Writer Studio, điền ownershipEvidence và xác minh admin. Không coi xác nhận ownership các bảng bài viết trước đó là xác nhận toàn bộ user.

Ví dụ cấu trúc (thay ID/email/identity bằng giá trị thực):

```json
{
  "project":"writer-studio",
  "sourceIdentity":"source-host:5432/postgres",
  "targetIdentity":"target-host:5432/railway",
  "users":[
    {"id":"00000000-0000-4000-8000-000000000001","email":"owner@example.com","role":"admin","ownershipEvidence":"Owner verified this account administers Writer Studio"}
  ]
}
```

ID/email phải khớp nguồn. Role là quyết định đã review trong manifest; importer không lấy quyền từ user_metadata. Cần ít nhất một admin active đã xác minh email trước chuyển provider.

```sh
npm run auth:import -- --scope=/tmp/writer-auth-scope.json
```

Sau khi dry-run đạt, đã backup và tạm đóng thao tác Auth Writer Studio trên nguồn:

```sh
npm run auth:import -- --scope=/tmp/writer-auth-scope.json --apply
```

Importer đọc snapshot READ ONLY, ghi target trong một transaction, giữ UUID/email/hash/created_at/trạng thái xác minh, kiểm tra từng bản ghi trước commit và từ chối ghi đè. Không chuyển session cũ. Nếu cần --allow-password-reset, cấu hình SMTP trước; user chưa xác minh email phải dùng resend-verification trước reset. Không đánh dấu email verified chỉ để đăng nhập được.

Không thể cô lập việc đổi password nguồn nếu cùng account còn dùng app khác: thống nhất thời điểm snapshot/cutover; password sau đó độc lập ở hai app. Không thay password hoặc thu hồi session nguồn của app kia.

## Bước 4: kiểm thử trên môi trường riêng

Chạy npm run check, npm --prefix backend test; browser test chạy trong CI desktop/mobile. Thử đăng nhập đúng/sai, refresh/reload, hai tab, token hết hạn, logout/logout-all, verify/reset một lần, user disabled, user thường không được quản trị. Gửi mail thật tới tài khoản thử để xác nhận SMTP và URL canonical; kiểm thử local không chứng minh email đã đến inbox.

Thử bài đơn/batch, lưu settings, approve/backtrack/regenerate và tải file với token mới. Không sửa workflow để bỏ Auth.

## Bước 5: cutover có kiểm soát

Giữ maintenance=true, allow-admin=false, chờ job cũ kết thúc. Sau import và kiểm thử, đặt:

```dotenv
AUTH_PROVIDER=postgres
WRITER_MAINTENANCE_MODE=true
WRITER_MAINTENANCE_ALLOW_ADMIN=true
```

Deploy. /health ghi authProvider; /health/dependencies phải có authProvider=postgres và authConnected=true. authConnected kiểm tra đọc bảng auth_users, không xác nhận SMTP inbox. Mở app, đăng nhập admin bằng mật khẩu nguồn đã import; token Supabase cũ bị từ chối và giao diện quay về đăng nhập. Kiểm tra các luồng trên, kiểm tra user thường vẫn bị maintenance chặn.

Sau khi đạt, đổi hai cờ maintenance về false và deploy. Public signup mặc định đóng; chỉ bật AUTH_ALLOW_SIGNUP=true sau kiểm tra gửi/xác minh email. Mọi user signup có role=user và chưa xác minh, không được đăng nhập trước xác minh.

API quản lý tài khoản: POST /api/auth/admin/user với Bearer access token admin, Origin canonical và JSON {id,role,status}. role=user|admin, status=active|disabled. Không vô hiệu hóa admin active cuối cùng; thay đổi thu hồi sessions của user đích và ghi audit. Giao diện có logout mọi thiết bị; quản trị account hiện qua API, chưa có màn hình quản lý account mới.

## Bước 6: vận hành và rollback

Lưu backup PostgreSQL, bảo vệ DB/private network. Xem audit qua tài khoản DB được phép; không ghi token/password trong log HTTP/proxy. Dọn định kỳ (không tự lên lịch):

```sh
npm run auth:cleanup
npm run auth:cleanup -- --apply
```

Lệnh mặc định chỉ đếm: session/token hết hạn hơn 7 ngày, rate-limit hết hạn hơn 1 ngày, audit quá 90 ngày. Chạy --apply theo chính sách retention đã chấp thuận. Không xóa user.

Trước khi có thay đổi Auth mới, rollback provider về Supabase chỉ khả thi nếu Supabase Auth hoạt động. Khi đã có user/password/role mới trên PostgreSQL, không rollback mù: freeze, backup và đối soát riêng; không có công cụ tự ghi ngược vào auth.users chung. Ưu tiên sửa tiến.

Auth PostgreSQL không gỡ chặn tải 7 file đang ở Supabase Storage. Supabase Query và các file chưa chuyển vẫn phụ thuộc nguồn. Giữ source credentials cho những chức năng đó; SOURCE_DATABASE_URL có thể gỡ khỏi service sau thời gian chuyển đổi và lưu riêng an toàn.

## Giới hạn kiểm chứng

Code/tests không thao tác production, không tự đổi Railway variables, không gửi email thật, không chứng minh quyền sở hữu từng tài khoản nguồn. Các bước cấu hình SMTP, review scope, import và đổi provider production do operator thực hiện riêng. MFA đang được chặn nhập, không phải đã hỗ trợ MFA thay thế.
