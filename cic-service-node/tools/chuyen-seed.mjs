/**
 * Chuyển V2__seed_ho_so_tin_dung.sql (1000 dòng INSERT) sang dulieu/du-lieu.json.
 *
 * Chạy một lần khi khởi tạo dự án. Giữ lại để tái sinh file JSON gốc nếu bản Java
 * cập nhật seed — đừng sửa tay file JSON đầu ra ở phần hồ sơ seed.
 *
 *   node tools/chuyen-seed.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const goc = dirname(fileURLToPath(import.meta.url))
const duongDanSql = join(
  goc, '..', '..', 'cic-service',
  'src', 'main', 'resources', 'db', 'migration', 'V2__seed_ho_so_tin_dung.sql',
)
const duongDanRa = join(goc, '..', 'dulieu', 'du-lieu.json')

/** Thứ tự cột trong câu INSERT, khớp 1-1 với thứ tự giá trị mỗi dòng. */
const COT = [
  'soCccd', 'phienBan', 'hieuLucTu', 'hoTen', 'tenKichBan', 'ghiChu',
  'nhomNoCaoNhat', 'soLanTreHan12Thang', 'soLanTreHan24Thang',
  'soNgayTreDaiNhat', 'soThangTuLanTreGanNhat',
  'tongDuNo', 'tongHanMuc', 'duNoTheTinDung', 'hanMucThe',
  'ngayMoQuanHeDauTien', 'soLanTraCuu6Thang', 'soHopDongMoMoi6Thang',
  'soHopDongDangCo', 'soLoaiSanPham',
]

/** Cột kiểu chuỗi — phần còn lại là số hoặc null. */
const COT_CHUOI = new Set([
  'soCccd', 'hieuLucTu', 'hoTen', 'tenKichBan', 'ghiChu', 'ngayMoQuanHeDauTien',
])

/**
 * Tách một dòng VALUES thành mảng token, tôn trọng dấu nháy đơn của SQL
 * (bao gồm '' là một dấu nháy escape bên trong chuỗi).
 */
function tachGiaTri(dong) {
  const ra = []
  let dem = ''
  let trongChuoi = false

  for (let i = 0; i < dong.length; i++) {
    const c = dong[i]
    if (trongChuoi) {
      if (c === "'") {
        if (dong[i + 1] === "'") { dem += "'"; i++ } else { trongChuoi = false }
      } else {
        dem += c
      }
    } else if (c === "'") {
      trongChuoi = true
    } else if (c === ',') {
      ra.push(dem.trim()); dem = ''
    } else {
      dem += c
    }
  }
  ra.push(dem.trim())
  return ra
}

const sql = readFileSync(duongDanSql, 'utf8')
const dongDuLieu = sql
  .split('\n')
  .map((d) => d.trim())
  .filter((d) => d.startsWith("('"))

if (dongDuLieu.length !== 1000) {
  throw new Error(`Kỳ vọng 1000 dòng seed, đọc được ${dongDuLieu.length}`)
}

const hoSo = dongDuLieu.map((dongTho, chiSo) => {
  // bỏ '(' đầu và ')' hoặc '),' / ');' cuối
  const dong = dongTho.replace(/^\(/, '').replace(/\)[,;]?$/, '')
  const gt = tachGiaTri(dong)
  if (gt.length !== COT.length) {
    throw new Error(`Dòng ${chiSo + 1}: kỳ vọng ${COT.length} giá trị, đọc được ${gt.length}`)
  }

  const ban = { id: chiSo + 1 }
  COT.forEach((ten, i) => {
    const tho = gt[i]
    if (tho === 'NULL') { ban[ten] = null; return }
    ban[ten] = COT_CHUOI.has(ten) ? tho : Number(tho)
  })
  return ban
})

mkdirSync(dirname(duongDanRa), { recursive: true })
writeFileSync(
  duongDanRa,
  JSON.stringify({ hoSoTinDung: hoSo, nhatKyTraCuu: [] }, null, 2) + '\n',
  'utf8',
)

console.log(`Đã ghi ${hoSo.length} hồ sơ vào ${duongDanRa}`)
