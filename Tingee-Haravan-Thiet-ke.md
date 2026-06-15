# Tài liệu phân tích & thiết kế: App tích hợp thanh toán Tingee × Haravan

> Phiên bản: 2.0 — Ngày: 15/06/2026
> Phạm vi: App giúp merchant Haravan thêm **một phương thức thanh toán QR (VietQR qua Tingee)** vào website. Khách chọn phương thức này → app sinh QR → khách chuyển tiền → Tingee bắn webhook báo thành công → app **tự động đánh dấu đơn "đã thanh toán"** trên Haravan. Mô hình bám đúng cách **SePay** làm cho Haravan.
> Mô hình kỹ thuật: **Private App + API Token tĩnh** (KHÔNG dùng OAuth public app). Merchant tự tạo Ứng dụng riêng trên Haravan, copy token đưa cho app.
> Môi trường Tingee: **PROD** — base URL `https://open-api.tingee.vn`. Loại QR: **QR tĩnh (VietQR)**.

> 📌 **Người mới đọc phần này trước:** Tài liệu gồm **§A — Hướng dẫn cầm tay chỉ việc** (giải thích từng khái niệm, từng bước cho người chưa biết gì) và **§1–§10 — đặc tả kỹ thuật**. Bắt đầu từ §A.

---

## ⚠️ Quyết định kiến trúc quan trọng nhất (đã chốt)

Mô hình bạn cần — "thêm 1 phương thức QR, tự xác nhận đơn" — **không cần OAuth, không cần làm cổng thanh toán native**. Đây là mô hình SePay dùng cho Haravan và đơn giản hơn nhiều so với hướng public app.

| | Public App + OAuth (KHÔNG dùng) | **Private App + Token (CHỌN cái này)** |
|---|---|---|
| Bạn phải code OAuth không? | Có, phức tạp | **Không** |
| Token lấy thế nào? | Luồng redirect / đổi code | **Merchant tự tạo trên Haravan Admin rồi copy** |
| App lưu gì về người dùng? | Token + định danh shop + session | **Chỉ token + cấu hình. Không session, không mật khẩu** |
| Phù hợp App Store công khai 1‑click | Có | Mỗi merchant tự tạo token (thủ công hơn) nhưng đúng nhu cầu |
| Độ phức tạp | Cao | **Thấp** |

**Cách Private App hoạt động (xác nhận từ docs Haravan):** Chỉ **chủ shop (Store owner)** mới tạo được Private App. Merchant vào Haravan Admin → tạo Ứng dụng riêng → cấp quyền **Đọc và ghi Đơn hàng** → nhận một **Token**. App của bạn gọi API Haravan bằng header `Authorization: Bearer {token}`. Không có redirect, không có đổi code, không có session.

---

## ⚠️ Một ràng buộc thực tế cần xác nhận: hiển thị QR cho khách

Đây là điểm **phải kiểm tra với Haravan/Tingee trước khi code**, vì nó quyết định phần frontend:

Cách SePay cũ làm: chèn **một đoạn code (script)** vào ô **"Nội dung thông báo thêm"** trong phần Thanh toán của Haravan, để khi khách chọn "Chuyển khoản ngân hàng" thì script gọi về SePay và render QR ngay trang đơn hàng. **Tài liệu SePay ghi rõ: bản MyHaravan mới không còn cho chèn script vào website.** SePay tích hợp cũ (trước khi đổi giao diện) vẫn chạy, nhưng tích hợp mới thì cách chèn script này bị siết.

→ **Hệ quả cho bạn:** phần *tự động xác nhận đơn qua API* (lõi nghiệp vụ) **không bị ảnh hưởng** và làm được 100%. Nhưng phần *hiển thị QR cho khách ngay trên trang Haravan* cần xác nhận cách làm hiện hành. Ba khả năng (xác nhận với Haravan):

1. **Trang trung gian do app bạn host** — phương thức thanh toán/hướng dẫn dẫn khách sang một URL của app bạn để hiện QR (an toàn, không phụ thuộc script Haravan).
2. **Script tag qua API** (nếu shop còn hỗ trợ) — Haravan có scope `web.write_script_tags`; cần kiểm tra giao diện mới có cho phép không.
3. **Cổng thanh toán native** — chỉ khi ký hợp tác trực tiếp với Haravan (ngoài phạm vi bản đơn giản này).

> Khuyến nghị: đi theo **(1) trang trung gian** để chủ động và không phụ thuộc chính sách script của Haravan.

---

# §A. HƯỚNG DẪN CẦM TAY CHỈ VIỆC (coi như bạn chưa biết gì)

## A.1. Toàn bộ ý tưởng trong 1 đoạn

Merchant cài app của bạn bằng cách tự tạo một "Ứng dụng riêng" trên Haravan và copy cái **Token** đưa cho app (giống đưa chìa khóa). Merchant cũng nhập `Client ID` + `Secret Token` của Tingee và chọn tài khoản ngân hàng nhận tiền. Sau đó: khách mua hàng, đến bước thanh toán chọn "Chuyển khoản QR", app sinh **mã QR ngân hàng** kèm một **mã đối soát** riêng cho đơn. Khách quét, chuyển tiền. Ngân hàng báo về Tingee, Tingee **bắn webhook** về app bạn. App đọc mã đối soát → biết đơn nào → dùng Token Haravan gọi API **đánh dấu đơn đã thanh toán**. Xong.

## A.2. Các "nhân vật"

- **Merchant**: chủ shop Haravan, cài app của bạn.
- **Khách hàng**: người mua, quét QR chuyển tiền.
- **Haravan**: nền tảng website bán hàng, quản lý đơn.
- **Tingee**: Open API ngân hàng — sinh QR và báo tiền về.
- **App của bạn**: middleware nối Haravan ↔ Tingee, tự động xác nhận thanh toán. Bạn đóng vai "SePay dùng Tingee".

## A.3. Chuẩn bị (tài khoản & công cụ)

**Tài khoản:**
1. **Tài khoản Tingee** (lấy `Client ID` + `Secret Token` tại `app.tingee.vn → Developers`). Test bằng UAT trước.
2. **Một shop Haravan để test** — bạn có thể đăng ký Haravan Partner (miễn phí) tạo **Dev Shop**, hoặc dùng shop thật.
3. Bạn **không cần** đăng ký "đối tác cổng thanh toán" với Haravan cho mô hình này.

**Công cụ:**
- **Node.js** (LTS) — chạy backend. Tải ở `nodejs.org`.
- **VS Code** — soạn code.
- **ngrok** (`ngrok.com`) — tạo URL HTTPS công khai trỏ về máy bạn, để Tingee bắn webhook về được khi dev. (Webhook bắt buộc HTTPS.)
- Một **database** — bắt đầu bằng SQLite cho dễ, lên production đổi PostgreSQL/MySQL.

**Khái niệm cần nắm sơ:**
- **API Token**: chuỗi bí mật merchant tạo trên Haravan, cho app bạn quyền đọc/ghi đơn hàng. Giữ như mật khẩu.
- **Webhook**: bên kia (Tingee) chủ động gọi về app bạn khi có sự kiện (tiền về), thay vì app phải liên tục hỏi.
- **HMAC / chữ ký**: con dấu toán học để verify webhook đến từ đúng Tingee, không bị giả mạo.
- **Mã đối soát**: chuỗi duy nhất app tự sinh cho mỗi đơn (vd `TG7K2P9`), nhúng vào nội dung chuyển khoản để sau biết tiền này của đơn nào.

## A.4. Lộ trình làm — từ số 0

**Giai đoạn 1 — Dựng môi trường**
- Cài Node.js, VS Code, ngrok. Tạo project Node.js rỗng. Tạo DB (SQLite).

**Giai đoạn 2 — Màn cấu hình của merchant** (§3)
- Làm form để merchant nhập: Haravan API Token, Tingee Client ID + Secret Token.
- Sau khi nhập Tingee, app gọi `get-va-paging` liệt kê tài khoản → merchant chọn tài khoản nhận tiền → lưu DB.

**Giai đoạn 3 — Sinh QR khi thanh toán** (§4)
- Khi có đơn cần trả qua Tingee: app sinh mã đối soát, gọi Tingee `generate-viet-qr`, hiển thị QR cho khách (qua trang trung gian do app host — xem ràng buộc ở trên).

**Giai đoạn 4 — Nhận tiền & xác nhận đơn** (§5)
- Đăng ký Webhook URL với Tingee. Khi tiền về: app verify chữ ký SHA512 → tra mã đối soát ra đơn → đối chiếu số tiền → gọi Haravan Transaction API đánh dấu "Capture/Sale, success" → đơn thành "Đã thanh toán".

**Giai đoạn 5 — Đối soát dự phòng & lỗi** (§7)
- Cron định kỳ gọi Tingee `transaction/get-paging` cho đơn còn treo; màn xử lý giao dịch lệch tiền / mất mã đối soát (gán tay).

**Giai đoạn 6 — Hoàn thiện**
- Hướng dẫn merchant cấu hình phương thức thanh toán "Chuyển khoản ngân hàng" trên Haravan (tên phải chứa "chuyển khoản" hoặc "VietQR" — theo kinh nghiệm SePay). Deploy lên server HTTPS thật.

## A.5. Vì sao mô hình này KHÔNG cần OAuth (so với câu hỏi trước của bạn)

OAuth chỉ cần khi app **tự cài lên nhiều shop qua App Store** và tự lấy token bằng luồng redirect/đăng nhập. Ở mô hình SePay‑style này, **merchant tự tay tạo token** trên Haravan Admin và đưa cho bạn — nên bạn bỏ qua hoàn toàn OAuth, session, quản lý danh tính người dùng. App của bạn **không lưu mật khẩu, không có đăng nhập người dùng**; nó chỉ cất Token + cấu hình rồi dùng để gọi API.

## A.6. Sai lầm hay mắc

- **Tưởng phải làm OAuth** → Không. Private App + token tĩnh là đủ.
- **Tự ký HMAC Tingee bằng tay** → dễ lỗi `97`. Dùng SDK `@tingee/sdk-node`.
- **Quên webhook phải HTTPS** → dùng ngrok khi dev.
- **Dùng `vaAccountNumber` để sinh QR** → sai. Dùng **số tài khoản thật** `accountNumber`.
- **Không verify chữ ký webhook Tingee** → ai cũng giả request báo "đã trả tiền". Luôn verify.
- **Tái dùng một mã đối soát cho nhiều đơn** → loạn đối soát. Mỗi đơn một mã.
- **Quên rằng MyHaravan mới siết chèn script** → dùng trang trung gian để hiện QR (xem ràng buộc đầu tài liệu).

---

# §1–§10. ĐẶC TẢ KỸ THUẬT

## 1. Mục tiêu & phạm vi

App trung gian giữa **Haravan** và **Tingee**, hai luồng:

1. **Cấu hình** — merchant cung cấp Haravan API Token + Tingee credentials, chọn tài khoản nhận tiền.
2. **Thanh toán** — khách chọn QR Tingee → app sinh QR + mã đối soát → khách trả → Tingee webhook → app đánh dấu đơn paid qua Haravan Transaction API.

## 2. Khác biệt cốt lõi: Tingee vs SePay

| Tiêu chí | SePay | Tingee (Open API) |
|---|---|---|
| Cấu hình | Thủ công trên `my.sepay.vn` | App của bạn gọi **API Tingee bằng Client ID + Secret Token** |
| Xác thực request | API Token (Bearer) | **HMAC‑SHA512** mỗi request: `x-signature = HMAC_SHA512(timestamp + ":" + JSON.stringify(body), secretToken)` + headers `x-client-id`, `x-request-timestamp` (`yyyyMMddHHmmssSSS`, UTC+7) |
| Nguồn QR | SePay tự render | App gọi `/v1/generate-viet-qr` lấy chuỗi QR + ảnh base64; QR tĩnh không có `billId` → đối soát theo nội dung + số tiền |
| Webhook | SePay → hệ thống bạn | Tingee → URL bạn đăng ký; verify chữ ký, trả `{"code":"00"}` |
| Cập nhật đơn | SePay hoặc bạn | **App của bạn** gọi Haravan Transaction API |

**Kết luận:** Bạn tự xây toàn bộ middleware mà SePay làm sẵn — nhưng với Haravan thì dùng **token tĩnh**, không cần OAuth.

## 3. Luồng 1 — Cấu hình (merchant kết nối Haravan + Tingee)

### 3.1. Merchant tạo Private App trên Haravan & lấy Token
Theo docs Haravan (chỉ **Store owner** làm được):
1. Haravan Admin → **Ứng dụng** → **Ứng dụng riêng** → **Tạo ứng dụng riêng** (tên vd "Tích hợp Tingee").
2. Tại **Các quyền quản trị API**: dòng **Đơn hàng** chọn **Đọc và ghi** (`com.read_orders`, `com.write_orders`). Các quyền khác để **Không có quyền**.
3. Tạo xong → màn App details hiện **Token**. Copy token này.
4. Dán token vào màn cấu hình app của bạn → app lưu vào DB.

> Cách dùng token: mọi request gọi Haravan API kèm header `Authorization: Bearer {token}`, base URL `https://apis.haravan.com/com/...`.

### 3.2. Merchant nhập credentials Tingee & chọn tài khoản
1. Merchant lấy `Client ID` + `Secret Token` tại `app.tingee.vn → Developers`. Cũng tại đây cấu hình **Webhook URL** trỏ về endpoint app của bạn.
2. App ký HMAC‑SHA512 và gọi `POST /v1/get-va-paging` liệt kê tài khoản (VA).
3. Merchant chọn tài khoản nhận tiền. App lưu `accountNumber` + `bankBin` (2 trường cần để sinh QR).
4. (Tùy ngân hàng, vd ACB) app gọi `register-notify` + `confirm-register-notify`.

### 3.3. Sinh chữ ký Tingee (bắt buộc mọi request)
```
x-signature = HMAC_SHA512( x-request-timestamp + ":" + JSON.stringify(body), secretToken )
```
- `x-request-timestamp`: `yyyyMMddHHmmssSSS`, **UTC+7**, không cũ quá 10 phút.
- `body`: JSON **minified**. Headers: `x-client-id`, `x-request-timestamp`, `x-signature`, `Content-Type: application/json`.
- Dùng SDK `@tingee/sdk-node` để khỏi tự ký (tránh lỗi `97`).

### 3.4. `POST /v1/get-va-paging`
Request: `{ "filter": "", "skipCount": 0, "maxResultCount": 50, "bankBin": "", "accountType": "" }`
Response (rút gọn):
```json
{ "code": "00", "data": { "items": [
  { "bankBin": "970418", "accountName": "LE DUY NGHIEM",
    "accountNumber": "0123456789111", "vaAccountNumber": "VQRQAHFVA0551", "status": "active" }
]}}
```

## 4. Luồng 2 — Thanh toán & sinh QR

```
Khách checkout trên Haravan → chọn "Chuyển khoản QR (Tingee)"
   │ 1. App nhận đơn cần trả (orderId, amount)
   │ 2. App sinh MÃ ĐỐI SOÁT duy nhất (vd "TG7K2P9"), lưu mapping (mã + amount → orderId)
   │ 3. App gọi Tingee: POST /v1/generate-viet-qr { bankBin, accountNumber, amount, content:"TG7K2P9" }
   ▼
Tingee → { qrCode, qrCodeImage(base64) }
   │ 4. App hiển thị QR cho khách (qua trang trung gian app host) + chờ (polling/SSE)
   ▼
Khách quét & chuyển tiền (giữ nguyên nội dung CK = mã đối soát)
```

### 4.1. `POST /v1/generate-viet-qr`
Body: `{ "bankBin": "970418", "accountNumber": "21510002865945", "amount": 500000, "content": "TG7K2P9" }`
Response: `{ "code": "00", "data": { "qrCode": "0002010102...", "qrCodeImage": "data:image/png;base64,..." } }`
- `accountNumber` = **số tài khoản thật** của VA (không phải `vaAccountNumber`).
- QR tĩnh không có `billId` → mỗi đơn một **mã đối soát** riêng nhúng vào `content`. **Không tái dùng** mã cho 2 đơn.

## 5. Nhận webhook Tingee & đánh dấu đơn paid

```
Tingee → POST webhook IPN về App
   │ 1. Verify x-signature (SHA512), đọc content + amount
   │ 2. Idempotency theo transactionCode (Tingee retry tối đa 5 lần)
   │ 3. Trích mã đối soát từ content (regex TG[A-Z0-9]+) → ra orderId
   │ 4. Đối chiếu amount; lệch → mismatch (§7)
   ▼
App → Haravan: POST /com/orders/{orderId}/transactions.json
   │    Header: Authorization: Bearer {token}
   │    Body: { "transaction": { "kind": "Capture", "amount": 500000 } }
   │ 5. Đơn chuyển "Đã thanh toán"
   │ 6. App phản hồi Tingee { "code":"00", "message":"Success" }
```

### 5.1. IPN Tingee — `POST {webhookUrl}`
Headers: `x-request-id`, `x-request-timestamp`, `x-signature`. Body (rút gọn):
```json
{ "transactionCode": "FT25...", "amount": 500000, "content": "TG7K2P9 chuyen tien",
  "bank": "BIDV", "accountNumber": "21510002865945", "transactionDate": "20260612101122" }
```
Verify: `HMAC_SHA512(timestamp + ":" + JSON.stringify(body), secretToken)` so với `x-signature`. Sai → bỏ. Trả HTTP 200 `{ "code":"00", "message":"Success" }`.

### 5.2. Đánh dấu đơn paid — Haravan Transaction API
- Endpoint: `POST https://apis.haravan.com/com/orders/{order_id}/transactions.json`
- Header: `Authorization: Bearer {token}`, `Content-Type: application/json`
- Body: `{ "transaction": { "amount": 500000, "kind": "Capture" } }`
- `kind`: `Capture` (chuyển tiền đã reserve) hoặc `Sale` (authorize+capture một bước). Đơn đang `Pending` → tạo transaction này với `status: success` để chuyển sang đã thanh toán.
- Response 201 trả transaction mới (có `id`, `parent_id`). Lưu `id` vào DB.

## 6. Mô hình dữ liệu (đề xuất)

> Đơn giản vì không có OAuth/session. Bắt đầu SQLite, production dùng PostgreSQL/MySQL.

```
merchants
  id (pk)
  haravan_shop_domain        -- vd: mystore.myharavan.com
  haravan_api_token (encrypted)  -- token Private App merchant đưa, mã hóa at-rest
  created_at

tingee_configs
  id (pk)
  merchant_id (fk)
  client_id
  secret_token (encrypted)   -- dùng ký request + verify IPN
  status                     -- active / pending
  created_at

tingee_accounts             -- VA merchant chọn nhận tiền
  id (pk)
  tingee_config_id (fk)
  va_account_number
  account_number            -- số TK thật, dùng generate-viet-qr
  bank_bin
  account_name
  is_default
  notify_registered (bool)

payments
  id (pk)
  merchant_id (fk)
  haravan_order_id
  reconcile_code (unique)     -- mã đối soát nhúng vào content QR
  qr_code (text)
  qr_code_image (text)
  amount
  status                      -- pending / paid / mismatch / expired / manual_matched
  tingee_transaction_code     -- để idempotency
  haravan_transaction_id      -- id transaction đã tạo trên Haravan
  created_at, paid_at

webhook_events (nên thêm sớm)  -- lưu payload + header thô mọi IPN (audit + idempotency)
  id (pk)
  tingee_transaction_code
  raw_headers (json), raw_body (json)
  matched_payment_id (fk, nullable)   -- null = giao dịch chưa khớp đơn nào → xử lý tay
  received_at
```

> Bảo mật: **token Haravan & Secret Token Tingee mã hóa at-rest**; không log; chỉ giải mã khi dùng.

## 7. Rủi ro & xử lý

| Rủi ro | Cách xử lý |
|---|---|
| **MyHaravan mới siết chèn script** | Hiện QR qua **trang trung gian app host**, không phụ thuộc script Haravan |
| **Khách sửa số tiền/nội dung QR tĩnh** | Đối chiếu cả **mã đối soát** và **amount**; chỉ auto‑paid khi cả hai khớp; lệch → `mismatch` |
| **Khách xóa/đổi mã đối soát** | Hướng dẫn "giữ nguyên nội dung CK"; fallback theo amount + thời gian + TK nhận; màn gán tay |
| **Trùng số tiền nhiều đơn** | Mã đối soát duy nhất mỗi đơn là khóa chính |
| **Webhook Tingee trùng (retry)** | Idempotency theo `transactionCode` |
| **Webhook Tingee giả mạo** | Verify `x-signature` SHA512; sai → bỏ |
| **Sai timestamp Tingee (code 90/91)** | Đồng bộ NTP, UTC+7, không cũ quá 10 phút |
| **Sai chữ ký request (code 97)** | Dùng SDK; body minified |
| **QR tĩnh không tự hết hạn** | App tự đặt timeout mỗi đơn (vd 15'); trả trễ vẫn đối soát theo mã nhưng cảnh báo |
| **Token Haravan bị merchant xóa/đổi** | Bắt lỗi 401 khi gọi API → báo merchant cập nhật token mới |
| **Tên phương thức thanh toán sai** | Tên phải chứa "chuyển khoản" hoặc "VietQR" (theo kinh nghiệm SePay) thì web mới hiện thông tin thanh toán |

## 8. Danh mục endpoint

**Tingee** (PROD `https://open-api.tingee.vn`):

| Mục đích | Endpoint |
|---|---|
| Liệt kê VA | `POST /v1/get-va-paging` |
| Danh sách ngân hàng | `POST /v1/get-banks` |
| Đăng ký nhận biến động | `POST /v1/register-notify` |
| Xác nhận đăng ký | `POST /v1/confirm-register-notify` |
| **Sinh QR tĩnh** | `POST /v1/generate-viet-qr` |
| Lịch sử giao dịch (fallback) | `POST /v1/transaction/get-paging` |
| Webhook IPN | (URL của bạn, đăng ký ở trang Developers Tingee) |

**Haravan**:

| Mục đích | Endpoint | Ghi chú |
|---|---|---|
| Lấy đơn hàng | `GET https://apis.haravan.com/com/orders/{id}.json` | Bearer token |
| **Đánh dấu paid** | `POST https://apis.haravan.com/com/orders/{id}/transactions.json` | body `{transaction:{kind:"Capture",amount}}` |
| Thông tin shop | `GET https://apis.haravan.com/com/shop.json` | kiểm tra token hợp lệ |

> Dùng QR tĩnh nên **không gọi** `generate-dynamic-qr`. Đối soát dựa vào IPN + (fallback) `transaction/get-paging`.

## 9. Roadmap triển khai

1. Dựng project Node.js + DB (SQLite). Cài `@tingee/sdk-node`, ngrok.
2. Màn cấu hình: nhập Haravan Token + Tingee credentials → `get-va-paging` → chọn VA → lưu. Kiểm tra token Haravan hợp lệ bằng `GET /com/shop.json`.
3. Sinh QR: mã đối soát → `generate-viet-qr` → render QR qua trang trung gian + trạng thái chờ.
4. Webhook Tingee: verify SHA512, idempotency, đối soát mã + amount.
5. Đánh dấu paid: `POST /com/orders/{id}/transactions.json` (`kind: Capture`).
6. Fallback: cron `transaction/get-paging` cho đơn pending; màn xử lý `mismatch`.
7. Hướng dẫn merchant cấu hình phương thức "Chuyển khoản ngân hàng" + trỏ tới trang QR. Xác nhận cách hiện QR với Haravan (script vs trang trung gian).
8. Test UAT Tingee + shop test Haravan → đổi sang PROD → deploy HTTPS.

## 10. Lộ trình nâng cấp

**10.1. Lên QR động (khi Tingee hỗ trợ đầy đủ)**
- Thay `generate-viet-qr` bằng `generate-dynamic-qr` (`{ vaAccountNumber, qrCodeType:"dynamic-one-time-payment", bankBin, amount, purpose, expireInMinute }`) → nhận `billId`.
- Đổi khóa đối soát từ `reconcile_code` (content) sang `billId` (trong `additionalData` IPN) — chính xác tuyệt đối, không lo khách sửa nội dung.
- Tách lớp `QrStrategy` (static/dynamic) trong `TingeeService` từ đầu để switch dễ.

**10.2. Nếu sau này muốn lên App Store công khai / cổng native**
- Mới cần chuyển sang **OAuth public app** (tự cài nhiều shop) hoặc **ký hợp tác cổng thanh toán** với Haravan. Khi đó chỉ thay lớp auth + lớp `OrderReconcile`; luồng Tingee và sinh QR giữ nguyên.

---

## Nguồn tham khảo

**Haravan:**
- Private app authentication (tạo Private App, Token, header Bearer): https://docs.haravan.com/docs/tutorials/authentication/private-app-authentication/
- Transaction API (đánh dấu đơn paid): https://docs.haravan.com/docs/omni-apis/transactions/
- AccessScope (com.read_orders / com.write_orders): https://docs.haravan.com/docs/omni-apis/access-scopes/
- Order API: https://docs.haravan.com/docs/omni-apis/orders/

**SePay (mô hình tham chiếu cho Haravan):**
- Hướng dẫn tích hợp Haravan (Private App + token, thêm phương thức chuyển khoản): https://docs.sepay.vn/tich-hop-haravan.html
- Hướng dẫn tích hợp Shopify (đối chiếu): https://docs.sepay.vn/tich-hop-shopify.html
- Video demo kết quả: https://www.youtube.com/watch?v=0VXRZECEPdI
- Video hướng dẫn tích hợp: https://www.youtube.com/watch?v=_tENP5j3Y50

**Tingee:**
- Bắt đầu ngay (Client ID, Secret Token, ký HMAC, webhook): https://developers.tingee.vn/docs/config-info
- get-va-paging: https://developers.tingee.vn/docs/banking/get-va-paging
- register-notify: https://developers.tingee.vn/docs/banking/register-notify
- generate-viet-qr (QR tĩnh): https://developers.tingee.vn/docs/qr/static/generate-viet-qr
- Webhook thanh toán (IPN): https://developers.tingee.vn/docs/webhook/webhook-payment-callback
- SDK: https://developers.tingee.vn/sdk/
