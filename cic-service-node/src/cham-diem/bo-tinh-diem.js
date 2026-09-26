/**
 * Bộ tính điểm tín dụng CIC: 5 nhóm yếu tố → tổng có trọng số → thang 150–750.
 *
 * ── Tính tất định ──
 * Module này KHÔNG import gì liên quan tới thời gian thực: không `homNay`, không
 * `Date`. Ngày tham chiếu là `hieuLucTu` của chính bản ghi hồ sơ, nên
 * `diem = f(hồ sơ)` tuyệt đối: cùng một phiên bản hồ sơ, tra hôm nay hay tra sang
 * năm cũng ra đúng một con số.
 *
 * Cổng port từ `BoTinhDiem.java`. Mọi công thức phải khớp tuyệt đối — bộ test
 * `test/doi-chieu-java.test.js` giữ ràng buộc đó.
 */
import { thamSoChamDiem } from '../cau-hinh.js'
import { noiSuyTai } from './noi-suy.js'
import { soNgayGiua } from '../ho-tro/ngay.js'

const NGAY_MOT_NAM = 365.25
const DIEM_THANH_PHAN_TOI_DA = 100.0

/** Chưa từng trễ hạn — khớp `HoSoTinDung.CHUA_TUNG_TRE_HAN` bản Java. */
export const CHUA_TUNG_TRE_HAN = -1

const gioiHan0100 = (x) => Math.min(DIEM_THANH_PHAN_TOI_DA, Math.max(0.0, x))

/**
 * Làm tròn nửa-lên như `Math.round` của Java.
 *
 * `Math.round` của JS đã là nửa-lên với số dương, nhưng khác Java ở số âm
 * (JS: -0.5 → -0; Java: -0.5 → 0). Điểm luôn không âm nên hai bên trùng nhau,
 * viết tường minh để chỗ này không thành bẫy nếu về sau có ngưỡng âm.
 */
const lamTronNuaLen = (x) => Math.floor(x + 0.5)

/** Chưa từng trễ hạn lần nào. */
export const chuaTungTreHan = (h) => h.soThangTuLanTreGanNhat < 0

/** Chưa từng có quan hệ tín dụng với bất kỳ tổ chức tín dụng nào. */
export const chuaCoQuanHeTinDung = (h) => h.ngayMoQuanHeDauTien == null

// ── Nhóm 1: Lịch sử trả nợ (35%) ─────────────────────────────────────────────

/**
 * Điểm nền theo nhóm nợ, trừ phạt theo số lần trễ và mức độ trễ, rồi cộng lại một
 * phần theo thời gian đã trôi qua kể từ lần trễ gần nhất.
 *
 * Hồi phục chỉ lấp được tối đa `tyLeHoiPhucToiDa` của khoảng hụt — một hồ sơ từng
 * nợ nhóm 5 không bao giờ trở lại 100 điểm dù đã sạch bao lâu.
 */
export function chamLichSuTraNo(h, ts = thamSoChamDiem) {
  const c = ts.lichSuTraNo

  if (h.nhomNoCaoNhat == null) {
    return c.diemNenChuaCoLichSu
  }

  const nhomNo = Math.min(5, Math.max(1, h.nhomNoCaoNhat))
  const diemGoc = c.mocTheoNhomNo[nhomNo - 1]

  const tre12 = Math.max(0, h.soLanTreHan12Thang)
  const treCu = Math.max(0, h.soLanTreHan24Thang - tre12)
  const phatTheoNgay = Math.min(
    c.phatToiDaTheoNgayTre,
    Math.max(0, h.soNgayTreDaiNhat) * c.phatMoiNgayTre,
  )

  const phat = tre12 * c.phatMoiLanTre12Thang
    + treCu * c.phatMoiLanTre24Thang
    + phatTheoNgay

  const truocHoiPhuc = gioiHan0100(diemGoc - phat)

  if (chuaTungTreHan(h)) {
    return truocHoiPhuc
  }

  const tienDo = Math.min(1.0, h.soThangTuLanTreGanNhat / c.soThangHoiPhucDayDu)
  const khoangHut = DIEM_THANH_PHAN_TOI_DA - truocHoiPhuc

  return gioiHan0100(truocHoiPhuc + khoangHut * tienDo * c.tyLeHoiPhucToiDa)
}

// ── Nhóm 2: Dư nợ hiện tại (30%) ─────────────────────────────────────────────

/**
 * Trung bình có trọng số của tỉ lệ sử dụng tổng hạn mức và tỉ lệ sử dụng hạn mức thẻ.
 *
 * Hạn mức bằng 0 nghĩa là KHÔNG CÓ THÔNG TIN, không phải "dùng 0%" — nên trả điểm
 * nền chứ không trả 100, và không có phép chia cho 0 nào xảy ra.
 */
export function chamDuNo(h, ts = thamSoChamDiem) {
  const c = ts.duNo
  const moc = c.moc

  const diemTong = h.tongHanMuc > 0 ? noiSuyTai(moc, h.tongDuNo / h.tongHanMuc) : null
  const diemThe = h.hanMucThe > 0 ? noiSuyTai(moc, h.duNoTheTinDung / h.hanMucThe) : null

  if (diemTong === null && diemThe === null) return c.diemNenKhongCoHanMuc
  if (diemThe === null) return gioiHan0100(diemTong)
  if (diemTong === null) return gioiHan0100(diemThe)

  const tongTrongSo = c.trongSoTong + c.trongSoThe
  return gioiHan0100((diemTong * c.trongSoTong + diemThe * c.trongSoThe) / tongTrongSo)
}

// ── Nhóm 3: Thời gian quan hệ tín dụng (15%) ─────────────────────────────────

/**
 * Số năm tính từ `ngayMoQuanHeDauTien` đến `hieuLucTu` của CHÍNH BẢN GHI — không
 * phải đến hôm nay. Cả bản ghi vốn đã là một ảnh chụp tại `hieuLucTu`; đem riêng
 * cột này so với hôm nay thì điểm sẽ tự trôi theo thời gian dù không ai sửa dữ liệu.
 */
export function chamThoiGianQuanHe(h, ts = thamSoChamDiem) {
  const c = ts.thoiGianQuanHe

  if (chuaCoQuanHeTinDung(h)) return c.diemNenChuaCoQuanHe

  const soNgay = soNgayGiua(h.ngayMoQuanHeDauTien, h.hieuLucTu)
  const soNam = Math.max(0.0, soNgay / NGAY_MOT_NAM)

  return gioiHan0100(noiSuyTai(c.moc, soNam))
}

// ── Nhóm 4: Tín dụng mới (10%) ───────────────────────────────────────────────

export function chamTinDungMoi(h, ts = thamSoChamDiem) {
  const c = ts.tinDungMoi

  const diem = c.diemGoc
    - Math.max(0, h.soLanTraCuu6Thang) * c.phatMoiLanTraCuu
    - Math.max(0, h.soHopDongMoMoi6Thang) * c.phatMoiHopDongMoi

  return gioiHan0100(diem)
}

// ── Nhóm 5: Cơ cấu tín dụng (10%) ────────────────────────────────────────────

/**
 * Không có hợp đồng nào thì không có cơ cấu nào để đánh giá → điểm nền. Đây là một
 * trong hai chỗ duy nhất phân biệt "chưa có gì xấu" với "đã chứng minh là tốt".
 */
export function chamCoCauTinDung(h, ts = thamSoChamDiem) {
  const c = ts.coCauTinDung

  if (h.soHopDongDangCo <= 0) return c.diemNenKhongCoHopDong

  const moc = c.mocTheoSoLoaiSanPham
  const soLoai = Math.max(1, h.soLoaiSanPham)
  return gioiHan0100(moc[Math.min(soLoai, moc.length) - 1])
}

// ── Điểm tổng ────────────────────────────────────────────────────────────────

/** `150 + tong/100 × 600`, làm tròn rồi kẹp về [150, 750]. */
export function giangSangThangCic(tongDiem, ts = thamSoChamDiem) {
  const { diemToiThieu: min, diemToiDa: max } = ts.thang
  const diem = lamTronNuaLen(min + (tongDiem / DIEM_THANH_PHAN_TOI_DA) * (max - min))
  return Math.min(max, Math.max(min, diem))
}

const thanhPhan = (diem, trongSo) => ({ diem, trongSo, dongGop: diem * trongSo })

/**
 * Chấm điểm một hồ sơ tín dụng.
 *
 * @returns {{lichSuTraNo, duNoHienTai, thoiGianQuanHe, tinDungMoi, coCauTinDung,
 *            tongDiem: number, diemCic: number}} giá trị CHƯA làm tròn; việc làm
 *          tròn để hiển thị là chuyện của tầng DTO.
 */
export function tinhDiem(hoSo, ts = thamSoChamDiem) {
  const w = ts.trongSo

  const n1 = thanhPhan(chamLichSuTraNo(hoSo, ts), w.lichSuTraNo)
  const n2 = thanhPhan(chamDuNo(hoSo, ts), w.duNoHienTai)
  const n3 = thanhPhan(chamThoiGianQuanHe(hoSo, ts), w.thoiGianQuanHe)
  const n4 = thanhPhan(chamTinDungMoi(hoSo, ts), w.tinDungMoi)
  const n5 = thanhPhan(chamCoCauTinDung(hoSo, ts), w.coCauTinDung)

  const tongDiem = n1.dongGop + n2.dongGop + n3.dongGop + n4.dongGop + n5.dongGop

  return {
    lichSuTraNo: n1,
    duNoHienTai: n2,
    thoiGianQuanHe: n3,
    tinDungMoi: n4,
    coCauTinDung: n5,
    tongDiem,
    diemCic: giangSangThangCic(tongDiem, ts),
  }
}
