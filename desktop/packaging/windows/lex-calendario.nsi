; Lex Calendário — instalador do Windows com assistente (Avançar, Concluir).
; Monte com: makensis -DAPPVER=1.2.3 -DSRC=<pasta "Lex Calendário"> -DOUTFILE=<saída.exe> [-DICON=<.ico>] lex-calendario.nsi
;
; O assistente só extrai o aplicativo numa pasta temporária e roda "Lex Calendário.exe --instalar",
; que faz a instalação de verdade (Documentos\Lex Calendário, atalhos, início com o Windows,
; registro em Configurações → Aplicativos, com o desinstalador do próprio Lex) e atualiza
; versões anteriores mantendo os dados. Sem pedir administrador. Modo silencioso: /S.

Unicode true
!include "MUI2.nsh"

!ifndef APPVER
  !define APPVER "0.0.0"
!endif
!ifndef OUTFILE
  !define OUTFILE "LexCalendario-Instalador-Windows.exe"
!endif

Name "Lex Calendário"
Caption "Instalar o Lex Calendário ${APPVER}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$TEMP\lex-calendario-instalador"
SetCompressor /SOLID lzma
ShowInstDetails nevershow
BrandingText "Lex Calendário ${APPVER}"

VIProductVersion "${APPVER}.0"
VIAddVersionKey /LANG=1046 "ProductName" "Lex Calendário"
VIAddVersionKey /LANG=1046 "FileDescription" "Instalador do Lex Calendário"
VIAddVersionKey /LANG=1046 "FileVersion" "${APPVER}"
VIAddVersionKey /LANG=1046 "ProductVersion" "${APPVER}"
VIAddVersionKey /LANG=1046 "LegalCopyright" "Carlos Alexandre Albuquerque Oliveira"

!ifdef ICON
  !define MUI_ICON "${ICON}"
!endif
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao Lex Calendário"
!define MUI_WELCOMEPAGE_TEXT "Este assistente vai instalar o Lex Calendário ${APPVER} no seu computador.$\r$\n$\r$\nO app funciona sem internet e sem conta. Se já houver uma versão instalada, ela será atualizada e todos os seus dados serão mantidos.$\r$\n$\r$\nClique em Avançar para instalar."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Lex Calendário instalado"
!define MUI_FINISHPAGE_TEXT "Os atalhos estão na Área de Trabalho e no menu Iniciar.$\r$\n$\r$\nClique em Concluir para terminar."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Lex Calendário agora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirLex
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Lex Calendário"
  DetailPrint "Copiando os arquivos…"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\lex"
  File /r "${SRC}\*.*"
  DetailPrint "Instalando o Lex Calendário e criando os atalhos…"
  ExecWait '"$PLUGINSDIR\lex\Lex Calendário.exe" --instalar' $0
  SetOutPath "$TEMP"
  RMDir /r "$PLUGINSDIR\lex"
  IfFileExists "$DOCUMENTS\Lex Calendário\Lex Calendário.exe" +2 0
    Abort "Não foi possível concluir a instalação (código $0)."
SectionEnd

Function AbrirLex
  Exec '"$DOCUMENTS\Lex Calendário\Lex Calendário.exe"'
FunctionEnd
