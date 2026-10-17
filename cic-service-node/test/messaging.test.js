/**
 * Test Task 4: parser `docLoanDelinquencyChanged`, bộ xử lý tin nhắn (thử lại/DLT) và
 * phần nối KafkaJS (commit offset, DLT, dừng an toàn) — dùng client Kafka giả, không cần
 * broker. Envelope/header ở đây đúng y như `KafkaOutboxPublisher` của FINORA phát.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const THU_MUC = mkdtempSync(join(tmpdir(), 'cic-messaging-'))
const TEP = join(THU_MUC, 'du-lieu.json')
copyFileSync(join(GOC, 'dulieu', 'du-lieu.json'), TEP)
process.env.CIC_TEP_DU_LIEU = TEP
process.env.CIC_KHO = 'tep'

const {
  docLoanDelinquencyChanged, taoBoXuLyTinNhan, khoiDongKafkaConsumer, dongKafkaConsumer,
} = await import('../src/messaging/loan-delinquency-changed.js')
const { DuLieuKhongHopLe, SuKienKhongHopLe } = await import('../src/ho-tro/loi.js')
const { ViPhamToanVenDuLieu } = await import('../src/dich-vu/tich-hop-finora.js')
const { kho } = await import('../src/du-lieu/kho-luu-tru.js')

before(() => kho.xoaDem())
after(async () => {
  await dongKafkaConsumer()
  rmSync(THU_MUC, { recursive: true, force: true })
})

const ID = '3f2a1c4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b'

/** Data đúng như LoanServicingSyncService phát (tiền scale 2, Instant có micro-giây). */
const dataFinora = (ghiDe = {}) => ({
  loanApplicationId: 1201,
  loanNumber: 'LN-2026-001201',
  borrowerId: '45',
  fineractLoanId: 3301,
  previousDaysPastDue: 0,
  daysPastDue: 1,
  previousDebtGroup: 1,
  debtGroup: 1,
  overdueAmount: '1250000.00',
  overdueSince: '2026-10-02',
  totalOutstanding: '18000000.00',
  dataAsOf: '2026-10-03T03:00:00.123456Z',
  ...ghiDe,
})

const envelope = (ghiDe = {}, dataGhiDe = {}) => ({
  eventId: ID,
  occurredAt: '2026-10-03T03:00:00.654321Z',
  version: 1,
  data: dataFinora(dataGhiDe),
  ...ghiDe,
})

const headersFinora = (ghiDe = {}) => ({
  'finora-event-id': Buffer.from(ID),
  'finora-event-type': Buffer.from('LoanDelinquencyChanged'),
  'finora-event-version': Buffer.from('1'),
  'finora-trace-id': Buffer.from('trace-0001'),
  ...ghiDe,
})

const giaTri = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x))

const tuChoi = (fn, mau) => assert.throws(fn,
  (loi) => loi instanceof SuKienKhongHopLe && (!mau || mau.test(loi.message)))

describe('docLoanDelinquencyChanged — envelope v1 hợp lệ', () => {
  test('đọc đúng tin nhắn FINORA (Buffer + header Buffer)', () => {
    const kq = docLoanDelinquencyChanged(giaTri(envelope()), headersFinora())
    assert.equal(kq.eventId, ID)
    assert.equal(kq.occurredAt, '2026-10-03T03:00:00.654321Z')
    assert.deepEqual(kq.data, dataFinora())
    assert.equal(kq.traceId, 'trace-0001')
  })

  test('header là tuỳ chọn như bản Java; payload chuỗi cũng đọc được', () => {
    const kq = docLoanDelinquencyChanged(JSON.stringify(envelope()), {})
    assert.equal(kq.eventId, ID)
    assert.equal(kq.traceId, null)
    assert.equal(docLoanDelinquencyChanged(giaTri(envelope())).eventId, ID)
  })

  test('so eventId theo giá trị UUID, không phân biệt hoa thường', () => {
    const kq = docLoanDelinquencyChanged(giaTri(envelope({ eventId: ID.toUpperCase() })), headersFinora())
    assert.equal(kq.eventId, ID)
  })

  test('hết quá hạn: overdueSince null, tiền 0.00, trường lạ bị bỏ qua', () => {
    const kq = docLoanDelinquencyChanged(giaTri(envelope({ extra: 'bo-qua' }, {
      previousDaysPastDue: 40, daysPastDue: 0, previousDebtGroup: 2, debtGroup: 1,
      overdueAmount: '0.00', overdueSince: null, truongMoi: 1,
    })), headersFinora())
    assert.equal(kq.data.overdueSince, null)
  })
})

describe('docLoanDelinquencyChanged — header không khớp', () => {
  test('finora-event-id khác eventId của envelope', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope()), headersFinora({
      'finora-event-id': Buffer.from('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
    })), /finora-event-id/)
  })
  test('finora-event-id không phải UUID', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope()),
      headersFinora({ 'finora-event-id': Buffer.from('khong-phai-uuid') })), /finora-event-id/)
  })
  test('finora-event-type sai loại', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope()),
      headersFinora({ 'finora-event-type': Buffer.from('LoanSettled') })), /finora-event-type/)
  })
  test('finora-event-version khác 1 hoặc không phải số', () => {
    for (const v of ['2', 'abc', '1.0', '']) {
      tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope()),
        headersFinora({ 'finora-event-version': Buffer.from(v) })), /finora-event-version/)
    }
  })
  test('header lặp nhiều lần', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope()), headersFinora({
      'finora-event-type': [Buffer.from('LoanDelinquencyChanged'), Buffer.from('LoanSettled')],
    })), /finora-event-type/)
  })
})

describe('docLoanDelinquencyChanged — JSON hỏng và version không hỗ trợ', () => {
  test('JSON hỏng, rỗng, tombstone', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri('{"eventId": hong'), headersFinora()), /JSON/)
    tuChoi(() => docLoanDelinquencyChanged(giaTri(''), headersFinora()), /JSON/)
    tuChoi(() => docLoanDelinquencyChanged(null, headersFinora()), /rỗng/)
  })
  test('JSON không phải object', () => {
    for (const x of ['[]', '42', '"chuoi"', 'null']) {
      tuChoi(() => docLoanDelinquencyChanged(giaTri(x), headersFinora()), /object/)
    }
  })
  test('version 2, thiếu version, version dạng chuỗi', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({ version: 2 })), headersFinora()), /version/)
    const { version: _bo, ...thieu } = envelope()
    tuChoi(() => docLoanDelinquencyChanged(giaTri(thieu), headersFinora()), /version/)
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({ version: '1' })), headersFinora()), /version/)
  })
  test('thiếu data hoặc data không phải object', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({ data: null })), headersFinora()), /data/)
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({ data: [1] })), headersFinora()), /data/)
  })
})

describe('docLoanDelinquencyChanged — UUID và thời điểm sai', () => {
  test('eventId sai', () => {
    for (const eventId of ['khong-phai-uuid', 123, undefined, `${ID}0`]) {
      tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({ eventId })), {}), /eventId/)
    }
  })
  test('occurredAt sai', () => {
    for (const occurredAt of ['2026-10-03', '2026-10-03T03:00:00', '2026-10-03 03:00:00Z',
      1759460400, undefined, '2026-02-30T00:00:00Z']) {
      tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({ occurredAt })), {}), /occurredAt/)
    }
  })
  test('dataAsOf sai và data vi phạm schema cũng bị từ chối ngay ở parser', () => {
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({}, { dataAsOf: '2026-10-03' })), {}), /dataAsOf/)
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({}, { debtGroup: 9 })), {}), /debtGroup/)
    tuChoi(() => docLoanDelinquencyChanged(giaTri(envelope({}, { overdueAmount: '-1.00' })), {}),
      /không được âm/)
  })
})

// ── Bộ xử lý tin nhắn: thử lại và DLT ───────────────────────────────────────

function dungBoXuLy(xuLy) {
  const dlt = []
  const ngu = []
  let nhip = 0
  const xuLyTinNhan = taoBoXuLyTinNhan({
    xuLy,
    guiDlt: async (thamSo) => { dlt.push(thamSo) },
    ngu: async (ms) => { ngu.push(ms) },
    nhatKy: { info() {}, warn() {}, error() {} },
  })
  const goi = (value, headers = headersFinora()) => xuLyTinNhan({
    topic: 'finora.loan.delinquency-changed',
    partition: 0,
    message: { key: Buffer.from('77'), value, headers, offset: '5', timestamp: '1759460400000' },
    heartbeat: async () => { nhip += 1 },
  })
  return { goi, dlt, ngu, nhip: () => nhip }
}

describe('Bộ xử lý tin nhắn', () => {
  test('hợp lệ: gọi dịch vụ đúng một lần, không DLT', async () => {
    const goiDichVu = []
    const b = dungBoXuLy(async (...thamSo) => {
      goiDichVu.push(thamSo)
      return { trangThai: 'CHO_MAPPING' }
    })
    const kq = await b.goi(giaTri(envelope()))
    assert.equal(kq.ketQua, 'XONG')
    assert.deepEqual(goiDichVu, [[ID, '2026-10-03T03:00:00.654321Z', dataFinora()]])
    assert.equal(b.dlt.length, 0)
  })

  test('không hợp lệ: thẳng DLT, không gọi dịch vụ, không thử lại', async () => {
    let soLanGoi = 0
    const b = dungBoXuLy(async () => { soLanGoi += 1 })
    const kq = await b.goi(giaTri('{hong'))
    assert.equal(kq.ketQua, 'DLT')
    assert.equal(soLanGoi, 0)
    assert.equal(b.dlt.length, 1)
    assert.equal(b.dlt[0].phanLoai, 'KHONG_HOP_LE')
    assert.ok(b.dlt[0].loi instanceof SuKienKhongHopLe)
    assert.equal(b.ngu.length, 0)
  })

  test('dịch vụ báo dữ liệu sai: DLT ngay sau lần đầu', async () => {
    let soLanGoi = 0
    const b = dungBoXuLy(async () => {
      soLanGoi += 1
      throw new DuLieuKhongHopLe('sai')
    })
    await b.goi(giaTri(envelope()))
    assert.equal(soLanGoi, 1)
    assert.equal(b.dlt[0].phanLoai, 'KHONG_HOP_LE')
  })

  test('lỗi tạm thời 2 lần rồi thành công: 3 lần gọi, cách 1 giây, không DLT', async () => {
    let soLanGoi = 0
    const b = dungBoXuLy(async () => {
      soLanGoi += 1
      if (soLanGoi <= 2) throw new Error('EBUSY: kho đang bận')
      return { trangThai: 'DA_CAP_NHAT', phienBan: 2 }
    })
    const kq = await b.goi(giaTri(envelope()))
    assert.equal(kq.ketQua, 'XONG')
    assert.equal(soLanGoi, 3)
    assert.deepEqual(b.ngu, [1000, 1000])
    assert.equal(b.nhip(), 2, 'giữ phiên consumer sống trong lúc chờ thử lại')
    assert.equal(b.dlt.length, 0)
  })

  test('lỗi tạm thời mãi: đúng 2 lần thử lại rồi DLT', async () => {
    let soLanGoi = 0
    const b = dungBoXuLy(async () => {
      soLanGoi += 1
      throw new Error('ECONNRESET')
    })
    const kq = await b.goi(giaTri(envelope()))
    assert.equal(soLanGoi, 3)
    assert.equal(kq.ketQua, 'DLT')
    assert.equal(b.dlt[0].phanLoai, 'HET_LUOT_THU_LAI')
  })

  test('vi phạm toàn vẹn được thử lại như bản Java (DataIntegrityViolation)', async () => {
    let soLanGoi = 0
    const b = dungBoXuLy(async () => {
      soLanGoi += 1
      throw new ViPhamToanVenDuLieu('ck_hs_11')
    })
    await b.goi(giaTri(envelope()))
    assert.equal(soLanGoi, 3)
    assert.equal(b.dlt[0].phanLoai, 'HET_LUOT_THU_LAI')
  })

  test('traceId từ header có ký tự xuống dòng không giả được dòng log', async () => {
    const dong = []
    const xuLyTinNhan = taoBoXuLyTinNhan({
      xuLy: async () => ({ trangThai: 'CHO_MAPPING' }),
      guiDlt: async () => {},
      nhatKy: { info: (...x) => dong.push(format(...x)), warn() {}, error() {} },
    })
    await xuLyTinNhan({
      topic: 't', partition: 0,
      message: {
        value: giaTri(envelope()), offset: '3',
        headers: headersFinora({ 'finora-trace-id': Buffer.from('abc\n[GIA MAO] da xoa') }),
      },
    })
    assert.equal(dong.length, 1)
    assert.equal(dong[0].includes('\n'), false)
    assert.ok(dong[0].includes('traceId="abc\\n[GIA MAO] da xoa"'))
  })

  test('DLT gửi lỗi thì bộ xử lý ném lỗi (để offset không được commit)', async () => {
    const xuLyTinNhan = taoBoXuLyTinNhan({
      xuLy: async () => {},
      guiDlt: async () => { throw new Error('broker mất kết nối') },
      ngu: async () => {},
      nhatKy: { info() {}, warn() {}, error() {} },
    })
    await assert.rejects(xuLyTinNhan({
      topic: 't', partition: 0, message: { value: giaTri('{hong'), headers: {}, offset: '1' },
    }), /broker mất kết nối/)
  })
})

// ── Phần nối KafkaJS (client giả) ───────────────────────────────────────────

function kafkaGia({ loiKetNoi = null, loiGui = null } = {}) {
  const ghi = { cauHinhKafka: null, consumer: null, producer: null, gui: [], commit: [], suKien: {} }
  const taoKafka = (cauHinh) => {
    ghi.cauHinhKafka = cauHinh
    return {
      consumer(tuyChon) {
        ghi.consumer = {
          tuyChon, daKetNoi: false, daNgat: 0, dangKy: null, chay: null,
          events: { CRASH: 'consumer.crash' },
          on(ten, cb) { ghi.suKien[ten] = cb },
          async connect() {
            if (loiKetNoi) throw loiKetNoi
            this.daKetNoi = true
          },
          async subscribe(x) { this.dangKy = x },
          async run(x) { this.chay = x },
          async commitOffsets(ds) { ghi.commit.push(...ds) },
          async disconnect() { this.daNgat += 1 },
        }
        return ghi.consumer
      },
      producer(tuyChon) {
        ghi.producer = {
          tuyChon, daNgat: 0,
          async connect() {},
          async send(x) {
            if (loiGui) throw loiGui
            ghi.gui.push(x)
          },
          async disconnect() { this.daNgat += 1 },
        }
        return ghi.producer
      },
    }
  }
  return { taoKafka, ghi }
}

const CAU_HINH = Object.freeze({
  batConsumer: true, brokers: ['127.0.0.1:9092'], groupId: 'nhom-thu', topic: 'chu-de-thu',
})

const tinNhanKafka = (value, offset, headers = headersFinora()) => ({
  topic: 'chu-de-thu',
  partition: 0,
  message: { key: Buffer.from('77'), value, headers, offset, timestamp: '1759460400000' },
  heartbeat: async () => {},
})

const im = { info() {}, warn() {}, error() {} }

describe('Nối KafkaJS', { concurrency: false }, () => {
  test('đăng ký đúng topic/group, đọc từ đầu, tắt auto-commit', async () => {
    const { taoKafka, ghi } = kafkaGia()
    const thongTin = await khoiDongKafkaConsumer({
      cauHinh: CAU_HINH, taoKafka, xuLy: async () => ({ trangThai: 'CHO_MAPPING' }), nhatKy: im,
    })
    assert.deepEqual(thongTin, {
      brokers: ['127.0.0.1:9092'], groupId: 'nhom-thu', topic: 'chu-de-thu', topicDlt: 'chu-de-thu.DLT',
    })
    assert.equal(ghi.cauHinhKafka.clientId, 'cic-service-node')
    assert.deepEqual(ghi.cauHinhKafka.brokers, ['127.0.0.1:9092'])
    assert.equal(ghi.consumer.tuyChon.groupId, 'nhom-thu')
    assert.deepEqual(ghi.consumer.dangKy, { topics: ['chu-de-thu'], fromBeginning: true })
    assert.equal(ghi.consumer.chay.autoCommit, false)
    assert.equal(typeof ghi.suKien['consumer.crash'], 'function')

    // Gọi khởi động lần hai không tạo client mới.
    const lan2 = await khoiDongKafkaConsumer({ cauHinh: CAU_HINH, taoKafka: () => { throw new Error('không được gọi') } })
    assert.deepEqual(lan2, thongTin)

    await dongKafkaConsumer()
    assert.equal(ghi.consumer.daNgat, 1)
    assert.equal(ghi.producer.daNgat, 1)
    await dongKafkaConsumer()
    assert.equal(ghi.consumer.daNgat, 1, 'đóng lần hai là no-op')
  })

  test('xử lý xong mới commit offset + 1; không gửi DLT', async () => {
    const { taoKafka, ghi } = kafkaGia()
    const thuTu = []
    await khoiDongKafkaConsumer({
      cauHinh: CAU_HINH, taoKafka, nhatKy: im,
      xuLy: async () => { thuTu.push('xuLy'); return { trangThai: 'DA_CAP_NHAT', phienBan: 3 } },
    })
    const commitGoc = ghi.consumer.commitOffsets.bind(ghi.consumer)
    ghi.consumer.commitOffsets = async (ds) => { thuTu.push('commit'); return commitGoc(ds) }

    await ghi.consumer.chay.eachMessage(tinNhanKafka(giaTri(envelope()), '41'))
    assert.deepEqual(thuTu, ['xuLy', 'commit'])
    assert.deepEqual(ghi.commit, [{ topic: 'chu-de-thu', partition: 0, offset: '42' }])
    assert.equal(ghi.gui.length, 0)
    await dongKafkaConsumer()
  })

  test('tin nhắn sai: gửi <topic>.DLT giữ key/value/header gốc + header DLT, rồi mới commit', async () => {
    const { taoKafka, ghi } = kafkaGia()
    await khoiDongKafkaConsumer({ cauHinh: CAU_HINH, taoKafka, nhatKy: im, xuLy: async () => {} })
    const hong = giaTri('{"eventId": hong')
    await ghi.consumer.chay.eachMessage(tinNhanKafka(hong, '7'))

    assert.equal(ghi.gui.length, 1)
    const { topic, messages, acks } = ghi.gui[0]
    assert.equal(topic, 'chu-de-thu.DLT')
    assert.equal(acks, -1)
    const [m] = messages
    assert.deepEqual(m.key, Buffer.from('77'))
    assert.deepEqual(m.value, hong)
    assert.deepEqual(m.headers['finora-event-id'], Buffer.from(ID))
    assert.equal(m.headers['kafka_dlt-original-topic'], 'chu-de-thu')
    assert.equal(m.headers['kafka_dlt-original-partition'].readInt32BE(0), 0)
    assert.equal(m.headers['kafka_dlt-original-offset'].readBigInt64BE(0), 7n)
    assert.equal(m.headers['kafka_dlt-original-timestamp'].readBigInt64BE(0), 1759460400000n)
    assert.equal(m.headers['kafka_dlt-original-consumer-group'], 'nhom-thu')
    assert.equal(m.headers['kafka_dlt-exception-fqcn'], 'SuKienKhongHopLe')
    assert.match(m.headers['kafka_dlt-exception-message'], /JSON/)
    assert.equal(m.headers['cic-dlt-phan-loai'], 'KHONG_HOP_LE')
    assert.deepEqual(ghi.commit, [{ topic: 'chu-de-thu', partition: 0, offset: '8' }])
    await dongKafkaConsumer()
  })

  test('DLT gửi lỗi: không commit, lỗi nổi lên để KafkaJS giao lại tin nhắn', async () => {
    const { taoKafka, ghi } = kafkaGia({ loiGui: new Error('KafkaJSConnectionError') })
    await khoiDongKafkaConsumer({ cauHinh: CAU_HINH, taoKafka, nhatKy: im, xuLy: async () => {} })
    await assert.rejects(ghi.consumer.chay.eachMessage(tinNhanKafka(giaTri('{hong'), '9')))
    assert.equal(ghi.commit.length, 0)
    await dongKafkaConsumer()
  })

  test('không kết nối được broker: khởi động thất bại, dọn client, lần sau khởi động lại được', async () => {
    const hong = kafkaGia({ loiKetNoi: new Error('ECONNREFUSED 127.0.0.1:9092') })
    await assert.rejects(khoiDongKafkaConsumer({
      cauHinh: CAU_HINH, taoKafka: hong.taoKafka, nhatKy: im, xuLy: async () => {},
    }), /ECONNREFUSED/)
    assert.equal(hong.ghi.consumer.daNgat, 1)
    assert.equal(hong.ghi.producer.daNgat, 1)

    const tot = kafkaGia()
    await khoiDongKafkaConsumer({ cauHinh: CAU_HINH, taoKafka: tot.taoKafka, nhatKy: im, xuLy: async () => {} })
    assert.equal(tot.ghi.consumer.daKetNoi, true)
    await dongKafkaConsumer()
  })

  test('KAFKA_BOOTSTRAP_SERVERS rỗng bị từ chối', async () => {
    await assert.rejects(khoiDongKafkaConsumer({
      cauHinh: { ...CAU_HINH, brokers: [] }, taoKafka: kafkaGia().taoKafka, nhatKy: im,
    }), /KAFKA_BOOTSTRAP_SERVERS/)
  })

  test('đi trọn với dịch vụ thật: lần đầu CHO_MAPPING, giao lại là DA_TON_TAI, cả hai đều commit', async () => {
    const { taoKafka, ghi } = kafkaGia()
    const nhatKy = []
    await khoiDongKafkaConsumer({
      cauHinh: CAU_HINH, taoKafka,
      nhatKy: { info: (...x) => nhatKy.push(x.join(' ')), warn() {}, error() {} },
    })
    await ghi.consumer.chay.eachMessage(tinNhanKafka(giaTri(envelope()), '100'))
    await ghi.consumer.chay.eachMessage(tinNhanKafka(giaTri(envelope()), '101'))
    assert.deepEqual(ghi.commit.map((c) => c.offset), ['101', '102'])
    assert.ok(nhatKy.some((d) => d.includes('CHO_MAPPING')))
    assert.ok(nhatKy.some((d) => d.includes('DA_TON_TAI')))
    const d = await kho.layDuLieu()
    assert.equal(d.suKienQuaHanChoXuLy.filter((e) => e.eventId === ID).length, 1)
    await dongKafkaConsumer()
  })
})

describe('Vercel không bao giờ khởi động consumer', () => {
  test('chỉ src/server.js được nạp module messaging; không tệp nào khác import kafkajs', () => {
    const tep = []
    const duyet = (thuMuc) => {
      for (const ten of readdirSync(thuMuc)) {
        const duong = join(thuMuc, ten)
        if (statSync(duong).isDirectory()) duyet(duong)
        else if (ten.endsWith('.js')) tep.push(duong)
      }
    }
    duyet(join(GOC, 'src'))
    duyet(join(GOC, 'api'))
    for (const duong of tep) {
      const tuongDoi = relative(GOC, duong).replaceAll('\\', '/')
      const noiDung = readFileSync(duong, 'utf8')
      if (tuongDoi === 'src/messaging/loan-delinquency-changed.js') continue
      assert.equal(/['"]kafkajs['"]/.test(noiDung), false, `${tuongDoi} không được import kafkajs`)
      if (tuongDoi !== 'src/server.js') {
        assert.equal(/messaging\//.test(noiDung), false, `${tuongDoi} không được nạp messaging`)
      }
    }
    const server = readFileSync(join(GOC, 'src', 'server.js'), 'utf8')
    assert.match(server, /if \(cauHinhKafka\.batConsumer\)[\s\S]*import\('\.\/messaging\/loan-delinquency-changed\.js'\)/)
    assert.ok(tep.some((duong) => relative(GOC, duong).replaceAll('\\', '/') === 'api/index.js'))
  })
})
