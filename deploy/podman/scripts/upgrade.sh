#!/bin/sh
#
# Upgrade the stack in place, with a health gate and automatic image rollback.
#
#   ./upgrade.sh                 # build from the working tree, then roll
#   UPGRADE_PULL=1 ./upgrade.sh  # pull prebuilt images instead of building
#   UPGRADE_SKIP_BUILD=1 ./upgrade.sh
#                                # roll the images already in the local store — the path to use when
#                                # you built them yourself with `podman build` and its build args
#                                # (degraded registry, see docs/deploy/README.md §5)
#
# Sequence — each step exists because skipping it loses data or takes the site down:
#
#   1. backup          a failed migration cannot be undone by reverting the image, only by restoring
#   2. pin :rollback   `compose build` retags :latest in place; naming the running image first is
#                      what makes the rollback below possible after the tag has moved
#   3. migrate         runs through the compose `migrate` service, which is gated on postgres being
#                      healthy and gates api on success
#   4. roll            `compose up -d` recreates the containers whose image changed; a `up` that
#                      fails on its own (an image that does not start) rolls back too
#   5. health gate     /api/ready polled from inside the container; on failure the rollback tags are
#                      restored over :latest / :latest-migrate and the stack is rolled back
#
# Rollback is best effort and only covers *images*. A migration that already ran stays applied —
# migrations are written forward-compatible on purpose (see docs/deploy/README.md).

set -eu
. "$(dirname "$0")/lib.sh"

require_podman

[ -f "$COMPOSE_DIR/.env.production" ] || die "deploy/podman/.env.production is missing"

API_IMAGE=localhost/planstar-api:latest
MIGRATE_IMAGE=localhost/planstar-api:latest-migrate
WEB_IMAGE=localhost/planstar-web:latest

log "1/5 backup"
"$COMPOSE_DIR/scripts/backup.sh"

log "2/5 pinning rollback tags"
pin() { # $1 = compose service, $2 = image ref, $3 = rollback ref
	# Pin what is *serving traffic*, not what the tag happens to point at. Under
	# `UPGRADE_SKIP_BUILD=1` the operator has already moved :latest onto the new build before this
	# runs, so the tag is the new — possibly broken — image and would make the rollback restore the
	# thing that just failed.
	id=$(container_of "$1" 2>/dev/null || true)
	[ -n "${id:-}" ] || id=$(podman ps -aq \
		--filter "label=com.docker.compose.project=$PROJECT" \
		--filter "label=com.docker.compose.service=$1" --latest 2>/dev/null | head -n 1 || true)
	if [ -n "${id:-}" ]; then
		current=$(podman inspect --format '{{.Image}}' "$id")
		podman tag "$current" "$3"
		printf '    %s (%s) -> %s\n' "$2" "$(printf '%.12s' "$current")" "$3"
	elif podman image exists "$2"; then
		podman tag "$2" "$3"
		printf '    %s -> %s\n' "$2" "$3"
	else
		warn "$2 does not exist yet; nothing to pin"
	fi
}
pin api "$API_IMAGE" "$API_IMAGE-rollback"
pin migrate "$MIGRATE_IMAGE" "$MIGRATE_IMAGE-rollback"
pin web "$WEB_IMAGE" "$WEB_IMAGE-rollback"

if [ "${UPGRADE_SKIP_BUILD:-0}" = "1" ]; then
	log "3/5 using the images already in the local store (UPGRADE_SKIP_BUILD=1)"
elif [ "${UPGRADE_PULL:-0}" = "1" ]; then
	log "3/5 pulling images"
	compose pull
else
	log "3/5 building images"
	# `podman compose build` goes through the compose provider and so cannot take the Podman build
	# args of §5. On a degraded registry build first, then run this script with UPGRADE_SKIP_BUILD=1.
	compose build
fi

restore_tag() { # $1 = rollback ref, $2 = image
	if podman image exists "$1"; then
		podman tag "$1" "$2"
		printf '    %s -> %s\n' "$1" "$2"
	else
		warn "no rollback image for $2"
	fi
}

rollback() { # $1 = why
	warn "$1 — rolling the images back"
	compose logs --tail 60 api || true
	restore_tag "$API_IMAGE-rollback" "$API_IMAGE"
	restore_tag "$MIGRATE_IMAGE-rollback" "$MIGRATE_IMAGE"
	restore_tag "$WEB_IMAGE-rollback" "$WEB_IMAGE"
	# `web` waits for `api` to be healthy, so this fails for the same reason the upgrade did when the
	# restored images are not healthy either. Capture the failure instead of letting `set -e` abort:
	# the message at the end is the actionable part.
	# `--force-recreate`: the rollback moves a tag back, which does not change the compose config, so a
	# plain `up -d` only restarts the existing container — still bound to the image id it was created
	# from, i.e. the broken one.
	compose up -d --force-recreate migrate api web || true
	if wait_ready 120; then
		die "upgrade failed and the previous images were restored; the stack is healthy again, investigate the logs above"
	fi
	die "upgrade failed AND the rollback did not come back healthy — restore from the backup taken in step 1 (scripts/restore.sh)"
}

log "4/5 running migrations and rolling containers"
# `up -d` recreates api/web (their image ids changed) and re-runs `migrate`, whose exit status gates
# api. It does not touch postgres, whose image and config are unchanged. Guarded, not bare: an image
# that does not start makes `web`'s `depends_on: api: service_healthy` fail the whole `up`, and `set -e`
# would then abort with the stack half-rolled and no rollback.
if ! compose up -d --force-recreate migrate api web; then
	rollback "compose up -d failed"
fi

log "5/5 health gate"
if wait_ready 120; then
	printf '\nupgrade complete; /api/ready is healthy\n'
	exit 0
fi

rollback "/api/ready did not come back within 120 s"
