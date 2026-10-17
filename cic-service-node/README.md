# cic-service-node

Bản Node.js của `cic-service`, dữ liệu lưu trong **file JSON** thay vì PostgreSQL,
deploy được lên Vercel.

Giữ nguyên **100% contract API** và **công thức chấm điểm** của bản Java: `finora-ai`
và `cic-web` trỏ sang bản này không phải sửa một dòng nào.

---

## Chạy nhanh

```bash
npm install
npm start           # http://localhost:9000
npm test            # 177 test (1 test đang đỏ chờ Hải sửa dữ liệu thử — xem B66 ở mục Tích hợp FINORA)
```

Không cần cài PostgreSQL, không cần Docker, không cần biến môi trường nào.

```bash
curl "http://localhost:9000/api/v1/diem-tin-dung/079081000001?chiTiet=true"
```

---

## Bằng chứng tương đương với bản Java

Đây là điều quan trọng nhất của bản port, nên nó được kiểm bằng máy chứ không bằng lời:

| Kiểm chứng | Kết quả |
|---|---|
| 1000 hồ sơ seed chấm bằng **chính lớp `BoTinhDiem.java`** rồi so với bản Node | **1000/1000 trùng khớp tuyệt đối** |
| 10 persona hiệu chuẩn so với dải kỳ vọng trong `persona.json` | 10/10 đúng dải |
| `tests/credit/test_cic_client.py` của finora-ai | 6/6 pass |
| `CicClient` thật của finora-ai gọi vào service này | 10/10 trường trả đúng |

File `test/diem-java-goc.txt` là output của bản Java, được commit kèm và dùng làm mốc
đối chiếu trong `test/cham-diem.test.js`. Sửa bất kỳ hằng số hay công thức nào làm lệch
một hồ sơ thôi là test đỏ ngay.

Tái tạo lại mốc đối chiếu (cần JDK 21 + jar Lombok/Spring trong cache Gradle):

```bash
javac -encoding UTF-8 -cp "$CP" -d out \
  ../cic-service/src/main/java/iuh/fit/se/cicservice/config/ThamSoChamDiem.java \
  ../cic-service/src/main/java/iuh/fit/se/cicservice/domain/HoSoTinDung.java \
  ../cic-service/src/main/java/iuh/fit/se/cicservice/support/chamdiem/*.java \
  DoiChieu.java
java -cp "out;$CP" DoiChieu dulieu/du-lieu.json > test/diem-java-goc.txt
```

---

## 8 endpoint — giống hệt bản Java

| Method | Đường dẫn | Ghi chú |
|---|---|---|
| GET | `/api/v1/diem-tin-dung/{soCccd}` | Endpoint chính. `?chiTiet=true` trả kèm phân rã 5 nhóm + 10 trường thô |
| GET | `/api/v1/ho-so` | Danh sách hiện hành. `?tuKhoa= &nhomNo= &trang= &kichThuoc=` |
| GET | `/api/v1/ho-so/{soCccd}` | Hồ sơ thô, phiên bản mới nhất |
| GET | `/api/v1/ho-so/{soCccd}/lich-su` | Toàn bộ phiên bản, cũ → mới |
| POST | `/api/v1/ho-so` | Thêm phiên bản mới (`phienBan = max + 1`) |
| GET | `/api/v1/nhat-ky` | `?soCccd= &tu= &den=` (ngày dạng `yyyy-MM-dd`) |
| GET | `/api/v1/thong-ke` | Thống kê phục vụ bảng điều khiển |
| GET | `/api/v1/cau-hinh` | Cấu hình bộ tính điểm, chỉ đọc |

`/actuator/health` giữ nguyên đường dẫn của Spring Boot để `cic-web` không phải sửa gì.

Ngoài 8 endpoint công khai còn một endpoint nội bộ có khoá cho FINORA,
`POST /api/v1/internal/borrower-mappings` — xem mục [Tích hợp FINORA](#tích-hợp-finora--kênh-báo-cáo-quá-hạn-mô-phỏng).

Bốn mã lỗi giữ nguyên: `CCCD_KHONG_HOP_LE`, `DU_LIEU_KHONG_HOP_LE`,
`CIC_KHONG_KHA_DUNG`, `LOI_HE_THONG`. Mọi lỗi đều có hình dạng `{maLoi, thongDiep}`.
Riêng endpoint nội bộ có thêm mã `KHO_LUU_TRU_CONG_KHAI` (503), không xuất hiện ở
8 endpoint công khai.

**Không có nhánh nào trả 404 cho CCCD chưa tồn tại** — hệ thống dựng hồ sơ tín dụng mới
và trả 200, y như bản Java.

---

## Dữ liệu trong file JSON

Toàn bộ dữ liệu nằm trong `dulieu/du-lieu.json`, đúng 1000 hồ sơ seed chuyển từ
`V2__seed_ho_so_tin_dung.sql` (10 persona + 1 hồ sơ demo + 959 bản sinh + 30 phiên bản 2):

```json
{
  "hoSoTinDung": [ { "id": 1, "soCccd": "079081000001", "phienBan": 1, ... } ],
  "nhatKyTraCuu": [ { "id": 1, "soCccd": "...", "diemTraVe": 735, ... } ],
  "lienKetNguoiVay": [ { "id": 1, "borrowerId": "45", "soCccd": "...", "createdAt": "..." } ],
  "suKienDaXuLy": [ { "id": 1, "eventId": "...", "eventType": "LoanDelinquencyChanged", ... } ],
  "suKienQuaHanChoXuLy": [ { "id": 1, "eventId": "...", "borrowerId": "45", ... } ]
}
```

Ba collection cuối phục vụ tích hợp FINORA; tài liệu cũ chỉ có hai collection đầu vẫn
đọc được (thiếu thì được bổ sung rỗng trong bộ nhớ, không ghi đè seed chỉ vì đọc).

Sinh lại từ file SQL gốc: `npm run sinh-seed`.

### Thêm / sửa / xoá

Bảng `hoSoTinDung` là **chỉ ghi thêm** (append-only), đúng thiết kế bản Java:

- **Thêm** một CCCD mới → `POST /api/v1/ho-so`, tạo `phienBan = 1`.
- **"Sửa"** một CCCD → cũng là `POST /api/v1/ho-so`, tạo `phienBan = max + 1`. Dòng cũ
  còn nguyên, tra cứu luôn dùng phiên bản mới nhất. Đây là *cách sửa* của mô hình này:
  lịch sử không bao giờ mất, và điểm cũ vẫn tra lại được qua `/lich-su`.
- **Xoá** → bản Java cố tình không có, và bản này giữ nguyên như vậy. Hồ sơ tín dụng là
  dữ liệu có tính lịch sử; xoá một dòng làm hỏng chính thứ mà bảng này tồn tại để giữ.
  Cần bỏ dữ liệu thì sửa thẳng `dulieu/du-lieu.json` rồi khởi động lại.

Mọi thao tác ghi đều được xếp hàng tuần tự và ghi qua file tạm rồi `rename`, nên tiến
trình chết giữa chừng không để lại file JSON cụt. Lượt ghi nào hỏng (lỗi nghiệp vụ hoặc
ghi xuống nguồn thất bại) thì bộ nhớ đệm bị bỏ, lượt sau đọc lại đúng trạng thái đã bền
vững.

`npm start` mặc định ghi **thẳng vào `dulieu/du-lieu.json`**. Khi thử nghiệm (nhất là
E2E với FINORA) hãy trỏ `CIC_TEP_DU_LIEU` sang một bản sao, nếu không mốc đối chiếu
1000 hồ sơ trong `test/cham-diem.test.js` sẽ đỏ.

---

## Deploy lên Vercel

### Vấn đề phải biết trước

Filesystem của Vercel là **chỉ đọc**; chỉ `/tmp` ghi được và `/tmp` **mất sau mỗi cold
start**. Nên nếu chỉ ghi file JSON thuần thì trên Vercel: đọc và chấm điểm vẫn đúng
tuyệt đối, nhưng dữ liệu thêm/sửa sẽ biến mất sau vài phút.

### Cách xử lý

Service có hai driver lưu trữ, tự chọn theo môi trường — code nghiệp vụ không hề biết:

| Driver | Khi nào dùng | Ghi có bền không |
|---|---|---|
| `tep` | Chạy local (mặc định) | Bền — ghi thẳng `dulieu/du-lieu.json` |
| `blob` | Có `BLOB_READ_WRITE_TOKEN` | Bền — ghi Vercel Blob |

Các bước:

1. Đẩy thư mục này lên GitHub, import vào Vercel.
2. Vào **Storage → Create Database → Blob**, connect vào project. Vercel tự gắn biến
   `BLOB_READ_WRITE_TOKEN`.
3. Deploy. Lần chạy đầu service tự nạp `dulieu/du-lieu.json` làm seed vào Blob; từ đó
   mọi thêm/sửa đều ghi vào Blob và **sống qua cold start lẫn deploy mới**.

Bỏ qua bước 2 thì service vẫn chạy và đọc đúng, chỉ là dữ liệu ghi mới không bền —
đủ dùng nếu Vercel chỉ để demo phần đọc.

Kiểm tra đang dùng driver nào: `GET /actuator/health` trả `{"kho": "tep" | "blob"}`.

---

## Biến môi trường

Xem `.env.example`. Không biến nào bắt buộc khi chạy local.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CIC_PORT` | `9000` | Cổng HTTP |
| `CIC_KHO` | tự đoán | `tep` hoặc `blob` |
| `CIC_TEP_DU_LIEU` | `dulieu/du-lieu.json` | Đường dẫn file khi dùng driver `tep` |
| `CIC_TEN_BLOB` | `cic/du-lieu.json` | Tên object trong Blob store |
| `CIC_MO_PHONG_DO_TRE_MS` | `0` | Chèn độ trễ nhân tạo vào mỗi request |
| `CIC_MO_PHONG_TY_LE_LOI` | `0.0` | Tỉ lệ request trả 503, trong `[0, 1]` |

Biến của tích hợp FINORA (khoá nội bộ, chính sách nợ xấu, Kafka): xem
[bảng riêng](#biến-môi-trường-của-tích-hợp).

---

## Cấu trúc

```
src/
  cau-hinh.js              trọng số + ngưỡng, kiểm tra lúc khởi động; cấu hình tích hợp FINORA
  app.js                   8 endpoint + endpoint nội bộ + xử lý lỗi
  server.js                khởi động local (+ consumer Kafka nếu bật, dừng an toàn)
  cham-diem/
    bo-tinh-diem.js        bộ tính điểm 5 nhóm — KHÔNG import gì về thời gian thực
    noi-suy.js             nội suy tuyến tính trên đường gấp khúc
  du-lieu/
    kho-luu-tru.js         driver tep / blob, ghi tuần tự
    kho-ho-so.js           truy vấn (thay repository JPA)
  dich-vu/
    tra-cuu.js  ho-so.js  nhat-ky.js  thong-ke.js
    tich-hop-finora.js     liên kết borrowerId ↔ CCCD, LoanDelinquencyChanged.v1
  messaging/
    loan-delinquency-changed.js   parser + consumer KafkaJS (thử lại/DLT)
  ho-tro/
    ngay.js  loi.js  kiem-tra-cccd.js
api/index.js               điểm vào Vercel serverless (không bao giờ nạp Kafka)
dulieu/du-lieu.json        1000 hồ sơ seed
test/                      177 test, gồm mốc đối chiếu với bản Java
tools/chuyen-seed.mjs      sinh lại du-lieu.json từ file SQL gốc
```

---

## Hai bất biến không được phá

**1. Điểm là hàm thuần của hồ sơ.** `src/cham-diem/` không import gì liên quan tới thời
gian thực. Ngày tham chiếu là `hieuLucTu` của chính bản ghi, nên cùng một phiên bản hồ
sơ tra hôm nay hay sang năm cũng ra đúng một con số. Điểm **không** được lưu ở đâu cả,
luôn tính lại — nên không thể có chuyện dữ liệu và điểm lệch nhau.

**2. Số ngẫu nhiên chỉ tồn tại ở tầng mô phỏng sự cố** trong `app.js`, hoàn toàn ngoài
bộ tính điểm. Request nào đi qua được thì vẫn nhận đúng con số như khi tắt mô phỏng.
Mặc định tắt, khi đó toàn hệ thống không có ngẫu nhiên nào.

---

## Quan hệ với bản Java

Hai bản **chạy song song**, `cic-service` (Java + PostgreSQL) vẫn còn nguyên. Cùng
contract nên `finora-ai` chuyển qua lại chỉ bằng một biến môi trường:

```bash
CIC_SERVICE_URL=http://localhost:9000   # bản nào cũng được
```

Khác biệt ngoài contract: bản Node bật CORS cho mọi origin (bản Java không bật,
vì `cic-web` đi qua proxy của Vite). Cần thiết vì trên Vercel giao diện có thể nằm khác
origin; dữ liệu seed vốn là dữ liệu mô phỏng. Lưu ý: khi nối với FINORA, CCCD thật từ
eKYC có thể đi vào service (qua tra cứu điểm và endpoint liên kết) — xem
[Bảo mật](#bảo-mật-cccd-thật-và-vercel-blob-công-khai).

---

## Tích hợp FINORA — kênh báo cáo quá hạn MÔ PHỎNG

> **Hải review trước merge.** Phần này hoàn thành Task 2–4 của plan
> `docs/superpowers/plans/2026-10-11-cic-service-parity.md` trên nhánh
> `feat/finora-delinquency-intake` (Thái uỷ quyền), port từ `cic-service` bản Java.

**Đây không phải báo cáo CIC thật.** CIC thật nhận dữ liệu do tổ chức tín dụng chủ động
gửi theo lịch và biểu mẫu do Ngân hàng Nhà nước quy định. Ở đây Loan của FINORA phát sự
kiện `LoanDelinquencyChanged.v1` và bản mock tự ghi thêm một phiên bản hồ sơ để *mô
phỏng* việc đã báo cáo. Mốc tạm khoá 12 tháng và thẩm định thủ công 24 tháng sau khi
khắc phục nợ xấu là **chính sách rủi ro nội bộ của FINORA**, không phải thời hạn cấm vay
do pháp luật ấn định.

```
finora-user (eKYC xong) ─ POST /api/v1/internal/borrower-mappings ─► lienKetNguoiVay
finora-loan (DPD đổi)   ─ Kafka finora.loan.delinquency-changed ──► hoSoTinDung (+1 phiên bản)
                                                  sai / hết lượt thử ─► <topic>.DLT
```

- Event không mang CCCD, chỉ mang `borrowerId` (= `user_profiles.id`). CCCD chỉ đi qua
  endpoint nội bộ có khoá.
- Event đến trước liên kết được giữ trong `suKienQuaHanChoXuLy` và phát lại theo
  `occurredAt` (hoà thì theo thứ tự nhận) ngay khi liên kết được tạo.
- Trùng `eventId` (đang chờ hay đã xử lý) không tạo phiên bản thứ hai.
- Hồ sơ đã có: chỉ cập nhật lịch sử quá hạn và nhóm nợ, **giữ nguyên** dư nợ, hạn mức, số
  hợp đồng, số loại sản phẩm. `nhomNoCaoNhat` là max lịch sử; `nhomNoHienTai` là nhóm
  của event; nhóm 3–5 về 1–2 thì mở `ngayKhacPhucNoXau`, `tamKhoaVayDen`,
  `thamDinhThuCongDen`.
- Thứ tự giữ đúng bản Java: event trực tiếp áp theo thứ tự đến, không có chốt bỏ event
  cũ hơn `dataAsOf`.

### Endpoint nội bộ

`POST /api/v1/internal/borrower-mappings`, header `X-Finora-Internal-Key`, thân
`{"borrowerId": "45", "soCccd": "<12 chữ số>"}`.

| Tình huống | HTTP | `maLoi` | `CicMappingWorker` của FINORA |
|---|---|---|---|
| Tạo mới | 201 | — | xong |
| Gửi lại đúng cặp (idempotent, giữ `createdAt` gốc) | 201 | — | xong |
| borrowerId đã gắn CCCD khác, hoặc CCCD đã gắn borrowerId khác | 400 | `DU_LIEU_KHONG_HOP_LE` | dừng hẳn |
| Thân sai (CCCD không đúng 12 chữ số, borrowerId rỗng/quá 100 ký tự, JSON hỏng) | 400 | `DU_LIEU_KHONG_HOP_LE` | dừng hẳn |
| Chưa cấu hình `CIC_INTERNAL_API_KEY` (endpoint đóng), thiếu hoặc sai khoá | 403 | `DU_LIEU_KHONG_HOP_LE` | thử lại |
| Kho là Vercel Blob công khai | 503 | `KHO_LUU_TRU_CONG_KHAI` | thử lại |
| Phát lại event chờ vi phạm ràng buộc hồ sơ (thao tác huỷ trọn vẹn) | 500 | `LOI_HE_THONG` | thử lại |

Phản hồi thành công `{borrowerId, soCccdDaChe: "079*******34", soSuKienDaPhatLai, createdAt}`
không bao giờ có CCCD thô; thông điệp lỗi không lặp lại CCCD; log chỉ ghi `borrowerId`.
Khoá được so bằng `crypto.timingSafeEqual` trên SHA-256 của hai phía và được kiểm
**trước** khi đọc thân request.

### Consumer Kafka (tuỳ chọn)

- Chỉ `npm start` (`src/server.js`) khởi động consumer, và chỉ khi
  `CIC_KAFKA_CONSUMER_ENABLED=true`; bật mà không kết nối được broker thì tiến trình
  dừng ngay lúc khởi động. Bản deploy Vercel (`api/index.js`) **không bao giờ** consume
  Kafka — function serverless không giữ được kết nối lâu dài, và Vercel không với tới
  Kafka local của FINORA.
- Tin nhắn sai envelope/header/schema → `<topic>.DLT` ngay, không thử lại. Lỗi tạm thời
  → thử lại 2 lần, cách 1 giây, rồi vào DLT. Offset chỉ được commit sau khi xử lý xong
  hoặc đã ghi DLT thành công.
- Bản ghi DLT giữ nguyên key/value/header gốc, thêm header kiểu Spring Kafka
  (`kafka_dlt-original-topic/-partition/-offset/-timestamp/-consumer-group`,
  `kafka_dlt-exception-fqcn/-message`) và `cic-dlt-phan-loai` (`KHONG_HOP_LE` hoặc
  `HET_LUOT_THU_LAI`).
- `Ctrl+C`/SIGTERM: thôi nhận HTTP, chờ tin nhắn đang xử lý xong, rời group, đóng
  producer DLT. Windows không chuyển SIGTERM giữa các tiến trình nên hãy `Ctrl+C` ở cửa
  sổ đang chạy. Dừng giữa chừng thì tin nhắn đang dở có thể được giao lại — `eventId`
  chặn trùng.

### Biến môi trường của tích hợp

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `CIC_INTERNAL_API_KEY` | rỗng | Khoá dịch vụ của endpoint nội bộ; rỗng = endpoint đóng (403). Không commit giá trị thật |
| `CIC_BAD_DEBT_COOLDOWN_MONTHS` | `12` | Số tháng tạm khoá sau khi khắc phục nợ xấu (chính sách nội bộ FINORA) |
| `CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS` | `24` | Số tháng bắt buộc thẩm định thủ công; không được nhỏ hơn số tháng tạm khoá |
| `CIC_KAFKA_CONSUMER_ENABLED` | `false` | `true` thì `npm start` consume Kafka |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Danh sách broker, cách nhau bằng dấu phẩy |
| `CIC_LOAN_DELINQUENCY_GROUP` | `cic-loan-delinquency` | Consumer group |
| `LOAN_DELINQUENCY_CHANGED_TOPIC` | `finora.loan.delinquency-changed` | Topic nguồn; DLT là `<topic>.DLT` |
| `CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI` | `false` | `true` mới cho lưu liên kết CCCD khi kho là Blob công khai — chỉ dùng với dữ liệu giả lập |

### Chạy local cho E2E của FINORA

```powershell
# PowerShell, trong thư mục cic-service-node. Dùng bản sao dữ liệu (xem mục Dữ liệu).
Copy-Item dulieu/du-lieu.json "$env:TEMP\cic-e2e-du-lieu.json"
$env:CIC_KHO = 'tep'
$env:CIC_TEP_DU_LIEU = "$env:TEMP\cic-e2e-du-lieu.json"
$env:CIC_PORT = '9000'
$env:CIC_INTERNAL_API_KEY = '<cùng giá trị CIC_INTERNAL_API_KEY trong docker/.env của FINORA>'
$env:CIC_KAFKA_CONSUMER_ENABLED = 'true'
$env:KAFKA_BOOTSTRAP_SERVERS = '127.0.0.1:9092'
npm start
```

Phía FINORA chỉ cần đổi biến môi trường, không sửa code:

- `finora-user`: `CIC_SERVICE_URL=http://host.docker.internal:9000` khi chạy trong
  Compose (`http://localhost:9000` khi chạy ngoài Docker), `USER_CIC_MAPPING_ENABLED=true`,
  `CIC_INTERNAL_API_KEY` cùng khoá.
- `finora-ai`: `CIC_SERVICE_URL` trỏ cùng địa chỉ để tra điểm trên đúng dữ liệu vừa ghi.
- `finora-loan` phát lên `finora.loan.delinquency-changed` của broker `finora-kafka`
  (`127.0.0.1:9092` từ máy host).

Dấu hiệu chạy đúng trong log CIC: `kafka : bật — topic finora.loan.delinquency-changed …`;
sau eKYC có `Đã ghi liên kết CIC: borrowerId=…`; khi DPD đổi có
`Đã xử lý LoanDelinquencyChanged: … trangThai=DA_CAP_NHAT`; và
`GET /api/v1/ho-so/{soCccd}/lich-su` thấy phiên bản mới.

### Bảo mật: CCCD thật và Vercel Blob công khai

Driver `blob` ghi `cic/du-lieu.json` với `access: 'public'` ở đường dẫn cố định: ai có URL
là đọc được toàn bộ tài liệu — họ tên, CCCD, và từ nay cả liên kết borrowerId ↔ CCCD. Vì
`finora-user` gửi CCCD thật từ eKYC, endpoint nội bộ **từ chối lưu** (503
`KHO_LUU_TRU_CONG_KHAI`) khi kho là Blob công khai; chỉ khi chủ động đặt
`CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI=true` (dữ liệu giả lập) mới cho qua.

`@vercel/blob` 0.27.3 đang dùng chỉ chấp nhận `access: 'public'`. Blob riêng tư cần một
**store mới tạo ở chế độ Private** (chế độ truy cập chọn lúc tạo store, không đổi được về
sau) và SDK `>= 2.3` (bản mới nhất 2.8.2, Node >= 20), đọc bằng
`get(pathname, { access: 'private', useCache: false })` thay cho `fetch(url)`. Nâng SDK hai
bản major và chuyển dữ liệu sang store mới là việc để Hải quyết.

Lưu ý: `GET /api/v1/diem-tin-dung/{soCccd}` vốn lưu hồ sơ mới và nhật ký tra cứu theo
CCCD, và `finora-ai` gọi endpoint này với CCCD thật — trên bản deploy Vercel, các CCCD đó
đã nằm trong Blob công khai (B68). Chốt mới không đổi hành vi của endpoint công khai này.

### Ghi chú cho Hải

- **B66** — test `tạo mapping phát lại event chờ và chỉ trả CCCD đã che` trong
  `test/tich-hop-finora-domain.test.js` đỏ vì CCCD `079203001234` đã có trong seed (id 11,
  "Kịch bản demo đầu-cuối"): theo đúng bản Java, event tạo phiên bản 2 và giữ nguyên dư nợ
  460 triệu của hồ sơ đó, còn test kỳ vọng một hồ sơ mới (`find` trả về phiên bản seed).
  Đổi CCCD trong test sang một số không có trong seed mà vẫn tận cùng `34`, ví dụ
  `079203009934`, thì cả 7 test xanh (đã thử trên bản sao, không sửa test ở nhánh này).
- Test của nhánh này nằm trong tệp mới, không đụng tệp test của Hải:
  `test/tich-hop-finora-bo-sung.test.js`, `test/tich-hop-finora-http.test.js`,
  `test/tich-hop-finora-blob.test.js`, `test/messaging.test.js`.
