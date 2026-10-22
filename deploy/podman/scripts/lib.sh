#!/bin/sh
#
# Shared helpers for deploy/podman/scripts/*.sh. Source it, do not execute it:
#
#   . "$(dirname "$0")/lib.sh"
#
# Every script here targets the compose stack (`podman compose -f compose.yaml`) because that is
# the path that runs on a laptop and in CI. On a quadlet host the same images run under systemd, so
# the two container lookups below resolve by compose label first and by quadlet container name
# second — that keeps backup/restore/upgrade usable on both without a second implementation.

set -eu

COMPOSE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PROJECT=harness
# Throwaway image for the host↔volume hops (staging a release, unpacking a backup). Any image with
# a POSIX shell works; the override exists for hosts whose registry mirror cannot serve alpine —
# use an image that is already in the local store (e.g. docker.io/library/node:24-alpine).
HELPER_IMAGE=${HELPER_IMAGE:-docker.io/library/alpine:3.20}

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() {
	printf 'ERROR: %s\n' "$*" >&2
	exit 1
}

# `podman compose` needs a provider. Fail with an actionable message instead of a python traceback.
require_podman() {
	command -v podman >/dev/null 2>&1 || die "podman not found in PATH"
}

# Extra compose file to layer over compose.yaml (`compose.local.yaml` for the localhost validation
# stack). Left empty, the file set is read back from the running stack — see `compose` below.
COMPOSE_OVERRIDE=${COMPOSE_OVERRIDE:-}

# Print the `-f <file>` flags for the stack the scripts should operate on, one word per line.
#
# Getting this wrong is silent and fatal: recreating api from compose.yaml alone drops the
# compose.local.yaml override, so it comes up with `.env.production` and the secrets mount instead
# of `.env.local`, and entrypoint.sh exits with
#   entrypoint: DATABASE_URL is unset and POSTGRES_PASSWORD(_FILE) was not provided
# Compose records the file set it was started with on every container, so the running stack is the
# authority. Where containers disagree (an earlier run recreated one of them from a subset) the
# longest list wins, because a subset is exactly the drift we are avoiding.
compose_files() {
	if [ -n "$COMPOSE_OVERRIDE" ]; then
		printf -- '-f\n%s\n-f\n%s\n' "$COMPOSE_DIR/compose.yaml" "$COMPOSE_DIR/$COMPOSE_OVERRIDE"
		return 0
	fi
	best=""
	best_n=0
	for id in $(podman ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null); do
		files=$(podman inspect \
			--format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' \
			"$id" 2>/dev/null || true)
		[ -n "${files:-}" ] || continue
		n=$(printf '%s' "$files" | tr ',' '\n' | wc -l | tr -d ' ')
		if [ "$n" -gt "$best_n" ]; then
			best=$files
			best_n=$n
		fi
	done
	if [ -n "$best" ]; then
		printf '%s\n' "$best" | tr ',' '\n' | while IFS= read -r f; do printf -- '-f\n%s\n' "$f"; done
		return 0
	fi
	printf -- '-f\n%s\n' "$COMPOSE_DIR/compose.yaml"
}

compose() {
	# Split on newlines only, and without globbing, so a compose path containing spaces survives.
	_saved_ifs=$IFS
	IFS='
'
	set -f
	# shellcheck disable=SC2046  # the word splitting is the point
	set -- $(compose_files) "$@"
	set +f
	IFS=$_saved_ifs
	podman compose "$@"
}

# Resolve a running container id for a compose service, falling back to the quadlet container name.
# Prints nothing (and fails) when the stack is not up.
container_of() {
	service=$1
	id=$(podman ps -q \
		--filter "label=com.docker.compose.project=$PROJECT" \
		--filter "label=com.docker.compose.service=$service" 2>/dev/null | head -n 1 || true)
	if [ -z "${id:-}" ]; then
		id=$(podman ps -q --filter "name=^${PROJECT}-${service}\$" 2>/dev/null | head -n 1 || true)
	fi
	[ -n "${id:-}" ] || return 1
	printf '%s' "$id"
}

# True when the container was created by `podman compose` (and not by quadlet/systemd).
is_compose() {
	podman inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$1" 2>/dev/null |
		grep -qx "$PROJECT"
}

# True when the stack runs as quadlet units.
is_systemd() {
	systemctl is-enabled --quiet harness-api.service 2>/dev/null
}

# Resolve a data volume by its compose label, falling back to quadlet's `<name>-<volume>` scheme.
volume_of() {
	name=$1
	vol=$(podman volume ls \
		--filter "label=com.docker.compose.project=$PROJECT" \
		--filter "label=com.docker.compose.volume=$name" \
		--format '{{.Name}}' 2>/dev/null | head -n 1 || true)
	if [ -z "${vol:-}" ]; then
		vol="${PROJECT}-${name}"
	fi
	podman volume exists "$vol" 2>/dev/null || die "volume $vol not found (is the stack up?)"
	printf '%s' "$vol"
}

# Poll /api/ready from *inside* the api container: the port is not published, by design.
# `node -e fetch` because the runtime image has no curl.
wait_ready() {
	timeout=${1:-90}
	elapsed=0
	while [ "$elapsed" -lt "$timeout" ]; do
		id=$(container_of api) || {
			sleep 2
			elapsed=$((elapsed + 2))
			continue
		}
		if podman exec "$id" node -e \
			"fetch('http://127.0.0.1:8000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
			>/dev/null 2>&1; then
			return 0
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done
	return 1
}

# Set KEY=value in an env file without rewriting unrelated lines. Used by stage-release.sh so the
# release metadata and the container environment cannot drift apart.
set_env() {
	file=$1
	key=$2
	value=$3
	[ -f "$file" ] || die "env file $file not found"
	if grep -q "^${key}=" "$file"; then
		awk -v k="$key" -v v="$value" '
			BEGIN { FS = "=" }
			$1 == k { print k "=" v; next }
			{ print }
		' "$file" >"$file.tmp"
	else
		cp "$file" "$file.tmp"
		printf '%s=%s\n' "$key" "$value" >>"$file.tmp"
	fi
	mv "$file.tmp" "$file"
}

# Timestamped directory name shared by backup.sh.
stamp() { date -u +%Y%m%dT%H%M%SZ; }
