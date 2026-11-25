#!/bin/sh
# Lex Calendário — desinstalador para Linux (pergunta se remove também os dados).
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/Lex Calendário" --desinstalar
