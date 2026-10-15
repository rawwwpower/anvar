#!/usr/bin/env bash
# Compila el motor de anvar (engine/, que usa tatum/core por dentro) a
# WebAssembly y lo deja en web/engine/anvar.wasm. Hace falta correrlo solo al
# cambiar engine/ o después de traer cambios de tatum: el .wasm compilado queda
# commiteado, así la web anda sin tener Rust instalado.
#
# Requisitos (una sola vez):
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-bindgen-cli --version <la de engine/Cargo.toml> --locked
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tatum="$root/tatum"

if [ ! -f "$tatum/Cargo.toml" ]; then
  echo "Falta el submódulo tatum. Corré: git submodule update --init" >&2
  exit 1
fi

# wasm-bindgen-cli tiene que ser exactamente la versión fijada en engine/.
want="$(sed -n 's/^wasm-bindgen = "=\(.*\)"/\1/p' "$root/engine/Cargo.toml")"
have="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [ "$want" != "$have" ]; then
  echo "Necesito wasm-bindgen-cli $want (tenés: ${have:-ninguno}). Instalalo con:" >&2
  echo "  cargo install wasm-bindgen-cli --version $want --locked" >&2
  exit 1
fi

cargo build --manifest-path "$root/engine/Cargo.toml" --release \
  --target wasm32-unknown-unknown

out="$(mktemp -d)"
wasm-bindgen --target web --no-typescript --out-dir "$out" \
  "$root/engine/target/wasm32-unknown-unknown/release/anvar_engine.wasm"
cp "$out/anvar_engine_bg.wasm" "$root/web/engine/anvar.wasm"
rm -rf "$out"

echo "Listo: web/engine/anvar.wasm (tatum $(git -C "$tatum" rev-parse --short HEAD))"
