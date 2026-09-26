/**
 * Tầng HTTP: 8 endpoint, giữ nguyên 100% contract của bản Java.
 *
 * Mọi lỗi ra khỏi service đều mang đúng một hình dạng: `{maLoi, thongDiep}`.
 * Cố ý KHÔNG có nhánh nào trả 404 cho CCCD chưa tồn tại — hệ thống dựng hồ sơ tín
 * dụng mới và trả 200.
 */
import express from 'express'

import { thamSoMoPhong } from './cau-hinh.js'
import { kho } from './du-lieu/kho-luu-tru.js'
import { CicKhongKhaDung, LoiCoMa, MaLoi } from './ho-tro/loi.js'
import * as dvHoSo from './dich-vu/ho-so.js'
import * as dvTraCuu from './dich-vu/tra-cuu.js'
import * as dvNhatKy from './dich-vu/nhat-ky.js'
import * as dvThongKe from './dich-vu/thong-ke.js'

/** Bọc handler async để lỗi rơi đúng vào middleware xử lý lỗi của Express 4. */
const async_ = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** Đọc tham số số nguyên từ query, rơi về mặc định khi thiếu hoặc không phải số. */
function soNguyen(giaTri, macDinh) {
  if (giaTri == null || giaTri === '') return macDinh
  const n = Number(giaTri)
  return Number.isInteger(n) ? n : macDinh
}

export function taoApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('json spaces', 0)
  app.use(express.json({ limit: '1mb' }))

  // CORS: bản Java không mở CORS (cic-web đi qua proxy của Vite). Bản này chạy trên
  // Vercel nên giao diện có thể nằm khác origin — mở đọc cho mọi origin, không gửi
  // cookie. Dữ liệu vốn là dữ liệu mô phỏng, không có PII thật.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.set('Access-Control-Allow-Headers', 'Content-Type, Accept')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    return next()
  })

  // ── Mô phỏng sự cố ───────────────────────────────────────────────────────
  // Đây là nơi DUY NHẤT trong toàn hệ thống có số ngẫu nhiên, và nó nằm ngoài bộ
  // tính điểm nên không phá tính tất định: request nào đi qua được thì vẫn nhận
  // đúng con số như khi tắt mô phỏng.
  if (thamSoMoPhong.dangBat) {
    console.warn('Chế độ mô phỏng sự cố ĐANG BẬT: do-tre-ms=%d ty-le-loi=%s',
      thamSoMoPhong.doTreMs, thamSoMoPhong.tyLeLoi)

    app.use('/api', async_(async (req, res, next) => {
      if (thamSoMoPhong.doTreMs > 0) {
        await new Promise((xong) => setTimeout(xong, thamSoMoPhong.doTreMs))
      }
      if (thamSoMoPhong.tyLeLoi > 0 && Math.random() < thamSoMoPhong.tyLeLoi) {
        throw new CicKhongKhaDung(
          'Hệ thống CIC tạm thời không khả dụng, vui lòng thử lại sau')
      }
      return next()
    }))
  }

  // ── Endpoint chính: tra điểm tín dụng ────────────────────────────────────

  app.get('/api/v1/diem-tin-dung/:soCccd', async_(async (req, res) => {
    const chiTiet = String(req.query.chiTiet ?? 'false') === 'true'
    res.json(await dvTraCuu.traCuu(req.params.soCccd, chiTiet))
  }))

  // ── Hồ sơ ────────────────────────────────────────────────────────────────

  app.get('/api/v1/ho-so', async_(async (req, res) => {
    const { tuKhoa, nhomNo } = req.query
    res.json(await dvHoSo.timDanhSach(
      tuKhoa ?? null,
      nhomNo == null || nhomNo === '' ? null : soNguyen(nhomNo, -1),
      soNguyen(req.query.trang, 0),
      soNguyen(req.query.kichThuoc, 25),
    ))
  }))

  app.get('/api/v1/ho-so/:soCccd', async_(async (req, res) => {
    res.json(await dvHoSo.xemHoSo(req.params.soCccd))
  }))

  app.get('/api/v1/ho-so/:soCccd/lich-su', async_(async (req, res) => {
    res.json(await dvHoSo.xemLichSu(req.params.soCccd))
  }))

  app.post('/api/v1/ho-so', async_(async (req, res) => {
    res.status(201).json(await dvHoSo.taoPhienBanMoi(req.body))
  }))

  // ── Nhật ký, thống kê, cấu hình ──────────────────────────────────────────

  app.get('/api/v1/nhat-ky', async_(async (req, res) => {
    const { soCccd, tu, den } = req.query
    res.json(await dvNhatKy.timNhatKy(soCccd ?? null, tu ?? null, den ?? null))
  }))

  app.get('/api/v1/thong-ke', async_(async (_req, res) => {
    res.json(await dvThongKe.thongKe())
  }))

  app.get('/api/v1/cau-hinh', (_req, res) => {
    res.json(dvThongKe.cauHinh())
  })

  // ── Sức khoẻ ─────────────────────────────────────────────────────────────
  // Giữ nguyên đường dẫn `/actuator/health` của Spring Boot để cic-web và mọi
  // script kiểm tra sẵn có không phải sửa gì.

  const sucKhoe = async_(async (_req, res) => {
    const d = await kho.layDuLieu()
    res.json({
      status: 'UP',
      kho: kho.tenDriver,
      soHoSo: d.hoSoTinDung.length,
      soNhatKy: d.nhatKyTraCuu.length,
    })
  })
  app.get('/actuator/health', sucKhoe)
  app.get('/api/v1/suc-khoe', sucKhoe)

  // ── Xử lý lỗi ────────────────────────────────────────────────────────────

  app.use((req, res) => {
    res.status(404).json({
      maLoi: MaLoi.DU_LIEU_KHONG_HOP_LE,
      thongDiep: `Không có endpoint ${req.method} ${req.path}`,
    })
  })

  app.use((loi, _req, res, _next) => {
    if (loi instanceof LoiCoMa) {
      return res.status(loi.httpStatus).json({
        maLoi: loi.maLoi,
        thongDiep: loi.message,
      })
    }
    // Thân JSON hỏng: express.json ném SyntaxError kèm cờ này.
    if (loi instanceof SyntaxError && 'body' in loi) {
      return res.status(400).json({
        maLoi: MaLoi.DU_LIEU_KHONG_HOP_LE,
        thongDiep: `Không đọc được dữ liệu gửi lên: ${loi.message}`,
      })
    }
    console.error('Lỗi hệ thống ngoài dự kiến', loi)
    return res.status(500).json({
      maLoi: MaLoi.LOI_HE_THONG,
      thongDiep: 'Lỗi hệ thống, vui lòng thử lại sau',
    })
  })

  return app
}
