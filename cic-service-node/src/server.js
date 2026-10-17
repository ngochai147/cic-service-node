/**
 * Điểm khởi động khi chạy local (`npm start`).
 *
 * Trên Vercel không dùng file này — `api/index.js` export thẳng app cho runtime
 * serverless, không có ai `listen` cả. Vì vậy consumer Kafka (tuỳ chọn) chỉ được khởi
 * động ở đây: function serverless không giữ được kết nối Kafka lâu dài.
 */
import { taoApp } from './app.js'
import { cauHinhKafka } from './cau-hinh.js'
import { kho } from './du-lieu/kho-luu-tru.js'

const CONG = Number(process.env.CIC_PORT ?? process.env.PORT ?? 9000)
const HET_GIO_DUNG_MS = 10_000

const app = taoApp()

// Nạp dữ liệu trước khi mở cổng: request đầu tiên không phải chờ đọc file, và cấu
// hình/dữ liệu hỏng thì chết ngay lúc khởi động thay vì lúc có người gọi.
const duLieu = await kho.layDuLieu()

// Consumer `LoanDelinquencyChanged.v1` chỉ chạy khi CIC_KAFKA_CONSUMER_ENABLED=true. Đã
// bật mà không kết nối được broker thì cũng chết ngay lúc khởi động, như dữ liệu hỏng.
let messaging = null
let kafka = null
if (cauHinhKafka.batConsumer) {
  messaging = await import('./messaging/loan-delinquency-changed.js')
  kafka = await messaging.khoiDongKafkaConsumer()
}

const may = app.listen(CONG, () => {
  console.log(
    `cic-service-node đang chạy tại http://localhost:${CONG}\n`
    + `  kho dữ liệu : ${kho.tenDriver} (${kho.nguon})\n`
    + `  hồ sơ       : ${duLieu.hoSoTinDung.length}\n`
    + `  nhật ký     : ${duLieu.nhatKyTraCuu.length}\n`
    + `  kafka       : ${kafka
      ? `bật — topic ${kafka.topic}, group ${kafka.groupId}, DLT ${kafka.topicDlt}`
      : 'tắt (CIC_KAFKA_CONSUMER_ENABLED khác true)'}`,
  )
})

let dangDung = false

/**
 * Dừng an toàn khi nhận SIGINT/SIGTERM: thôi nhận request mới, chờ consumer xử lý xong
 * tin nhắn đang dở (KafkaJS commit rồi mới rời group), đóng producer DLT, rồi thoát.
 * Quá HET_GIO_DUNG_MS thì thoát cứng; tín hiệu thứ hai cũng thoát ngay.
 */
async function dungAnToan(tinHieu) {
  if (dangDung) return
  dangDung = true
  console.log(`Nhận ${tinHieu}: đang dừng cic-service-node...`)
  const hetGio = setTimeout(() => {
    console.error(`Quá ${HET_GIO_DUNG_MS} ms chưa dừng xong, thoát cứng`)
    process.exit(1)
  }, HET_GIO_DUNG_MS)
  hetGio.unref()

  const httpDong = new Promise((xong) => may.close(() => xong()))
  may.closeIdleConnections?.()
  try {
    await messaging?.dongKafkaConsumer()
  } catch (loi) {
    console.error('Lỗi khi đóng consumer Kafka: %s', loi.message)
  }
  await httpDong
  console.log('Đã dừng cic-service-node')
  process.exit(0)
}

for (const tinHieu of ['SIGINT', 'SIGTERM']) {
  process.once(tinHieu, () => {
    void dungAnToan(tinHieu)
    process.once(tinHieu, () => process.exit(1))
  })
}
