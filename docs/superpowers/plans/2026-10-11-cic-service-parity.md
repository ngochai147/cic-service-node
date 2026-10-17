# CIC Service Node Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the current Java CIC debt-state and FINORA delinquency-integration features to `cic-service-node` without changing existing scoring behavior.

**Architecture:** Normalize the existing JSON/Blob document into a backward-compatible four-table data model, keep business operations inside serialized storage mutations, and expose the same internal mapping contract through Express. A pure message parser/processor sits behind an optional KafkaJS adapter so tests do not require a broker and Vercel does not create long-lived consumers.

**Tech Stack:** Node.js 20+, ES modules, Express 4, Node test runner, KafkaJS, JSON file/Vercel Blob storage

**Spec:** `docs/superpowers/specs/2026-10-11-cic-service-parity-design.md`

## Global Constraints

- Preserve the existing 1,000-profile Java score fixture exactly.
- Preserve append-only credit profiles and serialized atomic writes.
- Do not expose raw CCCD outside the existing public profile APIs.
- Kafka is opt-in in Node with `CIC_KAFKA_CONSUMER_ENABLED=true`.
- Invalid Kafka messages go to DLT without retry; transient failures get two retries.

## Review Focus

- Old two-collection JSON documents load with the new collections and V4 fields safely.
- Duplicate event IDs cannot create a second profile version, whether pending or processed.
- Conflicting borrower-to-CCCD mappings are rejected while an identical mapping is idempotent.
- Recovery from group 3-5 to group 1-2 preserves historical maximum debt group and opens both policy windows.
- A FINORA loan event never overwrites aggregate CIC balances on an existing profile.

---

### Task 1: Backward-compatible profile schema

**Files:**
- Modify: `cic-service-node/src/du-lieu/kho-luu-tru.js`
- Modify: `cic-service-node/src/dich-vu/ho-so.js`
- Modify: `cic-service-node/src/dich-vu/tra-cuu.js`
- Test: `cic-service-node/test/tich-hop-finora.test.js`

**Interfaces:**
- Produces: normalized storage collections and V4 response fields.

- [ ] Write tests asserting old seed documents receive V4 defaults and all profile response shapes include the new fields.
- [ ] Run the focused test and verify the missing fields fail.
- [ ] Implement document normalization and response mapping; manual profiles set current group from historical group.
- [ ] Run focused and full suites.

### Task 2: Durable mapping and delinquency domain service

**Files:**
- Create: `cic-service-node/src/dich-vu/tich-hop-finora.js`
- Modify: `cic-service-node/src/cau-hinh.js`
- Test: `cic-service-node/test/tich-hop-finora.test.js`

**Interfaces:**
- Consumes: `kho.capNhat`, `dungHoSoMoi(soCccd)`, ISO date helpers.
- Produces: `taoLienKetNguoiVay(request)`, `xuLyLoanDelinquencyChanged(eventId, occurredAt, data)`, and strict validation helpers.

- [x] Add failing tests for pending events, replay order, duplicate suppression, new late occurrence, recovery windows, preserved aggregates, and invalid data.
- [x] Verify failures are caused by absent service behavior.
- [x] Implement all mapping/event operations within one serialized storage mutation per operation.
- [x] Run focused and full suites.

### Task 3: Protected internal HTTP endpoint

**Files:**
- Modify: `cic-service-node/src/app.js`
- Modify: `cic-service-node/src/ho-tro/loi.js`
- Test: `cic-service-node/test/tich-hop-finora.test.js`

**Interfaces:**
- Consumes: `taoLienKetNguoiVay(request)` and `CIC_INTERNAL_API_KEY`.
- Produces: `POST /api/v1/internal/borrower-mappings` returning HTTP 201 or Java-compatible HTTP 400/403 errors.

- [x] Add failing HTTP tests for closed, wrong-key, valid, idempotent, and conflicting requests.
- [x] Verify expected 404/authorization failures.
- [x] Implement constant-time key validation, CORS header allowance, route, and error mapping.
- [x] Run focused and full suites.

### Task 4: Kafka consumer adapter and documentation

**Files:**
- Create: `cic-service-node/src/messaging/loan-delinquency-changed.js`
- Modify: `cic-service-node/src/server.js`
- Modify: `cic-service-node/package.json`
- Modify: `cic-service-node/package-lock.json`
- Modify: `cic-service-node/README.md`
- Test: `cic-service-node/test/messaging.test.js`

**Interfaces:**
- Consumes: `xuLyLoanDelinquencyChanged(eventId, occurredAt, data)`.
- Produces: `docLoanDelinquencyChanged(payload, headers)`, `khoiDongKafkaConsumer()`, and `dongKafkaConsumer()`.

- [x] Add failing parser tests for valid V1, header mismatch, malformed JSON, unsupported versions, and invalid UUID/timestamps.
- [x] Verify failures are due to the missing module.
- [x] Implement the pure parser and KafkaJS adapter with retry/DLT behavior.
- [x] Start/stop the adapter from the local server only when enabled and document configuration/storage changes.
- [x] Run focused and full suites, then inspect the final diff.
