@echo off
rem Lex Calendario - desinstalador para Windows (pergunta se remove tambem os dados)
for %%f in ("%~dp0Lex Calend*.exe") do start "" "%%f" --desinstalar
