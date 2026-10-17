/**
 * Test bổ sung cho Task 2 (bổ sung cho `tich-hop-finora-domain.test.js` của Hải, không sửa
 * tệp đó): định dạng FINORA thật, kiểm tra chặt, thứ tự phát lại, rollback trọn vẹn, đệm
 * kho khi ghi hỏng, cấu hình chính sách và các tiện ích ngày giờ.
 *
 * Mọi CCCD ở đây là số giả lập đầu `079299`, không có trong seed (test tự kiểm điều đó).
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const THU_MUC = mkdtempSync(join(tmpdir(), 'cic-finora-bo-sung-'))
const TEP = join(THU_MUC, 'du-lieu.json')
copyFileSync(join(GOC, 'dulieu', 'du-lieu.json'), TEP)

process.env.CIC_TEP_DU_LIEU = TEP
process.env.CIC_KHO = 'tep'
process.env.CIC_BAD_DEBT_COOLDOWN_MONTHS = '12'
process.env.CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS = '24'

const { kho } = await import('../src/du-lieu/kho-luu-tru.js')
const tichHop = await import('../src/dich-vu/tich-hop-finora.js')
const { taoPhienBanMoi } = await import('../src/dich-vu/ho-so.js')
const { docChinhSachNoXau, docCauHinhKafka, docCauHinhTichHop } = await import('../src/cau-hinh.js')
const { congThang, docThoiDiemIso, laNgayIsoHopLe, ngayTheoMuiGio } = await import('../src/ho-tro/ngay.js')
const { DuLieuKhongHopLe, KhoLuuTruCongKhai, SuKienKhongHopLe } = await import('../src/ho-tro/loi.js')

const { taoLienKetNguoiVay, xuLyLoanDelinquencyChanged, ViPhamToanVenDuLieu } = tichHop

before(() => kho.xoaDem())
after(() => rmSync(THU_MUC, { recursive: true, force: true }))

let dem = 0
/** UUID v4 giả lập, khác nhau giữa các lần gọi. */
const uuid = () => {
  dem += 1
  return `00000000-0000-4000-8000-${String(dem).padStart(12, '0')}`
}

/** Payload đúng y như FINORA phát: tiền 2 chữ số lẻ, dataAsOf có micro-giây. */
const suKien = (ghiDe = {}) => ({
  loanApplicationId: 501,
  loanNumber: 'LN-2026-000501',
  borrowerId: '9001',
  fineractLoanId: 701,
  previousDaysPastDue: 0,
  daysPastDue: 10,
  previousDebtGroup: 1,
  debtGroup: 2,
  overdueAmount: '1500000.00',
  overdueSince: '2026-09-23',
  totalOutstanding: '12000000.00',
  dataAsOf: '2026-10-03T03:00:00.123456Z',
  ...ghiDe,
})

const phienBanCua = async (soCccd) => (await kho.layDuLieu()).hoSoTinDung
  .filter((h) => h.soCccd === soCccd)
  .sort((a, b) => a.phienBan - b.phienBan)

describe('Dữ liệu thử', () => {
  test('CCCD giả lập đầu 079299 không có trong seed', () => {
    const seed = JSON.parse(readFileSync(join(GOC, 'dulieu', 'du-lieu.json'), 'utf8'))
    assert.equal(seed.hoSoTinDung.some((h) => h.soCccd.startsWith('079299')), false)
  })
})

describe('Định dạng FINORA thật', { concurrency: false }, () => {
  test('tiền scale 2/6/0, overdueSince null khi đã hết quá hạn, Instant có micro-giây', async () => {
    const soCccd = '079299000101'
    await taoLienKetNguoiVay({ borrowerId: 'dinh-dang-1', soCccd })

    const a = await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00.654321Z', suKien({
      borrowerId: 'dinh-dang-1', totalOutstanding: '9000000.000000', overdueAmount: '1000000.000000',
    }))
    const b = await xuLyLoanDelinquencyChanged(uuid(), '2026-10-04T03:00:00Z', suKien({
      borrowerId: 'dinh-dang-1', previousDaysPastDue: 11, daysPastDue: 0, previousDebtGroup: 2,
      debtGroup: 1, overdueAmount: '0.00', overdueSince: null, totalOutstanding: '8000000',
      dataAsOf: '2026-10-04T03:00:00.000001Z',
    }))
    const { overdueSince: _bo, ...khongCoOverdueSince } = suKien({
      borrowerId: 'dinh-dang-1', dataAsOf: '2026-10-05T03:00:00Z',
    })
    const c = await xuLyLoanDelinquencyChanged(uuid(), '2026-10-05T10:00:00+07:00', khongCoOverdueSince)

    assert.deepEqual([a, b, c].map((x) => x.trangThai), ['DA_CAP_NHAT', 'DA_CAP_NHAT', 'DA_CAP_NHAT'])
    const pb = await phienBanCua(soCccd)
    assert.equal(pb.length, 3)
    assert.equal(pb[0].tongDuNo, 9_000_000)
    assert.equal(pb[1].nhomNoHienTai, 1)
    assert.equal(pb[2].hieuLucTu, '2026-10-05')
  })

  test('tiền làm tròn HALF_UP về đồng cho hồ sơ mới', async () => {
    await taoLienKetNguoiVay({ borrowerId: 'lam-tron', soCccd: '079299000102' })
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00Z', suKien({
      borrowerId: 'lam-tron', totalOutstanding: '9000000.50',
    }))
    const [h] = await phienBanCua('079299000102')
    assert.equal(h.tongDuNo, 9_000_001)
    assert.equal(h.tongHanMuc, 9_000_001)
    assert.equal(h.soHopDongDangCo, 1)
    assert.equal(h.soLoaiSanPham, 1)
    assert.equal(h.hoTen, 'Chưa có thông tin')
    assert.equal(h.ghiChu, 'Nguồn Loan/Fineract; loanApplicationId=501')
  })

  test('ngày hiệu lực lấy theo dataAsOf ở múi giờ Asia/Ho_Chi_Minh', async () => {
    await taoLienKetNguoiVay({ borrowerId: 'mui-gio', soCccd: '079299000103' })
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T17:30:00Z', suKien({
      borrowerId: 'mui-gio', dataAsOf: '2026-10-03T17:30:00Z',
    }))
    const [h] = await phienBanCua('079299000103')
    assert.equal(h.hieuLucTu, '2026-10-04', '17:30Z là 00:30 ngày hôm sau ở +07:00')
    assert.equal(h.ngayMoQuanHeDauTien, '2026-10-04')
  })

  test('eventId chữ hoa và chữ thường là cùng một sự kiện', async () => {
    const id = 'ABCDEF01-2345-4678-89AB-CDEF01234567'
    const lan1 = await xuLyLoanDelinquencyChanged(id, '2026-10-03T03:00:00Z', suKien({ borrowerId: 'hoa-thuong' }))
    const lan2 = await xuLyLoanDelinquencyChanged(id.toLowerCase(), '2026-10-03T03:00:00Z',
      suKien({ borrowerId: 'hoa-thuong' }))
    assert.equal(lan1.trangThai, 'CHO_MAPPING')
    assert.equal(lan2.trangThai, 'DA_TON_TAI')
    const cho = (await kho.layDuLieu()).suKienQuaHanChoXuLy.filter((e) => e.borrowerId === 'hoa-thuong')
    assert.equal(cho.length, 1)
    assert.equal(cho[0].eventId, id.toLowerCase())
    assert.equal(Object.hasOwn(cho[0], 'soCccd'), false, 'hàng chờ không được chứa CCCD')
  })
})

describe('Kiểm tra chặt dữ liệu sự kiện', { concurrency: false }, () => {
  const truongHopSai = [
    ['debtGroup = 6', { debtGroup: 6 }, /debtGroup/],
    ['previousDebtGroup = 0', { previousDebtGroup: 0 }, /previousDebtGroup/],
    ['daysPastDue âm', { daysPastDue: -1 }, /daysPastDue/],
    ['daysPastDue lẻ', { daysPastDue: 1.5 }, /daysPastDue/],
    ['daysPastDue là chuỗi', { daysPastDue: '10' }, /daysPastDue/],
    ['thiếu loanApplicationId', { loanApplicationId: undefined }, /loanApplicationId/],
    ['fineractLoanId = 0', { fineractLoanId: 0 }, /fineractLoanId/],
    ['borrowerId rỗng', { borrowerId: '   ' }, /borrowerId/],
    ['borrowerId có khoảng trắng hai đầu', { borrowerId: ' 9001 ' }, /khoảng trắng/],
    ['loanNumber quá 50 ký tự', { loanNumber: 'L'.repeat(51) }, /loanNumber/],
    ['totalOutstanding âm', { totalOutstanding: '-5.00' }, /không được âm/],
    ['totalOutstanding dạng mũ', { totalOutstanding: '1e6' }, /totalOutstanding/],
    ['totalOutstanding là số JSON', { totalOutstanding: 1000 }, /totalOutstanding/],
    ['overdueSince không có thật', { overdueSince: '2026-02-30' }, /overdueSince/],
    ['dataAsOf thiếu múi giờ', { dataAsOf: '2026-10-03T03:00:00' }, /dataAsOf/],
    ['dataAsOf dạng epoch', { dataAsOf: 1759460400 }, /dataAsOf/],
  ]

  for (const [ten, ghiDe, mau] of truongHopSai) {
    test(`từ chối: ${ten}`, async () => {
      const truoc = structuredClone(await kho.layDuLieu())
      await assert.rejects(
        xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00Z', suKien(ghiDe)),
        (loi) => loi instanceof SuKienKhongHopLe && mau.test(loi.message),
      )
      assert.deepEqual(await kho.layDuLieu(), truoc)
    })
  }

  test('từ chối eventId không phải UUID, occurredAt sai, data không phải object', async () => {
    await assert.rejects(xuLyLoanDelinquencyChanged('khong-phai-uuid', '2026-10-03T03:00:00Z', suKien()),
      (loi) => loi instanceof SuKienKhongHopLe && /eventId/.test(loi.message))
    await assert.rejects(xuLyLoanDelinquencyChanged(uuid(), '2026-10-03 03:00:00Z', suKien()),
      (loi) => loi instanceof SuKienKhongHopLe && /occurredAt/.test(loi.message))
    await assert.rejects(xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00Z', []),
      (loi) => loi instanceof SuKienKhongHopLe && /data/.test(loi.message))
  })

  test('"-0.00" có signum 0 nên được nhận như bản Java', async () => {
    const kq = await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00Z',
      suKien({ borrowerId: 'am-khong', overdueAmount: '-0.00' }))
    assert.equal(kq.trangThai, 'CHO_MAPPING')
  })
})

describe('Chính sách khắc phục nợ xấu', { concurrency: false }, () => {
  test('khắc phục từ nhóm 2 không mở cửa sổ; tái nợ xấu xoá cửa sổ; mốc cuối tháng lùi đúng', async () => {
    const borrowerId = 'chinh-sach'
    const soCccd = '079299000201'
    await taoLienKetNguoiVay({ borrowerId, soCccd })

    const buoc = [
      { previousDaysPastDue: 0, daysPastDue: 15, previousDebtGroup: 1, debtGroup: 2,
        dataAsOf: '2024-01-10T03:00:00Z' },
      { previousDaysPastDue: 15, daysPastDue: 0, previousDebtGroup: 2, debtGroup: 1,
        dataAsOf: '2024-01-20T03:00:00Z' },
      { previousDaysPastDue: 0, daysPastDue: 120, previousDebtGroup: 1, debtGroup: 3,
        dataAsOf: '2024-02-01T03:00:00Z' },
      { previousDaysPastDue: 120, daysPastDue: 0, previousDebtGroup: 3, debtGroup: 1,
        dataAsOf: '2024-02-29T03:00:00Z' },
      { previousDaysPastDue: 0, daysPastDue: 5, previousDebtGroup: 1, debtGroup: 1,
        dataAsOf: '2024-03-05T03:00:00Z' },
      { previousDaysPastDue: 5, daysPastDue: 200, previousDebtGroup: 1, debtGroup: 4,
        dataAsOf: '2024-09-01T03:00:00Z' },
    ]
    for (const b of buoc) {
      await xuLyLoanDelinquencyChanged(uuid(), b.dataAsOf, suKien({ borrowerId, ...b }))
    }
    const pb = await phienBanCua(soCccd)
    const cuaSo = (h) => [h.ngayKhacPhucNoXau, h.tamKhoaVayDen, h.thamDinhThuCongDen]

    assert.deepEqual(cuaSo(pb[1]), [null, null, null], 'nhóm 2 → 1 không phải khắc phục nợ xấu')
    assert.deepEqual(cuaSo(pb[2]), [null, null, null])
    assert.deepEqual(cuaSo(pb[3]), ['2024-02-29', '2025-02-28', '2026-02-28'],
      'plusMonths: 29/02 + 12 tháng = 28/02')
    assert.deepEqual(cuaSo(pb[4]), ['2024-02-29', '2025-02-28', '2026-02-28'],
      'quá hạn nhẹ ở nhóm 1 không xoá cửa sổ phục hồi')
    assert.deepEqual(cuaSo(pb[5]), [null, null, null], 'quay lại nhóm 4 thì xoá cửa sổ')

    assert.deepEqual(pb.map((h) => h.nhomNoCaoNhat), [2, 2, 3, 3, 3, 4])
    assert.deepEqual(pb.map((h) => h.soLanTreHan12Thang), [1, 1, 2, 2, 3, 3],
      'chỉ đếm khi DPD đi từ 0 lên > 0')
    assert.equal(pb[5].soNgayTreDaiNhat, 200)
    assert.deepEqual(pb.map((h) => h.soThangTuLanTreGanNhat), [0, 0, 0, 0, 0, 0])
  })
})

describe('Phát lại hàng chờ', { concurrency: false }, () => {
  test('sắp theo occurredAt ở độ chính xác micro-giây, hoà thì theo thứ tự nhận', async () => {
    const borrowerId = 'thu-tu'
    const muon = suKien({ borrowerId, loanApplicationId: 3, debtGroup: 3, daysPastDue: 95 })
    const som = suKien({ borrowerId, loanApplicationId: 1 })
    const hoaA = suKien({ borrowerId, loanApplicationId: 2, previousDaysPastDue: 10, daysPastDue: 40 })
    const hoaB = suKien({ borrowerId, loanApplicationId: 4, previousDaysPastDue: 95, daysPastDue: 0,
      previousDebtGroup: 3, debtGroup: 1, overdueSince: null, overdueAmount: '0.00' })

    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00.000002Z', hoaA)
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00.000003Z', muon)
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00.000001Z', som)
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00.000003Z', hoaB)
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00Z',
      suKien({ borrowerId: 'nguoi-khac' }))

    const kq = await taoLienKetNguoiVay({ borrowerId, soCccd: '079299000301' })
    assert.equal(kq.soSuKienDaPhatLai, 4)

    const pb = await phienBanCua('079299000301')
    assert.deepEqual(pb.map((h) => h.ghiChu.split('=')[1]), ['1', '2', '3', '4'])
    const d = await kho.layDuLieu()
    assert.equal(d.suKienQuaHanChoXuLy.filter((e) => e.borrowerId === borrowerId).length, 0)
    assert.equal(d.suKienQuaHanChoXuLy.filter((e) => e.borrowerId === 'nguoi-khac').length, 1,
      'hàng chờ của borrower khác còn nguyên')
  })

  test('liên kết đã có vẫn phát lại phần chờ còn sót (nhánh byBorrower của bản Java)', async () => {
    const borrowerId = 'con-sot'
    const soCccd = '079299000302'
    await taoLienKetNguoiVay({ borrowerId, soCccd })
    // Giả lập tài liệu bị sửa tay: một bản ghi chờ còn sót dù liên kết đã có.
    await kho.capNhat((d) => {
      d.suKienQuaHanChoXuLy.push({
        id: 9_000, eventId: uuid(), ...suKien({ borrowerId }), occurredAt: '2026-10-03T03:00:00Z',
        createdAt: '2026-10-03T03:00:00Z', updatedAt: '2026-10-03T03:00:00Z',
      })
    })
    const kq = await taoLienKetNguoiVay({ borrowerId, soCccd })
    assert.equal(kq.soSuKienDaPhatLai, 1)
    assert.equal((await phienBanCua(soCccd)).length, 1)
  })
})

describe('Rollback trọn vẹn khi vi phạm ràng buộc hồ sơ', { concurrency: false }, () => {
  /** Hồ sơ có ngày mở quan hệ 10/10 — mọi event có dataAsOf trước đó sẽ vi phạm ck_hs_11. */
  async function hoSoMoQuanHeMuon(soCccd) {
    await taoPhienBanMoi({
      soCccd, hoTen: 'Hồ Sơ Giả Lập', hieuLucTu: '2026-10-10', ngayMoQuanHeDauTien: '2026-10-10',
      soLanTreHan12Thang: 0, soLanTreHan24Thang: 0, soNgayTreDaiNhat: 0, soThangTuLanTreGanNhat: -1,
      tongDuNo: 0, tongHanMuc: 50_000_000, duNoTheTinDung: 0, hanMucThe: 0, soLanTraCuu6Thang: 0,
      soHopDongMoMoi6Thang: 0, soHopDongDangCo: 1, soLoaiSanPham: 1,
    })
  }

  test('phát lại vi phạm thì không tạo liên kết, hàng chờ còn nguyên, không có phiên bản mới', async () => {
    const soCccd = '079299000401'
    await hoSoMoQuanHeMuon(soCccd)
    await xuLyLoanDelinquencyChanged(uuid(), '2026-10-03T03:00:00Z', suKien({ borrowerId: 'vi-pham' }))
    const truoc = structuredClone(await kho.layDuLieu())

    await assert.rejects(taoLienKetNguoiVay({ borrowerId: 'vi-pham', soCccd }),
      (loi) => loi instanceof ViPhamToanVenDuLieu && /ngayMoQuanHeDauTien/.test(loi.message)
        && !loi.message.includes(soCccd))
    assert.deepEqual(await kho.layDuLieu(), truoc)
  })

  test('sự kiện trực tiếp vi phạm thì không ghi gì, eventId chưa bị đánh dấu đã xử lý', async () => {
    const soCccd = '079299000402'
    await hoSoMoQuanHeMuon(soCccd)
    await taoLienKetNguoiVay({ borrowerId: 'vi-pham-truc-tiep', soCccd })
    const id = uuid()
    const truoc = structuredClone(await kho.layDuLieu())

    await assert.rejects(
      xuLyLoanDelinquencyChanged(id, '2026-10-03T03:00:00Z', suKien({ borrowerId: 'vi-pham-truc-tiep' })),
      (loi) => loi instanceof ViPhamToanVenDuLieu && !(loi instanceof DuLieuKhongHopLe))
    assert.deepEqual(await kho.layDuLieu(), truoc)
  })
})

describe('Đệm kho khi ghi xuống nguồn thất bại', { concurrency: false }, () => {
  test('không để lại sự kiện "đã xử lý" chỉ có trong RAM', async () => {
    const borrowerId = 'ghi-hong'
    await taoLienKetNguoiVay({ borrowerId, soCccd: '079299000501' })
    const id = uuid()

    // Chặn tệp tạm bằng một thư mục cùng tên: writeFile của driver tệp sẽ thất bại.
    mkdirSync(`${TEP}.tam`)
    try {
      await assert.rejects(
        xuLyLoanDelinquencyChanged(id, '2026-10-03T03:00:00Z', suKien({ borrowerId })),
        (loi) => !(loi instanceof DuLieuKhongHopLe), 'lỗi ghi phải là lỗi tạm thời')
    } finally {
      rmSync(`${TEP}.tam`, { recursive: true, force: true })
    }

    const d = await kho.layDuLieu()
    assert.equal(d.suKienDaXuLy.some((e) => e.eventId === id), false)
    assert.equal(d.hoSoTinDung.some((h) => h.soCccd === '079299000501'), false)

    const lanThuLai = await xuLyLoanDelinquencyChanged(id, '2026-10-03T03:00:00Z', suKien({ borrowerId }))
    assert.equal(lanThuLai.trangThai, 'DA_CAP_NHAT', 'thử lại phải được áp, không bị coi là trùng')
  })

  test('nạp lại đồng thời sau khi bỏ đệm dùng chung MỘT bản, không ghi đè lẫn nhau', async () => {
    kho.xoaDem()
    const [a, b, c] = await Promise.all([kho.layDuLieu(), kho.layDuLieu(), kho.layDuLieu()])
    assert.equal(a, b)
    assert.equal(b, c)

    // Một lượt ghi chen giữa các lượt nạp lại vẫn phải còn nguyên sau đó.
    kho.xoaDem()
    const id = uuid()
    const [, ketQua] = await Promise.all([
      kho.layDuLieu(),
      xuLyLoanDelinquencyChanged(id, '2026-10-03T03:00:00Z', suKien({ borrowerId: 'nap-dong-thoi' })),
      kho.layDuLieu(),
    ])
    assert.equal(ketQua.trangThai, 'CHO_MAPPING')
    assert.ok((await kho.layDuLieu()).suKienQuaHanChoXuLy.some((e) => e.eventId === id))
  })
})

describe('Chốt kho công khai', () => {
  test('Blob công khai bị chặn trừ khi bật cờ chấp nhận rủi ro', () => {
    assert.throws(() => tichHop.kiemTraKhoChoPhepLuuDinhDanh({ congKhai: true, choPhep: false }),
      (loi) => loi instanceof KhoLuuTruCongKhai && loi.httpStatus === 503
        && loi.maLoi === 'KHO_LUU_TRU_CONG_KHAI')
    assert.doesNotThrow(() => tichHop.kiemTraKhoChoPhepLuuDinhDanh({ congKhai: true, choPhep: true }))
    assert.doesNotThrow(() => tichHop.kiemTraKhoChoPhepLuuDinhDanh({ congKhai: false, choPhep: false }))
    assert.equal(kho.congKhai, false, 'driver tệp không công khai')
  })

  test('cờ chấp nhận rủi ro chỉ nhận đúng "true"', () => {
    assert.equal(docCauHinhTichHop({}).choPhepPiiTrenBlobCongKhai, false)
    assert.equal(docCauHinhTichHop({ CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI: 'TRUE' }).choPhepPiiTrenBlobCongKhai, true)
    assert.equal(docCauHinhTichHop({ CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI: '1' }).choPhepPiiTrenBlobCongKhai, false)
  })
})

describe('Cấu hình', () => {
  test('chính sách nợ xấu: mặc định 12/24, đọc đè được, chặn giá trị sai', () => {
    assert.deepEqual({ ...docChinhSachNoXau({}) }, { soThangTamKhoa: 12, soThangThamDinhThuCong: 24 })
    assert.deepEqual({ ...docChinhSachNoXau({
      CIC_BAD_DEBT_COOLDOWN_MONTHS: '6', CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS: '6',
    }) }, { soThangTamKhoa: 6, soThangThamDinhThuCong: 6 })
    for (const sai of [
      { CIC_BAD_DEBT_COOLDOWN_MONTHS: '-1' },
      { CIC_BAD_DEBT_COOLDOWN_MONTHS: '1.5' },
      { CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS: 'abc' },
      { CIC_BAD_DEBT_COOLDOWN_MONTHS: '1201', CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS: '1300' },
      { CIC_BAD_DEBT_COOLDOWN_MONTHS: '24', CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS: '12' },
    ]) {
      assert.throws(() => docChinhSachNoXau(sai), Error, JSON.stringify(sai))
    }
  })

  test('Kafka mặc định tắt, đúng tên biến môi trường của spec', () => {
    const macDinh = docCauHinhKafka({})
    assert.equal(macDinh.batConsumer, false)
    assert.deepEqual([...macDinh.brokers], ['localhost:9092'])
    assert.equal(macDinh.groupId, 'cic-loan-delinquency')
    assert.equal(macDinh.topic, 'finora.loan.delinquency-changed')

    const bat = docCauHinhKafka({
      CIC_KAFKA_CONSUMER_ENABLED: 'true', KAFKA_BOOTSTRAP_SERVERS: '127.0.0.1:9092, 127.0.0.1:9093',
      CIC_LOAN_DELINQUENCY_GROUP: 'nhom-thu', LOAN_DELINQUENCY_CHANGED_TOPIC: 'chu-de-thu',
    })
    assert.equal(bat.batConsumer, true)
    assert.deepEqual([...bat.brokers], ['127.0.0.1:9092', '127.0.0.1:9093'])
    assert.equal(bat.groupId, 'nhom-thu')
    assert.equal(bat.topic, 'chu-de-thu')
    assert.equal(docCauHinhKafka({ CIC_KAFKA_CONSUMER_ENABLED: 'yes' }).batConsumer, false)
  })

  test('khoá nội bộ rỗng nghĩa là endpoint đóng', () => {
    assert.equal(docCauHinhTichHop({}).khoaApiNoiBo, '')
  })
})

describe('Tiện ích ngày giờ (đối chiếu java.time)', () => {
  test('congThang giống LocalDate.plusMonths', () => {
    assert.equal(congThang('2026-10-04', 12), '2027-10-04')
    assert.equal(congThang('2026-10-04', 24), '2028-10-04')
    assert.equal(congThang('2026-01-31', 1), '2026-02-28')
    assert.equal(congThang('2024-01-31', 1), '2024-02-29')
    assert.equal(congThang('2024-02-29', 12), '2025-02-28')
    assert.equal(congThang('2026-12-15', 1), '2027-01-15')
    assert.equal(congThang('2026-03-31', 0), '2026-03-31')
  })

  test('docThoiDiemIso nhận Z/offset/phần lẻ tới nano-giây, từ chối chuỗi Java cũng từ chối', () => {
    assert.equal(docThoiDiemIso('2026-10-03T10:00:00+07:00'), docThoiDiemIso('2026-10-03T03:00:00Z'))
    assert.ok(docThoiDiemIso('2026-10-03T03:00:00.000001Z') < docThoiDiemIso('2026-10-03T03:00:00.000002Z'))
    assert.equal(docThoiDiemIso('2026-10-03T03:00:00.123456789Z') % 1_000_000_000n, 123_456_789n)
    for (const sai of [
      '2026-10-03T03:00:00', '2026-10-03 03:00:00Z', '2026-13-01T00:00:00Z', '2026-02-29T00:00:00Z',
      '2026-10-03T24:00:00Z', '2026-10-03T03:00:00+19:00', '2026-10-03T03:00:00.1234567890Z',
      '2026-10-03t03:00:00z', 1759460400, null,
    ]) {
      assert.equal(docThoiDiemIso(sai), null, String(sai))
    }
  })

  test('laNgayIsoHopLe và ngayTheoMuiGio', () => {
    assert.equal(laNgayIsoHopLe('2024-02-29'), true)
    assert.equal(laNgayIsoHopLe('2026-02-29'), false)
    assert.equal(laNgayIsoHopLe('2026-9-23'), false)
    assert.equal(ngayTheoMuiGio(docThoiDiemIso('2026-10-03T16:59:59.999999Z')), '2026-10-03')
    assert.equal(ngayTheoMuiGio(docThoiDiemIso('2026-10-03T17:00:00Z')), '2026-10-04')
  })
})
