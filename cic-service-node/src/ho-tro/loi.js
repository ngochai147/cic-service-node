/**
 * Tập mã lỗi đóng và các lớp lỗi tương ứng.
 *
 * Bên tiêu thụ khớp theo `maLoi`, không khớp theo `thongDiep` — thông điệp là để
 * người đọc, mã lỗi là để máy đọc. Giữ nguyên 4 mã của bản Java (`MaLoi.java`).
 */

export const MaLoi = {
  CCCD_KHONG_HOP_LE: 'CCCD_KHONG_HOP_LE',
  DU_LIEU_KHONG_HOP_LE: 'DU_LIEU_KHONG_HOP_LE',
  CIC_KHONG_KHA_DUNG: 'CIC_KHONG_KHA_DUNG',
  LOI_HE_THONG: 'LOI_HE_THONG',
}

export class LoiCoMa extends Error {
  constructor(maLoi, thongDiep, httpStatus) {
    super(thongDiep)
    this.name = new.target.name
    this.maLoi = maLoi
    this.httpStatus = httpStatus
  }
}

/** Số CCCD không đúng dạng 12 chữ số. → 400 */
export class CccdKhongHopLe extends LoiCoMa {
  constructor(thongDiep) {
    super(MaLoi.CCCD_KHONG_HOP_LE, thongDiep, 400)
  }
}

/** Dữ liệu hồ sơ vi phạm một trong sáu ràng buộc nghiệp vụ. → 400 */
export class DuLieuKhongHopLe extends LoiCoMa {
  constructor(thongDiep) {
    super(MaLoi.DU_LIEU_KHONG_HOP_LE, thongDiep, 400)
  }
}

/** Chế độ mô phỏng sự cố đang bật và lượt request này bị chọn để trả 503. */
export class CicKhongKhaDung extends LoiCoMa {
  constructor(thongDiep) {
    super(MaLoi.CIC_KHONG_KHA_DUNG, thongDiep, 503)
  }
}
