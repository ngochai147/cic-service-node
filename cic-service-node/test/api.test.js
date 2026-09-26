/**
 * Test tầng HTTP: 8 endpoint, mã lỗi, và các bất biến của tầng dữ liệu.
 *
 * Mỗi lần chạy dùng một file dữ liệu riêng trong thư mục tạm, nên test không bao giờ
 * đụng vào `dulieu/du-lieu.json` thật.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const THU_MUC = mkdtempSync(join(tmpdir(), 'cic-test-'))
const TEP = join(THU_MUC, 'du-lieu.json')
copyFileSync(join(GOC, 'dulieu', 'du-lieu.json'), TEP)

// Phải đặt TRƯỚC khi import app: kho-luu-tru đọc biến này lúc nạp module.
process.env.CIC_TEP_DU_LIEU = TEP
process.env.CIC_KHO = 'tep'

const { taoApp } = await import('../src/app.js')

let may
let goc

before(async () => {
  const app = taoApp()
  may = app.listen(0)
  await new Promise((xong) => may.once('listening', xong))
  goc = `http://127.0.0.1:${may.address().port}`
})

after(() => {
  may?.close()
  rmSync(THU_MUC, { recursive: true, force: true })
})

const GET = async (duongDan) => {
  const r = await fetch(goc + duongDan)
  return { status: r.status, than: await r.json() }
}

const POST = async (duongDan, than) => {
  const r = await fetch(goc + duongDan, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof than === 'string' ? than : JSON.stringify(than),
  })
  return { status: r.status, than: await r.json() }
}

/** Thân request hợp lệ tối thiểu. */
const yeuCauMau = (ghiDe = {}) => ({
  soCccd: '079081000001',
  hoTen: 'Nguyễn Minh Khôi',
  soLanTreHan12Thang: 0,
  soLanTreHan24Thang: 0,
  soNgayTreDaiNhat: 0,
  soThangTuLanTreGanNhat: -1,
  tongDuNo: 0,
  tongHanMuc: 100_000_000,
  duNoTheTinDung: 0,
  hanMucThe: 0,
  soLanTraCuu6Thang: 0,
  soHopDongMoMoi6Thang: 0,
  soHopDongDangCo: 1,
  soLoaiSanPham: 1,
  ...ghiDe,
})

describe('GET /api/v1/diem-tin-dung/{soCccd}', () => {
  test('bản gọn chỉ có 3 trường, không kèm phân rã', async () => {
    const { status, than } = await GET('/api/v1/diem-tin-dung/079081000001')
    assert.equal(status, 200)
    assert.deepEqual(Object.keys(than).sort(), ['diemCic', 'soCccd', 'thoiDiemTraCuu'])
    assert.equal(than.diemCic, 735)
  })

  test('chiTiet=true trả đủ phanRa và hoSo — contract của finora-ai', async () => {
    const { than } = await GET('/api/v1/diem-tin-dung/079081000001?chiTiet=true')

    assert.equal(than.phienBanHoSo, 1)
    assert.deepEqual(Object.keys(than.phanRa).sort(), [
      'coCauTinDung', 'duNoHienTai', 'lichSuTraNo',
      'thoiGianQuanHe', 'tinDungMoi', 'tongDiem',
    ])
    // 10 trường thô mà cic_client.py đọc
    assert.deepEqual(Object.keys(than.hoSo).sort(), [
      'duNoTheTinDung', 'hanMucThe', 'nhomNoCaoNhat', 'soHopDongDangCo',
      'soLanTraCuu6Thang', 'soLanTreHan24Thang', 'soNgayTreDaiNhat',
      'soThangQuanHe', 'soThangTuLanTreGanNhat', 'tongDuNo',
    ])
    assert.equal(than.hoSo.soThangQuanHe, 144)
  })

  test('tổng đóng góp 5 nhóm khớp tongDiem (sai số làm tròn ≤ 0,05)', async () => {
    const { than } = await GET('/api/v1/diem-tin-dung/040190000008?chiTiet=true')
    const p = than.phanRa
    const tong = p.lichSuTraNo.dongGop + p.duNoHienTai.dongGop
      + p.thoiGianQuanHe.dongGop + p.tinDungMoi.dongGop + p.coCauTinDung.dongGop
    assert.ok(Math.abs(tong - p.tongDiem) <= 0.05)
  })

  test('CCCD chưa có vẫn trả 200 và ĐƯỢC LƯU lại', async () => {
    const la = '111122223333'
    const { status, than } = await GET(`/api/v1/diem-tin-dung/${la}`)
    assert.equal(status, 200)
    assert.ok(than.diemCic >= 150 && than.diemCic <= 750)

    const d = JSON.parse(readFileSync(TEP, 'utf8'))
    const dong = d.hoSoTinDung.filter((h) => h.soCccd === la)
    assert.equal(dong.length, 1, 'phải lưu đúng 1 dòng')
    assert.equal(dong[0].nhomNoCaoNhat, null, 'hồ sơ mới phải để trống nhóm nợ')
  })

  test('tra lần hai KHÔNG đẻ thêm phiên bản rác', async () => {
    const la = '444455556666'
    await GET(`/api/v1/diem-tin-dung/${la}`)
    await GET(`/api/v1/diem-tin-dung/${la}`)
    await GET(`/api/v1/diem-tin-dung/${la}`)

    const d = JSON.parse(readFileSync(TEP, 'utf8'))
    assert.equal(d.hoSoTinDung.filter((h) => h.soCccd === la).length, 1)
  })

  test('CCCD sai định dạng trả 400 kèm mã CCCD_KHONG_HOP_LE', async () => {
    for (const xau of ['123', 'abcdefghijkl', '07908100000']) {
      const { status, than } = await GET(`/api/v1/diem-tin-dung/${xau}`)
      assert.equal(status, 400)
      assert.equal(than.maLoi, 'CCCD_KHONG_HOP_LE')
    }
  })

  test('mỗi lượt tra ghi đúng một dòng nhật ký', async () => {
    const truoc = (await GET('/api/v1/nhat-ky?soCccd=001185000002')).than.length
    await GET('/api/v1/diem-tin-dung/001185000002')
    const sau = (await GET('/api/v1/nhat-ky?soCccd=001185000002')).than.length
    assert.equal(sau, truoc + 1)
  })
})

describe('GET /api/v1/ho-so', () => {
  test('phân trang trả đúng vỏ TrangResponse', async () => {
    const { than } = await GET('/api/v1/ho-so?trang=0&kichThuoc=10')
    assert.deepEqual(Object.keys(than).sort(),
      ['kichThuoc', 'noiDung', 'tongSo', 'tongTrang', 'trang'])
    assert.equal(than.noiDung.length, 10)
    assert.equal(than.trang, 0)
  })

  test('kích thước trang bị chặn trần 200', async () => {
    const { than } = await GET('/api/v1/ho-so?kichThuoc=5000')
    assert.equal(than.kichThuoc, 200)
    assert.ok(than.noiDung.length <= 200)
  })

  test('lọc theo nhóm nợ', async () => {
    const { than } = await GET('/api/v1/ho-so?nhomNo=5&kichThuoc=200')
    assert.ok(than.noiDung.length > 0)
    assert.ok(than.noiDung.every((h) => h.nhomNoCaoNhat === 5))
  })

  test('lọc theo từ khoá, không phân biệt hoa thường', async () => {
    const { than } = await GET('/api/v1/ho-so?tuKhoa=NGUYỄN&kichThuoc=200')
    assert.ok(than.tongSo > 0)
    assert.ok(than.noiDung.every((h) => h.hoTen.toLowerCase().includes('nguyễn')))
  })

  test('nhomNo ngoài [1,5] trả 400', async () => {
    const { status, than } = await GET('/api/v1/ho-so?nhomNo=9')
    assert.equal(status, 400)
    assert.equal(than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
  })

  test('danh sách KHÔNG ghi nhật ký', async () => {
    const truoc = (await GET('/api/v1/nhat-ky')).than.length
    await GET('/api/v1/ho-so?kichThuoc=50')
    const sau = (await GET('/api/v1/nhat-ky')).than.length
    assert.equal(sau, truoc, 'mở danh sách không được đẻ ra dòng nhật ký nào')
  })
})

describe('GET /api/v1/ho-so/{soCccd}', () => {
  test('trả 20 trường của hồ sơ thô', async () => {
    const { than } = await GET('/api/v1/ho-so/079081000001')
    assert.equal(Object.keys(than).length, 20)
    assert.equal(than.soCccd, '079081000001')
  })

  test('CCCD chưa có trả 200 và KHÔNG ghi gì vào dữ liệu', async () => {
    const la = '777788889999'
    const { status, than } = await GET(`/api/v1/ho-so/${la}`)
    assert.equal(status, 200)
    assert.match(than.ghiChu, /chưa được lưu/)

    const d = JSON.parse(readFileSync(TEP, 'utf8'))
    assert.equal(d.hoSoTinDung.some((h) => h.soCccd === la), false,
      'GET không được ghi dữ liệu')
  })

  test('lịch sử trả các phiên bản theo thứ tự cũ → mới', async () => {
    const { than } = await GET('/api/v1/ho-so/024811893049/lich-su')
    assert.equal(than.soPhienBan, than.phienBan.length)
    const pb = than.phienBan.map((p) => p.phienBan)
    assert.deepEqual(pb, [...pb].sort((a, b) => a - b))
  })

  test('lịch sử của CCCD chưa có trả danh sách rỗng', async () => {
    const { status, than } = await GET('/api/v1/ho-so/121212121212/lich-su')
    assert.equal(status, 200)
    assert.deepEqual(than.phienBan, [])
    assert.equal(than.soPhienBan, 0)
  })
})

describe('POST /api/v1/ho-so', () => {
  test('tạo phiên bản mới: phienBan = max + 1, không ghi đè dòng cũ', async () => {
    const cccd = '079081000001'
    const truoc = (await GET(`/api/v1/ho-so/${cccd}/lich-su`)).than
    const maxTruoc = Math.max(...truoc.phienBan.map((p) => p.phienBan))

    const { status, than } = await POST('/api/v1/ho-so', yeuCauMau({ soCccd: cccd }))
    assert.equal(status, 201)
    assert.equal(than.phienBan, maxTruoc + 1)

    const sau = (await GET(`/api/v1/ho-so/${cccd}/lich-su`)).than
    assert.equal(sau.soPhienBan, truoc.soPhienBan + 1)
    // dòng cũ còn nguyên
    assert.deepEqual(sau.phienBan[0], truoc.phienBan[0])
  })

  test('dữ liệu mới được ghi xuống file JSON', async () => {
    const cccd = '135713571357'
    await POST('/api/v1/ho-so', yeuCauMau({ soCccd: cccd, hoTen: 'Lưu Xuống Tệp' }))

    const d = JSON.parse(readFileSync(TEP, 'utf8'))
    const dong = d.hoSoTinDung.find((h) => h.soCccd === cccd)
    assert.ok(dong, 'phải tìm thấy dòng vừa tạo trong file')
    assert.equal(dong.hoTen, 'Lưu Xuống Tệp')
  })

  test('điểm đổi theo dữ liệu mới', async () => {
    const cccd = '246824682468'
    await POST('/api/v1/ho-so', yeuCauMau({
      soCccd: cccd, tongDuNo: 95_000_000, tongHanMuc: 100_000_000,
    }))
    const dungNhieu = (await GET(`/api/v1/diem-tin-dung/${cccd}`)).than.diemCic

    await POST('/api/v1/ho-so', yeuCauMau({
      soCccd: cccd, tongDuNo: 5_000_000, tongHanMuc: 100_000_000,
    }))
    const dungIt = (await GET(`/api/v1/diem-tin-dung/${cccd}`)).than.diemCic

    assert.ok(dungIt > dungNhieu,
      `trả bớt nợ thì điểm phải tăng: ${dungNhieu} -> ${dungIt}`)
  })

  describe('sáu ràng buộc nghiệp vụ', () => {
    const truongHop = [
      ['tongDuNo vượt tongHanMuc',
        { tongDuNo: 900, tongHanMuc: 100 }],
      ['duNoTheTinDung vượt hanMucThe',
        { duNoTheTinDung: 900, hanMucThe: 100 }],
      ['ngayMoQuanHeDauTien sau hieuLucTu',
        { hieuLucTu: '2020-01-01', ngayMoQuanHeDauTien: '2026-01-01' }],
      ['nợ nhóm 4 nhưng chưa từng trễ',
        { nhomNoCaoNhat: 4, soThangTuLanTreGanNhat: -1 }],
      ['soLanTreHan12Thang vượt soLanTreHan24Thang',
        { soLanTreHan12Thang: 5, soLanTreHan24Thang: 1 }],
      ['nhomNoCaoNhat ngoài [1,5]',
        { nhomNoCaoNhat: 9 }],
    ]

    for (const [ten, ghiDe] of truongHop) {
      test(`chặn: ${ten}`, async () => {
        const { status, than } = await POST('/api/v1/ho-so', yeuCauMau(ghiDe))
        assert.equal(status, 400)
        assert.equal(than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
      })
    }
  })

  test('thiếu trường bắt buộc trả 400', async () => {
    const { status, than } = await POST('/api/v1/ho-so', { soCccd: '079081000001' })
    assert.equal(status, 400)
    assert.equal(than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
    assert.match(than.thongDiep, /hoTen/)
  })

  test('JSON hỏng trả 400 chứ không 500', async () => {
    const { status, than } = await POST('/api/v1/ho-so', '{hong')
    assert.equal(status, 400)
    assert.equal(than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
  })
})

describe('GET /api/v1/nhat-ky', () => {
  test('mới nhất trước', async () => {
    await GET('/api/v1/diem-tin-dung/048092000003')
    await GET('/api/v1/diem-tin-dung/079188000004')

    const { than } = await GET('/api/v1/nhat-ky')
    const moc = than.map((n) => new Date(n.thoiDiem).getTime())
    for (let i = 1; i < moc.length; i++) {
      assert.ok(moc[i] <= moc[i - 1], 'phải sắp giảm dần theo thời điểm')
    }
  })

  test('lọc theo khoảng ngày', async () => {
    const rong = (await GET('/api/v1/nhat-ky?tu=1970-01-01&den=9999-12-31')).than
    const hep = (await GET('/api/v1/nhat-ky?tu=1999-01-01&den=1999-12-31')).than
    assert.ok(rong.length > 0)
    assert.equal(hep.length, 0)
  })

  test('ngày sai định dạng trả 400', async () => {
    const { status, than } = await GET('/api/v1/nhat-ky?tu=07-08-2026')
    assert.equal(status, 400)
    assert.equal(than.maLoi, 'DU_LIEU_KHONG_HOP_LE')
  })
})

describe('GET /api/v1/thong-ke và /cau-hinh', () => {
  test('thống kê có đủ trường và phân bố', async () => {
    const { than } = await GET('/api/v1/thong-ke')
    assert.equal(than.nguongThamChieu, 431)
    assert.equal(than.theoNhomNo.length, 6, '6 nhóm: chưa có quan hệ + nhóm 1..5')
    assert.equal(than.theoDaiDiem.length, 5)
    assert.ok(than.diemThapNhat >= 150 && than.diemCaoNhat <= 750)
    assert.ok(than.tongBanGhi >= than.tongCccd)
  })

  test('tổng số lượng theo dải điểm bằng số hồ sơ hiện hành', async () => {
    const { than } = await GET('/api/v1/thong-ke')
    const tong = than.theoDaiDiem.reduce((a, d) => a + d.soLuong, 0)
    assert.equal(tong, than.tongHoSoHienHanh)
  })

  test('cấu hình trả 5 trọng số cộng lại bằng 1', async () => {
    const { than } = await GET('/api/v1/cau-hinh')
    assert.equal(than.trongSo.length, 5)
    const tong = than.trongSo.reduce((a, t) => a + t.trongSo, 0)
    assert.ok(Math.abs(tong - 1) < 1e-9)
    assert.equal(than.diemToiThieu, 150)
    assert.equal(than.diemToiDa, 750)
  })
})

describe('Sức khoẻ và 404', () => {
  test('/actuator/health giữ nguyên đường dẫn của Spring Boot', async () => {
    const { status, than } = await GET('/actuator/health')
    assert.equal(status, 200)
    assert.equal(than.status, 'UP')
  })

  test('endpoint không tồn tại trả 404 đúng hình dạng lỗi', async () => {
    const { status, than } = await GET('/api/v1/khong-ton-tai')
    assert.equal(status, 404)
    assert.ok(than.maLoi)
    assert.ok(than.thongDiep)
  })
})
