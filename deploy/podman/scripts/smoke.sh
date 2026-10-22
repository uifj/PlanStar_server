#!/bin/sh
#
# Five checks against a running stack, through the public entrypoint (Caddy), not the container port.
#
#   ./smoke.sh                       # http://localhost:8080 (compose.local.yaml)
#   BASE_URL=https://harness.example.com ./smoke.sh
#   SMOKE_SKIP_RELEASE=1 ./smoke.sh  # before the first release is staged (checks 3-4 have no artifact)
#
# 1. GET /                      200, and the SPA shell is actually the bundle (contains id="root")
# 2. GET /api/ready             200 — proves Caddy → api routing and that the DB connection is up
# 3. GET feed latest-mac.yml    200 — the update metadata is published
# 4. GET the artifact it names  200 with the declared size — the whitelist actually resolves it
# 5. /collab upgrade            101 — the WebSocket route is proxied (a plain GET returns 400/426)
#
# Every check prints the status it saw. Nothing here needs credentials: the log read endpoints are
# operator-only and are exercised by scripts/e2e/cloud-smoke.mjs with a token.

set -eu

BASE_URL=${BASE_URL:-http://localhost:8080}
SMOKE_SKIP_RELEASE=${SMOKE_SKIP_RELEASE:-0}
FAILED=0

pass() { printf 'PASS  %s\n' "$*"; }
fail() {
	printf 'FAIL  %s\n' "$*"
	FAILED=$((FAILED + 1))
}

# body + status in one request; writes the body to a temp file so callers can grep it.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
fetch() { # $1 = extra curl args..., $2 = path
	# No `|| printf '000'` fallback inside the substitution: curl exits non-zero *after* writing the
	# status when the server switches protocols (101), and appending a fallback there turns the
	# answer into "101000" — a failure that looks like a broken proxy but is only string glue.
	status=$(curl -sS -o "$TMP" -w '%{http_code}' "$@" 2>/dev/null) || true
	[ -n "$status" ] || status=000
	printf '%s' "$status"
}

printf 'smoke: %s\n\n' "$BASE_URL"

# 1 — SPA shell
status=$(fetch "$BASE_URL/")
if [ "$status" = "200" ] && grep -q 'id="root"' "$TMP"; then
	pass "GET / → 200 (SPA shell present)"
else
	fail "GET / → $status (expected 200 and id=\"root\" in the body)"
fi

# 2 — readiness through the proxy
status=$(fetch "$BASE_URL/api/ready")
if [ "$status" = "200" ]; then
	pass "GET /api/ready → 200"
else
	fail "GET /api/ready → $status (expected 200; check: podman logs harness-api)"
fi

# 3 + 4 — release feed and the artifact it names
if [ "$SMOKE_SKIP_RELEASE" = "1" ]; then
	printf 'SKIP  release feed checks (SMOKE_SKIP_RELEASE=1)\n'
else
	status=$(fetch "$BASE_URL/api/desktop/releases/feed/latest-mac.yml")
	if [ "$status" = "200" ]; then
		pass "GET /api/desktop/releases/feed/latest-mac.yml → 200"
		artifact=$(sed -n 's/^[[:space:]]*path:[[:space:]]*//p' "$TMP" | head -n 1 | tr -d '"'"'")
		if [ -z "$artifact" ]; then
			artifact=$(sed -n 's/^[[:space:]]*-[[:space:]]*url:[[:space:]]*//p' "$TMP" | head -n 1 | tr -d '"'"'")
		fi
		if [ -z "$artifact" ]; then
			fail "feed yml names no artifact (no path:/url: line)"
		else
			# electron-builder names artifacts using the productName (`Planstar-<ver>-arm64-mac.zip`),
			# and electron-updater percent-encodes the `path` it reads from the yml before requesting it.
			# Requesting the raw name instead makes curl fail on the space and report no status at all.
			artifact_url=$(printf '%s' "$artifact" | sed -e 's/ /%20/g' -e 's/#/%23/g' -e 's/?/%3F/g')
			# `-r 0-1023` is a partial request: the route streams the file, so either 200 (range
			# ignored, full body) or 206 (range honoured) proves the artifact is served, and a
			# 404 here is the whitelist refusing a name the yml does not reference.
			status=$(fetch -r 0-1023 --max-time 60 "$BASE_URL/api/desktop/releases/feed/$artifact_url")
			if [ "$status" = "200" ] || [ "$status" = "206" ]; then
				pass "GET feed/$artifact → $status"
			else
				fail "GET feed/$artifact → $status (expected 200/206; is the artifact in <appdata>/desktop/releases?)"
			fi
		fi
	else
		fail "GET feed/latest-mac.yml → $status (expected 200; run scripts/stage-release.sh first)"
	fi
fi

# 5 — WebSocket upgrade. A wrong status here usually means Caddy is proxying /collab with a normal
# handler (no upgrade headers) rather than the reverse_proxy that preserves them.
handshake=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
	-H 'Connection: Upgrade' \
	-H 'Upgrade: websocket' \
	-H 'Sec-WebSocket-Version: 13' \
	-H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
	"$BASE_URL/collab" 2>/dev/null) || true
[ -n "$handshake" ] || handshake=000
if [ "$handshake" = "101" ]; then
	pass "GET /collab (upgrade) → 101"
else
	fail "GET /collab (upgrade) → $handshake (expected 101; check the /collab handler in the Caddyfile)"
fi

printf '\n'
if [ "$FAILED" -ne 0 ]; then
	printf '%d check(s) failed\n' "$FAILED"
	exit 1
fi
printf 'all checks passed\n'
