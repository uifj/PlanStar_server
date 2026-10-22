# 0027 — Desktop log uplink: anonymous write, token-gated read, 14-day retention

- **Status**: Accepted
- **Date**: 2026-01
- **Context**: P3 of the production-readiness plan ("日志/崩溃/反馈默认开启并可服务端检索 + 14 天留存")

## Context

The desktop shell writes NDJSON logs locally. Nothing ever left the machine, so a user reporting
"it crashed / it did not update / it shows 401" gave us no evidence — the operator could only ask
for a manual export. At the same time the release package shipped with every optional feature
switched **off** (see P4), so even the local path was not exercised.

Three constraints shaped the design:

1. **The shell cannot keep a secret.** Anything embedded in a packaged Electron app is extractable
   (`asar` is not encryption, and an attacker has the binary). A static upload token therefore buys
   zero security and costs a rotation procedure.
2. **The crash path must not depend on the database.** A batch that arrives after the API lost
   Postgres must still be accepted — losing the report is worse than a missing foreign key.
3. **Log volume is unbounded by nature.** A renderer loop writing 5 lines per frame produces
   hundreds of MB per hour. Anything that accepts writes without a ceiling is a disk-fill attack
   with no attacker.

## Decision

### Write path: anonymous, bounded by shape and quota

`POST /api/desktop/logs?deviceId=<8-64 chars of [A-Za-z0-9_-]>&appVersion=&platform=` accepts an
NDJSON body, optionally gzip-encoded (detected by magic bytes, not `Content-Encoding` — a proxy
that strips the header must not turn a working upload into a 400).

- The device id doubles as the directory name, so its alphabet excludes `/` and `.` — traversal is
  a schema error, not a runtime check.
- Each request is capped at **4 MiB decompressed**, enforced by `gunzipSync(buf, { maxOutputLength })`
  so a compression bomb becomes a 400 instead of an OOM.
- Each device has a **50 MiB/day** budget (`DESKTOP_LOG_DAILY_QUOTA_BYTES`); exceeding it returns
  **429 with `Retry-After: 60`**, which the client honours by increasing its backoff.
- Anonymous writes are rate-limited only by those two numbers plus the disk watermark — accepted,
  because the alternative (a secret in the client) does not exist.

### Storage: files, not tables

`<DESKTOP_LOG_ROOT>/<deviceId>/<YYYY-MM-DD>.ndjson`, default
`<DESKTOP_DATA_ROOT>/logs`. Reasons:

- crash reports must land even while Postgres is failing;
- log rows would dominate the business database within a week and every backup;
- the read side is grep-shaped, not query-shaped.

Writes for one file are serialised through a per-key promise chain (`Map<string, Promise<void>>`),
so two batches that arrive together cannot interleave partial lines. The day comes from **each
record's own `time`**, so a spool replayed after midnight still lands on the day it happened.

### Read path: operator token, closed by default

`GET /api/desktop/logs` and `GET /api/desktop/logs/devices` require
`Authorization: Bearer ${DESKTOP_LOG_READ_TOKEN}`. When the token is unset the endpoints answer
**404** — "not enabled" — rather than 401, so a deployment that never configured the feature does
not advertise a surface. Comparison uses `timingSafeEqual(sha256(a), sha256(b))` to keep it
length-independent.

### Retention: 14 days, swept twice a day

`startLogRetention()` runs once at boot and then every 6 h, deleting day-files older than
`DESKTOP_LOG_RETENTION_DAYS` (default 14) and pruning empty device directories. The timer is
`unref()`ed so it never holds the process open, and it is stopped before the HTTP server closes.

## Consequences

**Good**

- A user's "it broke" report now has server-side evidence with no user action beyond the default-on
  flag.
- Failure of Postgres does not lose crash reports.
- Disk usage is bounded by `devices × 50 MiB × 14` plus the sweep, and backups exclude
  `desktop/logs` entirely (see `deploy/podman/scripts/backup.sh`).
- Nothing secret ships in the app.

**Bad / accepted**

- Anonymous write means a hostile actor can burn ~50 MiB per fake device id. The mitigation is
  operational: the disk watermark alarm in the runbook, and `DESKTOP_LOG_DAILY_QUOTA_BYTES` can be
  lowered without a code change.
- Files on local disk pin the deployment to **one API instance**. Horizontal scaling is an
  explicit non-goal of this plan; a multi-replica future needs object storage, which is a rewrite
  of this module's service layer, not a config change.
- `GET /logs` is a substring filter over the serialized record, not a query language. Good enough
  for "find the 12 lines around the crash"; not a log analytics product.
- No per-device deletion endpoint: retention is time-based only. Deleting a device means removing
  its directory on the host, which is documented in the runbook.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| Static upload token baked into the app | Extractable in minutes; adds rotation and a 401 path that cannot be recovered by the user. |
| Logs as a Prisma table | Couples the crash path to the database and pollutes every backup with the highest-volume table. |
| Ship logs with `crashReporter` (Electron's upload) | Only covers crashes; the interesting failures (401, update, collab) are not crashes. |
| Unbounded write + "monitor disk" | A renderer loop fills the volume long before a human reads the alert. |
| Read surface open on the same anonymous path | `GET /logs` returns every device's logs; it is operator data, not user data. |
| Per-user auth on the write path | A crashing app has no session; requiring one loses exactly the reports we need. |
