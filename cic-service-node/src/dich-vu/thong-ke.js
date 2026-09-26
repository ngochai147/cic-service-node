/**
 * Thống kê tổng quan và cấu hình đang chạy — phục vụ bảng điều khiển.
 *
 * Điểm được tính lại tại đây chứ không đọc từ đâu cả, đúng như mọi chỗ khác. Nhưng
 * KHÔNG ghi nhật ký: nhật ký chỉ dành cho lượt tra cứu thật của một CCCD cụ thể.
 *
 * Cổng port từ `ThongKeServiceImpl.java`.
 */
import * as repo from '../du-lieu/kho-ho-so.js'
import { tinhDiem } from '../cham-diem/bo-tinh-diem.js'
import { thamSoChamDiem, thamSoMoPhong } from '../cau-hinh.js'

/** Mốc từ giai đoạn hiệu chuẩn, dùng làm số liệu tham khảo. */
export const NGUONG_THAM_CHIEU = 431

const NHOM_NO_XAU_TU = 3

const TEN_NHOM_NO = [
  'Chưa có quan hệ tín dụng',
  'Nhóm 1 — Tiêu chuẩn',
  'Nhóm 2 — Cần chú ý',
  'Nhóm 3 — Dưới tiêu chuẩn',
  'Nhóm 4 — Nghi ngờ',
  'Nhóm 5 — Mất vốn',
]

const DAI_DIEM = [
  { nhan: '150–300', tu: 150, den: 300 },
  { nhan: '301–430', tu: 301, den: 430 },
  { nhan: '431–550', tu: 431, den: 550 },
  { nhan: '551–650', tu: 551, den: 650 },
  { nhan: '651–750', tu: 651, den: 750 },
]

function chiSoDaiDiem(diem) {
  for (let i = 0; i < DAI_DIEM.length; i++) {
    if (diem <= DAI_DIEM[i].den) return i
  }
  return DAI_DIEM.length - 1
}

function lamTron(x, soChuSo) {
  const heSo = 10 ** soChuSo
  return Math.round(x * heSo) / heSo
}

function phanBoNhomNo(dem, tong) {
  return TEN_NHOM_NO.map((nhan, khoa) => {
    const soLuong = dem.get(khoa) ?? 0
    return { nhan, soLuong, tyLe: tong === 0 ? 0 : lamTron((100.0 * soLuong) / tong, 1) }
  })
}

function phanBoDaiDiem(dem, tong) {
  return DAI_DIEM.map((d, i) => ({
    nhan: d.nhan,
    soLuong: dem[i],
    tyLe: tong === 0 ? 0 : lamTron((100.0 * dem[i]) / tong, 1),
  }))
}

/** Thống kê trên phiên bản hiện hành của mọi CCCD. */
export async function thongKe() {
  const hienHanh = await repo.layToanBoPhienBanMoiNhat()
  const tongBanGhi = await repo.demBanGhi()
  const tongCccd = await repo.demSoCccd()

  if (hienHanh.length === 0) {
    return {
      tongBanGhi,
      tongCccd,
      tongHoSoHienHanh: 0,
      diemTrungBinh: 0,
      diemThapNhat: 0,
      diemCaoNhat: 0,
      tyLeNoXau: 0,
      tyLeDuoiNguong: 0,
      nguongThamChieu: NGUONG_THAM_CHIEU,
      theoNhomNo: phanBoNhomNo(new Map(), 0),
      theoDaiDiem: [],
    }
  }

  const demNhomNo = new Map()
  const demDaiDiem = new Array(DAI_DIEM.length).fill(0)
  let soNoXau = 0
  let soDuoiNguong = 0
  let tongDiem = 0
  let thapNhat = Number.MAX_SAFE_INTEGER
  let caoNhat = Number.MIN_SAFE_INTEGER

  for (const hoSo of hienHanh) {
    const diem = tinhDiem(hoSo).diemCic

    tongDiem += diem
    thapNhat = Math.min(thapNhat, diem)
    caoNhat = Math.max(caoNhat, diem)
    if (diem < NGUONG_THAM_CHIEU) soDuoiNguong++
    demDaiDiem[chiSoDaiDiem(diem)]++

    // khoá 0 gom nhóm "chưa có quan hệ tín dụng" (nhomNoCaoNhat = null)
    const khoa = hoSo.nhomNoCaoNhat == null ? 0 : hoSo.nhomNoCaoNhat
    demNhomNo.set(khoa, (demNhomNo.get(khoa) ?? 0) + 1)
    if (khoa >= NHOM_NO_XAU_TU) soNoXau++
  }

  const soHoSo = hienHanh.length
  return {
    tongBanGhi,
    tongCccd,
    tongHoSoHienHanh: soHoSo,
    diemTrungBinh: lamTron(tongDiem / soHoSo, 1),
    diemThapNhat: thapNhat,
    diemCaoNhat: caoNhat,
    tyLeNoXau: lamTron((100.0 * soNoXau) / soHoSo, 1),
    tyLeDuoiNguong: lamTron((100.0 * soDuoiNguong) / soHoSo, 1),
    nguongThamChieu: NGUONG_THAM_CHIEU,
    theoNhomNo: phanBoNhomNo(demNhomNo, soHoSo),
    theoDaiDiem: phanBoDaiDiem(demDaiDiem, soHoSo),
  }
}

/**
 * Cấu hình đang chạy của bộ tính điểm.
 *
 * Chỉ đọc, không có endpoint sửa — điểm phải là hàm của hồ sơ, không phải hàm của
 * trạng thái runtime mà ai cũng vặn được.
 */
export function cauHinh() {
  const w = thamSoChamDiem.trongSo

  return {
    trongSo: [
      { ma: 'lichSuTraNo', ten: 'Lịch sử trả nợ', trongSo: w.lichSuTraNo },
      { ma: 'duNoHienTai', ten: 'Dư nợ hiện tại', trongSo: w.duNoHienTai },
      { ma: 'thoiGianQuanHe', ten: 'Thời gian quan hệ tín dụng', trongSo: w.thoiGianQuanHe },
      { ma: 'tinDungMoi', ten: 'Tín dụng mới', trongSo: w.tinDungMoi },
      { ma: 'coCauTinDung', ten: 'Cơ cấu tín dụng', trongSo: w.coCauTinDung },
    ],
    diemToiThieu: thamSoChamDiem.thang.diemToiThieu,
    diemToiDa: thamSoChamDiem.thang.diemToiDa,
    moPhong: {
      doTreMs: thamSoMoPhong.doTreMs,
      tyLeLoi: thamSoMoPhong.tyLeLoi,
      dangBat: thamSoMoPhong.dangBat,
    },
  }
}
