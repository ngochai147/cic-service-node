/**
 * Truy vấn nhật ký tra cứu. Cả ba tham số lọc đều tuỳ chọn.
 * Cổng port từ `NhatKyServiceImpl.java`.
 */
import * as repo from '../du-lieu/kho-ho-so.js'
import { chuanHoaCccd } from '../ho-tro/kiem-tra-cccd.js'
import { DuLieuKhongHopLe } from '../ho-tro/loi.js'
import { MUI_GIO } from '../cau-hinh.js'

const NGAY_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Hai mốc bao trọn mọi dữ liệu có thể có, dùng khi người gọi không chặn đầu nào. */
const MOC_XA_NHAT_TRUOC = Date.UTC(1970, 0, 1)
const MOC_XA_NHAT_SAU = Date.UTC(9999, 11, 31, 23, 59, 59)

/**
 * Lệch múi giờ (ms) của một ngày cụ thể tại múi giờ hệ thống.
 *
 * Tính từ chính ngày đó chứ không hardcode +07:00: Việt Nam hiện không đổi giờ
 * nhưng công thức này không phụ thuộc vào điều đó.
 */
function lechMuiGio(ngayIso) {
  const moc = new Date(`${ngayIso}T00:00:00Z`)
  const nhuMuiGio = new Date(
    moc.toLocaleString('en-US', { timeZone: MUI_GIO }),
  )
  const nhuUtc = new Date(moc.toLocaleString('en-US', { timeZone: 'UTC' }))
  return nhuMuiGio.getTime() - nhuUtc.getTime()
}

/** 00:00 của một ngày tại múi giờ hệ thống, quy về epoch ms. */
function dauNgay(ngayIso) {
  return Date.parse(`${ngayIso}T00:00:00Z`) - lechMuiGio(ngayIso)
}

/** 23:59:59.999 của một ngày tại múi giờ hệ thống, quy về epoch ms. */
function cuoiNgay(ngayIso) {
  return dauNgay(ngayIso) + 86_400_000 - 1
}

function kiemTraNgay(ten, giaTri) {
  if (giaTri != null && !NGAY_ISO.test(String(giaTri))) {
    throw new DuLieuKhongHopLe(
      `Không đọc được dữ liệu gửi lên: ${ten} phải có dạng yyyy-MM-dd, nhận được: ${giaTri}`)
  }
}

/**
 * Nhật ký tra cứu, mới nhất trước.
 *
 * @param soCccd lọc theo CCCD, `null` = mọi CCCD
 * @param tu     tính từ 00:00 của ngày này, `null` = không chặn dưới
 * @param den    tính đến hết 23:59:59 của ngày này, `null` = không chặn trên
 */
export async function timNhatKy(soCccd, tu, den) {
  kiemTraNgay('tu', tu)
  kiemTraNgay('den', den)

  const cccd = soCccd == null || String(soCccd).trim() === ''
    ? null
    : chuanHoaCccd(soCccd)

  const moc0 = tu == null ? MOC_XA_NHAT_TRUOC : dauNgay(tu)
  const moc1 = den == null ? MOC_XA_NHAT_SAU : cuoiNgay(den)

  const dong = await repo.timNhatKyTheoDieuKien(cccd, moc0, moc1)
  return dong.map((n) => ({
    id: n.id,
    soCccd: n.soCccd,
    diemTraVe: n.diemTraVe,
    phienBanSuDung: n.phienBanSuDung,
    thoiDiem: n.thoiDiem,
  }))
}
