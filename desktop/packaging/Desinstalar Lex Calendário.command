#!/bin/bash
# Lex Calendário — desinstalador para macOS.
# Pergunta se remove só o aplicativo ou também todos os dados (enviados para a Lixeira).
APP="/Applications/Lex Calendário.app"
[ -d "$APP" ] || APP="$HOME/Applications/Lex Calendário.app"
[ -d "$APP" ] || APP="$(cd "$(dirname "$0")" && pwd)/Lex Calendário.app"
if [ ! -x "$APP/Contents/MacOS/LexCalendario" ]; then
  osascript -e 'display dialog "O Lex Calendário não foi encontrado neste Mac." buttons {"OK"} with title "Lex Calendário"'
  exit 1
fi
"$APP/Contents/MacOS/LexCalendario" --desinstalar
osascript -e 'tell application "Terminal" to close (every window whose name contains "Desinstalar Lex")' >/dev/null 2>&1 &
exit 0
