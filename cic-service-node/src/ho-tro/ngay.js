/**
 * Tiện ích ngày tháng, thay cho java.time.
 *
 * Ngày trong hệ thống luôn là chuỗi 'yyyy-MM-dd' — không dùng Date object cho dữ
 * liệu nghiệp vụ, để tránh mọi bất ngờ về múi giờ khi tuần tự hoá ra JSON.
 */
import { MUI_GIO } from '../cau-hinh.js'

const MOT_NGAY_MS = 86_400_000

/** Đổi 'yyyy-MM-dd' sang mốc epoch UTC — chỉ để trừ hai ngày cho nhau. */
function mocUtc(ngayIso) {
  const [nam, thang, ngay] = ngayIso.split('-').map(Number)
  return Date.UTC(nam, thang - 1, ngay)
}

/** Số ngày giữa hai mốc 'yyyy-MM-dd', tương đương ChronoUnit.DAYS.between. */
export function soNgayGiua(tuIso, denIso) {
  return Math.round((mocUtc(denIso) - mocUtc(tuIso)) / MOT_NGAY_MS)
}

/**
 * Số tháng trọn vẹn giữa hai mốc, tương đương ChronoUnit.MONTHS.between:
 * chỉ đếm tháng đã đủ ngày, phần lẻ bị cắt về phía 0.
 */
export function soThangGiua(tuIso, denIso) {
  const [n1, t1, g1] = tuIso.split('-').map(Number)
  const [n2, t2, g2] = denIso.split('-').map(Number)
  let thang = (n2 - n1) * 12 + (t2 - t1)
  if (g2 < g1) thang -= 1
  return thang
}

/** So sánh hai ngày ISO: -1, 0 hoặc 1. Chuỗi ISO so sánh từ điển là đúng thứ tự. */
export function soSanhNgay(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Hôm nay theo múi giờ hệ thống, dạng 'yyyy-MM-dd'. */
export function homNay(luc = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MUI_GIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(luc)
}

/**
 * Thời điểm hiện tại theo múi giờ hệ thống, dạng OffsetDateTime của Java
 * (`2026-08-07T15:04:05+07:00`), đã cắt phần giây lẻ.
 */
export function bayGio(luc = new Date()) {
  const phan = new Intl.DateTimeFormat('en-CA', {
    timeZone: MUI_GIO,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(luc).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {})

  // Lệch múi giờ suy ra từ chính chuỗi đã định dạng, không hardcode +07:00.
  const nhuUtc = Date.UTC(
    Number(phan.year), Number(phan.month) - 1, Number(phan.day),
    Number(phan.hour) % 24, Number(phan.minute), Number(phan.second),
  )
  const lechPhut = Math.round((nhuUtc - Math.floor(luc.getTime() / 1000) * 1000) / 60000)
  const dau = lechPhut >= 0 ? '+' : '-'
  const tuyetDoi = Math.abs(lechPhut)
  const gio = String(Math.floor(tuyetDoi / 60)).padStart(2, '0')
  const phut = String(tuyetDoi % 60).padStart(2, '0')

  const h = String(Number(phan.hour) % 24).padStart(2, '0')
  return `${phan.year}-${phan.month}-${phan.day}T${h}:${phan.minute}:${phan.second}${dau}${gio}:${phut}`
}

/** Mốc epoch (ms) của một chuỗi OffsetDateTime — dùng để lọc và sắp xếp nhật ký. */
export function mocThoiGian(chuoi) {
  return new Date(chuoi).getTime()
}
