# SDD ledger — plan: docs/superpowers/plans/2026-10-11-cic-service-parity.md

Baseline: `npm.cmd test` -> 63 tests passed, 0 failed.

Ruling: Work in the current clean `main` checkout — the user explicitly requested the update and opted out of further planning questions; creating a nested worktree would require mutating Git metadata and add no protection from pre-existing changes because this repo is clean — cost if wrong: changes must be moved to a feature branch later.

Ruling: Track execution in this local ledger without the SDD helper scripts — the Git Bash helper cannot create the Windows workspace under the managed sandbox and loops on failure — cost if wrong: automated task-start/task-done metadata is unavailable, so test evidence is recorded manually.

Pre-flight: Task 1 normalized storage/V4 fields -> Task 2 consumes them: compatible.
Pre-flight: Task 2 mapping/event service -> Task 3 route consumes `taoLienKetNguoiVay`: compatible.
Pre-flight: Task 2 event service -> Task 4 Kafka adapter consumes `xuLyLoanDelinquencyChanged`: compatible.

Task 1: complete (tests: `npm.cmd test` -> 67 passed, 0 failed; score fixture 1,000/1,000 unchanged).

Ruling: Task 2–4 làm trên nhánh `feat/finora-delinquency-intake` trong worktree riêng, không đụng checkout `main`; mỗi task một commit, kafkajs 2.2.4 (ghim chính xác, node_modules commit kèm) tách commit riêng — Thái uỷ quyền chọn phương án tốt nhất, mọi thứ chờ Hải review trước merge — cost if wrong: rebase nhánh lên `main` mới của Hải.

Ruling (D66): kho là Vercel Blob công khai thì `taoLienKetNguoiVay` từ chối lưu borrowerId ↔ CCCD, trả 503 `KHO_LUU_TRU_CONG_KHAI` (kiểm sau khoá và sau dữ liệu vào); chỉ mở bằng `CIC_CHO_PHEP_PII_TREN_BLOB_CONG_KHAI=true` — driver blob ghi `access: 'public'` ở đường dẫn cố định mà `finora-user` gửi CCCD thật từ eKYC — cost if wrong: liên kết từ bản Vercel bị từ chối (FINORA tự thử lại) cho tới khi chuyển sang Blob riêng tư hoặc bật cờ.

Ruling (D67): hợp đồng HTTP của `POST /api/v1/internal/borrower-mappings` theo Java và `CicMappingWorker` — 201 cả khi gửi lại đúng cặp, 400 cho xung đột/dữ liệu sai, 403 khi đóng hoặc sai khoá, 500 khi phát lại vi phạm ràng buộc (huỷ trọn vẹn); khác Java ở chỗ khoá được kiểm trước khi đọc thân (SHA-256 + `timingSafeEqual`) và thông điệp lỗi không lặp lại CCCD — cost if wrong: thân sai + khoá sai ra 403 thay vì 400 như Java.

Ruling (D68): consumer KafkaJS tắt auto-commit, commit offset+1 sau khi xử lý xong hoặc đã ghi DLT; sai envelope/header/schema → DLT không thử lại; lỗi tạm thời và vi phạm toàn vẹn → thử lại 2 lần cách 1 giây rồi DLT (như FixedBackOff(1000, 2) và DataIntegrityViolation bên Java); DLT giữ key với partitioner tương thích Java thay vì ép cùng số partition; bật mà không kết nối được broker thì dừng lúc khởi động — cost if wrong: nếu DLT có ít partition hơn topic nguồn thì bản ghi DLT không nằm đúng số partition như Spring.

Ruling (D69): mỗi thao tác đúng một lượt `kho.capNhat`, mọi kiểm tra/tính toán xong mới ghi; `capNhat` bỏ bộ nhớ đệm khi lượt hỏng (B67); thứ tự sự kiện giữ đúng Java (trực tiếp theo thứ tự đến, không chốt dataAsOf cũ; hàng chờ theo occurredAt tới nano-giây rồi id); 12/24 tháng kiểm lúc khởi động, thẩm định thủ công không được nhỏ hơn tạm khoá (thay CHECK `ck_ho_so_cua_so_phuc_hoi`) — cost if wrong: mỗi lượt lỗi nghiệp vụ phải đọc lại kho một lần.

Defect (B66): test "tạo mapping phát lại event chờ và chỉ trả CCCD đã che" (`test/tich-hop-finora-domain.test.js`) dùng CCCD `079203001234` vốn có trong seed (id 11); đúng ngữ nghĩa Java thì event tạo phiên bản 2 và giữ dư nợ 460 triệu, còn test kỳ vọng hồ sơ mới — chưa sửa vì test thuộc Hải; đổi sang `079203009934` thì 7/7 xanh (đã thử trên bản sao).

Defect (B67): `kho.capNhat` để bản trong RAM đi trước nguồn khi bienDoi ném lỗi hoặc ghi xuống nguồn thất bại, khiến một sự kiện "đã xử lý" chỉ có trong RAM bị coi là trùng rồi commit offset — đã sửa trong Task 2 (bỏ đệm khi lượt hỏng), có test tái hiện.

Defect (B68): `GET /api/v1/diem-tin-dung/{soCccd}` vốn lưu hồ sơ mới và nhật ký theo CCCD, `finora-ai` gọi với CCCD thật, và Compose của FINORA mặc định `CIC_SERVICE_URL=https://cic-service-node.vercel.app` — trên bản Vercel các CCCD đó nằm trong Blob công khai; chưa sửa (contract công khai), khuyến nghị store Blob riêng tư.

Defect (B69): `.agents/rules/08-cross-service-flows.md` của FINORA (bước 4 eKYC) vẫn ghi `keycloakUserId` làm `borrowerId`, trong khi code `CicMappingWorker` (sau B26) gửi `user_profiles.id`; câu B27 "CIC Node không consume Kafka, không có endpoint mapping" sẽ lỗi thời khi nhánh này được merge — chỉ báo, không sửa repo FINORA.

Task 2: complete (tests: `node --test "test/**/*.test.js"` -> 110 passed, 1 failed — test B66 của Hải; score fixture 1,000/1,000 unchanged).

Task 3: complete (tests: `node --test "test/**/*.test.js"` -> 145 passed, 1 failed — B66; score fixture 1,000/1,000 unchanged).

Task 4: complete (tests: `node --test "test/**/*.test.js"` -> 176 passed, 1 failed — B66; score fixture 1,000/1,000 unchanged; smoke Kafka thật trên topic `cic-smoke.*` của broker `finora-kafka` xanh, topic và group smoke đã xoá). Hải review trước merge.
