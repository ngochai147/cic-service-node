/** Cổng kiểm tra số CCCD, đặt trước mọi truy cập dữ liệu. */
import { CccdKhongHopLe } from './loi.js'

const DUNG_DANG = /^\d{12}$/

/**
 * @returns chính số CCCD nếu hợp lệ
 * @throws {CccdKhongHopLe} nếu null, rỗng, không đủ 12 ký tự, hoặc lẫn ký tự
 *         không phải chữ số
 */
export function chuanHoaCccd(soCccd) {
  if (soCccd == null || String(soCccd).trim() === '') {
    throw new CccdKhongHopLe('Số CCCD không được để trống')
  }
  const rutGon = String(soCccd).trim()
  if (!DUNG_DANG.test(rutGon)) {
    throw new CccdKhongHopLe(`Số CCCD phải gồm đúng 12 chữ số, nhận được: ${soCccd}`)
  }
  return rutGon
}
