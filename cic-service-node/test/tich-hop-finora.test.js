import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const THU_MUC = mkdtempSync(join(tmpdir(), 'cic-finora-test-'))
const TEP = join(THU_MUC, 'du-lieu.json')
copyFileSync(join(GOC, 'dulieu', 'du-lieu.json'), TEP)

process.env.CIC_TEP_DU_LIEU = TEP
process.env.CIC_KHO = 'tep'

const { kho } = await import('../src/du-lieu/kho-luu-tru.js')
const hoSo = await import('../src/dich-vu/ho-so.js')

before(() => kho.xoaDem())
after(() => rmSync(THU_MUC, { recursive: true, force: true }))

describe('Tương thích dữ liệu V3/V4', () => {
  test('tài liệu JSON cũ được bổ sung ba collection tích hợp', async () => {
    const d = await kho.layDuLieu()
    assert.deepEqual(d.lienKetNguoiVay, [])
    assert.deepEqual(d.suKienDaXuLy, [])
    assert.deepEqual(d.suKienQuaHanChoXuLy, [])
  })

  test('hồ sơ seed cũ backfill nhóm hiện tại và các mốc phục hồi', async () => {
    const d = await kho.layDuLieu()
    const h = d.hoSoTinDung[0]
    assert.equal(h.nhomNoHienTai, h.nhomNoCaoNhat)
    assert.equal(h.ngayKhacPhucNoXau, null)
    assert.equal(h.tamKhoaVayDen, null)
    assert.equal(h.thamDinhThuCongDen, null)
  })

  test('response hồ sơ và tóm tắt trả các trường V4', async () => {
    const chiTiet = await hoSo.xemHoSo('079081000001')
    assert.equal(chiTiet.nhomNoHienTai, chiTiet.nhomNoCaoNhat)
    assert.ok(Object.hasOwn(chiTiet, 'ngayKhacPhucNoXau'))
    assert.ok(Object.hasOwn(chiTiet, 'tamKhoaVayDen'))
    assert.ok(Object.hasOwn(chiTiet, 'thamDinhThuCongDen'))

    const danhSach = await hoSo.timDanhSach('079081000001', null, 0, 25)
    assert.equal(danhSach.noiDung[0].nhomNoHienTai, danhSach.noiDung[0].nhomNoCaoNhat)
  })

  test('hồ sơ dựng mới để trống trạng thái nợ hiện tại và phục hồi', () => {
    const h = hoSo.dungHoSoMoi('123456789012')
    assert.equal(h.nhomNoHienTai, null)
    assert.equal(h.ngayKhacPhucNoXau, null)
    assert.equal(h.tamKhoaVayDen, null)
    assert.equal(h.thamDinhThuCongDen, null)
  })
})
