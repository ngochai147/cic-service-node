# SDD ledger — plan: docs/superpowers/plans/2026-10-11-cic-service-parity.md

Baseline: `npm.cmd test` -> 63 tests passed, 0 failed.

Ruling: Work in the current clean `main` checkout — the user explicitly requested the update and opted out of further planning questions; creating a nested worktree would require mutating Git metadata and add no protection from pre-existing changes because this repo is clean — cost if wrong: changes must be moved to a feature branch later.

Ruling: Track execution in this local ledger without the SDD helper scripts — the Git Bash helper cannot create the Windows workspace under the managed sandbox and loops on failure — cost if wrong: automated task-start/task-done metadata is unavailable, so test evidence is recorded manually.

Pre-flight: Task 1 normalized storage/V4 fields -> Task 2 consumes them: compatible.
Pre-flight: Task 2 mapping/event service -> Task 3 route consumes `taoLienKetNguoiVay`: compatible.
Pre-flight: Task 2 event service -> Task 4 Kafka adapter consumes `xuLyLoanDelinquencyChanged`: compatible.

Task 1: complete (tests: `npm.cmd test` -> 67 passed, 0 failed; score fixture 1,000/1,000 unchanged).

