/**
 * Tích hợp FINORA: liên kết `borrowerId ↔ CCCD` và sự kiện `LoanDelinquencyChanged.v1`.
 *
 * Cổng port từ `LienKetNguoiVayService.java` và `XuLyQuaHanFinoraService.java`. Event của
 * Loan chỉ mang `borrowerId`, không bao giờ mang CCCD; CCCD chỉ đến qua endpoint nội bộ có
 * khoá. Event đến trước khi có liên kết được giữ bền vững trong `suKienQuaHanChoXuLy` và
 * được phát lại ngay khi liên kết được tạo.
 *
 * ── Mỗi thao tác đúng MỘT lượt `kho.capNhat` ──
 * Bản Java dựa vào transaction PostgreSQL. Ở đây mọi kiểm tra và tính toán chạy xong
 * TRƯỚC khi chạm vào tài liệu; chỉ khi không còn gì có thể ném lỗi mới đẩy bản ghi vào
 * các collection. Lỗi ở bất kỳ bước nào thì tài liệu chưa hề bị sửa — tương đương rollback.
 *
 * ── Thứ tự sự kiện: giữ đúng như bản Java ──
 *   - Event trực tiếp (đã có liên kết) được áp theo thứ tự đến. Không có chốt "bỏ event
 *     cũ hơn dataAsOf" — Investment có chốt đó, CIC Java thì không.
 *   - Event chờ được phát lại theo `occurredAt` tăng dần, hoà thì theo thứ tự nhận (`id`).
 *   - `nhomNoCaoNhat` luôn là max của lịch sử, nên phát lại không bao giờ hạ nhóm cao nhất.
 *
 * Mốc tạm khoá/thẩm định thủ công (mặc định 12/24 tháng) là chính sách rủi ro NỘI BỘ của
 * FINORA, không phải thời hạn cấm vay do pháp luật ấn định. Đây là kênh MÔ PHỎNG: CIC thật
 * nhận báo cáo do tổ chức tín dụng chủ động gửi theo lịch/biểu mẫu của Ngân hàng Nhà nước.
 */
import { kho } from '../du-lieu/kho-luu-tru.js'
import { chinhSachNoXau, docCauHinhTichHop } from '../cau-hinh.js'
import { DuLieuKhongHopLe, KhoLuuTruCongKhai, SuKienKhongHopLe } from '../ho-tro/loi.js'
import { congThang, docThoiDiemIso, laNgayIsoHopLe, ngayTheoMuiGio } from '../ho-tro/ngay.js'
import { dungHoSoMoi, kiemTraRangBuocNghiepVu } from './ho-so.js'

export const LOAI_SU_KIEN = 'LoanDelinquencyChanged'
export const PHIEN_BAN_SU_KIEN = 1

/** Kết quả của `xuLyLoanDelinquencyChanged`. */
export const TrangThaiSuKien = Object.freeze({
  /** Chưa có liên kết borrowerId → giữ trong hàng chờ, phát lại khi liên kết được tạo. */
  CHO_MAPPING: 'CHO_MAPPING',
  /** eventId đã có (đang chờ hoặc đã xử lý) → không tạo side effect lần hai. */
  DA_TON_TAI: 'DA_TON_TAI',
  /** Đã ghi một phiên bản hồ sơ mới. */
  DA_CAP_NHAT: 'DA_CAP_NHAT',
})

const TEN_KICH_BAN_FINORA = 'FINORA cập nhật trạng thái quá hạn'

const UUID_CHUAN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SO_THAP_PHAN = /^(-?)(\d+)(?:\.(\d+))?$/
const CCCD_12_SO = /^\d{12}$/
const INT_JAVA_MAX = 2_147_483_647
const DO_DAI_BORROWER_TOI_DA = 100
const DO_DAI_SO_KHOAN_VAY_TOI_DA = 50
const VND_TOI_DA = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * Hồ sơ vi phạm ràng buộc toàn vẹn khi dựng phiên bản từ sự kiện — tương đương lỗi CHECK
 * constraint của PostgreSQL bên Java (`DataIntegrityViolationException`). Không phải lỗi
 * của dữ liệu gửi lên nên không mang mã 4xx: qua HTTP là 500 `LOI_HE_THONG` (thao tác bị
 * huỷ trọn vẹn), qua Kafka là lỗi được thử lại rồi mới vào DLT — y như bản Java.
 */
export class ViPhamToanVenDuLieu extends Error {
  constructor(thongDiep) {
    super(thongDiep)
    this.name = new.target.name
  }
}

// ── Tiện ích ─────────────────────────────────────────────────────────────────

const laObject = (x) => x != null && typeof x === 'object' && !Array.isArray(x)

/** Id kế tiếp của một collection — thay cho IDENTITY của PostgreSQL. */
function idKeTiep(danhSach) {
  return danhSach.reduce((max, b) => Math.max(max, b.id ?? 0), 0) + 1
}

const chuanEventId = (giaTri) => String(giaTri).toLowerCase()

/** Chỉ giữ 3 số đầu và 2 số cuối — đúng cách che của bản Java. */
export function cheCccd(soCccd) {
  return `${soCccd.slice(0, 3)}*******${soCccd.slice(-2)}`
}

/**
 * Số tiền dạng chuỗi thập phân không âm, làm tròn HALF_UP về đồng — tương đương
 * `new BigDecimal(s).setScale(0, HALF_UP).longValueExact()`. Dùng BigInt nên không mất
 * chính xác với số lớn; vượt `Number.MAX_SAFE_INTEGER` thì coi là không hợp lệ.
 */
function docSoTienVnd(ten, giaTri, loi) {
  if (typeof giaTri !== 'string') {
    loi.push(`${ten}: phải là chuỗi số thập phân, ví dụ "1000000.00"`)
    return null
  }
  const m = SO_THAP_PHAN.exec(giaTri)
  if (!m) {
    loi.push(`${ten}: phải là chuỗi số thập phân, ví dụ "1000000.00"`)
    return null
  }
  const phanNguyen = BigInt(m[2])
  const phanLe = m[3] ?? ''
  // "-0.00" có signum 0 trong BigDecimal nên bản Java chấp nhận; ở đây cũng vậy.
  if (m[1] === '-' && (phanNguyen !== 0n || /[1-9]/.test(phanLe))) {
    loi.push(`${ten}: số tiền trong LoanDelinquencyChanged không được âm`)
    return null
  }
  const dong = phanNguyen + (phanLe !== '' && phanLe[0] >= '5' ? 1n : 0n)
  if (dong > VND_TOI_DA) {
    loi.push(`${ten}: vượt giới hạn ${Number.MAX_SAFE_INTEGER} đồng`)
    return null
  }
  return Number(dong)
}

function kiemTraSoNguyen(ten, giaTri, { tu, den }, loi) {
  if (!Number.isInteger(giaTri) || giaTri < tu || giaTri > den) {
    loi.push(`${ten}: phải là số nguyên trong [${tu}, ${den}]`)
  }
}

function kiemTraChuoi(ten, giaTri, doDaiToiDa, loi) {
  if (typeof giaTri !== 'string' || giaTri.trim() === '') {
    loi.push(`${ten}: không được để trống`)
  } else if (giaTri.length > doDaiToiDa) {
    loi.push(`${ten}: tối đa ${doDaiToiDa} ký tự`)
  }
}

// ── Kiểm tra dữ liệu vào ─────────────────────────────────────────────────────

/**
 * Kiểm tra chặt một `LoanDelinquencyChanged.v1` — phần `kiemTra()` của bản Java cộng với
 * những ràng buộc mà bản Java giao cho kiểu dữ liệu Jackson và cột PostgreSQL
 * (`VARCHAR(50/100)`, `NUMERIC`, `UUID`, `TIMESTAMPTZ`).
 *
 * Chấp nhận đúng những gì FINORA thực sự gửi: tiền là chuỗi `toPlainString()` (thường 2
 * chữ số lẻ), `overdueSince` có thể `null` khi đã hết quá hạn, `dataAsOf`/`occurredAt` là
 * `Instant` ISO-8601 (có thể kèm micro-giây). Trường lạ bị bỏ qua như Jackson của Spring.
 *
 * @returns sự kiện đã chuẩn hoá: `eventId` chữ thường, mốc nano-giây và số tiền theo đồng
 * @throws {SuKienKhongHopLe}
 */
export function kiemTraSuKienQuaHan(eventId, occurredAt, data) {
  const loi = []

  const hopLeId = typeof eventId === 'string' && UUID_CHUAN.test(eventId)
  if (!hopLeId) loi.push('eventId: phải là UUID dạng 8-4-4-4-12')

  const mocOccurredAt = docThoiDiemIso(occurredAt)
  if (mocOccurredAt == null) {
    loi.push('occurredAt: phải là thời điểm ISO-8601 có múi giờ, ví dụ 2026-10-03T03:00:00Z')
  }

  if (!laObject(data)) {
    loi.push('data: phải là JSON object')
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN} không hợp lệ: ${loi.join('; ')}`)
  }

  kiemTraSoNguyen('loanApplicationId', data.loanApplicationId,
    { tu: 1, den: Number.MAX_SAFE_INTEGER }, loi)
  kiemTraSoNguyen('fineractLoanId', data.fineractLoanId,
    { tu: 1, den: Number.MAX_SAFE_INTEGER }, loi)
  kiemTraChuoi('loanNumber', data.loanNumber, DO_DAI_SO_KHOAN_VAY_TOI_DA, loi)
  kiemTraChuoi('borrowerId', data.borrowerId, DO_DAI_BORROWER_TOI_DA, loi)
  // borrowerId là định danh máy sinh, so khớp tuyệt đối với liên kết. Có khoảng trắng
  // đầu/cuối thì không bao giờ khớp được liên kết (đã trim) — đưa vào DLT cho thấy ngay.
  if (typeof data.borrowerId === 'string' && data.borrowerId.trim() !== ''
      && data.borrowerId !== data.borrowerId.trim()) {
    loi.push('borrowerId: không được có khoảng trắng ở đầu hoặc cuối')
  }
  kiemTraSoNguyen('previousDaysPastDue', data.previousDaysPastDue, { tu: 0, den: INT_JAVA_MAX }, loi)
  kiemTraSoNguyen('daysPastDue', data.daysPastDue, { tu: 0, den: INT_JAVA_MAX }, loi)
  kiemTraSoNguyen('previousDebtGroup', data.previousDebtGroup, { tu: 1, den: 5 }, loi)
  kiemTraSoNguyen('debtGroup', data.debtGroup, { tu: 1, den: 5 }, loi)
  const soTienQuaHanVnd = docSoTienVnd('overdueAmount', data.overdueAmount, loi)
  const tongDuNoVnd = docSoTienVnd('totalOutstanding', data.totalOutstanding, loi)
  if (data.overdueSince != null && !laNgayIsoHopLe(data.overdueSince)) {
    loi.push('overdueSince: phải là ngày yyyy-MM-dd hoặc null')
  }
  const mocDataAsOf = docThoiDiemIso(data.dataAsOf)
  if (mocDataAsOf == null) {
    loi.push('dataAsOf: phải là thời điểm ISO-8601 có múi giờ, ví dụ 2026-10-03T03:00:00Z')
  }

  if (loi.length > 0) {
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN} không hợp lệ: ${loi.join('; ')}`)
  }

  return {
    eventId: chuanEventId(eventId),
    occurredAt,
    mocOccurredAt,
    data: {
      loanApplicationId: data.loanApplicationId,
      loanNumber: data.loanNumber,
      borrowerId: data.borrowerId,
      fineractLoanId: data.fineractLoanId,
      previousDaysPastDue: data.previousDaysPastDue,
      daysPastDue: data.daysPastDue,
      previousDebtGroup: data.previousDebtGroup,
      debtGroup: data.debtGroup,
      overdueAmount: data.overdueAmount,
      overdueSince: data.overdueSince ?? null,
      totalOutstanding: data.totalOutstanding,
      dataAsOf: data.dataAsOf,
    },
    soTienQuaHanVnd,
    tongDuNoVnd,
    ngayHieuLuc: ngayTheoMuiGio(mocDataAsOf),
  }
}

/**
 * Kiểm tra thân request liên kết — `@NotBlank @Size(max=100) borrowerId` và
 * `@NotBlank @Pattern("\\d{12}") soCccd` của `TaoLienKetNguoiVayRequest.java`.
 *
 * Thông điệp lỗi KHÔNG bao giờ lặp lại giá trị CCCD nhận được (khác `chuanHoaCccd`, vốn
 * dành cho đường dẫn tra cứu công khai).
 *
 * @returns `{ borrowerId, soCccd }` — borrowerId đã trim như bản Java
 * @throws {DuLieuKhongHopLe}
 */
export function kiemTraYeuCauLienKet(yeuCau) {
  if (!laObject(yeuCau)) {
    throw new DuLieuKhongHopLe(
      'Không đọc được dữ liệu gửi lên: thân request phải là JSON object')
  }
  const loi = []
  const { borrowerId, soCccd } = yeuCau

  if (typeof borrowerId !== 'string' || borrowerId.trim() === '') {
    loi.push('borrowerId: không được để trống')
  } else if (borrowerId.length > DO_DAI_BORROWER_TOI_DA) {
    loi.push(`borrowerId: tối đa ${DO_DAI_BORROWER_TOI_DA} ký tự`)
  }

  if (typeof soCccd !== 'string' || soCccd.trim() === '') {
    loi.push('soCccd: không được để trống')
  } else if (!CCCD_12_SO.test(soCccd)) {
    loi.push('soCccd: soCccd phải gồm đúng 12 chữ số')
  }

  if (loi.length > 0) throw new DuLieuKhongHopLe(loi.join('; '))
  return { borrowerId: borrowerId.trim(), soCccd }
}

/**
 * Chốt fail-closed: kho Vercel Blob của bản này ghi `access: 'public'` ở đường dẫn cố
 * định, nên một liên kết borrowerId ↔ CCCD (CCCD thật từ eKYC của FINORA) sẽ đọc được bởi
 * bất kỳ ai có URL. Từ chối trừ khi người vận hành chủ động đặt
 * `CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI=true`.
 *
 * @throws {KhoLuuTruCongKhai} → HTTP 503
 */
export function kiemTraKhoChoPhepLuuDinhDanh({
  congKhai = kho.congKhai,
  choPhep = docCauHinhTichHop().choPhepPiiTrenBlobCongKhai,
} = {}) {
  if (congKhai && !choPhep) {
    throw new KhoLuuTruCongKhai(
      'Kho dữ liệu đang là Vercel Blob công khai: CIC từ chối lưu liên kết borrowerId ↔ CCCD. '
      + 'Chạy với kho tệp (CIC_KHO=tep) hoặc Blob riêng tư; chỉ đặt '
      + 'CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI=true khi mọi CCCD đều là dữ liệu giả lập.')
  }
}

// ── Dựng phiên bản hồ sơ (port `apDung` của bản Java) ────────────────────────

/** Phiên bản mới nhất của một CCCD, `null` nếu chưa có dòng nào. */
function hoSoMoiNhat(d, soCccd) {
  let moiNhat = null
  for (const h of d.hoSoTinDung) {
    if (h.soCccd === soCccd && (!moiNhat || h.phienBan > moiNhat.phienBan)) moiNhat = h
  }
  return moiNhat
}

/**
 * Phiên bản hồ sơ mới dựng từ một sự kiện. Hàm thuần: không sửa `cu`, không chạm tài liệu.
 *
 * Event mô tả MỘT khoản vay FINORA, không phải ảnh chụp tổng dư nợ của khách hàng: hồ sơ
 * đã có thì giữ nguyên mọi số tổng (dư nợ, hạn mức, số hợp đồng, số loại sản phẩm), chỉ
 * cập nhật lịch sử quá hạn và nhóm nợ. Consumer không tự suy DPD hay nhóm nợ.
 */
function dungPhienBanTuSuKien(cu, hoSoDaCo, suKien, soCccd, id, phienBan) {
  const { data, ngayHieuLuc, tongDuNoVnd } = suKien
  const treHanMoi = data.previousDaysPastDue === 0 && data.daysPastDue > 0
  const nhomNoCaoNhat = cu.nhomNoCaoNhat == null
    ? data.debtGroup
    : Math.max(cu.nhomNoCaoNhat, data.debtGroup)
  const nhomHienTaiTruoc = cu.nhomNoHienTai ?? data.previousDebtGroup
  const vuaKhacPhucNoXau = nhomHienTaiTruoc >= 3 && data.debtGroup < 3

  let ngayKhacPhucNoXau = cu.ngayKhacPhucNoXau ?? null
  let tamKhoaVayDen = cu.tamKhoaVayDen ?? null
  let thamDinhThuCongDen = cu.thamDinhThuCongDen ?? null
  if (data.debtGroup >= 3) {
    ngayKhacPhucNoXau = null
    tamKhoaVayDen = null
    thamDinhThuCongDen = null
  } else if (vuaKhacPhucNoXau) {
    ngayKhacPhucNoXau = ngayHieuLuc
    tamKhoaVayDen = congThang(ngayHieuLuc, chinhSachNoXau.soThangTamKhoa)
    thamDinhThuCongDen = congThang(ngayHieuLuc, chinhSachNoXau.soThangThamDinhThuCong)
  }

  return {
    id,
    soCccd,
    phienBan,
    hieuLucTu: ngayHieuLuc,
    hoTen: cu.hoTen,
    tenKichBan: TEN_KICH_BAN_FINORA,
    ghiChu: `Nguồn Loan/Fineract; loanApplicationId=${data.loanApplicationId}`,
    nhomNoCaoNhat,
    nhomNoHienTai: data.debtGroup,
    ngayKhacPhucNoXau,
    tamKhoaVayDen,
    thamDinhThuCongDen,
    soLanTreHan12Thang: cu.soLanTreHan12Thang + (treHanMoi ? 1 : 0),
    soLanTreHan24Thang: cu.soLanTreHan24Thang + (treHanMoi ? 1 : 0),
    soNgayTreDaiNhat: Math.max(cu.soNgayTreDaiNhat, data.daysPastDue),
    soThangTuLanTreGanNhat: data.daysPastDue > 0 ? 0 : cu.soThangTuLanTreGanNhat,
    tongDuNo: hoSoDaCo ? cu.tongDuNo : tongDuNoVnd,
    tongHanMuc: hoSoDaCo ? cu.tongHanMuc : Math.max(cu.tongHanMuc, tongDuNoVnd),
    duNoTheTinDung: cu.duNoTheTinDung,
    hanMucThe: cu.hanMucThe,
    ngayMoQuanHeDauTien: cu.ngayMoQuanHeDauTien ?? ngayHieuLuc,
    soLanTraCuu6Thang: cu.soLanTraCuu6Thang,
    soHopDongMoMoi6Thang: cu.soHopDongMoMoi6Thang,
    soHopDongDangCo: hoSoDaCo ? cu.soHopDongDangCo : Math.max(1, cu.soHopDongDangCo),
    soLoaiSanPham: hoSoDaCo ? cu.soLoaiSanPham : Math.max(1, cu.soLoaiSanPham),
  }
}

/** Biên nhận idempotency — `SuKienDaXuLy.tao` của bản Java. */
function bienNhanDaXuLy(id, suKien, luc) {
  return {
    id,
    eventId: suKien.eventId,
    eventType: LOAI_SU_KIEN,
    eventVersion: PHIEN_BAN_SU_KIEN,
    aggregateId: String(suKien.data.loanApplicationId),
    occurredAt: suKien.occurredAt,
    processedAt: luc,
    createdAt: luc,
    updatedAt: luc,
  }
}

/** Bản ghi hàng chờ — `SuKienQuaHanChoXuLy.tao` của bản Java. Không chứa CCCD. */
function banGhiCho(id, suKien, luc) {
  return {
    id,
    eventId: suKien.eventId,
    ...suKien.data,
    occurredAt: suKien.occurredAt,
    createdAt: luc,
    updatedAt: luc,
  }
}

/** Dựng lại sự kiện đã kiểm tra từ một bản ghi hàng chờ (`duLieu()` của bản Java). */
function suKienTuBanGhiCho(banGhi) {
  try {
    return kiemTraSuKienQuaHan(banGhi.eventId, banGhi.occurredAt, {
      loanApplicationId: banGhi.loanApplicationId,
      loanNumber: banGhi.loanNumber,
      borrowerId: banGhi.borrowerId,
      fineractLoanId: banGhi.fineractLoanId,
      previousDaysPastDue: banGhi.previousDaysPastDue,
      daysPastDue: banGhi.daysPastDue,
      previousDebtGroup: banGhi.previousDebtGroup,
      debtGroup: banGhi.debtGroup,
      overdueAmount: banGhi.overdueAmount,
      overdueSince: banGhi.overdueSince,
      totalOutstanding: banGhi.totalOutstanding,
      dataAsOf: banGhi.dataAsOf,
    })
  } catch (loi) {
    // Bản ghi đã được kiểm tra lúc nhận; hỏng ở đây nghĩa là tài liệu bị sửa tay.
    throw new ViPhamToanVenDuLieu(
      `Bản ghi chờ id=${banGhi.id} không còn hợp lệ: ${loi.message}`)
  }
}

/**
 * Tính trước mọi phiên bản hồ sơ và biên nhận cho một chuỗi sự kiện của cùng một CCCD,
 * nối tiếp nhau như bản Java áp lần lượt trong một transaction. Không sửa tài liệu.
 *
 * @throws {ViPhamToanVenDuLieu} nếu một phiên bản vi phạm ràng buộc hồ sơ (thay CHECK của DB)
 */
function tinhTruocPhienBan(d, dsSuKien, soCccd, luc) {
  let hienTai = hoSoMoiNhat(d, soCccd)
  let idHoSo = idKeTiep(d.hoSoTinDung)
  let idBienNhan = idKeTiep(d.suKienDaXuLy)
  const hoSoMoi = []
  const bienNhan = []

  for (const suKien of dsSuKien) {
    const hoSoDaCo = hienTai != null
    const cu = hienTai ?? dungHoSoMoi(soCccd)
    const moi = dungPhienBanTuSuKien(
      cu, hoSoDaCo, suKien, soCccd, idHoSo++, hoSoDaCo ? hienTai.phienBan + 1 : 1)
    try {
      kiemTraRangBuocNghiepVu(moi)
    } catch (loi) {
      if (!(loi instanceof DuLieuKhongHopLe)) throw loi
      throw new ViPhamToanVenDuLieu(
        `Không ghi được phiên bản hồ sơ từ sự kiện ${suKien.eventId}: ${loi.message}`)
    }
    hoSoMoi.push(moi)
    bienNhan.push(bienNhanDaXuLy(idBienNhan++, suKien, luc))
    hienTai = moi
  }
  return { hoSoMoi, bienNhan }
}

function daTonTai(d, eventId) {
  const trung = (e) => chuanEventId(e.eventId) === eventId
  return d.suKienDaXuLy.some(trung) || d.suKienQuaHanChoXuLy.some(trung)
}

// ── Hai thao tác công khai ───────────────────────────────────────────────────

/**
 * Xử lý một `LoanDelinquencyChanged.v1` — `XuLyQuaHanFinoraService.xuLy` của bản Java.
 *
 *   kiểm tra chặt (ngoài hàng đợi ghi — sai thì không chạm dữ liệu)
 *     -> eventId đã có (chờ hoặc đã xử lý) -> DA_TON_TAI
 *     -> chưa có liên kết borrowerId      -> giữ vào hàng chờ, CHO_MAPPING
 *     -> có liên kết                      -> phiên bản hồ sơ mới + biên nhận, DA_CAP_NHAT
 *
 * @param {string} eventId UUID của envelope
 * @param {string} occurredAt thời điểm phát sinh ISO-8601 của envelope
 * @param {object} data phần `data` của envelope
 * @returns {Promise<{trangThai: string, phienBan?: number}>} không bao giờ chứa CCCD
 * @throws {SuKienKhongHopLe} dữ liệu sai — không thử lại
 * @throws {ViPhamToanVenDuLieu} phiên bản mới vi phạm ràng buộc hồ sơ
 */
export async function xuLyLoanDelinquencyChanged(eventId, occurredAt, data) {
  const suKien = kiemTraSuKienQuaHan(eventId, occurredAt, data)

  return kho.capNhat((d) => {
    if (daTonTai(d, suKien.eventId)) return { trangThai: TrangThaiSuKien.DA_TON_TAI }

    const luc = new Date().toISOString()
    const lienKet = d.lienKetNguoiVay.find((l) => l.borrowerId === suKien.data.borrowerId)
    if (!lienKet) {
      d.suKienQuaHanChoXuLy.push(banGhiCho(idKeTiep(d.suKienQuaHanChoXuLy), suKien, luc))
      return { trangThai: TrangThaiSuKien.CHO_MAPPING }
    }

    const { hoSoMoi, bienNhan } = tinhTruocPhienBan(d, [suKien], lienKet.soCccd, luc)
    // Mọi kiểm tra đã xong: từ đây chỉ còn ghi.
    d.hoSoTinDung.push(...hoSoMoi)
    d.suKienDaXuLy.push(...bienNhan)
    return { trangThai: TrangThaiSuKien.DA_CAP_NHAT, phienBan: hoSoMoi[0].phienBan }
  })
}

/**
 * Tạo liên kết borrowerId ↔ CCCD và phát lại sự kiện đang chờ — `LienKetNguoiVayService.tao`
 * của bản Java, gói trong đúng một lượt ghi.
 *
 *   - Cùng cặp đã có → idempotent: không tạo gì mới, vẫn phát lại phần chờ (nếu có),
 *     `createdAt` là của liên kết gốc.
 *   - borrowerId đã gắn CCCD khác, hoặc CCCD đã gắn borrowerId khác → 400.
 *   - Phát lại theo `occurredAt` tăng dần rồi `id`; một sự kiện vi phạm ràng buộc thì cả
 *     thao tác bị huỷ — liên kết chưa được tạo và hàng chờ còn nguyên.
 *
 * @returns {Promise<{borrowerId: string, soCccdDaChe: string, soSuKienDaPhatLai: number,
 *          createdAt: string}>} chỉ có CCCD đã che
 */
export async function taoLienKetNguoiVay(yeuCau) {
  const { borrowerId, soCccd } = kiemTraYeuCauLienKet(yeuCau)
  kiemTraKhoChoPhepLuuDinhDanh()

  return kho.capNhat((d) => {
    const luc = new Date().toISOString()
    const theoBorrower = d.lienKetNguoiVay.find((l) => l.borrowerId === borrowerId)
    if (theoBorrower && theoBorrower.soCccd !== soCccd) {
      throw new DuLieuKhongHopLe('borrowerId đã liên kết với CCCD khác')
    }
    if (!theoBorrower && d.lienKetNguoiVay.some((l) => l.soCccd === soCccd)) {
      throw new DuLieuKhongHopLe('CCCD đã liên kết với borrowerId khác')
    }
    const lienKet = theoBorrower ?? {
      id: idKeTiep(d.lienKetNguoiVay),
      borrowerId,
      soCccd,
      createdAt: luc,
      updatedAt: luc,
    }

    const banGhiChoCuaBorrower = d.suKienQuaHanChoXuLy
      .filter((e) => e.borrowerId === borrowerId)
      .map((banGhi) => ({ banGhi, suKien: suKienTuBanGhiCho(banGhi) }))
      .sort((a, b) => {
        if (a.suKien.mocOccurredAt !== b.suKien.mocOccurredAt) {
          return a.suKien.mocOccurredAt < b.suKien.mocOccurredAt ? -1 : 1
        }
        return (a.banGhi.id ?? 0) - (b.banGhi.id ?? 0)
      })

    const daXuLy = new Set(d.suKienDaXuLy.map((e) => chuanEventId(e.eventId)))
    const canPhatLai = []
    for (const { suKien } of banGhiChoCuaBorrower) {
      if (daXuLy.has(suKien.eventId)) continue
      daXuLy.add(suKien.eventId)
      canPhatLai.push(suKien)
    }
    const { hoSoMoi, bienNhan } = tinhTruocPhienBan(d, canPhatLai, soCccd, luc)

    // Mọi kiểm tra đã xong: từ đây chỉ còn ghi, không còn gì ném lỗi.
    if (!theoBorrower) d.lienKetNguoiVay.push(lienKet)
    d.hoSoTinDung.push(...hoSoMoi)
    d.suKienDaXuLy.push(...bienNhan)
    if (banGhiChoCuaBorrower.length > 0) {
      const daPhatLai = new Set(banGhiChoCuaBorrower.map((x) => x.banGhi))
      d.suKienQuaHanChoXuLy = d.suKienQuaHanChoXuLy.filter((e) => !daPhatLai.has(e))
    }

    return {
      borrowerId: lienKet.borrowerId,
      soCccdDaChe: cheCccd(lienKet.soCccd),
      soSuKienDaPhatLai: hoSoMoi.length,
      createdAt: lienKet.createdAt,
    }
  })
}
