#!/usr/bin/env bash
# Generates TypeScript protobuf bindings from .proto files using ts-proto.
#
# Usage:
#   bash scripts/generate-protos.sh             # use dist/lib/protos (from the heart JS release)
#   HEART_DIR=../anytype-heart bash scripts/generate-protos.sh --local  # use a heart checkout
#
# The protos in dist/lib/protos come from the anytype-heart JS release asset
# (js_v<mw-version>_<os>_<arch>.tar.gz) and match middleware.version.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIDDLEWARE_DIR="$ROOT_DIR/middleware"
TS_PROTO_JS="$ROOT_DIR/node_modules/ts-proto/protoc-gen-ts_proto"

LOCAL=false
if [[ "${1:-}" == "--local" ]]; then
	LOCAL=true
fi

if [[ ! -f "$TS_PROTO_JS" ]]; then
	echo "Error: ts-proto not found at $TS_PROTO_JS. Run 'pnpm install' first."
	exit 1
fi

PROTOC="${PROTOC:-protoc}"
if ! command -v "$PROTOC" &> /dev/null; then
	echo "Error: protoc not found. Set PROTOC or install protobuf compiler."
	exit 1
fi

# Create a wrapper that protoc can execute as a plugin.
WRAPPER="$(mktemp)"
chmod +x "$WRAPPER"
printf '#!/usr/bin/env node\nrequire("%s/node_modules/ts-proto/build/src/plugin")\n' "$ROOT_DIR" > "$WRAPPER"

# Create a temp directory with the proto file structure that matches import paths
PROTO_ROOT="$(mktemp -d)"
trap 'rm -rf "$PROTO_ROOT" "$WRAPPER"' EXIT

if [[ "$LOCAL" == true ]]; then
	# Local mode: use an anytype-heart checkout
	HEART_DIR="${HEART_DIR:-${ANYTYPE_HEART_PATH:-$ROOT_DIR/../anytype-heart}}"
	if [[ ! -d "$HEART_DIR" ]]; then
		echo "Error: anytype-heart repo not found at $HEART_DIR"
		exit 1
	fi
	echo "Using anytype-heart at $HEART_DIR"

	mkdir -p "$PROTO_ROOT/pb/protos"
	cp "$HEART_DIR/pb/protos/commands.proto" "$PROTO_ROOT/pb/protos/"
	cp "$HEART_DIR/pb/protos/events.proto" "$PROTO_ROOT/pb/protos/"
	cp "$HEART_DIR/pb/protos/changes.proto" "$PROTO_ROOT/pb/protos/"
	cp "$HEART_DIR/pb/protos/snapshot.proto" "$PROTO_ROOT/pb/protos/"

	mkdir -p "$PROTO_ROOT/pkg/lib/pb/model/protos"
	cp "$HEART_DIR/pkg/lib/pb/model/protos/"*.proto "$PROTO_ROOT/pkg/lib/pb/model/protos/"
else
	# Release mode: use the .proto files shipped in dist/lib/protos/
	PROTO_SRC="$ROOT_DIR/dist/lib/protos"
	if [[ ! -d "$PROTO_SRC" ]]; then
		echo "Error: dist/lib/protos not found. Extract the anytype-heart JS release asset first"
		echo "(see README: js_v<version>_<os>_<arch>.tar.gz -> protobuf/protos)."
		exit 1
	fi

	mkdir -p "$PROTO_ROOT/pb/protos"
	cp "$PROTO_SRC/commands.proto" "$PROTO_ROOT/pb/protos/"
	cp "$PROTO_SRC/events.proto" "$PROTO_ROOT/pb/protos/"
	cp "$PROTO_SRC/changes.proto" "$PROTO_ROOT/pb/protos/"
	cp "$PROTO_SRC/snapshot.proto" "$PROTO_ROOT/pb/protos/"

	mkdir -p "$PROTO_ROOT/pkg/lib/pb/model/protos"
	cp "$PROTO_SRC/models.proto" "$PROTO_ROOT/pkg/lib/pb/model/protos/"
	cp "$PROTO_SRC/localstore.proto" "$PROTO_ROOT/pkg/lib/pb/model/protos/"
	if [[ -f "$PROTO_SRC/export_report.proto" ]]; then
		cp "$PROTO_SRC/export_report.proto" "$PROTO_ROOT/pkg/lib/pb/model/protos/"
	fi
fi

echo "Generating TypeScript protobuf bindings..."

# Clean previous generated files
rm -rf "$MIDDLEWARE_DIR/pb" "$MIDDLEWARE_DIR/pkg" "$MIDDLEWARE_DIR/google"

mkdir -p "$MIDDLEWARE_DIR"

# Run protoc with ts-proto.
# outputJsonMethods=false — fromJSON/toJSON are never called by the app; skipping them
# cuts roughly a third of the generated method surface (parse time + memory at startup).
# initializeFieldsAsUndefined=false — do not pre-fill optional/oneof fields with `undefined`
# in createBase*: decoded messages only carry fields present on the wire, which shrinks
# per-message allocations (Event_Message has ~90 oneof members) and makes Object.keys()
# scans over decoded events cheap.
"$PROTOC" \
	--plugin="protoc-gen-ts_proto=$WRAPPER" \
	--ts_proto_out="$MIDDLEWARE_DIR" \
	--ts_proto_opt=outputJsonMethods=false,initializeFieldsAsUndefined=false \
	--proto_path="$PROTO_ROOT" \
	"$PROTO_ROOT/pb/protos/commands.proto" \
	"$PROTO_ROOT/pb/protos/events.proto" \
	"$PROTO_ROOT/pb/protos/changes.proto" \
	"$PROTO_ROOT/pb/protos/snapshot.proto" \
	"$PROTO_ROOT/pkg/lib/pb/model/protos/"*.proto

# Replace the generated Struct/Value codec with the hand-optimized override
# (decodes google.protobuf.Struct/Value straight into plain JS objects without
# transient wrapper allocations — the hottest decode path for object details).
echo "Applying struct.ts override..."
cp "$ROOT_DIR/scripts/proto-overrides/struct.ts" "$MIDDLEWARE_DIR/google/protobuf/struct.ts"

echo "Generated TypeScript files:"
find "$MIDDLEWARE_DIR/pb" "$MIDDLEWARE_DIR/pkg" "$MIDDLEWARE_DIR/google" -name '*.ts' 2>/dev/null | sort

echo "Done!"
