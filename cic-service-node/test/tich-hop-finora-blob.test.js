/**
 * Chốt fail-closed: khi driver kho là Vercel Blob (ghi `access: 'public'`), endpoint
 * liên kết từ chối lưu borrowerId ↔ CCCD — 503 `KHO_LUU_TRU_CONG_KHAI` — trừ khi người
 * vận hành đặt `CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI=true`.
 *
 * Driver được chọn lúc nạp module nên cần file test riêng. Token Blob bị xoá khỏi môi
 * trường TRƯỚC khi import: test không bao giờ chạm tới Vercel, kể cả khi máy chạy test
 * có sẵn BLOB_READ_WRITE_TOKEN (SDK ném "No token found" trước mọi lời gọi mạng).
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'

delete process.env.BLOB_READ_WRITE_TOKEN
process.env.CIC_KHO = 'blob'
process.env.CIC_TEN_BLOB = 'cic-test-khong-ton-tai/du-lieu.json'
delete process.env.CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI

const KHOA = 'khoa-gia-lap-chi-dung-trong-test-blob'
const { taoApp } = await import('../src/app.js')
const { kho } = await import('../src/du-lieu/kho-luu-tru.js')

// Khoá được đọc lúc dựng app, như cấu hình nạp lúc khởi động.
process.env.CIC_INTERNAL_API_KEY = KHOA
const app = taoApp()
delete process.env.CIC_INTERNAL_API_KEY

let may
let goc
const loiGoc = console.error
const infoGoc = console.info

before(async () => {
  may = app.listen(0)
  await new Promise((xong) => may.once('listening', xong))
  goc = `http://127.0.0.1:${may.address().port}`
})

after(() => {
  may?.close()
  console.error = loiGoc
  console.info = infoGoc
  delete process.env.CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI
})

const goi = async (than, khoa = KHOA) => {
  const r = await fetch(`${goc}/api/v1/internal/borrower-mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Finora-Internal-Key': khoa },
    body: JSON.stringify(than),
  })
  return { status: r.status, than: await r.json() }
}

describe('Kho Vercel Blob công khai', { concurrency: false }, () => {
  test('driver blob được đánh dấu công khai', () => {
    assert.equal(kho.tenDriver, 'blob')
    assert.equal(kho.congKhai, true)
  })

  test('liên kết hợp lệ bị từ chối 503 KHO_LUU_TRU_CONG_KHAI, không lộ CCCD', async () => {
    const r = await goi({ borrowerId: '8001', soCccd: '079297000001' })
    assert.equal(r.status, 503)
    assert.equal(r.than.maLoi, 'KHO_LUU_TRU_CONG_KHAI')
    assert.match(r.than.thongDiep, /CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI/)
    assert.equal(JSON.stringify(r.than).includes('079297000001'), false)
  })

  test('khoá sai vẫn là 403, thân sai vẫn là 400 (kiểm trước chốt kho)', async () => {
    assert.equal((await goi({ borrowerId: '8002', soCccd: '079297000002' }, 'sai')).status, 403)
    const sai = await goi({ borrowerId: '8002', soCccd: '123' })
    assert.equal(sai.status, 400)
    assert.equal(sai.than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
  })

  test('bật cờ chấp nhận rủi ro thì qua được chốt (rồi mới tới tầng kho)', async () => {
    process.env.CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI = 'true'
    const loi = []
    console.error = (...thamSo) => { loi.push(thamSo) }
    try {
      const r = await goi({ borrowerId: '8003', soCccd: '079297000003' })
      assert.notEqual(r.status, 503, 'chốt kho không được chặn khi đã bật cờ')
      // Không có token Blob trong môi trường nên tầng kho báo lỗi trước khi gọi mạng.
      assert.equal(r.status, 500)
      assert.equal(r.than.maLoi, 'LOI_HE_THONG')
      assert.ok(loi.some((dong) => /No token found/.test(String(dong[1]?.message))))
    } finally {
      console.error = loiGoc
      delete process.env.CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI
    }
  })
})
