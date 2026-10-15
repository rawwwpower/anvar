#!/usr/bin/env bash
# Sirve anvar en http://localhost:8000/web/ (el navegador no carga el motor
# abriendo el archivo directo: necesita un servidor, aunque sea local).
set -euo pipefail
cd "$(dirname "$0")/.."
port="${1:-8000}"
echo "anvar en http://localhost:$port/web/"
python3 -m http.server "$port"
