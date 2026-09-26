/**
 * Tầng lưu trữ: đọc/ghi toàn bộ dữ liệu dưới dạng một object JSON duy nhất.
 *
 * ── Vì sao có lớp trừu tượng này ──
 * Filesystem của Vercel là chỉ-đọc (trừ /tmp, và /tmp mất sau mỗi cold start). Nên
 * "lưu trong file JSON" chỉ bền khi chạy local. Lớp này giữ nguyên mô hình file JSON
 * cho toàn bộ code nghiệp vụ, còn chuyện ghi ở đâu thì do driver quyết định:
 *
 *   - `tep`  (mặc định khi chạy local): đọc/ghi thẳng `dulieu/du-lieu.json`.
 *             Sửa tay được, commit vào git được, xem bằng mắt được.
 *   - `blob` (tự chọn khi deploy Vercel): đọc/ghi Vercel Blob, dữ liệu bền thật.
 *             Lần chạy đầu chưa có blob thì nạp `dulieu/du-lieu.json` làm seed.
 *
 * Chọn driver bằng biến môi trường `CIC_KHO`, mặc định tự đoán: có
 * `BLOB_READ_WRITE_TOKEN` thì dùng blob, không thì dùng tep.
 *
 * ── Ghi tuần tự ──
 * Mọi thao tác ghi đi qua `capNhat()` và được xếp hàng trên một promise duy nhất.
 * Node chỉ có một luồng nên không có race trong nội bộ một request, nhưng hai
 * request đồng thời cùng `đọc → sửa → ghi` thì vẫn mất dữ liệu của nhau nếu không
 * xếp hàng.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GOC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TEP_SEED = join(GOC, 'dulieu', 'du-lieu.json')

/** Nơi ghi khi chạy local. Trên Vercel không dùng tới (đã sang blob). */
const TEP_GHI = process.env.CIC_TEP_DU_LIEU
  ?? (process.env.VERCEL ? '/tmp/du-lieu.json' : TEP_SEED)

const TEN_BLOB = process.env.CIC_TEN_BLOB ?? 'cic/du-lieu.json'

/** Hình dạng rỗng — cũng là tài liệu về hai bảng của hệ thống. */
const RONG = { hoSoTinDung: [], nhatKyTraCuu: [] }

function chonDriver() {
  const chon = process.env.CIC_KHO
  if (chon) return chon
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'tep'
}

async function docSeed() {
  if (!existsSync(TEP_SEED)) return structuredClone(RONG)
  return JSON.parse(await readFile(TEP_SEED, 'utf8'))
}

// ── Driver: tệp ──────────────────────────────────────────────────────────────

const driverTep = {
  ten: 'tep',
  nguon: TEP_GHI,

  async doc() {
    if (!existsSync(TEP_GHI)) {
      // Trên Vercel: lần đầu chép seed sang /tmp. Local: chưa có thì dựng rỗng.
      const banDau = await docSeed()
      await this.ghi(banDau)
      return banDau
    }
    return JSON.parse(await readFile(TEP_GHI, 'utf8'))
  },

  /** Ghi qua file tạm rồi rename: tiến trình chết giữa chừng không để lại file cụt. */
  async ghi(duLieu) {
    await mkdir(dirname(TEP_GHI), { recursive: true })
    const tam = `${TEP_GHI}.tam`
    await writeFile(tam, JSON.stringify(duLieu, null, 2) + '\n', 'utf8')
    await rename(tam, TEP_GHI)
  },
}

// ── Driver: Vercel Blob ──────────────────────────────────────────────────────

const driverBlob = {
  ten: 'blob',
  nguon: TEN_BLOB,
  _mo: null,

  async _thuVien() {
    // import động: máy chạy local không cài @vercel/blob vẫn khởi động được.
    this._mo ??= await import('@vercel/blob')
    return this._mo
  },

  async doc() {
    const { list } = await this._thuVien()
    const { blobs } = await list({ prefix: TEN_BLOB, limit: 1 })
    const found = blobs.find((b) => b.pathname === TEN_BLOB)

    if (!found) {
      const banDau = await docSeed()
      await this.ghi(banDau)
      return banDau
    }
    // `?t=` chặn CDN trả bản cũ sau khi vừa ghi.
    const res = await fetch(`${found.url}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`Không đọc được blob: HTTP ${res.status}`)
    return res.json()
  },

  async ghi(duLieu) {
    const { put } = await this._thuVien()
    await put(TEN_BLOB, JSON.stringify(duLieu, null, 2) + '\n', {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
  },
}

// ── Kho ──────────────────────────────────────────────────────────────────────

const driver = chonDriver() === 'blob' ? driverBlob : driverTep

/** Bộ nhớ đệm trong tiến trình: tránh đọc lại nguồn ở mỗi request. */
let boNho = null
/** Hàng đợi ghi, giữ cho các thao tác đọc-sửa-ghi không chen nhau. */
let hangDoi = Promise.resolve()

export const kho = {
  tenDriver: driver.ten,
  nguon: driver.nguon,

  /** Toàn bộ dữ liệu. Chỉ đọc — muốn sửa thì đi qua `capNhat`. */
  async layDuLieu() {
    boNho ??= await driver.doc()
    return boNho
  },

  /**
   * Sửa dữ liệu một cách nguyên tử.
   *
   * @param {(duLieu: object) => any} bienDoi nhận dữ liệu hiện tại, sửa tại chỗ,
   *        trả về giá trị mà bên gọi cần. Ghi xuống nguồn sau khi hàm này chạy xong.
   */
  async capNhat(bienDoi) {
    const luot = hangDoi.then(async () => {
      const duLieu = await this.layDuLieu()
      const ketQua = await bienDoi(duLieu)
      await driver.ghi(duLieu)
      return ketQua
    })
    // Nuốt lỗi ở nhánh hàng đợi để một lượt ghi hỏng không chặn mọi lượt sau.
    hangDoi = luot.catch(() => {})
    return luot
  },

  /** Xoá đệm, buộc lượt đọc sau lấy lại từ nguồn. Dùng trong test. */
  xoaDem() {
    boNho = null
  },
}
