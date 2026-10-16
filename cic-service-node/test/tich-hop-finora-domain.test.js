import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const THU_MUC = mkdtempSync(join(tmpdir(), 'cic-finora-domain-'))
const TEP = join(THU_MUC, 'du-lieu.json')
copyFileSync(join(GOC, 'dulieu', 'du-lieu.json'), TEP)

process.env.CIC_TEP_DU_LIEU = TEP
process.env.CIC_KHO = 'tep'
process.env.CIC_BAD_DEBT_COOLDOWN_MONTHS = '12'
process.env.CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS = '24'

const { kho } = await import('../src/du-lieu/kho-luu-tru.js')
const {
  taoLienKetNguoiVay,
  xuLyLoanDelinquencyChanged,
} = await import('../src/dich-vu/tich-hop-finora.js')

before(() => kho.xoaDem())
after(() => rmSync(THU_MUC, { recursive: true, force: true }))

const UUID = {
  cho: '11111111-1111-4111-8111-111111111111',
  noXau: '22222222-2222-4222-8222-222222222222',
  phucHoi: '33333333-3333-4333-8333-333333333333',
  baoToan: '44444444-4444-4444-8444-444444444444',
}

const suKien = (ghiDe = {}) => ({
  loanApplicationId: 10,
  loanNumber: 'LN-10',
  borrowerId: 'borrower-cho',
  fineractLoanId: 20,
  previousDaysPastDue: 0,
  daysPastDue: 10,
  previousDebtGroup: 1,
  debtGroup: 2,
  overdueAmount: '1000000.00',
  overdueSince: '2026-09-23',
  totalOutstanding: '9000000.00',
  dataAsOf: '2026-10-03T03:00:00Z',
  ...ghiDe,
})

describe('Tích hợp LoanDelinquencyChanged', { concurrency: false }, () => {
  test('event đến trước mapping được giữ bền vững và duplicate không nhân đôi', async () => {
    const lanDau = await xuLyLoanDelinquencyChanged(
      UUID.cho, '2026-10-03T03:00:00Z', suKien())
    const lapLai = await xuLyLoanDelinquencyChanged(
      UUID.cho, '2026-10-03T03:00:00Z', suKien())

    assert.equal(lanDau.trangThai, 'CHO_MAPPING')
    assert.equal(lapLai.trangThai, 'DA_TON_TAI')
    const d = await kho.layDuLieu()
    assert.equal(d.suKienQuaHanChoXuLy.filter((e) => e.eventId === UUID.cho).length, 1)
    assert.equal(d.suKienDaXuLy.some((e) => e.eventId === UUID.cho), false)
  })

  test('tạo mapping phát lại event chờ và chỉ trả CCCD đã che', async () => {
    const ketQua = await taoLienKetNguoiVay({
      borrowerId: ' borrower-cho ', soCccd: '079203001234',
    })

    assert.deepEqual(Object.keys(ketQua).sort(), [
      'borrowerId', 'createdAt', 'soCccdDaChe', 'soSuKienDaPhatLai',
    ])
    assert.equal(ketQua.soCccdDaChe, '079*******34')
    assert.equal(ketQua.soSuKienDaPhatLai, 1)

    const d = await kho.layDuLieu()
    assert.equal(d.suKienQuaHanChoXuLy.length, 0)
    assert.equal(d.suKienDaXuLy.filter((e) => e.eventId === UUID.cho).length, 1)
    const h = d.hoSoTinDung.find((x) => x.soCccd === '079203001234')
    assert.equal(h.phienBan, 1)
    assert.equal(h.nhomNoCaoNhat, 2)
    assert.equal(h.nhomNoHienTai, 2)
    assert.equal(h.soLanTreHan12Thang, 1)
    assert.equal(h.soLanTreHan24Thang, 1)
    assert.equal(h.soNgayTreDaiNhat, 10)
    assert.equal(h.tongDuNo, 9_000_000)
  })

  test('event đã xử lý không tạo phiên bản thứ hai', async () => {
    const truoc = (await kho.layDuLieu()).hoSoTinDung
      .filter((h) => h.soCccd === '079203001234').length
    const ketQua = await xuLyLoanDelinquencyChanged(
      UUID.cho, '2026-10-03T03:00:00Z', suKien())
    const sau = (await kho.layDuLieu()).hoSoTinDung
      .filter((h) => h.soCccd === '079203001234').length
    assert.equal(ketQua.trangThai, 'DA_TON_TAI')
    assert.equal(sau, truoc)
  })

  test('replay theo occurredAt giữ nhóm nợ lịch sử và mở cửa sổ phục hồi', async () => {
    const borrowerId = 'borrower-recovery'
    await xuLyLoanDelinquencyChanged(UUID.phucHoi, '2026-10-04T03:00:00Z', suKien({
      borrowerId, previousDaysPastDue: 100, daysPastDue: 0,
      previousDebtGroup: 4, debtGroup: 1,
      totalOutstanding: '8000000.00', dataAsOf: '2026-10-04T03:00:00Z',
    }))
    await xuLyLoanDelinquencyChanged(UUID.noXau, '2026-10-03T03:00:00Z', suKien({
      borrowerId, debtGroup: 4,
    }))

    const mapping = await taoLienKetNguoiVay({ borrowerId, soCccd: '079203001235' })
    assert.equal(mapping.soSuKienDaPhatLai, 2)

    const phienBan = (await kho.layDuLieu()).hoSoTinDung
      .filter((h) => h.soCccd === '079203001235')
      .sort((a, b) => a.phienBan - b.phienBan)
    assert.equal(phienBan.length, 2)
    assert.equal(phienBan[1].nhomNoCaoNhat, 4)
    assert.equal(phienBan[1].nhomNoHienTai, 1)
    assert.equal(phienBan[1].ngayKhacPhucNoXau, '2026-10-04')
    assert.equal(phienBan[1].tamKhoaVayDen, '2027-10-04')
    assert.equal(phienBan[1].thamDinhThuCongDen, '2028-10-04')
  })

  test('hồ sơ đã có chỉ cập nhật lịch sử quá hạn, không ghi đè số tổng', async () => {
    const borrowerId = 'borrower-existing'
    const soCccd = '079081000001'
    await taoLienKetNguoiVay({ borrowerId, soCccd })
    const d0 = await kho.layDuLieu()
    const cu = d0.hoSoTinDung.filter((h) => h.soCccd === soCccd)
      .sort((a, b) => b.phienBan - a.phienBan)[0]

    await xuLyLoanDelinquencyChanged(UUID.baoToan, '2026-10-05T03:00:00Z', suKien({
      borrowerId, totalOutstanding: '1.50', dataAsOf: '2026-10-05T03:00:00Z',
    }))

    const moi = (await kho.layDuLieu()).hoSoTinDung.filter((h) => h.soCccd === soCccd)
      .sort((a, b) => b.phienBan - a.phienBan)[0]
    assert.equal(moi.phienBan, cu.phienBan + 1)
    assert.equal(moi.tongDuNo, cu.tongDuNo)
    assert.equal(moi.tongHanMuc, cu.tongHanMuc)
    assert.equal(moi.soHopDongDangCo, cu.soHopDongDangCo)
    assert.equal(moi.soLoaiSanPham, cu.soLoaiSanPham)
  })

  test('mapping một-một: tạo lại cùng cặp là idempotent, xung đột bị chặn', async () => {
    const mot = await taoLienKetNguoiVay({ borrowerId: 'borrower-existing', soCccd: '079081000001' })
    assert.equal(mot.soSuKienDaPhatLai, 0)
    await assert.rejects(
      taoLienKetNguoiVay({ borrowerId: 'borrower-existing', soCccd: '079081000002' }),
      /borrowerId đã liên kết với CCCD khác/,
    )
    await assert.rejects(
      taoLienKetNguoiVay({ borrowerId: 'borrower-khac', soCccd: '079081000001' }),
      /CCCD đã liên kết với borrowerId khác/,
    )
  })

  test('payload sai bị từ chối và không để lại side effect', async () => {
    const truoc = structuredClone(await kho.layDuLieu())
    await assert.rejects(
      xuLyLoanDelinquencyChanged(
        '55555555-5555-4555-8555-555555555555',
        '2026-10-03T03:00:00Z',
        suKien({ overdueAmount: '-0.01' }),
      ),
      /không được âm/,
    )
    assert.deepEqual(await kho.layDuLieu(), truoc)
  })
})
