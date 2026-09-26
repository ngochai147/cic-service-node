/**
 * Luồng tra cứu điểm tín dụng — endpoint chính của service.
 *
 *   validate CCCD
 *     -> tìm phiên bản mới nhất
 *          tìm thấy     -> dùng luôn
 *          không thấy   -> dựng hồ sơ tín dụng mới, LƯU lại
 *     -> tinhDiem(hoSo)
 *     -> ghi nhat_ky_tra_cuu
 *     -> 200 OK
 *
 * Không có nhánh nào trả 404. CCCD chưa tồn tại không phải lỗi.
 * Cổng port từ `TraCuuServiceImpl.java`.
 */
import * as repo from '../du-lieu/kho-ho-so.js'
import { chuanHoaCccd } from '../ho-tro/kiem-tra-cccd.js'
import { bayGio, soThangGiua } from '../ho-tro/ngay.js'
import { tinhDiem } from '../cham-diem/bo-tinh-diem.js'
import { dungHoSoMoi } from './ho-so.js'

/** Làm tròn chỉ để hiển thị. Bộ tính điểm bên trong luôn dùng giá trị đầy đủ. */
function lamTron(x, soChuSo) {
  const heSo = 10 ** soChuSo
  return Math.round(x * heSo) / heSo
}

/**
 * Dữ liệu tín dụng thô phục vụ ML — 10 trường chọn lọc.
 * Không chứa PII (tên, CCCD), chỉ chỉ số tài chính.
 */
function hoSoTho(h) {
  const soThangQuanHe = h.ngayMoQuanHeDauTien == null
    ? null
    : soThangGiua(h.ngayMoQuanHeDauTien, h.hieuLucTu)

  return {
    soLanTreHan24Thang: h.soLanTreHan24Thang,
    soThangTuLanTreGanNhat: h.soThangTuLanTreGanNhat,
    soNgayTreDaiNhat: h.soNgayTreDaiNhat,
    nhomNoCaoNhat: h.nhomNoCaoNhat,
    tongDuNo: h.tongDuNo,
    duNoTheTinDung: h.duNoTheTinDung,
    hanMucThe: h.hanMucThe,
    soLanTraCuu6Thang: h.soLanTraCuu6Thang,
    soHopDongDangCo: h.soHopDongDangCo,
    soThangQuanHe,
  }
}

const thanhPhan = (t) => ({
  diem: lamTron(t.diem, 1),
  trongSo: t.trongSo,
  dongGop: lamTron(t.dongGop, 2),
})

/** Bảng phân rã 5 nhóm yếu tố, trả kèm khi `?chiTiet=true`. */
function phanRa(k) {
  return {
    lichSuTraNo: thanhPhan(k.lichSuTraNo),
    duNoHienTai: thanhPhan(k.duNoHienTai),
    thoiGianQuanHe: thanhPhan(k.thoiGianQuanHe),
    tinDungMoi: thanhPhan(k.tinDungMoi),
    coCauTinDung: thanhPhan(k.coCauTinDung),
    tongDiem: lamTron(k.tongDiem, 2),
  }
}

/**
 * Trả phiên bản mới nhất, hoặc dựng và lưu hồ sơ tín dụng mới nếu CCCD chưa có.
 *
 * Chỉ lưu khi CHƯA có dòng nào cho CCCD đó. Lượt tra thứ hai đọc lại đúng dòng vừa
 * lưu chứ không sinh phiên bản mới — nếu sai chỗ này thì mỗi lượt tra cứu đẻ ra một
 * phiên bản rác.
 */
async function layHoacDungHoSo(soCccd) {
  const daCo = await repo.timPhienBanMoiNhatCua(soCccd)
  if (daCo) return daCo
  return repo.luuHoSo(dungHoSoMoi(soCccd))
}

/**
 * Tra điểm tín dụng CIC theo số CCCD.
 *
 * @param {boolean} chiTiet `true` thì trả kèm bảng phân rã 5 nhóm và hồ sơ thô
 */
export async function traCuu(soCccdTho, chiTiet) {
  const soCccd = chuanHoaCccd(soCccdTho)

  const hoSo = await layHoacDungHoSo(soCccd)
  const ketQua = tinhDiem(hoSo)

  const thoiDiem = bayGio()
  await repo.luuNhatKy({
    soCccd,
    diemTraVe: ketQua.diemCic,
    phienBanSuDung: hoSo.phienBan,
    thoiDiem,
  })

  // Bản gọn: 3 trường null bị `non_null` của Jackson lược khỏi JSON bên Java, nên ở
  // đây cũng không đặt chúng vào object.
  if (!chiTiet) {
    return { soCccd, diemCic: ketQua.diemCic, thoiDiemTraCuu: thoiDiem }
  }

  return {
    soCccd,
    diemCic: ketQua.diemCic,
    phienBanHoSo: hoSo.phienBan,
    thoiDiemTraCuu: thoiDiem,
    phanRa: phanRa(ketQua),
    hoSo: hoSoTho(hoSo),
  }
}
