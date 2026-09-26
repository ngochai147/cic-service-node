/**
 * Truy vấn trên hai "bảng" trong file JSON.
 *
 * Thay cho `HoSoTinDungRepository` và `NhatKyTraCuuRepository` của bản Java. Mỗi
 * hàm ở đây tương ứng một truy vấn JPA, tên giữ nguyên để đối chiếu được.
 *
 * `ho_so_tin_dung` là bảng CHỈ GHI THÊM: mỗi thay đổi của một CCCD là một dòng mới
 * với `phienBan = max + 1`. Không hàm nào ở đây sửa hay xoá một dòng đã có.
 */
import { kho } from './kho-luu-tru.js'
import { mocThoiGian } from '../ho-tro/ngay.js'

const dsHoSo = (d) => d.hoSoTinDung
const dsNhatKy = (d) => d.nhatKyTraCuu

/** Id kế tiếp cho một bảng — thay cho BIGSERIAL của PostgreSQL. */
function idKeTiep(danhSach) {
  return danhSach.reduce((max, b) => Math.max(max, b.id ?? 0), 0) + 1
}

// ── ho_so_tin_dung ───────────────────────────────────────────────────────────

/** Phiên bản mới nhất của một CCCD — nguồn duy nhất để tính điểm. */
export async function timPhienBanMoiNhatCua(soCccd) {
  const d = await kho.layDuLieu()
  return dsHoSo(d)
    .filter((h) => h.soCccd === soCccd)
    .reduce((moiNhat, h) => (!moiNhat || h.phienBan > moiNhat.phienBan ? h : moiNhat), null)
}

/** Toàn bộ lịch sử phiên bản của một CCCD, cũ → mới. */
export async function timTatCaTheoCccd(soCccd) {
  const d = await kho.layDuLieu()
  return dsHoSo(d)
    .filter((h) => h.soCccd === soCccd)
    .sort((a, b) => a.phienBan - b.phienBan)
}

/** Phiên bản mới nhất của MỌI CCCD — ảnh chụp hiện hành của mỗi người. */
export async function layToanBoPhienBanMoiNhat() {
  const d = await kho.layDuLieu()
  const theoCccd = new Map()
  for (const h of dsHoSo(d)) {
    const cu = theoCccd.get(h.soCccd)
    if (!cu || h.phienBan > cu.phienBan) theoCccd.set(h.soCccd, h)
  }
  return [...theoCccd.values()]
}

/** Tổng số dòng, khác số CCCD vì mỗi người có nhiều phiên bản. */
export async function demBanGhi() {
  const d = await kho.layDuLieu()
  return dsHoSo(d).length
}

/** Số CCCD phân biệt. */
export async function demSoCccd() {
  const d = await kho.layDuLieu()
  return new Set(dsHoSo(d).map((h) => h.soCccd)).size
}

/**
 * Phiên bản mới nhất của mọi CCCD, có lọc và phân trang.
 *
 * @param {string|null} tuKhoa khớp một phần số CCCD hoặc họ tên, không phân biệt hoa thường
 * @param {number|null} nhomNo lọc theo nhóm nợ 1..5
 */
export async function timDanhSachPhienBanMoiNhat(tuKhoa, nhomNo, trang, kichThuoc) {
  let hienHanh = await layToanBoPhienBanMoiNhat()

  if (tuKhoa) {
    const mau = tuKhoa.trim().toLowerCase()
    hienHanh = hienHanh.filter(
      (h) => h.soCccd.includes(mau) || (h.hoTen ?? '').toLowerCase().includes(mau),
    )
  }
  if (nhomNo != null) {
    hienHanh = hienHanh.filter((h) => h.nhomNoCaoNhat === nhomNo)
  }

  hienHanh.sort((a, b) => a.soCccd.localeCompare(b.soCccd))

  const tongSo = hienHanh.length
  const tongTrang = kichThuoc > 0 ? Math.ceil(tongSo / kichThuoc) : 0
  const noiDung = hienHanh.slice(trang * kichThuoc, trang * kichThuoc + kichThuoc)

  return { noiDung, trang, kichThuoc, tongSo, tongTrang }
}

/** Số phiên bản lớn nhất của một CCCD, `null` nếu chưa có dòng nào. */
export async function timMaxPhienBan(soCccd) {
  const d = await kho.layDuLieu()
  const cua = dsHoSo(d).filter((h) => h.soCccd === soCccd)
  return cua.length === 0 ? null : Math.max(...cua.map((h) => h.phienBan))
}

/** Thêm một dòng hồ sơ. Chỉ ghi thêm, không đụng dòng cũ. */
export async function luuHoSo(hoSo) {
  return kho.capNhat((d) => {
    const ban = { id: idKeTiep(dsHoSo(d)), ...hoSo }
    dsHoSo(d).push(ban)
    return ban
  })
}

// ── nhat_ky_tra_cuu ──────────────────────────────────────────────────────────

/** Thêm một dòng nhật ký tra cứu. */
export async function luuNhatKy(ban) {
  return kho.capNhat((d) => {
    const dong = { id: idKeTiep(dsNhatKy(d)), ...ban }
    dsNhatKy(d).push(dong)
    return dong
  })
}

/**
 * Nhật ký theo điều kiện, mới nhất trước.
 *
 * @param {string|null} soCccd `null` = mọi CCCD
 * @param {number} tu  mốc epoch ms, chặn dưới
 * @param {number} den mốc epoch ms, chặn trên
 */
export async function timNhatKyTheoDieuKien(soCccd, tu, den) {
  const d = await kho.layDuLieu()
  return dsNhatKy(d)
    .filter((n) => {
      if (soCccd && n.soCccd !== soCccd) return false
      const moc = mocThoiGian(n.thoiDiem)
      return moc >= tu && moc <= den
    })
    .sort((a, b) => mocThoiGian(b.thoiDiem) - mocThoiGian(a.thoiDiem))
}
