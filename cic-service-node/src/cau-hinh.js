/**
 * Toàn bộ trọng số và ngưỡng của bộ tính điểm.
 *
 * Bản Java giữ những con số này trong `application.yml` và nạp qua
 * `ThamSoChamDiem`. Ở đây chúng nằm trong một object JS, đọc đè được bằng biến môi
 * trường cho hai tham số mô phỏng. Mọi giá trị phải khớp tuyệt đối với bản Java —
 * đây là thứ quyết định điểm, lệch một con số là hai service trả hai kết quả khác nhau.
 *
 * Cấu hình sai thì tiến trình phải chết ngay lúc khởi động, chứ không trả điểm sai
 * suốt vòng đời.
 */

/** Múi giờ duy nhất của hệ thống, khớp `CauHinhChung.MUI_GIO` bản Java. */
export const MUI_GIO = 'Asia/Ho_Chi_Minh'

const SAI_SO_TRONG_SO = 1e-9

export const thamSoChamDiem = {
  trongSo: {
    lichSuTraNo: 0.35,
    duNoHienTai: 0.30,
    thoiGianQuanHe: 0.15,
    tinDungMoi: 0.10,
    coCauTinDung: 0.10,
  },

  thang: {
    diemToiThieu: 150,
    diemToiDa: 750,
  },

  // ── Nhóm 1: Lịch sử trả nợ (35%) ──
  lichSuTraNo: {
    /** index 0..4 ứng với nhóm nợ 1..5 */
    mocTheoNhomNo: [100.0, 72.0, 45.0, 25.0, 8.0],
    diemNenChuaCoLichSu: 52.0,
    phatMoiLanTre12Thang: 8.0,
    phatMoiLanTre24Thang: 6.0,
    phatMoiNgayTre: 0.05,
    phatToiDaTheoNgayTre: 20.0,
    soThangHoiPhucDayDu: 48,
    tyLeHoiPhucToiDa: 0.6,
  },

  // ── Nhóm 2: Dư nợ hiện tại (30%) ──
  duNo: {
    trongSoTong: 0.6,
    trongSoThe: 0.4,
    diemNenKhongCoHanMuc: 52.0,
    /** x = tỉ lệ sử dụng, y = điểm 0..100 */
    moc: [
      { x: 0.00, y: 100.0 },
      { x: 0.10, y: 100.0 },
      { x: 0.30, y: 80.0 },
      { x: 0.50, y: 60.0 },
      { x: 0.75, y: 30.0 },
      { x: 1.00, y: 0.0 },
    ],
  },

  // ── Nhóm 3: Thời gian quan hệ tín dụng (15%) ──
  thoiGianQuanHe: {
    diemNenChuaCoQuanHe: 32.0,
    /** x = số năm, y = điểm 0..100; bão hoà từ 7 năm */
    moc: [
      { x: 0.0, y: 10.0 },
      { x: 1.0, y: 30.0 },
      { x: 2.0, y: 45.0 },
      { x: 3.0, y: 60.0 },
      { x: 5.0, y: 82.0 },
      { x: 7.0, y: 100.0 },
    ],
  },

  // ── Nhóm 4: Tín dụng mới (10%) ──
  tinDungMoi: {
    diemGoc: 100.0,
    phatMoiLanTraCuu: 8.0,
    phatMoiHopDongMoi: 12.0,
  },

  // ── Nhóm 5: Cơ cấu tín dụng (10%) ──
  coCauTinDung: {
    diemNenKhongCoHopDong: 38.0,
    /** index 0..3 ứng với số loại sản phẩm 1..4+ */
    mocTheoSoLoaiSanPham: [55.0, 75.0, 90.0, 100.0],
  },
}

/**
 * Mô phỏng sự cố hạ tầng CIC. Đây là nơi DUY NHẤT có số ngẫu nhiên trong toàn hệ
 * thống, và nó nằm ở tầng middleware, hoàn toàn ngoài bộ tính điểm — request nào đi
 * qua được thì vẫn nhận đúng con số như khi tắt mô phỏng.
 */
export const thamSoMoPhong = {
  doTreMs: Number(process.env.CIC_MO_PHONG_DO_TRE_MS ?? 0),
  tyLeLoi: Number(process.env.CIC_MO_PHONG_TY_LE_LOI ?? 0),
  get dangBat() {
    return this.doTreMs > 0 || this.tyLeLoi > 0
  },
}

function kiemTraMoc(duongDan, moc) {
  if (moc.length < 2) {
    throw new Error(`${duongDan} phải có ít nhất 2 mốc`)
  }
  for (let i = 1; i < moc.length; i++) {
    if (moc[i].x <= moc[i - 1].x) {
      throw new Error(`${duongDan}: trục x phải tăng dần nghiêm ngặt`)
    }
  }
}

/** Cổng kiểm tra cấu hình, gọi ngay lúc nạp module. */
export function kiemTraCauHinh(ts = thamSoChamDiem) {
  const w = ts.trongSo
  const tong = w.lichSuTraNo + w.duNoHienTai + w.thoiGianQuanHe + w.tinDungMoi + w.coCauTinDung
  if (Math.abs(tong - 1.0) > SAI_SO_TRONG_SO) {
    throw new Error(`trongSo: tổng 5 trọng số phải bằng 1.0 nhưng đang là ${tong}`)
  }
  if (ts.thang.diemToiThieu >= ts.thang.diemToiDa) {
    throw new Error('thang: diemToiThieu phải nhỏ hơn diemToiDa')
  }
  if (ts.lichSuTraNo.mocTheoNhomNo.length !== 5) {
    throw new Error('lichSuTraNo.mocTheoNhomNo phải có đúng 5 phần tử (nhóm 1..5)')
  }
  if (ts.coCauTinDung.mocTheoSoLoaiSanPham.length === 0) {
    throw new Error('coCauTinDung.mocTheoSoLoaiSanPham không được rỗng')
  }
  kiemTraMoc('duNo.moc', ts.duNo.moc)
  kiemTraMoc('thoiGianQuanHe.moc', ts.thoiGianQuanHe.moc)

  if (thamSoMoPhong.tyLeLoi < 0 || thamSoMoPhong.tyLeLoi > 1) {
    throw new Error('moPhong.tyLeLoi phải nằm trong [0, 1]')
  }
  return ts
}

kiemTraCauHinh()
