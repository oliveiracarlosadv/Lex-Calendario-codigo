#!/usr/bin/env bash
# Baixa o runtime oficial do Node.js (nodejs.org) e extrai somente o binário.
# Uso: fetch-node.sh <win-x64|linux-x64|darwin-arm64|darwin-x64> <destino>
set -euo pipefail
PLATFORM="$1"; DEST="$2"
MAJOR="${NODE_MAJOR:-22}"
BASE="https://nodejs.org/dist/latest-v${MAJOR}.x"
NAME=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep -E "^node-v[0-9.]+-${PLATFORM}\.(zip|tar\.gz)$" | head -1)
[ -n "$NAME" ] || { echo "Runtime não encontrado para $PLATFORM" >&2; exit 1; }
TMP=$(mktemp -d)
curl -fsSL "$BASE/$NAME" -o "$TMP/$NAME"
(cd "$TMP" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $NAME\$" | sha256sum -c - 2>/dev/null || shasum -a 256 -c <(curl -fsSL "$BASE/SHASUMS256.txt" | grep " $NAME\$"))
mkdir -p "$DEST"
case "$NAME" in
  *.zip)
    unzip -q "$TMP/$NAME" -d "$TMP/x"
    cp "$TMP"/x/*/node.exe "$DEST/node.exe"
    cp "$TMP"/x/*/LICENSE "$DEST/LICENSE-node.txt" ;;
  *.tar.gz)
    tar -xzf "$TMP/$NAME" -C "$TMP"
    mkdir -p "$DEST/bin"
    cp "$TMP"/node-v*/bin/node "$DEST/bin/node"
    chmod +x "$DEST/bin/node"
    cp "$TMP"/node-v*/LICENSE "$DEST/LICENSE-node.txt" ;;
esac
rm -rf "$TMP"
echo "Node.js ${NAME} → $DEST"
