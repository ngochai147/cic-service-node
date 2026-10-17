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

// ── Ngày và thời điểm của sự kiện tích hợp FINORA ────────────────────────────
// Dữ liệu từ ngoài vào nên kiểm chặt bằng tay, không giao cho `Date.parse` (V8 nhận cả
// những chuỗi mà `Instant.parse`/`LocalDate.parse` của Java từ chối).

const NGAY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const THOI_DIEM_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/
const NANO_MOI_MS = 1_000_000n

/** Năm nhuận theo lịch Gregory, giống `java.time`. */
function laNamNhuan(nam) {
  return (nam % 4 === 0 && nam % 100 !== 0) || nam % 400 === 0
}

function soNgayTrongThang(nam, thang) {
  return [31, laNamNhuan(nam) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][thang - 1]
}

const hai = (n) => String(n).padStart(2, '0')

/** `true` nếu là ngày 'yyyy-MM-dd' có thật trên lịch — tương đương `LocalDate.parse` thành công. */
export function laNgayIsoHopLe(chuoi) {
  if (typeof chuoi !== 'string') return false
  const m = NGAY_ISO.exec(chuoi)
  if (!m) return false
  const [nam, thang, ngay] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return thang >= 1 && thang <= 12 && ngay >= 1 && ngay <= soNgayTrongThang(nam, thang)
}

/**
 * Cộng tháng vào một ngày 'yyyy-MM-dd', tương đương `LocalDate.plusMonths`: ngày vượt
 * cuối tháng đích thì lùi về ngày cuối tháng (31/01 + 1 tháng = 28/02 hoặc 29/02).
 */
export function congThang(ngayIso, soThang) {
  const [nam, thang, ngay] = ngayIso.split('-').map(Number)
  const tong = nam * 12 + (thang - 1) + soThang
  const namMoi = Math.floor(tong / 12)
  const thangMoi = tong - namMoi * 12 + 1
  const ngayMoi = Math.min(ngay, soNgayTrongThang(namMoi, thangMoi))
  return `${String(namMoi).padStart(4, '0')}-${hai(thangMoi)}-${hai(ngayMoi)}`
}

/**
 * Đọc thời điểm ISO-8601 có múi giờ (`Z` hoặc `±HH:mm`), phần lẻ giây tối đa 9 chữ số —
 * cùng tập chuỗi mà `Instant.parse` của Java 21 nhận với dữ liệu FINORA gửi.
 *
 * @returns số nano-giây kể từ epoch (BigInt) để so thứ tự không mất phần micro/nano giây,
 *          hoặc `null` nếu sai dạng hay ngày giờ không có thật
 */
export function docThoiDiemIso(chuoi) {
  if (typeof chuoi !== 'string') return null
  const m = THOI_DIEM_ISO.exec(chuoi)
  if (!m) return null
  const [nam, thang, ngay, gio, phut, giay] = m.slice(1, 7).map(Number)
  if (thang < 1 || thang > 12 || ngay < 1 || ngay > soNgayTrongThang(nam, thang)
      || gio > 23 || phut > 59 || giay > 59) {
    return null
  }
  let lechPhut = 0
  if (m[8] !== 'Z') {
    const [lechGio, lechPhutLe] = m[8].slice(1).split(':').map(Number)
    if (lechPhutLe > 59 || lechGio * 60 + lechPhutLe > 18 * 60) return null
    lechPhut = (m[8][0] === '-' ? -1 : 1) * (lechGio * 60 + lechPhutLe)
  }
  // setUTCFullYear thay cho Date.UTC: Date.UTC hiểu năm 0..99 thành 1900..1999.
  const moc = new Date(0)
  moc.setUTCFullYear(nam, thang - 1, ngay)
  moc.setUTCHours(gio, phut, giay, 0)
  const msNguyenGiay = moc.getTime() - lechPhut * 60_000
  return BigInt(msNguyenGiay) * NANO_MOI_MS + BigInt((m[7] ?? '').padEnd(9, '0'))
}

/**
 * Ngày lịch theo múi giờ hệ thống của một mốc nano-giây — tương đương
 * `instant.atZone(MUI_GIO).toLocalDate()`.
 */
export function ngayTheoMuiGio(nanoGiay) {
  let ms = nanoGiay / NANO_MOI_MS
  if (nanoGiay < 0n && nanoGiay % NANO_MOI_MS !== 0n) ms -= 1n
  return homNay(new Date(Number(ms)))
}
