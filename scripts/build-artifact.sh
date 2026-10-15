#!/usr/bin/env bash
# Arma en dist/ la versión de anvar que se publica en claude.ai: la misma web,
# con los temas de ejemplo copiados adentro (allá no existe el submódulo).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dist="$root/dist"
rm -rf "$dist"
mkdir -p "$dist/engine" "$dist/songs"

cp "$root/web/style.css" "$root/web/app.js" "$dist/"
cp "$root"/web/engine/*.js "$root/web/engine/anvar.wasm" "$dist/engine/"

# Los temas que lista app.js (SONGS), desde tatum/examples/.
for song in $(sed -n 's/^  \["\([a-z_0-9]*\)", ".*"\],$/\1/p' "$root/web/app.js"); do
  cp "$root/tatum/examples/$song.synth" "$dist/songs/"
done

# claude.ai envuelve la página en su propio <html><head><body>: va solo el contenido.
python3 - "$root/web/index.html" "$dist/index.html" <<'PY'
import re, sys
html = open(sys.argv[1], encoding="utf-8").read()
head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
head = re.sub(r'\s*<meta (charset|name="viewport")[^>]*>', "", head)
head = head.replace("<title>anvar</title>",
                    '<title>anvar</title>\n  <meta name="claude:viewport-fit-sides" content="cover">')
open(sys.argv[2], "w", encoding="utf-8").write(head.strip() + "\n" + body)
PY
echo "Listo: dist/ ($(ls "$dist/songs" | wc -l | tr -d ' ') temas)"
