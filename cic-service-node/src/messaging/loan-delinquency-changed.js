/**
 * Consumer Kafka cho `LoanDelinquencyChanged.v1` — port `LoanDelinquencyChangedConsumer.java`
 * và `CauHinhKafkaConsumer.java`.
 *
 *   - Tuỳ chọn: chỉ `src/server.js` nạp module này, và chỉ khi
 *     `CIC_KAFKA_CONSUMER_ENABLED=true`. Điểm vào Vercel (`api/index.js`) không bao giờ
 *     nạp nó — function serverless không giữ được kết nối Kafka lâu dài.
 *   - Tin nhắn sai envelope/header/schema → `<topic>.DLT` ngay, KHÔNG thử lại (bản Java:
 *     `IllegalArgumentException` là not-retryable).
 *   - Lỗi tạm thời → thử lại 2 lần, cách 1 giây (`FixedBackOff(1000, 2)`), vẫn lỗi → DLT.
 *   - Offset chỉ được commit sau khi xử lý xong hoặc đã đẩy DLT thành công. Đẩy DLT hỏng
 *     thì ném lỗi để KafkaJS giao lại tin nhắn (at-least-once; trùng đã có `eventId` chặn).
 *   - Không log payload: event không có CCCD, nhưng log chỉ cần eventId/traceId/offset.
 */
import { cauHinhKafka } from '../cau-hinh.js'
import {
  LOAI_SU_KIEN, PHIEN_BAN_SU_KIEN, kiemTraSuKienQuaHan, xuLyLoanDelinquencyChanged,
} from '../dich-vu/tich-hop-finora.js'
import { DuLieuKhongHopLe, SuKienKhongHopLe } from '../ho-tro/loi.js'

export const SO_LAN_THU_LAI = 2
export const DO_TRE_THU_LAI_MS = 1000
export const HAU_TO_DLT = '.DLT'

/** Phân loại ghi vào header `cic-dlt-phan-loai` của bản ghi DLT. */
export const PhanLoaiDlt = Object.freeze({
  KHONG_HOP_LE: 'KHONG_HOP_LE',
  HET_LUOT_THU_LAI: 'HET_LUOT_THU_LAI',
})

const HEADER_EVENT_ID = 'finora-event-id'
const HEADER_EVENT_TYPE = 'finora-event-type'
const HEADER_EVENT_VERSION = 'finora-event-version'
const HEADER_TRACE_ID = 'finora-trace-id'
const UUID_CHUAN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DO_DAI_THONG_DIEP_DLT = 1000

const laObject = (x) => x != null && typeof x === 'object' && !Array.isArray(x)
const nguMs = (ms) => new Promise((xong) => setTimeout(xong, ms))
const vanBan = (giaTri) => (Buffer.isBuffer(giaTri) ? giaTri.toString('utf8') : String(giaTri))

/** Header KafkaJS là Buffer, chuỗi, mảng (khi lặp) hoặc vắng. Lặp nhiều lần → sai. */
function docHeader(headers, ten) {
  const giaTri = headers?.[ten]
  if (giaTri == null) return undefined
  if (Array.isArray(giaTri)) {
    const coGiaTri = giaTri.filter((x) => x != null)
    if (coGiaTri.length === 0) return undefined
    if (coGiaTri.length > 1) throw new SuKienKhongHopLe(`${LOAI_SU_KIEN}: header ${ten} xuất hiện nhiều lần`)
    return vanBan(coGiaTri[0])
  }
  return vanBan(giaTri)
}

/**
 * Parser thuần cho một bản ghi Kafka của `finora.loan.delinquency-changed`.
 *
 * Đúng các kiểm tra của consumer Java: envelope `{eventId, occurredAt, version, data}`
 * với `version = 1`; header là tuỳ chọn nhưng nếu có thì `finora-event-id` phải bằng
 * eventId (so theo giá trị UUID), `finora-event-type` phải là `LoanDelinquencyChanged`,
 * `finora-event-version` phải parse ra 1. Thêm: data được kiểm chặt ngay tại đây, để
 * mọi tin nhắn sai đều vào DLT mà không tốn lượt thử lại.
 *
 * @param {Buffer|string|null} payload `message.value` của KafkaJS
 * @param {object} [headers] `message.headers` của KafkaJS
 * @returns {{eventId: string, occurredAt: string, data: object, traceId: string|null}}
 * @throws {SuKienKhongHopLe}
 */
export function docLoanDelinquencyChanged(payload, headers = {}) {
  if (payload == null) {
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN}: tin nhắn rỗng (tombstone)`)
  }
  let envelope
  try {
    envelope = JSON.parse(vanBan(payload))
  } catch {
    // Không đưa nội dung payload vào thông điệp: nó đi vào log và header DLT.
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN} JSON không hợp lệ`)
  }
  if (!laObject(envelope)) {
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN}: envelope phải là JSON object`)
  }
  if (envelope.version !== PHIEN_BAN_SU_KIEN) {
    throw new SuKienKhongHopLe(
      `${LOAI_SU_KIEN}: envelope version phải là ${PHIEN_BAN_SU_KIEN} (số nguyên JSON)`)
  }

  const suKien = kiemTraSuKienQuaHan(envelope.eventId, envelope.occurredAt, envelope.data)

  const idHeader = docHeader(headers, HEADER_EVENT_ID)
  if (idHeader !== undefined && (!UUID_CHUAN.test(idHeader) || idHeader.toLowerCase() !== suKien.eventId)) {
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN}: header ${HEADER_EVENT_ID} không khớp eventId của envelope`)
  }
  const loaiHeader = docHeader(headers, HEADER_EVENT_TYPE)
  if (loaiHeader !== undefined && loaiHeader !== LOAI_SU_KIEN) {
    throw new SuKienKhongHopLe(`${LOAI_SU_KIEN}: header ${HEADER_EVENT_TYPE} phải là ${LOAI_SU_KIEN}`)
  }
  const phienBanHeader = docHeader(headers, HEADER_EVENT_VERSION)
  // Như Integer.parseInt của Java: dấu tuỳ chọn + chữ số; giá trị phải là 1.
  if (phienBanHeader !== undefined
      && !(/^[+-]?\d+$/.test(phienBanHeader) && Number(phienBanHeader) === PHIEN_BAN_SU_KIEN)) {
    throw new SuKienKhongHopLe(
      `${LOAI_SU_KIEN}: header ${HEADER_EVENT_VERSION} phải là ${PHIEN_BAN_SU_KIEN}`)
  }

  return {
    eventId: suKien.eventId,
    occurredAt: envelope.occurredAt,
    data: envelope.data,
    traceId: docHeader(headers, HEADER_TRACE_ID) ?? null,
  }
}

/**
 * Bộ xử lý một tin nhắn: parse → gọi dịch vụ → thử lại/DLT. Không chạm Kafka trực tiếp
 * (DLT đi qua `guiDlt`) nên test được không cần broker.
 *
 * @returns {Promise<{ketQua: 'XONG'|'DLT', trangThai?: string, phanLoai?: string}>}
 * @throws lỗi của `guiDlt` — bên gọi KHÔNG được commit offset khi đó
 */
export function taoBoXuLyTinNhan({
  xuLy = xuLyLoanDelinquencyChanged,
  guiDlt,
  nhatKy = console,
  soLanThuLai = SO_LAN_THU_LAI,
  doTreMs = DO_TRE_THU_LAI_MS,
  ngu = nguMs,
} = {}) {
  async function chuyenDlt(thamSo, loi, phanLoai, eventId) {
    await guiDlt({ ...thamSo, loi, phanLoai })
    nhatKy.warn('Đã chuyển LoanDelinquencyChanged sang DLT: eventId=%s, topic=%s, partition=%s, '
      + 'offset=%s, phanLoai=%s, loi=%s', eventId ?? '-', thamSo.topic, thamSo.partition,
    thamSo.message.offset, phanLoai, loi.message)
    return { ketQua: 'DLT', phanLoai }
  }

  return async function xuLyTinNhan(thamSo) {
    const { message, heartbeat } = thamSo
    let suKien
    try {
      suKien = docLoanDelinquencyChanged(message.value, message.headers)
    } catch (loi) {
      return chuyenDlt(thamSo, loi, PhanLoaiDlt.KHONG_HOP_LE)
    }

    for (let lan = 0; ; lan += 1) {
      try {
        const kq = await xuLy(suKien.eventId, suKien.occurredAt, suKien.data)
        nhatKy.info('Đã xử lý LoanDelinquencyChanged: eventId=%s, traceId=%s, trangThai=%s, '
          + 'phienBan=%s, offset=%s', suKien.eventId, suKien.traceId ?? '-', kq?.trangThai,
        kq?.phienBan ?? '-', message.offset)
        return { ketQua: 'XONG', trangThai: kq?.trangThai }
      } catch (loi) {
        if (loi instanceof DuLieuKhongHopLe) {
          return chuyenDlt(thamSo, loi, PhanLoaiDlt.KHONG_HOP_LE, suKien.eventId)
        }
        if (lan >= soLanThuLai) {
          return chuyenDlt(thamSo, loi, PhanLoaiDlt.HET_LUOT_THU_LAI, suKien.eventId)
        }
        nhatKy.warn('Lỗi tạm thời khi xử lý LoanDelinquencyChanged: eventId=%s, thử lại %d/%d: %s',
          suKien.eventId, lan + 1, soLanThuLai, loi.message)
        await heartbeat?.()
        await ngu(doTreMs)
      }
    }
  }
}

// ── Nối KafkaJS ──────────────────────────────────────────────────────────────

const int32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n)
  return b
}
const int64 = (n) => {
  const b = Buffer.alloc(8)
  b.writeBigInt64BE(BigInt(n))
  return b
}

/**
 * Header DLT theo đúng tên và mã hoá của `DeadLetterPublishingRecoverer` (Spring Kafka)
 * mà bản Java dùng — partition int32, offset/timestamp int64 big-endian — để công cụ phía
 * Java đọc lại được. Thêm `cic-dlt-phan-loai` cho người đọc.
 */
function headerDlt({ topic, partition, message, loi, phanLoai }, groupId) {
  const h = {}
  for (const [ten, giaTri] of Object.entries(message.headers ?? {})) {
    if (giaTri != null) h[ten] = giaTri
  }
  h['kafka_dlt-original-topic'] = topic
  h['kafka_dlt-original-partition'] = int32(partition)
  h['kafka_dlt-original-offset'] = int64(message.offset)
  if (message.timestamp != null && /^-?\d+$/.test(String(message.timestamp))) {
    h['kafka_dlt-original-timestamp'] = int64(message.timestamp)
  }
  h['kafka_dlt-original-consumer-group'] = groupId
  h['kafka_dlt-exception-fqcn'] = loi?.name ?? 'Error'
  h['kafka_dlt-exception-message'] = String(loi?.message ?? '').slice(0, DO_DAI_THONG_DIEP_DLT)
  h['cic-dlt-phan-loai'] = phanLoai
  return h
}

/** Tạo nhà máy client KafkaJS thật (nạp động: không bật consumer thì không nạp kafkajs). */
async function taoKafkaJs() {
  const { default: kafkajs } = await import('kafkajs')
  const { Kafka, logLevel, Partitioners } = kafkajs
  return (cauHinh) => {
    const kafka = new Kafka({ ...cauHinh, logLevel: logLevel.WARN })
    return {
      consumer: (tuyChon) => kafka.consumer(tuyChon),
      // Partitioner tương thích Java: cùng key → cùng partition như producer FINORA.
      producer: (tuyChon) => kafka.producer({
        ...tuyChon, createPartitioner: Partitioners.DefaultPartitioner,
      }),
    }
  }
}

let dangChay = null

/**
 * Khởi động consumer. Gọi lần hai khi đang chạy thì trả thông tin cũ.
 *
 * @param {object} [tuyChon] chỉ để test: `cauHinh`, `taoKafka`, `xuLy`, `nhatKy`, `ngu`
 * @returns {Promise<{brokers: string[], groupId: string, topic: string, topicDlt: string}>}
 * @throws nếu cấu hình sai hoặc không kết nối/đăng ký được broker
 */
export async function khoiDongKafkaConsumer({
  cauHinh = cauHinhKafka, taoKafka, xuLy, nhatKy = console, ngu,
} = {}) {
  if (dangChay) return dangChay.thongTin
  if (!cauHinh.brokers?.length) {
    throw new Error('KAFKA_BOOTSTRAP_SERVERS rỗng: không có broker nào để kết nối')
  }

  const thongTin = {
    brokers: [...cauHinh.brokers],
    groupId: cauHinh.groupId,
    topic: cauHinh.topic,
    topicDlt: `${cauHinh.topic}${HAU_TO_DLT}`,
  }
  const kafka = (taoKafka ?? (await taoKafkaJs()))({
    clientId: 'cic-service-node',
    brokers: thongTin.brokers,
  })
  const consumer = kafka.consumer({ groupId: thongTin.groupId })
  const producer = kafka.producer({ allowAutoTopicCreation: true })

  const guiDlt = async (thamSo) => {
    await producer.send({
      topic: `${thamSo.topic}${HAU_TO_DLT}`,
      acks: -1,
      messages: [{
        key: thamSo.message.key ?? null,
        value: thamSo.message.value ?? null,
        headers: headerDlt(thamSo, thongTin.groupId),
      }],
    })
  }
  const xuLyTinNhan = taoBoXuLyTinNhan({
    guiDlt, nhatKy, ...(xuLy && { xuLy }), ...(ngu && { ngu }),
  })

  try {
    consumer.on?.(consumer.events?.CRASH, ({ payload }) => {
      nhatKy.error('Consumer Kafka CIC bị crash: %s (KafkaJS tự khởi động lại: %s)',
        payload?.error?.message, payload?.restart)
    })
    await producer.connect()
    await consumer.connect()
    await consumer.subscribe({ topics: [thongTin.topic], fromBeginning: true })
    await consumer.run({
      autoCommit: false,
      eachMessage: async (thamSo) => {
        await xuLyTinNhan(thamSo)
        await consumer.commitOffsets([{
          topic: thamSo.topic,
          partition: thamSo.partition,
          offset: (BigInt(thamSo.message.offset) + 1n).toString(),
        }])
      },
    })
  } catch (loi) {
    await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
    throw loi
  }

  dangChay = { consumer, producer, thongTin }
  return thongTin
}

/**
 * Dừng an toàn: `consumer.disconnect()` của KafkaJS chờ tin nhắn đang xử lý chạy xong
 * rồi mới rời group; sau đó mới đóng producer DLT. Gọi khi chưa chạy là no-op.
 */
export async function dongKafkaConsumer() {
  const hienTai = dangChay
  dangChay = null
  if (!hienTai) return
  try {
    await hienTai.consumer.disconnect()
  } finally {
    await hienTai.producer.disconnect()
  }
}
