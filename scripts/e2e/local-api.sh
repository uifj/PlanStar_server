#!/bin/sh
# Local stand-in for the API half of `scripts/e2e/desktop-packaged.mjs`.
#
#   sh scripts/e2e/local-api.sh forced       # start with DESKTOP_RELEASE_FORCED=true
#   sh scripts/e2e/local-api.sh retracted    # restart with the flag flipped to false
#   sh scripts/e2e/local-api.sh stop
#
# The packaged-app harness needs a release feed whose version is *newer* than the app and, for the
# forced-update leg, a manifest that says `is_forced: true`. In a real deployment the retraction is
# "edit `.env.production`, restart the api container" (`deploy/podman/scripts/upgrade.sh` does the
# restart); this script does the same thing against a plain `tsx` process so the harness can run
# without Podman. `deploy/podman/scripts/smoke.sh` + `scripts/e2e/cloud-smoke.mjs` cover the
# containerised stack instead.
set -eu

REPO=$(cd "$(dirname "$0")/../.." && pwd)
PORT=${E2E_API_PORT:-8090}
DATA_ROOT=${E2E_API_DATA_ROOT:-/tmp/harness-desktop}
RELEASE_VERSION=${E2E_RELEASE_VERSION:-0.58.0}
MODE=${1:-forced}

stop() {
	pid=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
	if [ -n "$pid" ]; then
		kill $pid 2>/dev/null || true
		sleep 1
	fi
}

start() {
	forced=$1
	stop
	mkdir -p "$DATA_ROOT/logs" "$DATA_ROOT/releases"
	cd "$REPO"
	PORT=$PORT \
		HOST=127.0.0.1 \
		APP_URL="http://localhost:$PORT" \
		CLIENT_URL="http://localhost:$PORT" \
		DESKTOP_DATA_ROOT="$DATA_ROOT" \
		DESKTOP_LOG_ROOT="$DATA_ROOT/logs" \
		DESKTOP_LOG_READ_TOKEN=local-desktop-log-read-token \
		DESKTOP_RELEASE_DIR="$DATA_ROOT/releases" \
		DESKTOP_RELEASE_VERSION="$RELEASE_VERSION" \
		DESKTOP_RELEASE_FORCED="$forced" \
		nohup npx tsx src/index.ts </dev/null >"$DATA_ROOT/api.log" 2>&1 &
	i=0
	while [ "$i" -lt 60 ]; do
		if curl -sf "http://localhost:$PORT/api/ready" >/dev/null 2>&1; then
			exit 0
		fi
		i=$((i + 1))
		sleep 1
	done
	echo "api did not become ready on port $PORT (see $DATA_ROOT/api.log)" >&2
	exit 1
}

case "$MODE" in
forced) start true ;;
retracted) start false ;;
stop) stop ;;
*)
	echo "usage: $0 [forced|retracted|stop]" >&2
	exit 2
	;;
esac
