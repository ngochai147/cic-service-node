/**
 * Tập mã lỗi đóng và các lớp lỗi tương ứng.
 *
 * Bên tiêu thụ khớp theo `maLoi`, không khớp theo `thongDiep` — thông điệp là để
 * người đọc, mã lỗi là để máy đọc. Giữ nguyên 4 mã của bản Java (`MaLoi.java`); mã thứ
 * năm `KHO_LUU_TRU_CONG_KHAI` là riêng của bản Node và chỉ endpoint nội bộ trả ra.
 */

export const MaLoi = {
  CCCD_KHONG_HOP_LE: 'CCCD_KHONG_HOP_LE',
  DU_LIEU_KHONG_HOP_LE: 'DU_LIEU_KHONG_HOP_LE',
  CIC_KHONG_KHA_DUNG: 'CIC_KHONG_KHA_DUNG',
  LOI_HE_THONG: 'LOI_HE_THONG',
  KHO_LUU_TRU_CONG_KHAI: 'KHO_LUU_TRU_CONG_KHAI',
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

/**
 * Sự kiện tích hợp FINORA sai envelope/header/schema. Lỗi vĩnh viễn: consumer Kafka
 * chuyển thẳng sang DLT, không thử lại (bản Java: `IllegalArgumentException` nằm trong
 * `addNotRetryableExceptions`). Đi qua HTTP thì vẫn là 400 `DU_LIEU_KHONG_HOP_LE`.
 */
export class SuKienKhongHopLe extends DuLieuKhongHopLe {}

/** Chế độ mô phỏng sự cố đang bật và lượt request này bị chọn để trả 503. */
export class CicKhongKhaDung extends LoiCoMa {
  constructor(thongDiep) {
    super(MaLoi.CIC_KHONG_KHA_DUNG, thongDiep, 503)
  }
}

/**
 * API nội bộ đang đóng (chưa cấu hình khoá) hoặc khoá sai. → 403, cùng mã và thông điệp
 * với `TruyCapNoiBoBiTuChoiException` bản Java. Hai trường hợp cố ý trả giống hệt nhau.
 */
export class TruyCapNoiBoBiTuChoi extends LoiCoMa {
  constructor(thongDiep = 'API liên kết định danh CIC chưa được phép') {
    super(MaLoi.DU_LIEU_KHONG_HOP_LE, thongDiep, 403)
  }
}

/**
 * Kho dữ liệu là Vercel Blob công khai nên từ chối lưu liên kết borrowerId ↔ CCCD.
 * → 503: `CicMappingWorker` của FINORA coi 5xx là lỗi tạm thời và tự thử lại sau khi
 * kho đã được chuyển sang nơi an toàn.
 */
export class KhoLuuTruCongKhai extends LoiCoMa {
  constructor(thongDiep) {
    super(MaLoi.KHO_LUU_TRU_CONG_KHAI, thongDiep, 503)
  }
}
