# syntax=docker/dockerfile:1
#
# Web image: builds the browser bundle (vite) and serves it with Caddy.
#
# Build context is `front_web/` — it is its own pnpm workspace root, so it installs independently
# of the API image and the root `pnpm-lock.yaml` plays no part here.
#
#   podman build -f front_web/Dockerfile front_web
#
# The Caddyfile is *not* baked in for the compose stack: `deploy/podman/compose.yaml` mounts the
# entrypoint that matches the environment (public TLS vs localhost). The default copied below only
# exists so a bare `podman run` serves the SPA instead of returning 404.

# Global build arg, declared before the first FROM so it is in scope for every `FROM` below.
# `CADDY_IMAGE` exists so a host whose registry mirror cannot serve the official image can point at
# a locally built equivalent (alpine + `apk add caddy`, uid 1000, same /data /config /srv layout,
# same entrypoint) instead of giving up on the smoke test. Production and CI use the default, so
# nothing here depends on the override.
ARG CADDY_IMAGE=caddy:2-alpine

# Registry override, same pair of args as the root Dockerfile: `replace-registry-host` defaults to
# `npmjs` and would otherwise rewrite every URL back to registry.npmjs.org.
ARG PNPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_REPLACE_REGISTRY_HOST=npmjs
# See the root Dockerfile: skips pnpm's per-entry registry metadata re-verification, which needs a
# healthy registry even though the lockfile already pins every integrity hash.
ARG PNPM_TRUST_LOCKFILE=false

# ---------- build ----------
FROM node:24-alpine AS build

# Re-declared inside the stage: an ARG written before the first FROM is only in scope for the FROM
# lines themselves, so without these three the `${...}` expansions below would silently be empty.
ARG PNPM_REGISTRY
ARG PNPM_REPLACE_REGISTRY_HOST
ARG PNPM_TRUST_LOCKFILE

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    PNPM_TRUST_LOCKFILE=${PNPM_TRUST_LOCKFILE} \
    # The web bundle never touches Electron, and its postinstall downloads a ~120 MB binary that
    # would otherwise land in the build cache layer.
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Registry settings go into ~/.npmrc, and each knob is measured and explained in the root Dockerfile.
RUN printf 'registry=%s\nreplace-registry-host=%s\n' "${PNPM_REGISTRY}" "${PNPM_REPLACE_REGISTRY_HOST}" \
      > /root/.npmrc

# pnpm via npm, not `corepack enable`: corepack's on-first-use download of the `packageManager`
# version stalls on some build networks (see the root Dockerfile for the measurement).
COPY package.json /tmp/pnpm-version.json
RUN PNPM_VERSION=$(node -p "require('/tmp/pnpm-version.json').packageManager.slice(5)") \
 && npm i -g "pnpm@${PNPM_VERSION}" \
 && pnpm --version \
 && rm -f /tmp/pnpm-version.json
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/desktop-shared/package.json packages/desktop-shared/
RUN if [ "$PNPM_TRUST_LOCKFILE" = "true" ]; then set -- --config.trustLockfile=true; else set --; fi \
 && pnpm install --frozen-lockfile "$@"

COPY . .
# `pnpm build` = `build:shared` (tsc -b for @harness/desktop-shared) + `vite build`.
# Node derives its default heap from the container memory: on a 3.7 GiB Podman machine V8 caps out
# near 1.8 GiB and the bundle dies at ~70% with "Ineffective mark-compacts near heap limit". Give
# it explicit headroom instead of shrinking the bundle — measured with a 8 GiB machine:
#
#   podman build --env NODE_OPTIONS=--max-old-space-size=4096 \
#     -f front_web/Dockerfile -t localhost/harness-web:latest front_web
RUN pnpm build

# ---------- runtime ----------
FROM ${CADDY_IMAGE}

# Files are owned by the unprivileged `caddy` user and the process runs as that user. The official
# image sets cap_net_bind_service on the binary, so binding :80/:443 still works. /data and /config
# are chowned too: a fresh named volume inherits the ownership of the image directory it covers,
# which is what lets Caddy persist certificates without a host-side chown step.
COPY --from=build /app/dist-web /srv
COPY deploy/Caddyfile.standalone /etc/caddy/Caddyfile
RUN chown -R caddy:caddy /srv /data /config

USER caddy

EXPOSE 80 443
EXPOSE 443/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1/"]

# CMD and ENTRYPOINT come from the base image (`caddy run --config /etc/caddy/Caddyfile`).
