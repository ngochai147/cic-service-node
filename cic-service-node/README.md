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
npm test            # 63 test
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

Bốn mã lỗi giữ nguyên: `CCCD_KHONG_HOP_LE`, `DU_LIEU_KHONG_HOP_LE`,
`CIC_KHONG_KHA_DUNG`, `LOI_HE_THONG`. Mọi lỗi đều có hình dạng `{maLoi, thongDiep}`.

**Không có nhánh nào trả 404 cho CCCD chưa tồn tại** — hệ thống dựng hồ sơ tín dụng mới
và trả 200, y như bản Java.

---

## Dữ liệu trong file JSON

Toàn bộ dữ liệu nằm trong `dulieu/du-lieu.json`, đúng 1000 hồ sơ seed chuyển từ
`V2__seed_ho_so_tin_dung.sql` (10 persona + 1 hồ sơ demo + 959 bản sinh + 30 phiên bản 2):

```json
{
  "hoSoTinDung": [ { "id": 1, "soCccd": "079081000001", "phienBan": 1, ... } ],
  "nhatKyTraCuu": [ { "id": 1, "soCccd": "...", "diemTraVe": 735, ... } ]
}
```

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
trình chết giữa chừng không để lại file JSON cụt.

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

---

## Cấu trúc

```
src/
  cau-hinh.js              trọng số + ngưỡng, kiểm tra lúc khởi động
  app.js                   8 endpoint + xử lý lỗi
  server.js                khởi động local
  cham-diem/
    bo-tinh-diem.js        bộ tính điểm 5 nhóm — KHÔNG import gì về thời gian thực
    noi-suy.js             nội suy tuyến tính trên đường gấp khúc
  du-lieu/
    kho-luu-tru.js         driver tep / blob, ghi tuần tự
    kho-ho-so.js           truy vấn (thay repository JPA)
  dich-vu/
    tra-cuu.js  ho-so.js  nhat-ky.js  thong-ke.js
  ho-tro/
    ngay.js  loi.js  kiem-tra-cccd.js
api/index.js               điểm vào Vercel serverless
dulieu/du-lieu.json        1000 hồ sơ seed
test/                      63 test, gồm mốc đối chiếu với bản Java
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

Khác biệt duy nhất ngoài contract: bản Node bật CORS cho mọi origin (bản Java không bật,
vì `cic-web` đi qua proxy của Vite). Cần thiết vì trên Vercel giao diện có thể nằm khác
origin; dữ liệu vốn là dữ liệu mô phỏng, không có PII thật.
