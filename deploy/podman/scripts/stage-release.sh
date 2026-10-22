#!/bin/sh
#
# Publish a desktop release into the running stack.
#
#   ./stage-release.sh [build-dir] [--forced]
#
#   build-dir   defaults to front_web/build — the directory electron-builder writes into
#   --forced    publish the manifest with is_forced: true (the shell then shows a blocking dialog)
#
# STAGE_ENV_FILE picks which env file receives DESKTOP_RELEASE_* (default `.env.production`).
# Point it at `.env.local` when staging into the local validation stack:
#
#   STAGE_ENV_FILE=$PWD/deploy/podman/.env.local deploy/podman/scripts/stage-release.sh
#
# What it does, in order:
#   1. `verify-desktop-feed` — the yml's `path`/`files[].url` must resolve to a local archive whose
#      sha512 matches the yml, and `version` must match front_web/package.json. Without this gate a
#      bad yml is discovered by every client as a 150 MB download that fails at the end.
#   2. copy the yml + archives into `<appdata>/desktop/releases/` — the only directory the feed
#      routes will serve artifacts from (the whitelist is built from the yml references).
#   3. write DESKTOP_RELEASE_* into `.env.production` so the manifest endpoint describes what was
#      just staged, and restart the api so it reads them.

set -eu
. "$(dirname "$0")/lib.sh"

require_podman

REPO_ROOT=$(CDPATH= cd -- "$COMPOSE_DIR/../.." && pwd)
BUILD_DIR="$REPO_ROOT/front_web/build"
FORCED=false

for arg in "$@"; do
	case $arg in
	--forced) FORCED=true ;;
	*) BUILD_DIR=$arg ;;
	esac
done

[ -d "$BUILD_DIR" ] || die "build directory $BUILD_DIR not found (run 'pnpm dist:mac' in front_web first)"
ENV_FILE="${STAGE_ENV_FILE:-$COMPOSE_DIR/.env.production}"
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing"

# The api restart at the end must use the same compose file set the stack runs with. lib.sh reads
# that back from the running containers; this covers a stack that is down, and keeps the env file
# and the override that references it from drifting apart (see `compose_files` in lib.sh).
case $(basename "$ENV_FILE") in
.env.local) COMPOSE_OVERRIDE=${COMPOSE_OVERRIDE:-compose.local.yaml} ;;
esac

log "verifying release metadata in $BUILD_DIR"
(cd "$REPO_ROOT/front_web" && node scripts/verify-desktop-feed.mjs --dir "$BUILD_DIR")

# Extract the fields the manifest endpoint needs. Keeping the parse in node means this script and
# the shell's parser (electron/main/manifestProvider.ts) only agree on the two line shapes that
# electron-builder actually emits, not on a full YAML grammar.
log "reading release metadata"
META=$(cd "$REPO_ROOT/front_web" && node -e '
const { readFileSync, readdirSync } = require("node:fs");
const { join, basename } = require("node:path");
const dir = process.argv[1];
const yml = readdirSync(dir).find((f) => /^(latest|beta|alpha|next)(-mac|-linux)?\.yml$/.test(f));
if (!yml) { console.error("no feed yml in " + dir); process.exit(1); }
const text = readFileSync(join(dir, yml), "utf8");
const line = (re) => { const m = text.match(re); return m ? m[1].trim().replace(/^["\x27]|["\x27]$/g, "") : ""; };
const version = line(/^version:\s*(.+)$/m);
const path = line(/^\s*path:\s*(.+)$/m) || line(/^\s*-\s*url:\s*(.+)$/m);
const sha512 = line(/^\s*sha512:\s*(.+)$/m);
if (!version || !path || !sha512) {
  console.error("feed yml is missing version/path/sha512");
  process.exit(1);
}
process.stdout.write([version, basename(path), sha512].join("\n"));
' "$BUILD_DIR") || die "could not read $BUILD_DIR"

VERSION=$(printf '%s\n' "$META" | sed -n 1p)
ARTIFACT=$(printf '%s\n' "$META" | sed -n 2p)
SHA512=$(printf '%s\n' "$META" | sed -n 3p)

log "staging $VERSION ($ARTIFACT) into the appdata volume"
APP_VOL=$(volume_of appdata)
podman run --rm --volume "$APP_VOL:/data" --volume "$BUILD_DIR:/src:ro" "$HELPER_IMAGE" \
	sh -c 'mkdir -p /data/desktop/releases && for f in /src/*; do case "$f" in *.yml | *.zip) cp -v "$f" /data/desktop/releases/ ;; esac; done'

log "updating $ENV_FILE"
set_env "$ENV_FILE" DESKTOP_RELEASE_VERSION "$VERSION"
set_env "$ENV_FILE" DESKTOP_RELEASE_PATH "$ARTIFACT"
set_env "$ENV_FILE" DESKTOP_RELEASE_SHA512 "$SHA512"
set_env "$ENV_FILE" DESKTOP_RELEASE_DATE "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
set_env "$ENV_FILE" DESKTOP_RELEASE_FORCED "$FORCED"

log "restarting api to pick up the new manifest"
API=$(container_of api) || die "api container is not running"
if is_compose "$API"; then
	compose up -d --no-deps api
elif is_systemd; then
	systemctl restart harness-api.service
else
	podman restart "$API" >/dev/null
fi

wait_ready 90 || die "api did not become ready after the release was staged"

printf '\nstaged release %s\n' "$VERSION"
printf '  path:      %s\n' "$ARTIFACT"
printf '  forced:    %s\n' "$FORCED"
printf '  feed:      %s/api/desktop/releases/feed/latest-mac.yml\n' "$(grep -m1 '^APP_URL=' "$ENV_FILE" | cut -d= -f2-)"
