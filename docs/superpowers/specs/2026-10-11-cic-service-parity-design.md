# CIC Service Node parity design

## Intent

Bring the Node implementation up to the current functional contract of the Java
`cic-service` working tree while retaining the Node service's JSON/Blob storage model,
Express API, and Vercel-compatible HTTP entry point.

## Scope

- Preserve all existing scoring, profile, audit-log, statistics, configuration, and
  health behavior.
- Add the V4 credit-profile fields: current debt group, bad-debt resolution date,
  cooldown end, and manual-review end. Existing seed records are read as if their
  current debt group equals their historical maximum group.
- Add protected `POST /api/v1/internal/borrower-mappings`, including one-to-one
  borrower/CCCD validation, masked CCCD responses, constant-time API-key checking,
  idempotent creation, and replay of pending events.
- Add processing for `LoanDelinquencyChanged.v1`: strict envelope/data validation,
  idempotency by event ID, durable pending events when the mapping is absent, ordered
  replay, append-only profile versions, and the same bad-debt recovery policy as Java.
- Add an optional KafkaJS runtime adapter for local/long-running Node deployments.
  It is disabled unless `CIC_KAFKA_CONSUMER_ENABLED=true`, so the Vercel function does
  not try to maintain a Kafka connection. Invalid messages are sent directly to the
  `.DLT`; transient processing errors receive two retries before DLT.
- Extend the JSON/Blob document with `lienKetNguoiVay`, `suKienDaXuLy`, and
  `suKienQuaHanChoXuLy`. Missing collections and V4 profile fields are normalized in
  memory for backward compatibility; the seed file itself is not bulk-rewritten.

## Compatibility constraints

- The existing score remains a pure function of a stored profile and must not change
  for the 1,000 seed profiles.
- Existing public request bodies remain valid. Manual profile creation maps
  `nhomNoHienTai` from `nhomNoCaoNhat`, matching Java.
- Existing data is append-only and all multi-collection event updates are persisted
  through one serialized storage mutation.
- Raw CCCD is never returned by the internal mapping endpoint or carried in Kafka.
- Money strings are non-negative decimal values and are rounded half-up to integer VND.

## Configuration

- `CIC_INTERNAL_API_KEY` (empty means the internal endpoint is closed)
- `CIC_BAD_DEBT_COOLDOWN_MONTHS` (default `12`)
- `CIC_BAD_DEBT_MANUAL_REVIEW_MONTHS` (default `24`)
- `CIC_KAFKA_CONSUMER_ENABLED` (default `false` in Node)
- `KAFKA_BOOTSTRAP_SERVERS` (default `localhost:9092`)
- `CIC_LOAN_DELINQUENCY_GROUP` (default `cic-loan-delinquency`)
- `LOAN_DELINQUENCY_CHANGED_TOPIC` (default `finora.loan.delinquency-changed`)

## Verification

Node tests cover backward-compatible schema normalization, response field parity,
mapping authorization and uniqueness, pending/replay ordering, duplicate suppression,
bad-debt recovery windows, aggregate preservation, strict message validation, and DLT
routing. The pre-existing 1,000-profile Java score fixture must remain green.
