# Production deployment runbook

Everything below is meant to be **copied and run in order** on a fresh host. Each step states what
you should see; if the output differs, the step failed — fix it before continuing.

Single-instance, single-host, Podman (or Docker ≥ 24 with compose v2). The whole stack is:

```
            :80 / :443
                │
            ┌───▼────┐
            │  web   │  Caddy: TLS, /srv SPA, /api/* and /collab proxies
            └───┬────┘
        ┌───────┴────────┐
        │                │
   /api/*            /collab*        (both → the same container)
        │                │
        └───────┬────────┘
            ┌───▼────┐
            │  api   │  Hono + Hocuspocus + log uplink + release feed
            └───┬────┘
            ┌───▼────┐
            │postgres│  internal network only, never published
            └────────┘
```

`migrate` is a one-shot container that must exit 0 before `api` starts. `/data` is the only
writable volume on the API host; it holds files, uploads, exports, desktop intake and the log tree.

---

## 0. Prerequisites

| Requirement | Check | Expected |
|---|---|---|
| Podman ≥ 4.9 (or Docker ≥ 24 + compose v2) | `podman --version` | `podman version 5.x` |
| A compose provider for `podman compose` | `podman compose version` | `Docker Compose version v2.x`/`v5.x` |
| `openssl` | `openssl version` | any |
| `curl` | `curl --version` | any |
| Ports 80/443 free, DNS pointing at the host | `dig +short harness.example.com` | the host's public IP |

`podman compose` delegates to an external provider. If `podman compose version` fails, install
`docker-compose` (the binary is enough, no Docker daemon) or use the quadlet path in §10, which
needs no provider at all.

---

## 1. Get the code and the build inputs

```bash
git clone <repo> harness && cd harness
```

Verify the toolchain before touching the deployment (this is the P0 baseline, and it is what
`ci.yml` runs):

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test:unit
```

Expected: `biome` reports **0 errors and 0 warnings** (`biome.json` turns `noExplicitAny` off for
`tests/**` only — the integration tests assert on untyped JSON bodies — and keeps every other rule
on everywhere, including `src/`), `tsc` prints nothing, and vitest ends with
`Test Files  … passed` / `Tests  … passed`.

Recorded baseline (measured on this repo, 2026-10-21/22). A run below these numbers means a test
disappeared, which is a failure even when the suite is green:

| Gate | Command | Recorded |
|---|---|---|
| Root lint | `pnpm lint` | 0 errors, 0 warnings |
| Root types | `pnpm typecheck` | clean |
| Root unit | `pnpm test:unit` | `Test Files 35 passed`, `Tests 203 passed` |
| Front-end types | `cd front_web && pnpm typecheck` | clean |
| Front-end lint | `pnpm lint:gate` | 0 errors |
| Front-end unit | `pnpm test` | `Test Files 101 passed`, `Tests 1577 passed` |
| Bridge parity | `pnpm check:desktop-parity` | `✓ desktop mock parity OK (16 methods)` |
| IPC ownership | `pnpm check:desktop-contract` | `✓ desktop IPC contract OK (7 invoke, 3 send, 8 push)` |
| Feed verifier | `pnpm check:desktop-feed-contract` | 5/5 checks pass |

Integration tests need a database; they are not part of the deployment gate but they are part of
"did I break the API":

```bash
cp .env.test.example .env.test    # if absent, point DATABASE_URL at a scratch database
pnpm test:integration
```

The database has to be reachable from the host on the port in `.env.test`. The compose stack does
not publish Postgres on purpose — the API reaches it over the internal network, and a published
5432 would be an unauthenticated door on every interface — so use a scratch container:

```bash
podman run -d --name vanlife-pg-test \
  -e POSTGRES_USER=vanlife -e POSTGRES_PASSWORD=vanlife -e POSTGRES_DB=vanlife_test \
  -p 127.0.0.1:5432:5432 docker.io/library/postgres:16-alpine
pnpm exec dotenv -e .env.test -- pnpm exec prisma migrate deploy   # → All migrations have been successfully applied.
pnpm test:integration
podman rm -f vanlife-pg-test
```

Expected — measured on 2026-10-21 with the stack of §16 running:

```
 Test Files  143 passed | 1 skipped (144)
      Tests  722 passed | 5 skipped (727)
   Duration  130.25s          # 130–150 s across runs; only the counts are a gate
```

The five skips are conditional suites, not lost coverage: `openapi.test.ts` is
`describe.skipIf(!isDevelopment)` (4 tests — the route is dev-only and `NODE_ENV=test` here), and
`perf-object-filters.test.ts` is gated on `PERF_GATE=1` (1 test).

---

## 2. Generate the secrets

Three files, never in git (`deploy/podman/secrets/*` is gitignored):

```bash
cd deploy/podman

printf '%s' "$(openssl rand -base64 48)" > secrets/better_auth_secret
printf '%s' "$(openssl rand -base64 24 | tr -d '/+=')" > secrets/postgres_password
printf '%s' "$(openssl rand -base64 32 | tr -d '/+=')" > secrets/desktop_log_read_token
chmod 0600 secrets/*

ls -l secrets/
```

Expected:

```
-rw-------  … better_auth_secret
-rw-------  … desktop_log_read_token
-rw-------  … postgres_password
```

Optional, only if the deployment runs agent turns:

```bash
printf '%s' 'AIza…' > secrets/gemini_api_key    # chmod 0600 as well
```

`printf '%s'`, not `echo`: a trailing newline inside a password is an auth failure with no
diagnostic. The postgres password is kept alphanumeric because `entrypoint.sh` concatenates it into
a URL without escaping.

---

## 3. Write `.env.production`

```bash
cp .env.production.example .env.production
$EDITOR .env.production
```

Change at minimum:

| Key | Value |
|---|---|
| `APP_URL` | `https://harness.example.com` — **must be https**, this is what turns the session cookie into `SameSite=None; Secure` |
| `CLIENT_URL` | same origin as `APP_URL` |
| `HARNESS_DOMAIN` | `harness.example.com` — Caddy requests the certificate for this name |
| `HARNESS_TLS_EMAIL` | a real address; Let's Encrypt uses it for expiry notices |

Leave `DESKTOP_ORIGIN=http://localhost:8321` as it is. It is the Electron shell's renderer origin
and must stay a fixed **http** loopback URL: the shell serves its renderer over http precisely so
the cookie is not `Secure`-only on a machine without TLS.

Do **not** set `DATABASE_URL`. `entrypoint.sh` assembles it from `POSTGRES_*` plus the password
secret, so the password never appears in a world-readable env file.

Confirm the file parses:

```bash
set -a; . ./.env.production; set +a
echo "$APP_URL / $HARNESS_DOMAIN"
```

Expected: `https://harness.example.com / harness.example.com`

---

## 4. Validate the compose file before building anything

```bash
podman compose -f compose.yaml config >/dev/null && echo "compose config OK"
```

Expected: `compose config OK`. A YAML typo, a missing `env_file` or an undefined `${...}` variable
all fail here, in under a second — not after a 10-minute build.

---

## 5. Build the images

```bash
cd ../..                     # repo root
podman build -f Dockerfile --target runner       -t localhost/harness-api:latest .
podman build -f Dockerfile --target builder      -t localhost/harness-api:latest-migrate .
# The web bundle needs more heap than a small VM derives by default (see the note below).
podman build --env NODE_OPTIONS=--max-old-space-size=4096 \
  -f front_web/Dockerfile -t localhost/harness-web:latest front_web
```

Expected: three `COMMIT` lines, no `error TS`. The API build runs `prisma generate` and `tsc`;
`--target runner` deliberately ships no pnpm and no devDependencies. Measured on the reference
machine: api 1.63 GB, migrate 2.23 GB, web ≈ 90 MB.

> **Builder memory.** `vite build` died inside the image with `Ineffective mark-compacts near heap
> limit` on a 3.7 GiB Podman machine — V8 caps the heap near 1.8 GiB at that size, and the host
> build passes because the host is bigger. Either raise the VM (`podman machine set --memory 8192`,
> needs the machine stopped) or build the web image on the host/CI and `podman save`/`load` it. Both
> fixes are in [troubleshooting.md](troubleshooting.md#14-the-front-end-image-build-dies-with-javascript-heap-out-of-memory).
> Do not lower the heap to make it fit — V8 will thrash instead of failing fast.

> **Degraded registry.** The commands above assume registry.npmjs.org answers. When it does not —
> measured on the reference machine: ~25 s per metadata request, `GET ... error (23)` retries that
> never converge, pnpm's supply-chain policy check aborting after 10m29s, `@prisma/engines`
> postinstall stalled 32 minutes at 0 CPU — the same three builds finish in about four minutes with
> `--build-arg PNPM_REGISTRY=https://registry.npmmirror.com`,
> `--build-arg PNPM_REPLACE_REGISTRY_HOST=never`, `--build-arg PNPM_TRUST_LOCKFILE=true` and
> `--env PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma`, plus
> `--volume "$HOME/Library/pnpm/store/v11:/pnpm/store/v11"` to reuse the workstation's package store
> (`reused 909, downloaded 0`). What each knob costs and why none of them change *what* gets
> installed: [troubleshooting.md](troubleshooting.md#12-podman-build-cannot-pull-a-base-image).

---

## 6. First start

```bash
cd deploy/podman
podman compose up -d
podman compose ps
```

Expected: four services, `postgres`, `migrate`, `api`, `web`; `migrate` shows `exited (0)`, `api`
and `web` eventually report `healthy`:

```
NAME              STATUS
harness-api-1     Up (healthy)
harness-migrate-1 Exited (0)
harness-postgres-1 Up (healthy)
harness-web-1     Up
```

The first start does the schema migration. Watch it happen once so a later failure is recognisable:

```bash
podman compose logs migrate
```

Expected: `No pending migrations to apply.` or a list of applied migrations, then exit 0. If it
prints `P3009` (failed migration), stop and read
[troubleshooting.md](troubleshooting.md#7-migrations-fail-or-hang) before doing anything else.

---

## 7. Health, TLS and the SPA

```bash
curl -fsS https://harness.example.com/api/ready && echo
```

Expected: a 200 with a small JSON body. If TLS is not up yet, `caddy` is still solving the ACME
challenge — `podman compose logs web | grep -i acme` shows the progress. DNS must already point at
this host; Caddy cannot complete the challenge otherwise.

```bash
deploy/podman/scripts/smoke.sh 2>/dev/null || BASE_URL=https://harness.example.com \
  deploy/podman/scripts/smoke.sh
```

Expected (release checks fail until §9 publishes something — that is correct):

```
PASS  GET / → 200 (SPA shell present)
PASS  GET /api/ready → 200
FAIL  GET /api/desktop/releases/feed/latest-mac.yml → 404 (expected 200; run scripts/stage-release.sh first)
FAIL  GET /collab (upgrade) → …
```

Re-run after §9; all five must pass.

---

## 8. Create the first administrator

The first account is created through the normal sign-up endpoint, then promoted. Run this **once**,
from the host:

```bash
curl -fsS -X POST https://harness.example.com/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://harness.example.com' \
  -d '{"email":"ops@example.com","password":"<a long password>","name":"Ops"}'
```

Then promote it (roles are a comma-separated column, `admin` is what the admin plugin checks):

```bash
PG=$(podman ps -q --filter name=harness-postgres | head -1)
podman exec -i "$PG" psql -U harness -d harness -c \
  "update \"user\" set role = 'admin' where email = 'ops@example.com';"
```

Expected: `UPDATE 1`.

Sign in at `https://harness.example.com` as that account. If the browser is redirected back to the
sign-in screen, that is the cookie problem in
[troubleshooting.md](troubleshooting.md#1-login-returns-401) — do not continue until it works,
because the desktop clients depend on the same attribute.

---

## 9. Publish a desktop release (rehearsal)

Do this before the first real user, so the feed, the whitelist and the updater are proven together.

```bash
# 1. build the artifacts (macOS host, ~10 min)
cd front_web && pnpm dist:mac

# 2. verify the metadata against the archive BEFORE publishing it
pnpm verify:desktop-feed
```

Expected: `✓ desktop feed OK …` (0 mismatches). This checks three things that electron-updater
trusts blindly: every `path`/`files[].url` resolves next to the yml, the yml's `sha512` equals the
archive's base64 SHA-512, and `version` equals `front_web/package.json`.

```bash
# 3. stage it into the running stack (also re-runs the check as a gate)
cd ../..
deploy/podman/scripts/stage-release.sh
```

Expected: the script prints the version, the artifact name and the feed URL, then
`staged release <version>`.

```bash
# 4. prove the whole download path
deploy/podman/scripts/smoke.sh
node scripts/e2e/cloud-smoke.mjs
```

Expected: `all checks passed` from smoke, and cloud-smoke ends with
`0 failed` and writes `deploy/podman/e2e-artifacts/cloud-smoke-<stamp>.json`.

The feed route only serves artifacts **named by a `*.yml` in the releases directory**
(`src/modules/desktop/feed.ts`). An unreferenced file is a 404 even if it sits in the directory —
that is deliberate; see the rejected alternatives in the plan.

---

## 10. Quadlet (Linux production)

Compose is fine on a laptop; on a Linux server use the quadlet units so the stack survives reboots
without a compose provider in the boot path.

```bash
# secrets (values, not files, this time — quadlet delivers them as env vars)
cd deploy/podman
podman secret create postgres_password      secrets/postgres_password
podman secret create better_auth_secret     secrets/better_auth_secret
podman secret create desktop_log_read_token secrets/desktop_log_read_token
podman secret ls
```

Expected: three secrets listed. `podman secret create` accepts a file path directly.

```bash
sudo install -d /etc/harness
sudo install -m 0600 .env.production /etc/harness/harness.env
sudo install -m 0644 Caddyfile       /etc/harness/Caddyfile
sudo install -m 0644 quadlet/*.network quadlet/*.container /etc/containers/systemd/
sudo install -m 0644 quadlet/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start harness-migrate.service harness-api.service harness-web.service
systemctl status harness-api.service --no-pager
```

Expected: `harness-migrate` `active (exited)`, `harness-api` and `harness-web` `active (running)`
with a health check passing. `harness-api.service` **requires** `harness-migrate.service`, so a
failed migration keeps the API down instead of serving a mismatched schema.

Images must exist under the same names the units reference:
`localhost/harness-api:latest`, `localhost/harness-api:latest-migrate`, `localhost/harness-web:latest`.

The operational scripts work on both paths — they resolve the container by compose label first and
by the quadlet container name second, and use `systemctl` when the unit exists.

---

## 11. Backups

```bash
deploy/podman/scripts/backup.sh            # writes deploy/podman/backups/harness-<UTC stamp>/
```

Expected: `db.dump`, `appdata.tar.gz`, `meta.txt`, then `backup complete: …`.

Measured on the validation stack with a 0.57.4 release staged into `/data/desktop/releases`:

```
==> dumping database
==> archiving /data (excluding desktop/logs)
==> recording image versions

backup complete: /Users/uifj/Workspace/ActiveProjects/agent_harness_server/deploy/podman/backups/harness-20261021T164512Z
144M    /Users/uifj/Workspace/ActiveProjects/agent_harness_server/deploy/podman/backups/harness-20261021T164512Z
```

- `db.dump` is `pg_dump --format=custom` (restorable with `pg_restore`, unlike plain SQL).
- `appdata.tar.gz` is `/data` **minus `desktop/logs`** — log intake is high-volume, short-lived and
  excluded so it cannot dominate the archive.
- `BACKUP_KEEP` (default 7) prunes the oldest directories this script created.

Copy the directory off the host. A backup on the same disk is not a backup. `podman volume export`
works too, but loses the `desktop/logs` exclusion.

Restore:

```bash
deploy/podman/scripts/restore.sh deploy/podman/backups/harness-20260101T000000Z
```

It stops the API (`pg_restore --clean` fails while a client holds objects), restores the database,
unpacks the volume, starts the API and polls `/api/ready`. It refuses to run without typing
`restore` unless you pass `--yes`.

Measured against the backup above, on the same stack:

```
$ deploy/podman/scripts/restore.sh deploy/podman/backups/harness-20261021T164512Z --yes
...
restore complete; /api/ready is healthy
```

After the restore `smoke.sh` still reports all five checks passing, including the artifact download —
that is what proves the release files came back with the volume, not just the database.

`backup.sh` and `restore.sh` both tar the volume through a throwaway `alpine:3.20`. On a host that
cannot reach Docker Hub, pass an image that is already in the store:
`HELPER_IMAGE=docker.io/library/node:24-alpine deploy/podman/scripts/backup.sh`.

---

## 12. Upgrade and roll back

```bash
git pull
deploy/podman/scripts/upgrade.sh
```

The script does five things and stops on the first failure:

1. `backup.sh` — a rolled-back *migration* cannot be undone by a rolled-back image.
2. pins the image **the running container was created from** as `:rollback` — not whatever the tag
   points at, because under `UPGRADE_SKIP_BUILD=1` the tag already holds the new build.
3. `podman compose build` (or `UPGRADE_PULL=1` + `compose pull` for prebuilt images).
4. `podman compose up -d --force-recreate migrate api web` — re-runs `migrate`, whose exit status
   gates api. `--force-recreate` is required: retagging an image does not change a service's compose
   config, so a plain `up -d` only *restarts* the container on the image id it was created from.
5. polls `/api/ready` inside the container; on failure — and on a step 4 that fails on its own —
   restores the `:rollback` tags and rolls back the same way.

Migrations are written forward-compatible on purpose: rolling back the image does **not** revert a
schema change. The only true rollback is restoring the backup taken in step 1.

Two environment knobs, both only needed where a registry cannot be reached:

```bash
# step 1 runs a throwaway alpine:3.20 to tar the data volume; name an image already in the store
HELPER_IMAGE=docker.io/library/node:24-alpine deploy/podman/scripts/upgrade.sh

# `podman compose build` goes through the compose provider, so it cannot carry the §5 build args.
# Build with `podman build`, then roll the images already in the local store:
UPGRADE_SKIP_BUILD=1 deploy/podman/scripts/upgrade.sh
```

Measured — without `HELPER_IMAGE` the run stops at `1/5 backup` with
`pinging container registry registry-1.docker.io ... i/o timeout`; with it, five steps, exit 0. The
block is excerpted — between `4/5` and `5/5` the compose lines are the usual
`Container … Running/Recreate/Started/Waiting/Healthy`:

```
==> 2/5 pinning rollback tags
    localhost/harness-api:latest (4e992708c127) -> localhost/harness-api:latest-rollback
    localhost/harness-api:latest-migrate -> localhost/harness-api:latest-migrate-rollback
    localhost/harness-web:latest (de6359daffd5) -> localhost/harness-web:latest-rollback
==> 3/5 using the images already in the local store (UPGRADE_SKIP_BUILD=1)
==> 4/5 running migrations and rolling containers
 Container harness-api-1 Healthy 
==> 5/5 health gate

upgrade complete; /api/ready is healthy
```

The container is then on the new image (`4400c6bc1749`, `org.opencontainers.image.revision`
`upgrade-success-20261021T1712Z`) and `/api/ready` answers 200.

The failure path is measured too, with `localhost/harness-api:latest` pointed at an image that
cannot boot — step 4 fails on `web`'s `depends_on: api: service_healthy`, the tags are restored and
the stack comes back on the pinned image (again excerpted; the omitted compose lines are
`Container harness-api-1 Error dependency api failed to start` and
`dependency failed to start: container harness-api-1 exited (0)`):

```
WARNING: compose up -d failed — rolling the images back
    localhost/harness-api:latest-rollback -> localhost/harness-api:latest
    localhost/harness-api:latest-migrate-rollback -> localhost/harness-api:latest-migrate
    localhost/harness-web:latest-rollback -> localhost/harness-web:latest
 Container harness-api-1 Healthy 
ERROR: upgrade failed and the previous images were restored; the stack is healthy again, investigate the logs above
```

Exit code 1, `/api/ready` 200, container back on the pinned image id. See §12 of troubleshooting
for the same `HELPER_IMAGE` knob in `backup`/`restore`/`stage-release`.

---

## 13. Reading uploaded desktop logs

The write side is anonymous (a crashing app has no session); the read side needs the operator token:

```bash
TOKEN=$(cat deploy/podman/secrets/desktop_log_read_token)
BASE=https://harness.example.com

curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/desktop/logs/devices" | head -c 400
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/desktop/logs?deviceId=<id>&limit=200" | head -c 400
curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/api/desktop/logs?deviceId=<id>&q=error" | head -c 400
```

Expected: a device inventory, then NDJSON-shaped records newest-last, then only records matching the
substring. Retention is `DESKTOP_LOG_RETENTION_DAYS` (default 14), swept at boot and every 6 h;
backups exclude this tree.

If these endpoints answer **404**, `DESKTOP_LOG_READ_TOKEN` is unset — that is the "feature closed"
answer, not a bug (see [ADR-0027](../adr/0027-desktop-log-uplink.md)).

---

## 14. Go-live checklist

Tick every line on the actual host, in order. A line that cannot be ticked is a blocker, not a
note for later.

| # | Check | Command / evidence |
|---|---|---|
| 1 | DNS resolves to this host | `dig +short $HARNESS_DOMAIN` |
| 2 | Certificate is valid and auto-renewing | `curl -vI https://$HARNESS_DOMAIN 2>&1 \| grep -E 'subject|expire'` |
| 3 | HSTS, `nosniff`, `Referrer-Policy` present | `curl -sI https://$HARNESS_DOMAIN \| grep -i -E 'strict-transport\|x-content-type\|referrer'` |
| 4 | Enforcing CSP present (`object-src 'none'`) | `curl -sI https://$HARNESS_DOMAIN \| grep -i content-security-policy` |
| 5 | `/api/ready` 200 | `curl -fsS https://$HARNESS_DOMAIN/api/ready` |
| 6 | Web sign-in works in a browser | manual: sign in, reload, still signed in |
| 7 | Session cookie is `SameSite=None; Secure` | DevTools → Application → Cookies |
| 8 | Desktop sign-in works from `http://localhost:8321` | run the packaged app, sign in |
| 9 | `smoke.sh` five checks pass | `deploy/podman/scripts/smoke.sh` |
| 10 | `cloud-smoke.mjs` all groups pass | `node scripts/e2e/cloud-smoke.mjs` |
| 11 | Feed yml is served and referenced artifact downloads | `smoke.sh` checks 3–4 |
| 12 | An unreferenced feed name 404s | `curl -o /dev/null -w '%{http_code}' $BASE/api/desktop/releases/feed/nope.zip` → `404` |
| 13 | Manifest carries the expected `version` | `curl -fsS $BASE/api/desktop/releases/manifest` |
| 14 | `is_forced` matches policy | same; flip `DESKTOP_RELEASE_FORCED` and restart api to verify the modal |
| 15 | Withdrawing the force flag closes the modal | stage-release without `--forced`, app modal closes without reload |
| 16 | Log upload arrives | upload once, then `GET /api/desktop/logs/devices` lists the device |
| 17 | Log read without token is closed | `curl -o /dev/null -w '%{http_code}' $BASE/api/desktop/logs?deviceId=x` → `401` (token set) / `404` (token unset) |
| 18 | Retention sweep is scheduled | `podman logs harness-api \| grep -i retention` at boot |
| 19 | `/collab` upgrade returns 101 | `smoke.sh` check 5 |
| 20 | SIGTERM stops the API in ≤ 5 s with exit 0 | `podman stop harness-api-1` then `podman inspect -f '{{.State.ExitCode}}'` → `0` |
| 21 | Backup runs and is off-host | `backup.sh`, then confirm the copy exists elsewhere |
| 22 | Restore is rehearsed once | `restore.sh <latest>` on a scratch host |
| 23 | Disk watermark known | `df -h /var/lib/containers` → alert at 80 % |
| 24 | Log rotation bounded | `podman inspect … \| grep -i max-size` → `10m`, `5` files |
| 25 | Admin account exists and can sign in | §8 |
| 26 | `docs/deploy/troubleshooting.md` printed/copied somewhere reachable | — |

---

## 15. Known limits at go-live

- **Unsigned macOS build.** `quit-and-install` fails on an unsigned `.app`; verification stops at
  `update-downloaded`. Shipping a self-updating app requires a Developer ID certificate and
  notarization — an external prerequisite, not a code change. Do not present updates as "working
  end to end" until that exists.
- **Single instance.** Logs, uploads, exports and releases are files under `/data`. Two API
  containers sharing a volume is not supported (nor tested); a second replica needs object storage.
- **`desktop/logs` is not backed up.** By design; see §11.
- **Podman machine builders are small.** Build the web image on the host or in CI.
- **Windows and Linux desktop packages are out of scope.** Only macOS arm64 is built.

---

## 16. Local validation stack (localhost, no domain, no TLS)

Everything above assumes a domain and a certificate. This path runs the **same images, the same
compose graph and the same routes** on a laptop, and it is what produced the measured output quoted
in this runbook. Use it to rehearse an upgrade, to reproduce a troubleshooting entry, or to prove a
change before it goes anywhere near production.

```bash
cd deploy/podman
cp .env.local.example .env.local        # fixed, non-secret values; nothing to edit
podman compose -f compose.yaml -f compose.local.yaml up -d --no-build
podman ps -a --filter name=harness --format '{{.Names}}\t{{.Status}}'
```

Expected — measured, with the images built in §5:

```
harness-postgres-1      Up 23 minutes (healthy)
harness-migrate-1       Exited (0) 3 minutes ago
harness-api-1           Up 37 seconds (healthy)
harness-web-1           Up 2 minutes
```

`compose.local.yaml` publishes Caddy on **8080** (host port 80 stays free), mounts `Caddyfile.local`
(http, no HSTS — a cached HSTS header for localhost outlives the stack) and reads `.env.local`
instead of the secrets mount.

Then publish a release into it and run both suites:

```bash
STAGE_ENV_FILE=$PWD/.env.local sh scripts/stage-release.sh
sh scripts/smoke.sh
cd ../.. && node scripts/e2e/cloud-smoke.mjs
```

Expected — measured on a fresh volume (every line below is literal output, including the two extra
`==>` steps that the script prints between the verification and the staging summary):

```
==> verifying release metadata in /Users/uifj/Workspace/ActiveProjects/agent_harness_server/front_web/build
✓ desktop feed OK (1 metadata file(s), 1 artifact check(s), version 0.57.4)
==> reading release metadata
==> staging 0.57.4 (Planstar-0.57.4-arm64-mac.zip) into the appdata volume
==> updating /Users/uifj/Workspace/ActiveProjects/agent_harness_server/deploy/podman/.env.local
==> restarting api to pick up the new manifest
staged release 0.57.4
  path:      Planstar-0.57.4-arm64-mac.zip
  forced:    false
  feed:      http://localhost:8080/api/desktop/releases/feed/latest-mac.yml

smoke: http://localhost:8080
PASS  GET / → 200 (SPA shell present)
PASS  GET /api/ready → 200
PASS  GET /api/desktop/releases/feed/latest-mac.yml → 200
PASS  GET feed/Planstar-0.57.4-arm64-mac.zip → 200
PASS  GET /collab (upgrade) → 101
all checks passed

cloud-smoke: http://localhost:8080            (five of the 32 lines shown)
PASS  [auth] cookie SameSite=Lax — Lax
PASS  [logs] daily quota → 429 — after 16 batches, Retry-After=60
PASS  [feed] sha512 matches the yml — 6NBz312ke13ij0iA
PASS  [shutdown] SIGTERM exits within the grace window — 0.3 s
PASS  [shutdown] exit code 0 (no forced kill) — ExitCode=0
all result(s): 32 passed, 0 failed
evidence: deploy/podman/e2e-artifacts/cloud-smoke-2026-10-21T17-12-57-152Z.json
```

`cloud-smoke.mjs` drives the containerised stack through Caddy the way a browser and the desktop shell
do: SPA shell and enforcing CSP, sign-up plus the session cookie attributes (`SameSite=Lax`,
`Secure=false` on this http origin — `None; Secure` requires the https `APP_URL` of §3), log uplink →
operator query → 429 quota, feed yml → artifact → sha512 → unreferenced name 404 → traversal 404, the
release manifest, and a real `SIGTERM` to the api container. That last group stops the api;
`restart: unless-stopped` brings it back, which is worth watching once.

Two overrides were needed on the reference machine and are **not** part of the canonical path:
`HELPER_IMAGE=docker.io/library/node:24-alpine` for `stage-release.sh`, because the alpine helper
image could not be pulled (§12), and the registry build args in §5.

Tear it down, volumes included:

```bash
cd deploy/podman
podman compose -f compose.yaml -f compose.local.yaml down -v
```
