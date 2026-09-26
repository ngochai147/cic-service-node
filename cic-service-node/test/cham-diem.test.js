/**
 * Đối chiếu bộ tính điểm bản Node với bản Java.
 *
 * `test/diem-java-goc.txt` được sinh bằng cách chạy CHÍNH lớp `BoTinhDiem` của bản
 * Java (biên dịch trực tiếp từ `cic-service/src/main/java`) trên đúng 1000 hồ sơ
 * trong `dulieu/du-lieu.json`. Mỗi dòng là `soCccd|phienBan|diemCic`.
 *
 * Test này là ràng buộc mạnh nhất của dự án: sửa bất kỳ công thức hay hằng số nào
 * mà làm lệch một hồ sơ thôi là nó đỏ ngay.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  tinhDiem, giangSangThangCic,
  chamLichSuTraNo, chamDuNo, chamThoiGianQuanHe, chamTinDungMoi, chamCoCauTinDung,
} from '../src/cham-diem/bo-tinh-diem.js'
import { noiSuyTai } from '../src/cham-diem/noi-suy.js'
import { thamSoChamDiem, kiemTraCauHinh } from '../src/cau-hinh.js'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..')
const duLieu = JSON.parse(readFileSync(join(GOC, 'dulieu', 'du-lieu.json'), 'utf8'))

/** Hồ sơ sạch tuyệt đối, dùng làm nền để chỉ đổi một trường mỗi lần. */
function hoSoMau(ghiDe = {}) {
  return {
    soCccd: '079081000001',
    phienBan: 1,
    hieuLucTu: '2026-08-07',
    hoTen: 'Nguyễn Văn A',
    nhomNoCaoNhat: 1,
    soLanTreHan12Thang: 0,
    soLanTreHan24Thang: 0,
    soNgayTreDaiNhat: 0,
    soThangTuLanTreGanNhat: -1,
    tongDuNo: 0,
    tongHanMuc: 100_000_000,
    duNoTheTinDung: 0,
    hanMucThe: 100_000_000,
    ngayMoQuanHeDauTien: '2016-08-07',
    soLanTraCuu6Thang: 0,
    soHopDongMoMoi6Thang: 0,
    soHopDongDangCo: 2,
    soLoaiSanPham: 2,
    ...ghiDe,
  }
}

describe('Đối chiếu với bản Java', () => {
  test('1000 hồ sơ seed cho ĐÚNG cùng điểm như BoTinhDiem.java', () => {
    const mong = readFileSync(join(GOC, 'test', 'diem-java-goc.txt'), 'utf8')
      .split('\n').map((d) => d.trim()).filter(Boolean)

    assert.equal(mong.length, 1000, 'file gốc phải có đúng 1000 dòng')
    assert.equal(duLieu.hoSoTinDung.length, 1000, 'seed phải có đúng 1000 hồ sơ')

    const lech = []
    duLieu.hoSoTinDung.forEach((h, i) => {
      const [cccd, pb, diem] = mong[i].split('|')
      const thucTe = tinhDiem(h).diemCic

      assert.equal(h.soCccd, cccd, `dòng ${i + 1}: lệch thứ tự CCCD`)
      assert.equal(h.phienBan, Number(pb), `dòng ${i + 1}: lệch phiên bản`)
      if (thucTe !== Number(diem)) {
        lech.push(`${cccd} pb${pb}: java=${diem} node=${thucTe}`)
      }
    })

    assert.deepEqual(lech, [], `${lech.length} hồ sơ lệch điểm so với bản Java`)
  })

  test('10 persona hiệu chuẩn nằm trong dải kỳ vọng của bản Java', () => {
    // Dải kỳ vọng lấy từ cic-service/src/test/resources/persona.json
    const persona = [
      ['079081000001', 700, 750], ['001185000002', 660, 710],
      ['048092000003', 560, 630], ['079188000004', 520, 590],
      ['074095000005', 590, 650], ['056100000006', 570, 630],
      ['064087000007', 610, 670], ['040190000008', 420, 480],
      ['038086000009', 300, 370], ['089182000010', 280, 340],
    ]

    for (const [cccd, min, max] of persona) {
      const h = duLieu.hoSoTinDung.find((x) => x.soCccd === cccd && x.phienBan === 1)
      const diem = tinhDiem(h).diemCic
      assert.ok(diem >= min && diem <= max,
        `${cccd} (${h.tenKichBan}): điểm ${diem} ngoài dải [${min}, ${max}]`)
    }
  })
})

describe('Thang điểm và tổng trọng số', () => {
  test('cấu hình hợp lệ: tổng 5 trọng số bằng 1.0', () => {
    assert.doesNotThrow(() => kiemTraCauHinh())
  })

  test('cấu hình sai thì ném lỗi ngay', () => {
    const hong = structuredClone(thamSoChamDiem)
    hong.trongSo.lichSuTraNo = 0.9
    assert.throws(() => kiemTraCauHinh(hong), /tổng 5 trọng số/)
  })

  test('giãn sang thang CIC và kẹp về [150, 750]', () => {
    assert.equal(giangSangThangCic(0), 150)
    assert.equal(giangSangThangCic(100), 750)
    assert.equal(giangSangThangCic(50), 450)
    assert.equal(giangSangThangCic(-10), 150, 'điểm âm phải bị kẹp về 150')
    assert.equal(giangSangThangCic(150), 750, 'điểm vượt trần phải bị kẹp về 750')
  })

  test('tổng đóng góp 5 nhóm bằng tongDiem', () => {
    const k = tinhDiem(hoSoMau())
    const tong = k.lichSuTraNo.dongGop + k.duNoHienTai.dongGop
      + k.thoiGianQuanHe.dongGop + k.tinDungMoi.dongGop + k.coCauTinDung.dongGop
    assert.ok(Math.abs(tong - k.tongDiem) < 1e-9)
  })
})

describe('Nhóm 1 — Lịch sử trả nợ', () => {
  test('chưa có quan hệ tín dụng nhận điểm nền, KHÔNG phải 100', () => {
    assert.equal(chamLichSuTraNo(hoSoMau({ nhomNoCaoNhat: null })), 52.0)
  })

  test('nhóm nợ càng xấu điểm càng thấp, đơn điệu', () => {
    const diem = [1, 2, 3, 4, 5].map((n) => chamLichSuTraNo(hoSoMau({
      nhomNoCaoNhat: n, soThangTuLanTreGanNhat: n === 1 ? -1 : 0,
    })))
    for (let i = 1; i < diem.length; i++) {
      assert.ok(diem[i] <= diem[i - 1], `nhóm ${i + 1} phải không cao hơn nhóm ${i}`)
    }
  })

  test('phạt theo ngày trễ bị chặn trần', () => {
    const it = chamLichSuTraNo(hoSoMau({
      nhomNoCaoNhat: 2, soNgayTreDaiNhat: 100, soThangTuLanTreGanNhat: 0,
    }))
    const nhieu = chamLichSuTraNo(hoSoMau({
      nhomNoCaoNhat: 2, soNgayTreDaiNhat: 100_000, soThangTuLanTreGanNhat: 0,
    }))
    // 100 ngày × 0.05 = 5 < trần 20; 100_000 ngày thì đụng trần 20
    assert.ok(nhieu < it)
    assert.equal(it - nhieu, 20.0 - 5.0)
  })

  test('hồi phục chỉ lấp tối đa 60% khoảng hụt: nợ nhóm 5 không bao giờ về 100', () => {
    const daLau = chamLichSuTraNo(hoSoMau({
      nhomNoCaoNhat: 5, soThangTuLanTreGanNhat: 999,
    }))
    assert.ok(daLau < 100, `dù sạch rất lâu vẫn phải dưới 100, nhận được ${daLau}`)
  })

  test('chưa từng trễ thì không áp hồi phục', () => {
    const h = hoSoMau({ nhomNoCaoNhat: 1, soThangTuLanTreGanNhat: -1 })
    assert.equal(chamLichSuTraNo(h), 100.0)
  })
})

describe('Nhóm 2 — Dư nợ hiện tại', () => {
  test('hạn mức 0 là KHÔNG CÓ THÔNG TIN, trả điểm nền chứ không trả 100', () => {
    const h = hoSoMau({ tongHanMuc: 0, hanMucThe: 0, tongDuNo: 0, duNoTheTinDung: 0 })
    assert.equal(chamDuNo(h), 52.0)
  })

  test('không chia cho 0 khi mọi hạn mức bằng 0', () => {
    const d = chamDuNo(hoSoMau({ tongHanMuc: 0, hanMucThe: 0 }))
    assert.ok(Number.isFinite(d))
  })

  test('dùng càng nhiều hạn mức điểm càng thấp', () => {
    const diem = [0, 0.1, 0.3, 0.5, 0.75, 1.0].map((t) => chamDuNo(hoSoMau({
      tongDuNo: t * 100_000_000, tongHanMuc: 100_000_000,
      duNoTheTinDung: t * 100_000_000, hanMucThe: 100_000_000,
    })))
    for (let i = 1; i < diem.length; i++) {
      assert.ok(diem[i] <= diem[i - 1], `tỉ lệ tăng thì điểm phải không tăng`)
    }
    assert.equal(diem[0], 100)
    assert.equal(diem.at(-1), 0)
  })

  test('chỉ có hạn mức thẻ thì lấy nguyên điểm thẻ', () => {
    const h = hoSoMau({
      tongHanMuc: 0, tongDuNo: 0, hanMucThe: 100_000_000, duNoTheTinDung: 0,
    })
    assert.equal(chamDuNo(h), 100.0)
  })
})

describe('Nhóm 3 — Thời gian quan hệ tín dụng', () => {
  test('chưa có quan hệ tín dụng nhận điểm nền', () => {
    assert.equal(chamThoiGianQuanHe(hoSoMau({ ngayMoQuanHeDauTien: null })), 32.0)
  })

  test('bão hoà từ 7 năm', () => {
    const bay = chamThoiGianQuanHe(hoSoMau({
      ngayMoQuanHeDauTien: '2019-08-07', hieuLucTu: '2026-08-07',
    }))
    const haiMuoi = chamThoiGianQuanHe(hoSoMau({
      ngayMoQuanHeDauTien: '2006-08-07', hieuLucTu: '2026-08-07',
    }))
    assert.equal(bay, 100.0)
    assert.equal(haiMuoi, 100.0)
  })

  test('mốc tham chiếu là hieuLucTu của bản ghi, KHÔNG phải hôm nay', () => {
    // Cùng ngày mở, khác hieuLucTu → điểm phải khác. Đây là thứ giữ cho điểm của
    // một phiên bản hồ sơ không tự trôi theo thời gian thực.
    const som = chamThoiGianQuanHe(hoSoMau({
      ngayMoQuanHeDauTien: '2020-01-01', hieuLucTu: '2021-01-01',
    }))
    const muon = chamThoiGianQuanHe(hoSoMau({
      ngayMoQuanHeDauTien: '2020-01-01', hieuLucTu: '2025-01-01',
    }))
    assert.ok(muon > som)
  })
})

describe('Nhóm 4 — Tín dụng mới', () => {
  test('không tra cứu, không hợp đồng mới thì đạt điểm tối đa', () => {
    assert.equal(chamTinDungMoi(hoSoMau()), 100.0)
  })

  test('tra cứu và mở hợp đồng dồn dập bị phạt, sàn là 0', () => {
    assert.equal(chamTinDungMoi(hoSoMau({ soLanTraCuu6Thang: 1 })), 92.0)
    assert.equal(chamTinDungMoi(hoSoMau({ soHopDongMoMoi6Thang: 1 })), 88.0)
    assert.equal(chamTinDungMoi(hoSoMau({
      soLanTraCuu6Thang: 50, soHopDongMoMoi6Thang: 50,
    })), 0.0)
  })
})

describe('Nhóm 5 — Cơ cấu tín dụng', () => {
  test('không có hợp đồng nào thì nhận điểm nền', () => {
    assert.equal(chamCoCauTinDung(hoSoMau({ soHopDongDangCo: 0 })), 38.0)
  })

  test('càng nhiều loại sản phẩm điểm càng cao, bão hoà ở mốc cuối', () => {
    const d = [1, 2, 3, 4, 9].map((n) => chamCoCauTinDung(hoSoMau({
      soHopDongDangCo: 3, soLoaiSanPham: n,
    })))
    assert.deepEqual(d, [55, 75, 90, 100, 100])
  })
})

describe('Nội suy tuyến tính', () => {
  const moc = [{ x: 0, y: 0 }, { x: 10, y: 100 }]

  test('bão hoà ngoài hai đầu', () => {
    assert.equal(noiSuyTai(moc, -5), 0)
    assert.equal(noiSuyTai(moc, 15), 100)
  })

  test('nội suy đúng ở giữa', () => {
    assert.equal(noiSuyTai(moc, 5), 50)
    assert.equal(noiSuyTai(moc, 2.5), 25)
  })

  test('trúng mốc thì trả đúng giá trị mốc', () => {
    assert.equal(noiSuyTai(moc, 0), 0)
    assert.equal(noiSuyTai(moc, 10), 100)
  })
})

describe('Tính tất định', () => {
  test('chấm cùng một hồ sơ nhiều lần cho cùng một kết quả', () => {
    const h = duLieu.hoSoTinDung[42]
    const lan = Array.from({ length: 20 }, () => tinhDiem(h).diemCic)
    assert.equal(new Set(lan).size, 1)
  })

  test('điểm không phụ thuộc thời gian thực', () => {
    // Bộ tính điểm chỉ đọc hieuLucTu của bản ghi; không có Date.now() nào trong
    // đường đi. Đổi đồng hồ hệ thống không đổi được điểm.
    const h = hoSoMau()
    const truoc = tinhDiem(h).diemCic
    const that = Date.now
    try {
      Date.now = () => that() + 10 * 365 * 86_400_000
      assert.equal(tinhDiem(h).diemCic, truoc)
    } finally {
      Date.now = that
    }
  })
})
