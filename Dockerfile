# syntax=docker/dockerfile:1
#
# One build file, not two: Podman accepts `-f Dockerfile` natively, so a `Containerfile`
# twin would only create a second source of truth that drifts.
# Production orchestration lives in `deploy/podman/`; see `docs/deploy/README.md`.
#
# Stages:
#   base       toolchain + pnpm
#   deps       full dependency tree (build-time)
#   builder    prisma generate + tsc  → also the `migrate` target (`pnpm db:deploy`)
#   prod-deps  runtime dependency tree only
#   runner     tini + entrypoint + dist (no pnpm, no devDeps)

# ---------- base ----------
FROM node:24-alpine AS base
# Registry knobs. The defaults are a plain public-registry build. All three exist because on the
# network this image was first built behind, registry.npmjs.org degraded to ~25 s per metadata
# request with `GET ... error (23)` retries that never converge, while a mirror answered in ~1 s:
#   --build-arg PNPM_REGISTRY=https://registry.npmmirror.com \
#   --build-arg PNPM_REPLACE_REGISTRY_HOST=never \
#   --build-arg PNPM_TRUST_LOCKFILE=true
# PNPM_REPLACE_REGISTRY_HOST is needed alongside the mirror because pnpm's `replace-registry-host`
# defaults to `npmjs`, which rewrites every metadata and tarball URL back to registry.npmjs.org no
# matter what `registry` says. PNPM_TRUST_LOCKFILE skips pnpm's per-entry "supply-chain policy
# check": one live metadata request per lockfile entry (1016 here), which aborted the build after
# 10m29s with `ERR_PNPM_BROKEN_METADATA_JSON ... aborted due to timeout`. Its cache is keyed by the
# lockfile's absolute path, so a warm host cache never carries into /app.
# None of this weakens what gets installed: the lockfile pins versions *and* integrity hashes, so a
# mirror only changes where the bytes come from, not which bytes are accepted.
ARG PNPM_TRUST_LOCKFILE=false
ARG PNPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_REPLACE_REGISTRY_HOST=npmjs
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    PNPM_TRUST_LOCKFILE=${PNPM_TRUST_LOCKFILE}

# Registry settings land in ~/.npmrc rather than in `npm_config_*` env vars: measured, pnpm ignores
# `npm_config_replace_registry_host` and keeps pulling tarballs from registry.npmjs.org. npm reads
# the same file for `registry` and merely warns about the key it does not know.
RUN printf 'registry=%s\nreplace-registry-host=%s\n' "${PNPM_REGISTRY}" "${PNPM_REPLACE_REGISTRY_HOST}" \
      > /root/.npmrc

# pnpm is installed with npm rather than activated through `corepack enable`: corepack resolves the
# version from `packageManager` on first use and that fetch stalls indefinitely on at least one
# Podman-VM network we build behind (no progress after 20 minutes), while `npm i -g pnpm@<same
# version>` from the same registry takes 5 s and fails loudly when it cannot. The version still has
# exactly one source of truth: `packageManager` in package.json.
COPY package.json /tmp/pnpm-version.json
RUN PNPM_VERSION=$(node -p "require('/tmp/pnpm-version.json').packageManager.slice(5)") \
 && npm i -g "pnpm@${PNPM_VERSION}" \
 && pnpm --version \
 && rm -f /tmp/pnpm-version.json
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN if [ "$PNPM_TRUST_LOCKFILE" = "true" ]; then set -- --config.trustLockfile=true; else set --; fi \
 && pnpm install --frozen-lockfile "$@"

# ---------- builder ----------
FROM deps AS builder
COPY prisma ./prisma
# `prisma generate` reads tsconfig.json to decide the import specifiers it writes into the generated
# client: with the file present it emits `./enums.js`, without it `./enums.ts` (both measured in one
# container from this image). tsc copies the specifier verbatim, so generating before tsconfig.json
# exists yields a dist/ that dies at boot with
#   ERR_MODULE_NOT_FOUND: Cannot find module '/app/dist/generated/prisma/enums.ts'
COPY tsconfig.json ./
# Generated sources are produced here, not copied in: `.dockerignore` excludes
# `src/generated`, so `COPY . .` below cannot overwrite them with stale local output.
RUN pnpm db:generate
COPY . .
RUN pnpm build

# ---------- prod-deps ----------
FROM base AS prod-deps
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# `--ignore-scripts` keeps postinstall scripts out of the runtime layer; prisma's client is
# already compiled into `dist` by the builder.
RUN if [ "$PNPM_TRUST_LOCKFILE" = "true" ]; then set -- --config.trustLockfile=true; else set --; fi \
 && pnpm install --prod --frozen-lockfile --ignore-scripts "$@"

# ---------- runner ----------
FROM node:24-alpine AS runner

# tini reaps zombies and turns SIGTERM into a signal the node process actually sees, which is
# what makes the 5 s graceful shutdown (SSE/WS close) work instead of being SIGKILLed.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src/generated ./src/generated
COPY package.json ./
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# `/data` is the single persistent mount (postgres data lives in its own volume). The app writes
# uploads, exports, desktop intake and the log tree below it — see `.env.production.example`.
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data

USER node

EXPOSE 8000
VOLUME ["/data"]

# `node -e` instead of wget/curl: the runtime image has no HTTP client, and adding one for a
# healthcheck is a dependency the container does not otherwise need.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
# Direct `node`, not `pnpm start`: the runtime layer has no corepack/pnpm and must not try to
# reach the network on boot.
CMD ["node", "dist/index.js"]
