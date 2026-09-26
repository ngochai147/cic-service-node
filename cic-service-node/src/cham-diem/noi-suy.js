/**
 * Nội suy tuyến tính trên một đường gấp khúc cho trước.
 *
 * Ngoài hai đầu thì bão hoà: x nhỏ hơn mốc đầu trả y của mốc đầu, lớn hơn mốc cuối
 * trả y của mốc cuối. Nhờ vậy "bão hoà ở 7 năm" là một dòng cấu hình chứ không phải
 * một nhánh if trong code.
 *
 * Hàm này đơn điệu theo x nếu dãy y của các mốc đơn điệu.
 */
export function noiSuyTai(moc, x) {
  const dau = moc[0]
  if (x <= dau.x) return dau.y

  const cuoi = moc[moc.length - 1]
  if (x >= cuoi.x) return cuoi.y

  for (let i = 1; i < moc.length; i++) {
    const phai = moc[i]
    if (x <= phai.x) {
      const trai = moc[i - 1]
      const tyLe = (x - trai.x) / (phai.x - trai.x)
      return trai.y + tyLe * (phai.y - trai.y)
    }
  }
  return cuoi.y
}
