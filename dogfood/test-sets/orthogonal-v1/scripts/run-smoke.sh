#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/taskops-orthogonal-v1-smoke"
rm -rf "$TMP_ROOT"
mkdir -p "$TMP_ROOT"
node "$ROOT/scripts/run-smoke.mjs" "$ROOT" "$TMP_ROOT"
