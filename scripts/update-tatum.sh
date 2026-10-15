#!/usr/bin/env bash
# Trae la última versión de tatum (el repo de Seba) y recompila el motor.
# Después revisá que anvar siga sonando y commiteá tatum + web/engine/anvar.wasm.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

before="$(git -C tatum rev-parse --short HEAD)"
git submodule update --init --remote tatum
after="$(git -C tatum rev-parse --short HEAD)"

if [ "$before" = "$after" ]; then
  echo "tatum ya estaba al día ($after)."
  exit 0
fi

echo "tatum: $before -> $after"
git -C tatum log --oneline "$before..$after" 2>/dev/null || true
"$root/scripts/build-engine.sh"
echo
echo "Para guardarlo: git add tatum engine/Cargo.lock web/engine/anvar.wasm && git commit -m 'tatum: $before -> $after'"
