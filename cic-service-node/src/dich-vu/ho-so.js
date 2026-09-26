/**
 * Đọc và thêm phiên bản hồ sơ tín dụng.
 *
 * Bảng chỉ ghi thêm: module này không có hàm nào sửa hay xoá bản ghi cũ.
 * Cổng port từ `HoSoServiceImpl.java`.
 */
import * as repo from '../du-lieu/kho-ho-so.js'
import { chuanHoaCccd } from '../ho-tro/kiem-tra-cccd.js'
import { DuLieuKhongHopLe } from '../ho-tro/loi.js'
import { homNay, soSanhNgay } from '../ho-tro/ngay.js'
import { tinhDiem, CHUA_TUNG_TRE_HAN } from '../cham-diem/bo-tinh-diem.js'

/** Họ tên gán cho hồ sơ tự dựng khi tra một CCCD chưa có trong dữ liệu. */
export const HO_TEN_CHUA_RO = 'Chưa có thông tin'
export const KICH_BAN_HO_SO_MOI = 'Hồ sơ tín dụng mới'

/** Trần kích thước trang, chặn một request kéo cả bảng về. */
export const KICH_THUOC_TRANG_TOI_DA = 200

/** 20 trường nghiệp vụ của một hồ sơ, đúng thứ tự của `HoSoResponse` bản Java. */
function raHoSo(h) {
  return {
    soCccd: h.soCccd,
    phienBan: h.phienBan,
    hieuLucTu: h.hieuLucTu,
    hoTen: h.hoTen,
    tenKichBan: h.tenKichBan,
    ghiChu: h.ghiChu,
    nhomNoCaoNhat: h.nhomNoCaoNhat,
    soLanTreHan12Thang: h.soLanTreHan12Thang,
    soLanTreHan24Thang: h.soLanTreHan24Thang,
    soNgayTreDaiNhat: h.soNgayTreDaiNhat,
    soThangTuLanTreGanNhat: h.soThangTuLanTreGanNhat,
    tongDuNo: h.tongDuNo,
    tongHanMuc: h.tongHanMuc,
    duNoTheTinDung: h.duNoTheTinDung,
    hanMucThe: h.hanMucThe,
    ngayMoQuanHeDauTien: h.ngayMoQuanHeDauTien,
    soLanTraCuu6Thang: h.soLanTraCuu6Thang,
    soHopDongMoMoi6Thang: h.soHopDongMoMoi6Thang,
    soHopDongDangCo: h.soHopDongDangCo,
    soLoaiSanPham: h.soLoaiSanPham,
  }
}

/** Một dòng trong danh sách hồ sơ, kèm điểm cho tiện hiển thị. */
function raTomTat(h, diemCic) {
  return {
    soCccd: h.soCccd,
    hoTen: h.hoTen,
    phienBan: h.phienBan,
    hieuLucTu: h.hieuLucTu,
    tenKichBan: h.tenKichBan,
    nhomNoCaoNhat: h.nhomNoCaoNhat,
    tongDuNo: h.tongDuNo,
    tongHanMuc: h.tongHanMuc,
    soLanTreHan12Thang: h.soLanTreHan12Thang,
    soLanTreHan24Thang: h.soLanTreHan24Thang,
    soThangTuLanTreGanNhat: h.soThangTuLanTreGanNhat,
    diemCic,
  }
}

/**
 * Dựng hồ sơ tín dụng mới cho một CCCD chưa có trong dữ liệu — nhánh "không tìm
 * thấy" của luồng tra cứu. Không đánh dấu gì đặc biệt: về sau nó là hồ sơ bình
 * thường như mọi hồ sơ khác, chỉ là mọi số đếm bằng 0 và hai cột nullable để trống.
 *
 * Hai cột `null` chính là thứ phân biệt "chưa có quan hệ tín dụng" với "nhóm 1,
 * sạch nợ" — nên hồ sơ mới nhận điểm nền chứ không nhận điểm tuyệt đối.
 */
export function dungHoSoMoi(soCccd) {
  return {
    soCccd,
    phienBan: 1,
    hieuLucTu: homNay(),
    hoTen: HO_TEN_CHUA_RO,
    tenKichBan: KICH_BAN_HO_SO_MOI,
    ghiChu: 'Tự dựng khi tra cứu lần đầu, CCCD chưa có trong dữ liệu',
    nhomNoCaoNhat: null,
    soLanTreHan12Thang: 0,
    soLanTreHan24Thang: 0,
    soNgayTreDaiNhat: 0,
    soThangTuLanTreGanNhat: CHUA_TUNG_TRE_HAN,
    tongDuNo: 0,
    tongHanMuc: 0,
    duNoTheTinDung: 0,
    hanMucThe: 0,
    ngayMoQuanHeDauTien: null,
    soLanTraCuu6Thang: 0,
    soHopDongMoMoi6Thang: 0,
    soHopDongDangCo: 0,
    soLoaiSanPham: 0,
  }
}

/**
 * Danh sách phiên bản hiện hành của mọi CCCD, có lọc và phân trang.
 *
 * Kèm điểm cho tiện hiển thị nhưng KHÔNG ghi nhật ký: nhật ký dành cho lượt tra cứu
 * thật của một CCCD, nếu ghi ở đây thì mỗi lần mở danh sách sẽ đẻ ra hàng trăm dòng rác.
 */
export async function timDanhSach(tuKhoa, nhomNo, trang, kichThuoc) {
  if (nhomNo != null && (nhomNo < 1 || nhomNo > 5)) {
    throw new DuLieuKhongHopLe(`nhomNo phải nằm trong [1, 5], nhận được: ${nhomNo}`)
  }

  const mau = tuKhoa == null || String(tuKhoa).trim() === '' ? null : String(tuKhoa)
  const t = await repo.timDanhSachPhienBanMoiNhat(
    mau,
    nhomNo ?? null,
    Math.max(0, trang),
    Math.min(KICH_THUOC_TRANG_TOI_DA, Math.max(1, kichThuoc)),
  )

  return {
    noiDung: t.noiDung.map((h) => raTomTat(h, tinhDiem(h).diemCic)),
    trang: t.trang,
    kichThuoc: t.kichThuoc,
    tongSo: t.tongSo,
    tongTrang: t.tongTrang,
  }
}

/**
 * Hồ sơ thô, phiên bản mới nhất.
 *
 * CCCD chưa có trong dữ liệu vẫn trả kết quả — nhất quán với endpoint tra cứu. Khi
 * đó thân phản hồi là hồ sơ tín dụng mới mà hệ thống SẼ dùng, và ghi rõ trong
 * `ghiChu` rằng nó chưa được lưu. GET không ghi dữ liệu.
 */
export async function xemHoSo(soCccdTho) {
  const soCccd = chuanHoaCccd(soCccdTho)
  const daCo = await repo.timPhienBanMoiNhatCua(soCccd)
  if (daCo) return raHoSo(daCo)

  const moi = dungHoSoMoi(soCccd)
  moi.ghiChu = 'CCCD chưa có trong dữ liệu. Đây là hồ sơ tín dụng mới '
    + 'mà hệ thống sẽ dùng, chưa được lưu'
  return raHoSo(moi)
}

/** Toàn bộ phiên bản của một CCCD, cũ đến mới. CCCD chưa có thì trả danh sách rỗng. */
export async function xemLichSu(soCccdTho) {
  const soCccd = chuanHoaCccd(soCccdTho)
  const phienBan = (await repo.timTatCaTheoCccd(soCccd)).map(raHoSo)
  return { soCccd, soPhienBan: phienBan.length, phienBan }
}

/**
 * Thêm một phiên bản mới cho một CCCD: `phienBan = max + 1`; không dòng cũ nào bị
 * ghi đè.
 */
export async function taoPhienBanMoi(yeuCau) {
  kiemTraTruongBatBuoc(yeuCau)

  const soCccd = chuanHoaCccd(yeuCau.soCccd)
  const hieuLucTu = yeuCau.hieuLucTu ?? homNay()

  const hoSo = {
    soCccd,
    phienBan: ((await repo.timMaxPhienBan(soCccd)) ?? 0) + 1,
    hieuLucTu,
    hoTen: yeuCau.hoTen,
    tenKichBan: yeuCau.tenKichBan ?? null,
    ghiChu: yeuCau.ghiChu ?? null,
    nhomNoCaoNhat: yeuCau.nhomNoCaoNhat ?? null,
    soLanTreHan12Thang: yeuCau.soLanTreHan12Thang,
    soLanTreHan24Thang: yeuCau.soLanTreHan24Thang,
    soNgayTreDaiNhat: yeuCau.soNgayTreDaiNhat,
    soThangTuLanTreGanNhat: yeuCau.soThangTuLanTreGanNhat,
    tongDuNo: yeuCau.tongDuNo,
    tongHanMuc: yeuCau.tongHanMuc,
    duNoTheTinDung: yeuCau.duNoTheTinDung,
    hanMucThe: yeuCau.hanMucThe,
    ngayMoQuanHeDauTien: yeuCau.ngayMoQuanHeDauTien ?? null,
    soLanTraCuu6Thang: yeuCau.soLanTraCuu6Thang,
    soHopDongMoMoi6Thang: yeuCau.soHopDongMoMoi6Thang,
    soHopDongDangCo: yeuCau.soHopDongDangCo,
    soLoaiSanPham: yeuCau.soLoaiSanPham,
  }

  kiemTraRangBuocNghiepVu(hoSo)
  return raHoSo(await repo.luuHoSo(hoSo))
}

// ── Kiểm tra dữ liệu vào ─────────────────────────────────────────────────────

const NGAY_ISO = /^\d{4}-\d{2}-\d{2}$/

const SO_NGUYEN_KHONG_AM = [
  'soLanTreHan12Thang', 'soLanTreHan24Thang', 'soNgayTreDaiNhat',
  'tongDuNo', 'tongHanMuc', 'duNoTheTinDung', 'hanMucThe',
  'soLanTraCuu6Thang', 'soHopDongMoMoi6Thang', 'soHopDongDangCo', 'soLoaiSanPham',
]

/**
 * Thay cho bean validation của `TaoHoSoRequest`. Gom mọi lỗi rồi báo một lần, nối
 * bằng "; " — giống hệt cách `XuLyLoiToanCuc` bản Java gộp field errors.
 */
function kiemTraTruongBatBuoc(y) {
  const loi = []

  if (y == null || typeof y !== 'object') {
    throw new DuLieuKhongHopLe(
      'Không đọc được dữ liệu gửi lên: thân request phải là JSON object')
  }
  if (y.soCccd == null || String(y.soCccd).trim() === '') {
    loi.push('soCccd: soCccd không được để trống')
  } else if (!/^\d{12}$/.test(String(y.soCccd).trim())) {
    loi.push('soCccd: soCccd phải gồm đúng 12 chữ số')
  }
  if (y.hoTen == null || String(y.hoTen).trim() === '') {
    loi.push('hoTen: hoTen không được để trống')
  } else if (String(y.hoTen).length > 120) {
    loi.push('hoTen: hoTen tối đa 120 ký tự')
  }
  if (y.tenKichBan != null && String(y.tenKichBan).length > 120) {
    loi.push('tenKichBan: tenKichBan tối đa 120 ký tự')
  }
  if (y.nhomNoCaoNhat != null
      && (!Number.isInteger(y.nhomNoCaoNhat) || y.nhomNoCaoNhat < 1 || y.nhomNoCaoNhat > 5)) {
    loi.push('nhomNoCaoNhat: nhomNoCaoNhat phải trong [1, 5] hoặc null')
  }

  for (const ten of SO_NGUYEN_KHONG_AM) {
    const v = y[ten]
    if (v == null) loi.push(`${ten}: không được để trống`)
    else if (!Number.isInteger(v) || v < 0) loi.push(`${ten}: ${ten} không được âm`)
  }

  const thang = y.soThangTuLanTreGanNhat
  if (thang == null) {
    loi.push('soThangTuLanTreGanNhat: không được để trống')
  } else if (!Number.isInteger(thang) || thang < -1) {
    loi.push('soThangTuLanTreGanNhat: soThangTuLanTreGanNhat tối thiểu là -1 (chưa từng trễ)')
  }

  for (const ten of ['hieuLucTu', 'ngayMoQuanHeDauTien']) {
    if (y[ten] != null && !NGAY_ISO.test(String(y[ten]))) {
      loi.push(`${ten}: phải có dạng yyyy-MM-dd`)
    }
  }

  if (loi.length > 0) {
    throw new DuLieuKhongHopLe([...new Set(loi)].join('; '))
  }
}

/**
 * Sáu ràng buộc nghiệp vụ.
 *
 * Bản Java kiểm ở cả tầng service lẫn CHECK constraint của PostgreSQL. Ở đây không
 * có tầng DB nào để dựa vào, nên đây là chốt chặn duy nhất — càng phải giữ đủ.
 */
export function kiemTraRangBuocNghiepVu(h) {
  if (h.nhomNoCaoNhat != null && (h.nhomNoCaoNhat < 1 || h.nhomNoCaoNhat > 5)) {
    throw new DuLieuKhongHopLe(
      `nhomNoCaoNhat phải nằm trong [1, 5] hoặc để null, nhận được: ${h.nhomNoCaoNhat}`)
  }
  if (h.tongDuNo > h.tongHanMuc) {
    throw new DuLieuKhongHopLe(
      `tongDuNo (${h.tongDuNo}) không được vượt tongHanMuc (${h.tongHanMuc})`)
  }
  if (h.duNoTheTinDung > h.hanMucThe) {
    throw new DuLieuKhongHopLe(
      `duNoTheTinDung (${h.duNoTheTinDung}) không được vượt hanMucThe (${h.hanMucThe})`)
  }
  if (h.ngayMoQuanHeDauTien != null
      && soSanhNgay(h.ngayMoQuanHeDauTien, h.hieuLucTu) > 0) {
    throw new DuLieuKhongHopLe(
      `ngayMoQuanHeDauTien (${h.ngayMoQuanHeDauTien}) không được sau hieuLucTu (${h.hieuLucTu})`)
  }
  if (h.nhomNoCaoNhat != null && h.nhomNoCaoNhat >= 2 && h.soThangTuLanTreGanNhat < 0) {
    throw new DuLieuKhongHopLe(
      `nhomNoCaoNhat = ${h.nhomNoCaoNhat} nhưng soThangTuLanTreGanNhat = -1: `
      + `hồ sơ không thể vừa có nợ nhóm ${h.nhomNoCaoNhat} vừa chưa từng trễ hạn`)
  }
  if (h.soLanTreHan12Thang > h.soLanTreHan24Thang) {
    throw new DuLieuKhongHopLe(
      `soLanTreHan12Thang (${h.soLanTreHan12Thang}) không được vượt soLanTreHan24Thang `
      + `(${h.soLanTreHan24Thang})`)
  }
}

export { raHoSo }
