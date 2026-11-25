#!/bin/bash
# Monta os pacotes e instaladores do Lex Calendário neste Mac, sem o GitHub Actions.
# Uso só quando o usuário pedir (ver CLAUDE.md). Espelha .github/workflows/release.yml.
#
#   scripts/montar-no-mac.sh v1.2.3 <pasta-de-trabalho>
#
# Baixa Go 1.22 e Node 22 (sites oficiais, com checagem) para <pasta>/tools; precisa do
# makensis (brew install makensis) e das Ferramentas de Linha de Comando do Xcode.
# O segredo do Google vem do client_secret*.json local (nunca versionado).
# Resultado: <pasta>/dist com os 8 arquivos da versão.
set -euo pipefail
VERSION="$1"; W="$2"; V="${VERSION#v}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$W/src"; D="$SRC/desktop"; DIST="$W/dist"; T="$W/tools"
mkdir -p "$T"
if [ ! -x "$T/go/bin/go" ]; then curl -fsSL https://go.dev/dl/go1.22.12.darwin-arm64.tar.gz | tar -xz -C "$T"; fi
if [ ! -x "$T/node22/bin/node" ]; then
  BASE=https://nodejs.org/dist/latest-v22.x
  NAME=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep -E '^node-v[0-9.]+-darwin-arm64\.tar\.gz$')
  (cd "$T" && curl -fsSLO "$BASE/$NAME" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $NAME\$" | shasum -a 256 -c - && tar -xzf "$NAME" && rm -rf node22 && mv node-v*-darwin-arm64 node22 && rm "$NAME")
fi
command -v makensis >/dev/null || { echo "Instale o makensis: brew install makensis" >&2; exit 1; }
export PATH="$T/go/bin:$T/node22/bin:$PATH" GOFLAGS=-mod=mod NEXT_TELEMETRY_DISABLED=1

echo "== Código (git $(git -C "$REPO" rev-parse --short HEAD))"
rm -rf "$SRC" "$W/payload" "$DIST"; mkdir -p "$SRC" "$DIST"
git -C "$REPO" archive HEAD | tar -x -C "$SRC"

echo "== App web"
cd "$SRC"
npm install --no-audit --no-fund >"$W/npm.log" 2>&1
NEXT_OUTPUT=standalone NEXT_PUBLIC_APP_URL=http://127.0.0.1:47830 NEXT_PUBLIC_LEX_LOCAL=1 NEXT_PUBLIC_APP_VERSION="$VERSION" \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:47830/local NEXT_PUBLIC_SUPABASE_ANON_KEY=lex-local NEXT_PUBLIC_FULLCALENDAR_LICENSE_KEY= NEXT_PUBLIC_LICENSE_SERVER= \
  npm run build >"$W/build.log" 2>&1
P="$W/payload/app"; mkdir -p "$P/.next" "$P/node_modules/@electric-sql"
cp -R .next/standalone/. "$P/"; cp -R .next/static "$P/.next/static"; cp -R public "$P/public"
rm -rf "$P/node_modules/@electric-sql/pglite"; cp -R node_modules/@electric-sql/pglite "$P/node_modules/@electric-sql/pglite"

GJSON=$(ls "$REPO"/client_secret*.json 2>/dev/null | head -1 || true)
GCID=""; GSEC=""
if [ -n "$GJSON" ]; then
  GCID=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d[list(d)[0]]['client_id'])" "$GJSON")
  GSEC=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d[list(d)[0]]['client_secret'])" "$GJSON")
fi
LDF="-s -w -X main.version=$V -X main.googleClientID=$GCID -X main.googleClientSecret=$GSEC -X main.microsoftClientID="
cd "$D"

echo "== Windows"
go install github.com/tc-hib/go-winres@latest
"$(go env GOPATH)/bin/go-winres" simply --arch amd64 --icon ../public/icon-512.png --manifest gui \
  --product-name "Lex Calendário" --file-description "Lex Calendário" --original-filename "Lex Calendário.exe" \
  --product-version "$V" --file-version "$V" --copyright "Carlos Alexandre Albuquerque Oliveira"
OUT="out/win/Lex Calendário"; mkdir -p "$OUT/payload"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDF -H windowsgui" -o "$OUT/Lex Calendário.exe" .
cp -R "$W/payload/." "$OUT/payload/"
./scripts/fetch-node.sh win-x64 "$OUT/payload/runtime"
mkdir -p out/ico; for s in 16 32 48 256; do sips -z $s $s ../public/icon-512.png --out out/ico/$s.png >/dev/null; done
python3 - out/ico "$OUT/lex-calendario.ico" <<'PY'
import struct,sys
d,out=sys.argv[1],sys.argv[2]
imgs=[(s,open(f"{d}/{s}.png","rb").read()) for s in (16,32,48,256)]
h=struct.pack("<HHH",0,1,len(imgs)); off=6+16*len(imgs); ent=b""; data=b""
for s,b in imgs:
    ent+=struct.pack("<BBBBHHII",s%256,s%256,0,0,1,32,len(b),off+len(data)); data+=b
open(out,"wb").write(h+ent+data)
PY
cp packaging/LEIA-ME-Windows.txt "$OUT/LEIA-ME.txt"
cp packaging/Desinstalar-Lex-Calendario.cmd "$OUT/Desinstalar Lex Calendário.cmd"
# zip com nomes marcados como UTF-8: o "zip" do Mac não marca e o Windows embaralha o "á"
python3 - out/win "$DIST/LexCalendario-Windows.zip" <<'PY'
import os,sys,zipfile
base,out=sys.argv[1],sys.argv[2]
with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for root,dirs,files in os.walk(base):
        for f in sorted(files):
            full=os.path.join(root,f); z.write(full, os.path.relpath(full,base))
PY
LANG=en_US.UTF-8 makensis -V2 -DAPPVER="$V" -DSRC="$PWD/$OUT" -DOUTFILE="$DIST/LexCalendario-Instalador-Windows.exe" "-DICON=$PWD/$OUT/lex-calendario.ico" packaging/windows/lex-calendario.nsi
rm -f *.syso

echo "== Linux"
OUT="out/linux/Lex Calendário"; mkdir -p "$OUT/payload"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDF" -o "$OUT/Lex Calendário" .
cp -R "$W/payload/." "$OUT/payload/"
./scripts/fetch-node.sh linux-x64 "$OUT/payload/runtime"
cp ../public/icon-512.png "$OUT/lex-calendario.png"
cp packaging/LEIA-ME-Linux.txt "$OUT/LEIA-ME.txt"
cp packaging/desinstalar.sh "$OUT/Desinstalar Lex Calendário.sh" && chmod +x "$OUT/Desinstalar Lex Calendário.sh"
COPYFILE_DISABLE=1 tar --no-mac-metadata -czf "$DIST/LexCalendario-Linux.tar.gz" -C out/linux "Lex Calendário"
DEB=out/deb; mkdir -p "$DEB/root/opt/lex-calendario" "$DEB/root/usr/share/applications" "$DEB/root/usr/share/icons/hicolor/512x512/apps" "$DEB/control"
cp -R "$OUT/." "$DEB/root/opt/lex-calendario/"
rm -f "$DEB/root/opt/lex-calendario/LEIA-ME.txt" "$DEB/root/opt/lex-calendario/Desinstalar Lex Calendário.sh"
install -m 644 packaging/linux-deb/lex-calendario.desktop "$DEB/root/usr/share/applications/"
install -m 644 ../public/icon-512.png "$DEB/root/usr/share/icons/hicolor/512x512/apps/lex-calendario.png"
sed "s/__VERSION__/$V/" packaging/linux-deb/control > "$DEB/control/control"
echo "Installed-Size: $(du -sk "$DEB/root/opt" | cut -f1)" >> "$DEB/control/control"
install -m 755 packaging/linux-deb/postinst packaging/linux-deb/postrm "$DEB/control/"
OWN=(--uid 0 --gid 0 --uname root --gname root --no-mac-metadata --no-xattrs --no-fflags)
(cd "$DEB/control" && COPYFILE_DISABLE=1 tar "${OWN[@]}" -cJf ../control.tar.xz ./control ./postinst ./postrm)
(cd "$DEB/root" && COPYFILE_DISABLE=1 tar "${OWN[@]}" -cJf ../data.tar.xz .)
printf '2.0\n' > "$DEB/debian-binary"
# pacote .deb = arquivo "ar" com três partes (o dpkg-deb não existe no Mac)
python3 - "$DEB" "$DIST/LexCalendario-Instalador-Linux.deb" <<'PY'
import sys,os
d,out=sys.argv[1],sys.argv[2]
with open(out,"wb") as f:
    f.write(b"!<arch>\n")
    for n in ("debian-binary","control.tar.xz","data.tar.xz"):
        b=open(os.path.join(d,n),"rb").read()
        f.write(f"{n+'/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(b):<10}`\n".encode())
        f.write(b)
        if len(b)%2: f.write(b"\n")
PY

echo "== macOS"
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDF" -o out/lex-arm64 .
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDF" -o out/lex-amd64 .
swiftc -O -target arm64-apple-macos11 -o out/notifier-arm64 macos/LexNotifier.swift
# Intel: as Ferramentas de Linha de Comando não trazem as bibliotecas x86_64 para macOS 11
swiftc -O -target x86_64-apple-macos13 -o out/notifier-x64 macos/LexNotifier.swift
ICONSET=out/AppIcon.iconset; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../public/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d ../public/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o out/AppIcon.icns
for pair in arm64:AppleSilicon:arm64 x64:Intel:x86_64; do
  ARCH=${pair%%:*}; rest=${pair#*:}; LABEL=${rest%%:*}; HOST=${rest#*:}
  M="out/mac-$ARCH"; APP="$M/Lex Calendário.app"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/payload"
  lipo -create -output "$APP/Contents/MacOS/LexCalendario" out/lex-arm64 out/lex-amd64
  lipo -create -output "$APP/Contents/MacOS/LexNotifier" out/notifier-arm64 out/notifier-x64
  sed "s/__VERSION__/$V/g" packaging/Info.plist > "$APP/Contents/Info.plist"
  cp -R "$W/payload/." "$APP/Contents/Resources/payload/"
  ./scripts/fetch-node.sh darwin-$ARCH "$APP/Contents/Resources/payload/runtime"
  cp out/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
  xattr -cr "$APP"
  codesign --force --deep --sign - "$APP"
  cp packaging/LEIA-ME-macOS.txt "$M/LEIA-ME.txt"
  cp "packaging/Desinstalar Lex Calendário.command" "$M/" && chmod +x "$M/Desinstalar Lex Calendário.command"
  (cd "$M" && ditto -c -k --keepParent "Lex Calendário.app" "$DIST/LexCalendario-macOS-$LABEL.zip" && zip -q "$DIST/LexCalendario-macOS-$LABEL.zip" LEIA-ME.txt "Desinstalar Lex Calendário.command")
  # pasta temporária do .pkg sem acento: o pkgbuild não aceita
  R="out/pkgroot-$ARCH"; PK="out/pkgs-$ARCH"; mkdir -p "$R" "$PK"
  ditto "$APP" "$R/LexCalendario.app"
  pkgbuild --analyze --root "$R" "out/componente-$ARCH.plist"
  plutil -replace 0.BundleIsRelocatable -bool NO "out/componente-$ARCH.plist"
  pkgbuild --root "$R" --component-plist "out/componente-$ARCH.plist" \
    --identifier br.adv.caao.lexcalendario.pkg --version "$V" \
    --install-location /private/tmp/lex-calendario-instalador \
    --scripts packaging/macos-pkg/scripts "$PK/lex-calendario-componente.pkg"
  sed -e "s/__VERSION__/$V/" -e "s/__ARCH__/$HOST/" packaging/macos-pkg/Distribution.xml > "out/Distribution-$ARCH.xml"
  productbuild --distribution "out/Distribution-$ARCH.xml" --resources packaging/macos-pkg/resources \
    --package-path "$PK" "$DIST/LexCalendario-Instalador-macOS-$LABEL.pkg"
done
ls -la "$DIST"
