/**
 * Toàn bộ trọng số và ngưỡng của bộ tính điểm.
 *
 * Bản Java giữ những con số này trong `application.yml` và nạp qua
 * `ThamSoChamDiem`. Ở đây chúng nằm trong một object JS, đọc đè được bằng biến môi
 * trường cho hai tham số mô phỏng. Mọi giá trị phải khớp tuyệt đối với bản Java —
 * đây là thứ quyết định điểm, lệch một con số là hai service trả hai kết quả khác nhau.
 *
 * Cấu hình sai thì tiến trình phải chết ngay lúc khởi động, chứ không trả điểm sai
 * suốt vòng đời.
 *
 * Cuối tệp là cấu hình tích hợp FINORA (chính sách nợ xấu, endpoint nội bộ, Kafka) —
 * không có giá trị nào trong đó ảnh hưởng tới công thức chấm điểm.
 */

/** Múi giờ duy nhất của hệ thống, khớp `CauHinhChung.MUI_GIO` bản Java. */
export const MUI_GIO = 'Asia/Ho_Chi_Minh'

const SAI_SO_TRONG_SO = 1e-9

export const thamSoChamDiem = {
  trongSo: {
    lichSuTraNo: 0.35,
    duNoHienTai: 0.30,
    thoiGianQuanHe: 0.15,
    tinDungMoi: 0.10,
    coCauTinDung: 0.10,
  },

  thang: {
    diemToiThieu: 150,
    diemToiDa: 750,
  },

  // ── Nhóm 1: Lịch sử trả nợ (35%) ──
  lichSuTraNo: {
    /** index 0..4 ứng với nhóm nợ 1..5 */
    mocTheoNhomNo: [100.0, 72.0, 45.0, 25.0, 8.0],
    diemNenChuaCoLichSu: 52.0,
    phatMoiLanTre12Thang: 8.0,
    phatMoiLanTre24Thang: 6.0,
    phatMoiNgayTre: 0.05,
    phatToiDaTheoNgayTre: 20.0,
    soThangHoiPhucDayDu: 48,
    tyLeHoiPhucToiDa: 0.6,
  },

  // ── Nhóm 2: Dư nợ hiện tại (30%) ──
  duNo: {
    trongSoTong: 0.6,
    trongSoThe: 0.4,
    diemNenKhongCoHanMuc: 52.0,
    /** x = tỉ lệ sử dụng, y = điểm 0..100 */
    moc: [
      { x: 0.00, y: 100.0 },
      { x: 0.10, y: 100.0 },
      { x: 0.30, y: 80.0 },
      { x: 0.50, y: 60.0 },
      { x: 0.75, y: 30.0 },
      { x: 1.00, y: 0.0 },
    ],
  },

  // ── Nhóm 3: Thời gian quan hệ tín dụng (15%) ──
  thoiGianQuanHe: {
    diemNenChuaCoQuanHe: 32.0,
    /** x = số năm, y = điểm 0..100; bão hoà từ 7 năm */
    moc: [
      { x: 0.0, y: 10.0 },
      { x: 1.0, y: 30.0 },
      { x: 2.0, y: 45.0 },
      { x: 3.0, y: 60.0 },
      { x: 5.0, y: 82.0 },
      { x: 7.0, y: 100.0 },
    ],
  },

  // ── Nhóm 4: Tín dụng mới (10%) ──
  tinDungMoi: {
    diemGoc: 100.0,
    phatMoiLanTraCuu: 8.0,
    phatMoiHopDongMoi: 12.0,
  },

  // ── Nhóm 5: Cơ cấu tín dụng (10%) ──
  coCauTinDung: {
    diemNenKhongCoHopDong: 38.0,
    /** index 0..3 ứng với số loại sản phẩm 1..4+ */
    mocTheoSoLoaiSanPham: [55.0, 75.0, 90.0, 100.0],
  },
}

/**
 * Mô phỏng sự cố hạ tầng CIC. Đây là nơi DUY NHẤT có số ngẫu nhiên trong toàn hệ
 * thống, và nó nằm ở tầng middleware, hoàn toàn ngoài bộ tính điểm — request nào đi
 * qua được thì vẫn nhận đúng con số như khi tắt mô phỏng.
 */
export const thamSoMoPhong = {
  doTreMs: Number(process.env.CIC_MO_PHONG_DO_TRE_MS ?? 0),
  tyLeLoi: Number(process.env.CIC_MO_PHONG_TY_LE_LOI ?? 0),
  get dangBat() {
    return this.doTreMs > 0 || this.tyLeLoi > 0
  },
}

function kiemTraMoc(duongDan, moc) {
  if (moc.length < 2) {
    throw new Error(`${duongDan} phải có ít nhất 2 mốc`)
  }
  for (let i = 1; i < moc.length; i++) {
    if (moc[i].x <= moc[i - 1].x) {
      throw new Error(`${duongDan}: trục x phải tăng dần nghiêm ngặt`)
    }
  }
}

/** Cổng kiểm tra cấu hình, gọi ngay lúc nạp module. */
export function kiemTraCauHinh(ts = thamSoChamDiem) {
  const w = ts.trongSo
  const tong = w.lichSuTraNo + w.duNoHienTai + w.thoiGianQuanHe + w.tinDungMoi + w.coCauTinDung
  if (Math.abs(tong - 1.0) > SAI_SO_TRONG_SO) {
    throw new Error(`trongSo: tổng 5 trọng số phải bằng 1.0 nhưng đang là ${tong}`)
  }
  if (ts.thang.diemToiThieu >= ts.thang.diemToiDa) {
    throw new Error('thang: diemToiThieu phải nhỏ hơn diemToiDa')
  }
  if (ts.lichSuTraNo.mocTheoNhomNo.length !== 5) {
    throw new Error('lichSuTraNo.mocTheoNhomNo phải có đúng 5 phần tử (nhóm 1..5)')
  }
  if (ts.coCauTinDung.mocTheoSoLoaiSanPham.length === 0) {
    throw new Error('coCauTinDung.mocTheoSoLoaiSanPham không được rỗng')
  }
  kiemTraMoc('duNo.moc', ts.duNo.moc)
  kiemTraMoc('thoiGianQuanHe.moc', ts.thoiGianQuanHe.moc)

  if (thamSoMoPhong.tyLeLoi < 0 || thamSoMoPhong.tyLeLoi > 1) {
    throw new Error('moPhong.tyLeLoi phải nằm trong [0, 1]')
  }
  return ts
}

kiemTraCauHinh()

// ── Tích hợp FINORA ──────────────────────────────────────────────────────────

/** Trần an toàn cho số tháng: 100 năm, đủ xa mà ngày kết quả vẫn giữ dạng 'yyyy-MM-dd'. */
const SO_THANG_TOI_DA = 1200

function docSoThang(env, ten, macDinh) {
  const tho = env[ten]
  if (tho == null || String(tho).trim() === '') return macDinh
  const chuoi = String(tho).trim()
  if (!/^\d+$/.test(chuoi) || Number(chuoi) > SO_THANG_TOI_DA) {
    throw new Error(`${ten} phải là số nguyên trong [0, ${SO_THANG_TOI_DA}], nhận được: ${tho}`)
  }
  return Number(chuoi)
}

/**
 * Chính sách sau khi khắc phục nợ xấu — tương đương `ChinhSachNoXau.java` (`@Min(0)`).
 *
 * Thêm đúng một ràng buộc mà bản Java giao cho CHECK `ck_ho_so_cua_so_phuc_hoi` của
 * PostgreSQL: mốc thẩm định thủ công không được sớm hơn mốc tạm khoá. Ở đây không có DB
 * nào chặn hộ, nên cấu hình sai phải làm tiến trình chết ngay lúc khởi động.
 *
 * Đây là chính sách rủi ro NỘI BỘ của FINORA, KHÔNG phải thời hạn cấm vay do pháp luật ấn định.
 */
export function docChinhSachNoXau(env = process.env) {
  const soThangTamKhoa = docSoThang(env, 'CIC_BAD_DEBT_COOLDOWN_MONTHS', 12)
  const soThangThamDinhThuCong = docSoThang(env, 'CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS', 24)
  if (soThangThamDinhThuCong < soThangTamKhoa) {
    throw new Error('CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS không được nhỏ hơn '
      + `CIC_BAD_DEBT_COOLDOWN_MONTHS (${soThangThamDinhThuCong} < ${soThangTamKhoa})`)
  }
  return Object.freeze({ soThangTamKhoa, soThangThamDinhThuCong })
}

export const chinhSachNoXau = docChinhSachNoXau()

const laTrue = (giaTri) => String(giaTri ?? '').trim().toLowerCase() === 'true'

/**
 * Cấu hình endpoint nội bộ `POST /api/v1/internal/borrower-mappings`.
 *
 * Đọc lại mỗi lần gọi (rẻ) để test và tiến trình dài hạn thấy đúng giá trị môi trường.
 *   - `CIC_INTERNAL_API_KEY` rỗng/chỉ có khoảng trắng → endpoint ĐÓNG (403), như bản Java.
 *   - `CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI=true` → chấp nhận lưu liên kết CCCD dù kho là
 *     Vercel Blob công khai. Chỉ dùng khi chắc chắn mọi CCCD gửi tới đều là dữ liệu giả lập.
 */
export function docCauHinhTichHop(env = process.env) {
  return {
    khoaApiNoiBo: env.CIC_INTERNAL_API_KEY ?? '',
    choPhepPiiTrenBlobCongKhai: laTrue(env.CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI),
  }
}

/**
 * Consumer Kafka cho `LoanDelinquencyChanged.v1`. Bản Java mặc định bật; bản Node mặc
 * định TẮT vì function Vercel không giữ được kết nối Kafka lâu dài — chỉ `src/server.js`
 * khởi động consumer, và chỉ khi `CIC_KAFKA_CONSUMER_ENABLED=true`.
 */
export function docCauHinhKafka(env = process.env) {
  return Object.freeze({
    batConsumer: laTrue(env.CIC_KAFKA_CONSUMER_ENABLED),
    brokers: Object.freeze(String(env.KAFKA_BOOTSTRAP_SERVERS || 'localhost:9092')
      .split(',').map((b) => b.trim()).filter(Boolean)),
    groupId: env.CIC_LOAN_DELINQUENCY_GROUP || 'cic-loan-delinquency',
    topic: env.LOAN_DELINQUENCY_CHANGED_TOPIC || 'finora.loan.delinquency-changed',
  })
}

export const cauHinhKafka = docCauHinhKafka()
