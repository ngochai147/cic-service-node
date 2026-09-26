/**
 * Điểm khởi động khi chạy local (`npm start`).
 *
 * Trên Vercel không dùng file này — `api/index.js` export thẳng app cho runtime
 * serverless, không có ai `listen` cả.
 */
import { taoApp } from './app.js'
import { kho } from './du-lieu/kho-luu-tru.js'

const CONG = Number(process.env.CIC_PORT ?? process.env.PORT ?? 9000)

const app = taoApp()

// Nạp dữ liệu trước khi mở cổng: request đầu tiên không phải chờ đọc file, và cấu
// hình/dữ liệu hỏng thì chết ngay lúc khởi động thay vì lúc có người gọi.
const duLieu = await kho.layDuLieu()

app.listen(CONG, () => {
  console.log(
    `cic-service-node đang chạy tại http://localhost:${CONG}\n`
    + `  kho dữ liệu : ${kho.tenDriver} (${kho.nguon})\n`
    + `  hồ sơ       : ${duLieu.hoSoTinDung.length}\n`
    + `  nhật ký     : ${duLieu.nhatKyTraCuu.length}`,
  )
})
