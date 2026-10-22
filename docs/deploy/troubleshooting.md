# Troubleshooting

Eleven failure modes, each with the **symptom** you actually see, the **discriminator** that tells
you which cause it is, and the **fix**. Start from the symptom; do not restart anything before the
discriminator has narrowed it down, or you lose the evidence.

Quick orientation:

| Symptom | Section |
|---|---|
| Browser or desktop app bounces back to sign-in; API answers 401 | [1](#1-login-returns-401) |
| Updater reports 400 while downloading | [2](#2-update-download-returns-400) |
| Update downloads, then never installs | [3](#3-update-downloaded-but-nothing-installs) |
| Collaborative editing never connects | [4](#4-collab-101-then-403-or-a-silent-nothing) |
| `podman compose ps` shows `unhealthy` | [5](#5-a-container-is-unhealthy) |
| Writes fail with `ENOSPC`, or the API dies under load | [6](#6-disk-fills-up) |
| `migrate` exits non-zero or hangs | [7](#7-migrations-fail-or-hang) |
| `podman stop` takes the full 30 s | [8](#8-stop-hangs-for-the-whole-grace-period) |
| `podman compose` itself errors out | [9](#9-podman-compose-has-no-provider) |
| No certificate, or a TLS handshake error | [10](#10-certificate-never-issues) |
| `permission denied` writing under `/data` | [11](#11-data-is-not-writable-by-node) |

---

## 1. Login returns 401

**Symptom.** Sign-in "works" (200 from `/api/auth/sign-in/email`) but the next request is 401, or
the SPA redirects straight back to the sign-in screen. The desktop app behaves the same at
`http://localhost:8321`.

The browser decides whether to attach the cookie; the server only decides what it asks for. Work
out which half is failing before changing anything.

**Discriminator — is the cookie present in the request?**

```
DevTools → Network → any /api request → Request Headers → Cookie:
DevTools → Application → Cookies → <api origin>
```

| Observation | Cause | Fix |
|---|---|---|
| No `Set-Cookie` on the sign-in response | `APP_URL` is not the origin you are browsing | set `APP_URL`/`CLIENT_URL` to the public origin, restart `api` |
| Cookie exists in Application but not attached | `SameSite=Lax` on a cross-site request | `APP_URL` must be `https://…` — `src/lib/cookie-attributes.ts` only emits `SameSite=None; Secure` for https |
| Cookie exists, attached, still 401 | `BETTER_AUTH_SECRET` changed between boots | sessions are signed with it; restarting with a new secret invalidates every session. Set it once, from a secret file |
| Desktop only, browser fine | the renderer origin is not in `trustedOrigins` | `DESKTOP_ORIGIN` must be exactly `http://localhost:8321` (fixed port — an ephemeral port is an unexplained 401 by design) |
| 401 with `Origin` absent | a proxy stripped the header | check `Caddyfile`: the `/api/*` handler must not rewrite headers |

**Verify what the server emits, independent of the browser:**

```bash
curl -sS -D- -o /dev/null -X POST https://$DOMAIN/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H "Origin: https://$DOMAIN" \
  -d '{"email":"ops@example.com","password":"…"}' | grep -i set-cookie
```

Expected on https: `SameSite=None; Secure`. If you see `SameSite=Lax`, `APP_URL` is not the https
origin the request arrived on.

**Third-party cookie blocking.** If the header is right and the browser still drops the cookie, a
tracking-protection setting is blocking third-party cookies (the desktop renderer at
`localhost:8321` talking to `api.example.com` is exactly that case). Check for the blocked-cookie
icon in the URL bar. The documented fallback is the loopback reverse proxy described in
[ADR-0026](../adr/0026-cloud-cookie-policy.md); it is **not** enabled by default because it proxies
SSE and WebSocket through the Electron main process.

---

## 2. Update download returns 400

**Symptom.** The updater finds a new version, starts downloading, and fails immediately with a 400.

**Cause.** `electron-updater` resolves the artifact as `new URL(fileInfo.url, feedUrl)`. If the yml's
`path` is a bare filename, the request is `/api/desktop/releases/feed/<name>.zip`. That route only
serves a file whose name appears in a `*.yml` inside the releases directory — a 404 for a name it
does not know, and a 400 only if the request is malformed at the schema level.

**Discriminator:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN/api/desktop/releases/feed/latest-mac.yml
curl -sS https://$DOMAIN/api/desktop/releases/feed/latest-mac.yml | head -5
```

| Observation | Cause | Fix |
|---|---|---|
| yml 404 | nothing staged | `deploy/podman/scripts/stage-release.sh` |
| yml 200, artifact 404 | the archive is not in `<appdata>/desktop/releases`, or the yml names a different file | re-run `stage-release.sh`; it copies the yml **and** the archives together |
| artifact 404, file is there | the yml in the releases directory does not reference it | the whitelist is built from the yml; publish the matching yml |
| everything 200, client still fails | sha512 mismatch | `cd front_web && pnpm verify:desktop-feed` — it re-hashes the archive and compares base64 |

```bash
podman exec harness-api-1 ls -l /data/desktop/releases
```

The directory must contain the yml and the archive it names. Staging copies both; a manual `cp` of
only the zip is the usual mistake.

---

## 3. `update-downloaded` but nothing installs

**Symptom.** The app reports "update ready", the user clicks install (or the app quits) and the
version never changes. Nothing in the server logs.

**Cause.** This is not a server problem. macOS refuses to install an **unsigned** `.app`; Squirrel
also refuses to swap an app whose code signature does not match the update.

**Discriminator:**

```bash
codesign -dv "front_web/build/mac-arm64/Anytype Harness.app" 2>&1 | head -5
spctl -a -vvv "front_web/build/mac-arm64/Anytype Harness.app" 2>&1
```

`code object is not signed at all` / `rejected` confirms it.

**Fix.** There is none in this repository. Production self-update needs:
`Developer ID Application` certificate → `codesign --deep --options runtime` → `notarytool submit`
→ staple. Until that exists, the verification ceiling is `update-downloaded`, and
`scripts/e2e/desktop-packaged.mjs` says so in its output. Do not tell users updates work end to end.

---

## 4. `/collab` 101, then 403 or a silent nothing

**Symptom.** The WebSocket upgrade is accepted (101) but the connection closes immediately, or the
editor shows "connecting…" forever.

**Discriminator — is it the proxy or the server?**

```bash
# through Caddy
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 5 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://$DOMAIN/collab

# straight to the API, bypassing Caddy (from the host, or `podman exec`)
podman exec harness-api-1 node -e \
  "fetch('http://127.0.0.1:8000/api/ready').then(r=>console.log(r.status))"
```

| Observation | Cause | Fix |
|---|---|---|
| `200`/`400`, not `101` | Caddy is not proxying the upgrade | the `/collab*` handler must be a plain `reverse_proxy` — no `flush_interval -1` change needed, but *any* middleware that buffers breaks it |
| 101 then immediate close | session cookie not sent on the upgrade | the socket is same-origin with the API precisely so the cookie rides along; if you proxied `/collab` to a different origin, the cookie is cross-site and needs §1 |
| 101 then close, cookie fine | document id not authorised | API log shows the refusal; that is application logic, not the proxy |
| works locally, fails behind a load balancer | the LB has an HTTP idle timeout | raise it above the collab heartbeat, or terminate TLS on Caddy only |

---

## 5. A container is unhealthy

**Symptom.** `podman compose ps` shows `(unhealthy)` or a restart loop.

Work from the outside in:

```bash
podman compose ps
podman compose logs --tail 50 api
podman exec harness-api-1 node -e "fetch('http://127.0.0.1:8000/api/ready').then(r=>console.log(r.status)).catch(e=>console.error(e.message))"
```

| Observation | Cause | Fix |
|---|---|---|
| `api` restarts every few seconds | env validation failed at boot | logs show `❌ Invalid environment variables` followed by the offending key — fix `.env.production`, not the image |
| `api` healthy, `web` unhealthy | web's healthcheck hits `/` on :80; Caddy is not listening | `podman compose logs web`; usually a Caddyfile syntax error, which Caddy prints with a line number |
| `api` unhealthy but `/api/ready` 200 from inside | the healthcheck binary is missing | the image uses `node -e fetch`, not `wget`; if you replaced the healthcheck, put node back |
| `postgres` unhealthy | data directory from an older major version | the volume was created by a different `postgres` tag; restore a dump into a fresh volume rather than starting the old one |
| `migrate` exited non-zero | see §7 | — |

Never "fix" a healthcheck by removing it. It is the only thing that stops a broken container from
receiving traffic.

---

## 6. Disk fills up

**Symptom.** Writes fail with `ENOSPC`; the API starts returning 500; `podman` refuses to pull.

```bash
df -h /var/lib/containers ~/.local/share/containers 2>/dev/null
podman system df
du -sh $(podman volume inspect harness_appdata -f '{{.Mountpoint}}')/desktop/logs
```

| Culprit | Bound | Action |
|---|---|---|
| `desktop/logs` | 50 MiB/device/day × 14 days | lower `DESKTOP_LOG_DAILY_QUOTA_BYTES`; delete a device directory; it is already excluded from backups |
| `files` / `uploads` | user data | this is the data; move `/data` to a bigger volume |
| container images | one per build | `podman image prune -f --filter until=168h` |
| json-file logs | `max-size=10m`, `max-file=5` per container | already bounded; if not, the service was started outside compose |
| `podman system df` shows reclaimable | stopped containers, dangling images | `podman system prune -f` (does **not** touch volumes) |

The retention sweep runs at boot and every 6 h. If `desktop/logs` keeps growing across 14 days,
the sweep is not running: `podman logs harness-api-1 | grep -i retention`.

---

## 7. Migrations fail or hang

**Symptom.** `migrate` exits non-zero, or the stack sits at `migrate` forever and `api` never starts.

```bash
podman compose logs migrate
```

| Output | Cause | Fix |
|---|---|---|
| `P3009` — failed migrations found | a previous migration failed mid-way | read the migration; either finish it manually and `prisma migrate resolve --applied <name>`, or restore the backup |
| `P1001` — cannot reach database | `migrate` is not on the same network, or postgres is not up | `migrate` must `depends_on postgres: service_healthy`; do not remove that |
| `P1010` / `password authentication failed` | the password secret is not what the volume was initialised with | `POSTGRES_PASSWORD` only takes effect on **first** start of a volume; restore or reset the password inside postgres |
| hangs with no output | DNS/network | `podman exec harness-migrate-1 getent hosts postgres` (or run a throwaway container on the same network) |
| `exec format error` | image built for the wrong architecture | build on the target architecture; `--platform` mismatches are silent until run time |

Migrations are forward-only. There is no `migrate down`; the rollback procedure is
`scripts/restore.sh`. Write migrations so the previous app version still works against the new
schema (add nullable column → deploy → backfill → drop) if you need a rollback window.

---

## 8. Stop hangs for the whole grace period

**Symptom.** `podman stop` / `systemctl stop harness-api` takes 30 s and ends with `SIGKILL`.

**Cause.** A live SSE stream or a collab WebSocket keeps the listener alive; `server.close()` waits
for them forever. The process is supposed to close them itself:

```
flushPendingStores() → closeConnections() → stopLogRetention() → server.close()
  → after 5 s: server.closeAllConnections() → prisma.$disconnect()
```

**Discriminator:**

```bash
podman logs --tail 20 harness-api-1   # look for the ordered shutdown lines
```

| Observation | Cause | Fix |
|---|---|---|
| shutdown lines present, still slow | `closeConnections()` did not close the sockets (hocuspocus connection tracking) | check the hocuspocus major version; `closeConnections()` exists from 4.x |
| shutdown lines absent | the container is not running `node dist/index.js` directly — `tini` is not forwarding | the image's `ENTRYPOINT` must be `tini -- entrypoint.sh`; if you overrode it, SIGTERM goes to the shell |
| hangs at `prisma.$disconnect()` | a long transaction | not fatal; it will be killed at the grace timeout |
| only after adding a new stream endpoint | the new endpoint never ends | register it with the force-close path |

`stop_grace_period` is 30 s and `StopTimeout=30`; the internal budget is 5 s, so anything near 30 s
means the ordered shutdown did not run at all.

---

## 9. `podman compose` has no provider

**Symptom.** `podman compose up` prints a Python traceback, or `Error: no compose providers found`.

**Discriminator:**

```bash
podman compose version
```

Expected: `Docker Compose version v2.x` (or `podman-compose version …`). If it fails, podman has no
provider on `PATH`.

**Fix (pick one):**

```bash
# 1. the docker-compose binary alone is enough — no Docker daemon needed
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 2. or use podman-compose
pip install podman-compose

# 3. or skip compose entirely on a Linux server
sudo install -m 0644 deploy/podman/quadlet/*.{network,container} /etc/containers/systemd/
sudo install -m 0644 deploy/podman/quadlet/*.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Option 3 is the recommended production path; compose exists so the same images can be validated on
a laptop.

---

## 10. Certificate never issues

**Symptom.** Caddy logs `obtaining certificate` repeatedly, `curl` fails the handshake, or browsers
show `ERR_CERT_*`.

```bash
podman compose logs web | grep -i -E 'acme|tls|certificate'
```

| Log line | Cause | Fix |
|---|---|---|
| `no such host` / `NXDOMAIN` | DNS not pointing at this host | fix DNS first; ACME cannot work around it |
| `connection refused` on port 80 | port 80 is not reachable from the internet | the HTTP-01 challenge needs it; open it, or switch to DNS-01 |
| `too many certificates already issued` | rate limit from repeated redeploys | wait out the limit (7 days) or use the staging CA while testing |
| `timeout during connect` | a firewall or NAT forwards 443 but not 80 | forward both, or use TLS-ALPN on 443 |
| works, then breaks after a restart | the `caddydata` volume was deleted | certificates and the account key live there; never `podman volume rm` it |

The ACME email comes from `HARNESS_TLS_EMAIL`; Caddy reads it from the container environment
(`{$HARNESS_TLS_EMAIL}`), not from compose interpolation.

---

## 11. `/data` is not writable by `node`

**Symptom.** Boot succeeds, then `EACCES: permission denied, mkdir '/data/files'`, or an upload
fails with a 500 while logs show `EACCES`.

The API container runs as `node` (uid 1000) with a **read-only root filesystem**; `/data` is the
only writable mount. `entrypoint.sh` creates the write roots at boot, which works when the volume is
writable by uid 1000.

**Discriminator:**

```bash
VOL=$(podman volume inspect harness_appdata -f '{{.Mountpoint}}')
ls -ld "$VOL" "$VOL/desktop"
podman exec harness-api-1 id
```

| Observation | Cause | Fix |
|---|---|---|
| volume owned by `root:root` with mode `0755` | someone pre-created it with `mkdir`, or restored with `sudo tar` | `podman unshare chown -R 1000:1000 "$VOL"` (never `sudo chown`, it maps to a different uid inside the container) |
| owned by `1000:1000`, still denied | SELinux | the compose volumes carry `:Z`; if you added one without it, add it |
| `desktop` owned by root after a restore | `restore.sh` extracts as root inside a helper container | the entrypoint only creates missing dirs; re-run `podman unshare chown -R 1000:1000 "$VOL/desktop"` |
| `read_only: true` + a new write root | a new path outside `/data` | move it under `/data`, or add it to `entrypoint.sh` |

Do not solve this by running the API as root. The read-only root filesystem and `cap_drop: ALL` are
load-bearing; a `chown` on the volume is the whole fix.

---

## 12. `podman build` cannot pull a base image

**Symptom.** Every pull fails the same way, whatever the tag:

```
Error: unable to copy from source docker://alpine:3.20: copying system image from manifest list:
parsing image configuration: Get "https://image-mirror.r2.daocloud.vip/...": EOF
```

**Discriminator.** Try an image that has nothing to do with this project:

```bash
podman pull alpine:3.20
```

If that also ends in `EOF`, the registry mirror is down or dropping large blobs. The repo is not
involved. Podman Desktop injects the mirror through
`/etc/containers/registries.conf.d/999-podman-desktop-registries-from-host.conf` →
`~/.config/containers/registries.conf`; editing `/etc/containers/registries.conf` inside the machine
does not disable it, because the drop-in wins.

**Fix.** In order of effort:

| Option | How |
|---|---|
| wait it out / retry | mirrors recover; `podman pull` is idempotent |
| use another network | the whole failure is external |
| build the web image anyway | the API images need only `node:24-alpine` (usually already cached); the web runtime stage needs Caddy, so give it a local equivalent — see the `CADDY_IMAGE` arg |

```bash
# A stand-in for caddy:2-alpine with the same layout and entrypoint, built from the cached node image.
# `setcap` is load-bearing, not decoration: the official image ships it, the apk package does not,
# and without it Caddy cannot bind :80 as the unprivileged `caddy` user (see §16).
printf '%s\n' 'FROM node:24-alpine' \
  'RUN apk add --no-cache caddy libcap-utils \' \
  ' && setcap cap_net_bind_service=+ep /usr/sbin/caddy \' \
  ' && getcap /usr/sbin/caddy \' \
  ' && mkdir -p /data /config /srv && chown -R caddy:caddy /data /config /srv' \
  'WORKDIR /srv' 'ENTRYPOINT ["caddy"]' \
  'CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]' > /tmp/Dockerfile.caddy
podman build -t localhost/caddy:2-alpine -f /tmp/Dockerfile.caddy /tmp

podman build --env NODE_OPTIONS=--max-old-space-size=4096 \
  --build-arg CADDY_IMAGE=localhost/caddy:2-alpine \
  -f front_web/Dockerfile -t localhost/harness-web:latest front_web
```

Production and CI never pass `CADDY_IMAGE`; they get the official image. Anything the smoke test
proves with the stand-in still holds — the Caddyfile, the routing and the SPA are unchanged — but
the image is not the one you ship, so rebuild without the override before go-live.

**The same network usually degrades the npm registry too.** Measured on the reference machine while
the image mirror was down: registry.npmjs.org answered a metadata request in ~25 s (a mirror answered
the same request in ~1.3 s), tarball fetches looped on `GET ... error (23)`, pnpm's supply-chain
policy check aborted the build after 10m29s, and `@prisma/engines`' postinstall sat for 32 minutes at
0 CPU. The build args exist for exactly this:

```bash
podman build \
  --build-arg PNPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg PNPM_REPLACE_REGISTRY_HOST=never \
  --build-arg PNPM_TRUST_LOCKFILE=true \
  --env PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma \
  --volume "$HOME/Library/pnpm/store/v11:/pnpm/store/v11" \
  -f Dockerfile --target runner -t localhost/harness-api:latest .
```

| Knob | What it fixes | Measured |
|---|---|---|
| `PNPM_REGISTRY` | where tarballs come from | 916 packages, 0 downloaded (all store hits) |
| `PNPM_REPLACE_REGISTRY_HOST=never` | pnpm rewrites every URL back to `registry.npmjs.org` unless told not to; setting `npm_config_registry` alone changes nothing | tarballs still fetched from npmjs.org with the env var only |
| `PNPM_TRUST_LOCKFILE=true` | skips the per-entry "supply-chain policy check" — one live metadata request per lockfile entry (1016 here), cached per absolute lockfile path so a host cache never carries into `/app` | `✗ Lockfile failed supply-chain policy check (1016 entries in 10m 29.7s)` → install completes in <90 s |
| `PRISMA_ENGINES_MIRROR` | `@prisma/engines` postinstall fetches from binaries.prisma.sh | 32 min at 0 CPU → seconds |
| `--volume <host pnpm store>:/pnpm/store/v11` | reuse the workstation's content-addressable store | `reused 909, downloaded 0` |

None of these change *what* is installed: the lockfile pins versions and integrity hashes, so a mirror
only changes where the bytes come from. Production and CI use the defaults.

---

## 13. The api container exits with `ERR_MODULE_NOT_FOUND`

**Symptom.** `harness-api-1` restarts in a loop and the log ends with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'dotenv' imported from /app/dist/config/env.js
```

The package installs fine on a workstation, so the usual first reaction is "the image is broken".
It is not: the image installs `--prod`, and this import is a **runtime** import of a package that
is listed under `devDependencies`. `src/config/env.ts` does `import "dotenv/config"` at module load.

**Fix.**

```bash
# 1. it is a runtime dependency — move it, do not remove the import
node -e 'const f="package.json",p=require("./"+f);const v=p.devDependencies.dotenv;delete p.devDependencies.dotenv;p.dependencies.dotenv=v;require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")'
pnpm install --lockfile-only          # keeps --frozen-lockfile working inside the image

# 2. rebuild both api images and recreate
podman build -f Dockerfile --target runner  -t localhost/harness-api:latest .
podman build -f Dockerfile --target builder -t localhost/harness-api:latest-migrate .
podman compose up -d --no-build api
```

**Find every instance at once** — any `src/**/*.ts` that imports a package from `devDependencies`
will fail the same way:

```bash
node -e 'const fs=require("fs"),path=require("path"),p=require("./package.json");const dev=new Set(Object.keys(p.devDependencies));const hits=new Set();const walk=(d)=>{for(const f of fs.readdirSync(d)){const q=path.join(d,f);if(fs.statSync(q).isDirectory())walk(q);else if(/\.ts$/.test(f)){for(const m of fs.readFileSync(q,"utf8").matchAll(/from\s+["\x27]([^".\x27]+)["\x27]/g)){const n=m[1].startsWith("@")?m[1].split("/").slice(0,2).join("/"):m[1].split("/")[0];if(dev.has(n))hits.add(n+" <- "+q)}}}};walk("src");console.log([...hits].join("\n")||"none")'
```

`pino-pretty` is the one deliberate exception: it is referenced as a transport *target string* and
only when `NODE_ENV === "development"`, so a production image never resolves it.

---

## 14. The front-end image build dies with "JavaScript heap out of memory"

**Symptom.** `vite build` inside the image stops around 70% and the log ends with:

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

V8 sizes its heap from the container's memory limit. On a 3.7 GiB Podman machine the cap lands near
1.8 GiB, which this bundle exceeds; the host build passes because the host has more RAM, which makes
it look like a container-only bug.

**Fix.** Give it headroom instead of shrinking the bundle:

```bash
podman machine set --memory 8192 && podman machine stop && podman machine start   # needs the VM stopped
podman build --env NODE_OPTIONS=--max-old-space-size=4096 \
  -f front_web/Dockerfile -t localhost/harness-web:latest front_web
```

The CI `container-build` job runs on a 16 GiB runner and does not need either step.

---

## 15. The api exits with `Cannot find module '/app/dist/generated/prisma/enums.ts'`

**Symptom.** Boot fails immediately and the missing path ends in `.ts`:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/dist/generated/prisma/enums.ts'
imported from /app/dist/generated/prisma/client.js
```

`tsc` never emits `.ts` into `dist`, so that specifier cannot resolve. It is not a TypeScript
configuration problem: `prisma generate` picks the import extension it writes into the generated
client from the **tsconfig.json it can see at generation time**. Measured inside one container built
from the migrate image:

```bash
podman run --rm localhost/harness-api:latest-migrate sh -c '
  for CASE in notsconfig withtsconfig; do
    mkdir -p /tmp/$CASE && cd /tmp/$CASE
    cp -r /app/prisma . && cp /app/package.json . && ln -sfn /app/node_modules node_modules
    [ "$CASE" = withtsconfig ] && cp /app/tsconfig.json .
    npx prisma generate --schema prisma/schema.prisma >/dev/null 2>&1
    printf "%s: " "$CASE"; grep -m1 -o "from \"./enums[^\"]*\"" src/generated/prisma/client.ts
  done'
```

```
notsconfig:   from "./enums.ts"
withtsconfig: from "./enums.js"
```

**Fix.** `Dockerfile` copies `tsconfig.json` in the builder stage *before* `pnpm db:generate`, not
only later with the rest of the tree. Keep that order if you touch the stage. A workstation never
shows this bug — the file is always there — so the only place it can surface is a build that
regenerates the client, which is exactly what the image does.

---

## 16. The web container exits with `listen tcp :80: bind: permission denied`

**Symptom.** `harness-web-1` restarts in a loop and the last line is

```
Error: loading initial config: loading new config: http app module: start:
listening on :80: listen tcp :80: bind: permission denied
```

Caddy runs as the unprivileged `caddy` user (`front_web/Dockerfile`), so binding 80/443 needs
`cap_net_bind_service` **on the binary**. The official `caddy:2-alpine` ships it; the alpine `caddy`
apk package used by the §12 stand-in does not.

**Discriminator.**

```bash
podman run --rm --entrypoint sh localhost/harness-web:latest -c 'getcap $(command -v caddy)'
```

No output means the capability is missing. Adding `--cap-add NET_BIND_SERVICE` to the same run makes
the bind succeed (measured both ways: `permission denied` without, clean start with).

**Fix.** Put `setcap cap_net_bind_service=+ep` in the stand-in image (§12). Do not solve it by
granting the capability in compose or by running Caddy as root: production runs the official image,
which already carries the file capability, and a compose-level grant would hide the difference
between the two images instead of removing it.

---

## 17. A deploy script restarts the api and it dies with `DATABASE_URL is unset`

**Symptom.** `stage-release.sh`, `upgrade.sh` or `restore.sh` recreates the api and the new container
logs

```
entrypoint: DATABASE_URL is unset and POSTGRES_PASSWORD(_FILE) was not provided
```

although the stack was healthy a minute earlier.

**Cause.** The script recreated it from `compose.yaml` alone. On the localhost validation stack the
api gets its database settings from `compose.local.yaml` + `.env.local`; without that override it
falls back to `.env.production` and the secrets mount, which the local stack deliberately does not
populate.

**Discriminator.** Compose records the file set on every container:

```bash
podman inspect harness-api-1 harness-web-1 \
  --format '{{.Name}} {{index .Config.Labels "com.docker.compose.project.config_files"}}'
```

Two different answers means the containers were created from different configurations.

**Fix.** `scripts/lib.sh` reads that label back and reuses the longest file set it finds, so a script
operates on the stack as it is actually running; `stage-release.sh` additionally infers
`compose.local.yaml` from `STAGE_ENV_FILE=.../.env.local`. Pin it explicitly with
`COMPOSE_OVERRIDE=compose.local.yaml` when the stack is down. Recreate the drifted container once
with the full set:

```bash
podman compose -f compose.yaml -f compose.local.yaml up -d --no-build
```
