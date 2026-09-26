/**
 * Điểm vào cho Vercel serverless.
 *
 * Vercel gọi hàm export mặc định với (req, res) — app Express dùng trực tiếp được.
 * Không `listen` ở đây: runtime tự lo vòng đời tiến trình.
 */
import { taoApp } from '../src/app.js'

export default taoApp()
