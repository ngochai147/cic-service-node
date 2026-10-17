/**
 * Test Task 3: `POST /api/v1/internal/borrower-mappings` qua HTTP thật.
 *
 * Hợp đồng phải khớp `CicMappingWorker` của FINORA (2xx = xong; 403/408/429/5xx = thử
 * lại; 4xx khác = dừng hẳn) và bản Java (`LienKetNguoiVayController` + `XuLyLoiToanCuc`).
 * Khoá dưới đây là chuỗi giả lập chỉ dùng trong test. Mọi CCCD đầu `079298` là giả lập,
 * không có trong seed.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const THU_MUC = mkdtempSync(join(tmpdir(), 'cic-finora-http-'))
const TEP = join(THU_MUC, 'du-lieu.json')
copyFileSync(join(GOC, 'dulieu', 'du-lieu.json'), TEP)

process.env.CIC_TEP_DU_LIEU = TEP
process.env.CIC_KHO = 'tep'
delete process.env.CIC_INTERNAL_API_KEY

const KHOA = 'khoa-gia-lap-chi-dung-trong-test-0123456789'
const DUONG_DAN = '/api/v1/internal/borrower-mappings'

const { taoApp } = await import('../src/app.js')
const { kho } = await import('../src/du-lieu/kho-luu-tru.js')
const { xuLyLoanDelinquencyChanged } = await import('../src/dich-vu/tich-hop-finora.js')

/** Ghi lại mọi dòng log trong suốt file test để kiểm không lộ CCCD/khoá. */
const nhatKy = []
const consoleGoc = {}
for (const muc of ['log', 'info', 'warn', 'error', 'debug']) {
  consoleGoc[muc] = console[muc]
  console[muc] = (...thamSo) => { nhatKy.push(format(...thamSo)) }
}

const may = {}
const goc = {}

async function moMay(ten, khoa) {
  if (khoa === undefined) delete process.env.CIC_INTERNAL_API_KEY
  else process.env.CIC_INTERNAL_API_KEY = khoa
  const app = taoApp()
  delete process.env.CIC_INTERNAL_API_KEY
  may[ten] = app.listen(0)
  await new Promise((xong) => may[ten].once('listening', xong))
  goc[ten] = `http://127.0.0.1:${may[ten].address().port}`
}

before(async () => {
  kho.xoaDem()
  await moMay('mo', KHOA)
  await moMay('chuaCauHinh', undefined)
  await moMay('khoaRong', '')
  await moMay('khoaKhoangTrang', '   ')
})

after(() => {
  for (const m of Object.values(may)) m.close()
  Object.assign(console, consoleGoc)
  rmSync(THU_MUC, { recursive: true, force: true })
})

async function goi(tenMay, { than, tho, khoa, phuongThuc = 'POST', duongDan = DUONG_DAN,
  headers = {} } = {}) {
  const h = { ...headers }
  if (phuongThuc === 'POST' && !('Content-Type' in h)) h['Content-Type'] = 'application/json'
  if (khoa !== undefined) h['X-Finora-Internal-Key'] = khoa
  const r = await fetch(goc[tenMay] + duongDan, {
    method: phuongThuc,
    headers: h,
    body: phuongThuc === 'POST' ? (tho ?? JSON.stringify(than)) : undefined,
  })
  const vanBan = await r.text()
  return { status: r.status, vanBan, than: vanBan ? JSON.parse(vanBan) : null, headers: r.headers }
}

const LOI_403 = {
  maLoi: 'DU_LIEU_KHONG_HOP_LE',
  thongDiep: 'API liên kết định danh CIC chưa được phép',
}

describe('Endpoint đóng khi chưa cấu hình khoá', () => {
  for (const tenMay of ['chuaCauHinh', 'khoaRong', 'khoaKhoangTrang']) {
    test(`${tenMay}: mọi request đều 403, kể cả gửi khoá rỗng`, async () => {
      for (const khoa of [undefined, '', '   ', KHOA]) {
        const r = await goi(tenMay, { than: { borrowerId: 'dong', soCccd: '079298000001' }, khoa })
        assert.equal(r.status, 403)
        assert.deepEqual(r.than, LOI_403)
      }
    })
  }
})

describe('Khoá sai bị chặn trước khi đọc thân request', () => {
  const sai = [
    ['thiếu header', undefined],
    ['sai cùng độ dài', KHOA.slice(0, -1) + 'X'],
    ['ngắn hơn', KHOA.slice(0, 10)],
    ['dài hơn', KHOA + 'thua'],
    ['khác hoa thường', KHOA.toUpperCase()],
    // Khoảng trắng đầu/cuối header bị chính HTTP cắt (OWS, RFC 7230) nên không thử được;
    // khoảng trắng ở giữa thì phải bị coi là sai.
    ['khoảng trắng ở giữa, cùng độ dài', `${KHOA.slice(0, 5)} ${KHOA.slice(6)}`],
  ]
  for (const [ten, khoa] of sai) {
    test(`403: ${ten}`, async () => {
      const r = await goi('mo', { than: { borrowerId: 'sai-khoa', soCccd: '079298000002' }, khoa })
      assert.equal(r.status, 403)
      assert.deepEqual(r.than, LOI_403)
    })
  }

  test('JSON hỏng + khoá sai vẫn là 403, không phải 400', async () => {
    const r = await goi('mo', { tho: '{"soCccd": "079298000003", hong', khoa: 'sai' })
    assert.equal(r.status, 403)
    assert.deepEqual(r.than, LOI_403)
  })

  test('đường dẫn nội bộ khác cũng không lộ khi thiếu khoá', async () => {
    assert.equal((await goi('mo', { phuongThuc: 'GET', duongDan: '/api/v1/internal/khac' })).status, 403)
    const coKhoa = await goi('mo', { phuongThuc: 'GET', duongDan: '/api/v1/internal/khac', khoa: KHOA })
    assert.equal(coKhoa.status, 404)
  })
})

describe('Tạo liên kết', { concurrency: false }, () => {
  test('201, chỉ trả CCCD đã che, đúng 4 trường của LienKetNguoiVayResponse', async () => {
    const r = await goi('mo', { than: { borrowerId: '7001', soCccd: '079298000011' }, khoa: KHOA })
    assert.equal(r.status, 201)
    assert.match(r.headers.get('content-type'), /application\/json/)
    assert.deepEqual(Object.keys(r.than).sort(),
      ['borrowerId', 'createdAt', 'soCccdDaChe', 'soSuKienDaPhatLai'])
    assert.equal(r.than.borrowerId, '7001')
    assert.equal(r.than.soCccdDaChe, '079*******11')
    assert.equal(r.than.soSuKienDaPhatLai, 0)
    assert.ok(!Number.isNaN(Date.parse(r.than.createdAt)))
    assert.equal(r.vanBan.includes('079298000011'), false, 'không được trả CCCD thô')
  })

  test('gửi lại đúng cặp là idempotent: 201, giữ createdAt gốc', async () => {
    const dau = await goi('mo', { than: { borrowerId: '7002', soCccd: '079298000012' }, khoa: KHOA })
    const lai = await goi('mo', { than: { borrowerId: ' 7002 ', soCccd: '079298000012' }, khoa: KHOA })
    assert.equal(lai.status, 201)
    assert.equal(lai.than.createdAt, dau.than.createdAt)
    assert.equal(lai.than.soSuKienDaPhatLai, 0)
    const d = await kho.layDuLieu()
    assert.equal(d.lienKetNguoiVay.filter((l) => l.borrowerId === '7002').length, 1)
  })

  test('xung đột một-một: 400 DU_LIEU_KHONG_HOP_LE, không lộ CCCD', async () => {
    await goi('mo', { than: { borrowerId: '7003', soCccd: '079298000013' }, khoa: KHOA })

    const borrowerKhac = await goi('mo',
      { than: { borrowerId: '7003', soCccd: '079298000014' }, khoa: KHOA })
    assert.equal(borrowerKhac.status, 400)
    assert.deepEqual(borrowerKhac.than,
      { maLoi: 'DU_LIEU_KHONG_HOP_LE', thongDiep: 'borrowerId đã liên kết với CCCD khác' })

    const cccdKhac = await goi('mo',
      { than: { borrowerId: '7004', soCccd: '079298000013' }, khoa: KHOA })
    assert.equal(cccdKhac.status, 400)
    assert.deepEqual(cccdKhac.than,
      { maLoi: 'DU_LIEU_KHONG_HOP_LE', thongDiep: 'CCCD đã liên kết với borrowerId khác' })

    for (const r of [borrowerKhac, cccdKhac]) {
      assert.equal(/079298\d{6}/.test(r.vanBan), false)
    }
  })

  test('phát lại sự kiện đã chờ trước khi có liên kết', async () => {
    const cho = await xuLyLoanDelinquencyChanged('aaaaaaaa-0000-4000-8000-000000000001',
      '2026-10-03T03:00:00.123456Z', {
        loanApplicationId: 88, loanNumber: 'LN-2026-000088', borrowerId: '7005', fineractLoanId: 99,
        previousDaysPastDue: 0, daysPastDue: 12, previousDebtGroup: 1, debtGroup: 2,
        overdueAmount: '2500000.00', overdueSince: '2026-09-21', totalOutstanding: '30000000.00',
        dataAsOf: '2026-10-03T03:00:00.123456Z',
      })
    assert.equal(cho.trangThai, 'CHO_MAPPING')

    const r = await goi('mo', { than: { borrowerId: '7005', soCccd: '079298000015' }, khoa: KHOA })
    assert.equal(r.status, 201)
    assert.equal(r.than.soSuKienDaPhatLai, 1)

    const lichSu = await goi('mo', { phuongThuc: 'GET', duongDan: '/api/v1/ho-so/079298000015/lich-su' })
    assert.equal(lichSu.than.soPhienBan, 1)
    assert.equal(lichSu.than.phienBan[0].nhomNoHienTai, 2)
    assert.equal(lichSu.than.phienBan[0].tongDuNo, 30_000_000)
  })
})

describe('Dữ liệu sai: 400, thông điệp không lặp lại CCCD', { concurrency: false }, () => {
  const sai = [
    ['CCCD 11 số', { borrowerId: '7101', soCccd: '07929800002' }, /soCccd/],
    ['CCCD có chữ', { borrowerId: '7102', soCccd: '07929800002x' }, /soCccd/],
    ['CCCD có khoảng trắng (như @Pattern bản Java)', { borrowerId: '7103', soCccd: ' 079298000021 ' }, /soCccd/],
    ['CCCD là số JSON', { borrowerId: '7104', soCccd: 79298000021 }, /soCccd/],
    ['thiếu CCCD', { borrowerId: '7105' }, /soCccd/],
    ['thiếu borrowerId', { soCccd: '079298000021' }, /borrowerId/],
    ['borrowerId rỗng', { borrowerId: '   ', soCccd: '079298000021' }, /borrowerId/],
    ['borrowerId quá 100 ký tự', { borrowerId: 'b'.repeat(101), soCccd: '079298000021' }, /borrowerId/],
    ['borrowerId là số JSON', { borrowerId: 7106, soCccd: '079298000021' }, /borrowerId/],
  ]
  for (const [ten, than, mau] of sai) {
    test(ten, async () => {
      const r = await goi('mo', { than, khoa: KHOA })
      assert.equal(r.status, 400)
      assert.equal(r.than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
      assert.match(r.than.thongDiep, mau)
      assert.equal(/0792980000\d\d|07929800002x|79298000021/.test(r.than.thongDiep), false)
    })
  }

  test('thân là mảng, JSON hỏng hoặc không có thân → 400', async () => {
    for (const tuyChon of [{ than: [] }, { tho: '{hong' }, { tho: '', headers: { 'Content-Type': 'text/plain' } }]) {
      const r = await goi('mo', { ...tuyChon, khoa: KHOA })
      assert.equal(r.status, 400, JSON.stringify(tuyChon))
      assert.equal(r.than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
    }
  })

  test('không có liên kết nào bị tạo từ request sai', async () => {
    const d = await kho.layDuLieu()
    assert.equal(d.lienKetNguoiVay.some((l) => /^71\d\d$/.test(l.borrowerId)), false)
  })
})

describe('Vi phạm toàn vẹn khi phát lại', { concurrency: false }, () => {
  test('500 LOI_HE_THONG như bản Java, liên kết không được tạo, hàng chờ còn nguyên', async () => {
    const soCccd = '079298000031'
    const hoSo = await goi('mo', {
      duongDan: '/api/v1/ho-so',
      than: {
        soCccd, hoTen: 'Hồ Sơ Giả Lập', hieuLucTu: '2026-10-10', ngayMoQuanHeDauTien: '2026-10-10',
        soLanTreHan12Thang: 0, soLanTreHan24Thang: 0, soNgayTreDaiNhat: 0, soThangTuLanTreGanNhat: -1,
        tongDuNo: 0, tongHanMuc: 10_000_000, duNoTheTinDung: 0, hanMucThe: 0, soLanTraCuu6Thang: 0,
        soHopDongMoMoi6Thang: 0, soHopDongDangCo: 1, soLoaiSanPham: 1,
      },
    })
    assert.equal(hoSo.status, 201)
    await xuLyLoanDelinquencyChanged('aaaaaaaa-0000-4000-8000-000000000002', '2026-10-03T03:00:00Z', {
      loanApplicationId: 89, loanNumber: 'LN-2026-000089', borrowerId: '7201', fineractLoanId: 100,
      previousDaysPastDue: 0, daysPastDue: 12, previousDebtGroup: 1, debtGroup: 2,
      overdueAmount: '1.00', overdueSince: '2026-09-21', totalOutstanding: '5.00',
      dataAsOf: '2026-10-03T03:00:00Z',
    })

    const r = await goi('mo', { than: { borrowerId: '7201', soCccd }, khoa: KHOA })
    assert.equal(r.status, 500)
    assert.deepEqual(r.than, { maLoi: 'LOI_HE_THONG', thongDiep: 'Lỗi hệ thống, vui lòng thử lại sau' })

    const d = await kho.layDuLieu()
    assert.equal(d.lienKetNguoiVay.some((l) => l.borrowerId === '7201'), false)
    assert.equal(d.suKienQuaHanChoXuLy.filter((e) => e.borrowerId === '7201').length, 1)
    assert.equal(d.hoSoTinDung.filter((h) => h.soCccd === soCccd).length, 1)
  })
})

describe('CORS', () => {
  test('preflight cho phép header X-Finora-Internal-Key và không bị chốt khoá chặn', async () => {
    const r = await fetch(goc.mo + DUONG_DAN, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://cic-web.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-finora-internal-key',
      },
    })
    assert.equal(r.status, 204)
    assert.match(r.headers.get('access-control-allow-headers'), /X-Finora-Internal-Key/i)
  })

  test('lỗi 403 vẫn mang header CORS để giao diện đọc được lỗi', async () => {
    const r = await goi('mo', { than: {}, khoa: 'sai' })
    assert.equal(r.headers.get('access-control-allow-origin'), '*')
  })
})

describe('Endpoint công khai không đổi', () => {
  test('/actuator/health vẫn 200 UP', async () => {
    const r = await goi('mo', { phuongThuc: 'GET', duongDan: '/actuator/health' })
    assert.equal(r.status, 200)
    assert.equal(r.than.status, 'UP')
  })
})

describe('Log không chứa CCCD thô hay khoá', () => {
  test('borrowerId có ký tự xuống dòng không giả được dòng log', async () => {
    const r = await goi('mo', { than: { borrowerId: '7301\nGIA MAO: da xoa CIC', soCccd: '079298000041' }, khoa: KHOA })
    assert.equal(r.status, 201)
    const dong = nhatKy.find((d) => d.includes('7301'))
    assert.ok(dong)
    assert.equal(dong.includes('\n'), false)
    assert.ok(dong.includes('borrowerId="7301\\nGIA MAO: da xoa CIC"'))
  })

  test('mọi dòng log của file test này', () => {
    assert.ok(nhatKy.some((d) => d.includes('borrowerId="7001"')), 'phải có log khi liên kết thành công')
    for (const dong of nhatKy) {
      assert.equal(/079298\d{6}/.test(dong), false, `lộ CCCD: ${dong.slice(0, 120)}`)
      assert.equal(dong.includes(KHOA), false, 'lộ khoá nội bộ')
    }
    assert.equal(readFileSync(TEP, 'utf8').includes(KHOA), false, 'khoá không được ghi xuống kho')
  })
})
