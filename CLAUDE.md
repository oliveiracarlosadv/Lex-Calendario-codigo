# Lex Calendário — regras do projeto

Calendário jurídico para advogados brasileiros: app web (Next.js 15) + app de computador (inicializador em Go, banco local PGlite). O usuário é advogado, não programador: responda em português do Brasil, em linguagem simples.

## Onde trabalhar

- Código de trabalho: `/Users/usuario/Documents/Claude/Lex-calendario` (git, remoto `origin` = `oliveiracarlosadv/Lex-Calendario-codigo`, **público desde 25/11/2026**, licença GPL-3.0).
- Esta pasta do Drive é o arquivo do projeto. `01 - Código-fonte/Lex-calendario` é uma **cópia**; não edite nela — edite na pasta de trabalho e copie para cá ao final.

## Regras permanentes do usuário

- **Código aberto** (decisão do usuário em 25/11/2026): repositório público, licença GPL-3.0, tudo gratuito e sem planos pagos. Histórico anterior a 25/11/2026 guardado só no Drive (`03 - Histórico e prompts (Claude)/historico-git-completo-ate-2026-11-25.bundle`).
- Commits sempre com o autor "Lex Tecnologias" e o e-mail `oliveiracarlosadv@users.noreply.github.com` (nunca o e-mail pessoal).
- Toda alteração é enviada ao GitHub (`git push`). A cada atualização, nova versão (release); vários pedidos seguidos podem ir juntos numa versão.
- O app é gratuito, abre direto no calendário, funciona sem conta e sem internet; "Entrar" serve só para sincronizar com o Google.
- IA: preferir opções gratuitas e de código aberto (Ollama local).
- Nunca digitar, criar ou gravar senhas, tokens ou chaves pelo usuário; ele mesmo cadastra os "Secrets" no GitHub. Nunca versionar `client_secret*.json`.
- Não publicar o e-mail pessoal do usuário em documentos.

## Como publicar uma versão

1. Não há Node nem Go no Mac: a validação é pelo GitHub Actions (CI: lint, tipos, testes, migrações, Go vet, build). Espere o CI ficar verde.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` dispara `.github/workflows/release.yml`, que gera Mac (Apple Silicon e Intel), Windows e Linux.
   **Sempre pelo GitHub.** Montar os instaladores no Mac só quando o usuário pedir explicitamente (decisão de 15/10/2026), com `scripts/montar-no-mac.sh vX.Y.Z <pasta temporária>`; se o GitHub estiver bloqueado, a versão fica pendente e o usuário é avisado.
3. Escreva as notas da versão em linguagem simples (`gh release edit`).
4. Mantenha no GitHub **só a versão mais recente** (decisão do usuário em 25/10/2026). Ao publicar uma nova, apague a anterior, mas só depois de confirmar que todos os arquivos dela estão em `05 - Instaladores`, com o mesmo tamanho.
5. Depois de cada versão, atualize esta pasta: instaladores em `05 - Instaladores/vX.Y.Z` e o código com
   `rsync -a --delete --exclude 'client_secret*.json' --exclude node_modules --exclude .next <trabalho>/ "01 - Código-fonte/Lex-calendario/"`.

## Versão web (PWA)

- Endereço: https://oliveiracarlosadv.github.io/Lex-Calendario/ (GitHub Pages, ramo `gh-pages` do repositório público; só arquivos compilados, nunca código-fonte).
- Decisão do usuário (23/11/2026): a web é um **cliente de leitura** do Google Agenda, só com o Calendário (sem processos, clientes, parceiros nem comunicações). Não cria nem altera nada no Google (escopo `calendar.events.readonly`).
- Roda inteira no navegador: o mesmo banco PGlite fica no aparelho (IndexedDB). Sem conta, sem servidor e sem internet depois da primeira abertura. Os dados não sincronizam entre aparelhos; o caminho é Backup → Importar.
- Montagem: `scripts/montar-web.py vX.Y.Z <pasta temporária>` aplica `web/overlay` sobre uma cópia do projeto e gera `<pasta>/site`. Publique a cada versão: dentro de `site`, `git init -b gh-pages`, commit com o e-mail "noreply" e `git push --force` para o repositório público.
- Login com Google na web: fluxo direto do navegador, com o ID público do cliente OAuth tipo "Aplicativo da Web" em `web/config.json` (sem segredo). O acesso dura 1 hora e é renovado ao abrir o app ou ao tocar em Sincronizar.
- Fica de fora da web, por depender de servidor: intimações, busca e monitoramento de processos, envio de e-mail e IA.

## Pontos técnicos que não são óbvios

- Migrações em `supabase/migrations/*.sql` têm cópia embutida em `src/infrastructure/local/migrations.generated.ts`; as duas precisam ficar idênticas (há teste que confere).
- O modo local usa um emulador da API do Supabase (`src/infrastructure/local/rest.ts`); recursos novos de consulta precisam funcionar nos dois.
- Sincronização com Google: dados compartilhados entre duas instalações do Lex viajam em `extendedProperties.shared`; comentário do convidado vai pelo campo de comentário do participante.
- O DJEN (CNJ) aceita o parâmetro `texto` (trecho exato na publicação): é assim que o Lex busca por CPF, CNPJ e outros números, com e sem pontuação.
- Atualização é sempre manual, pelo arquivo do pacote (Configurações → Aplicativo); o app faz backup automático antes. Não há busca de versão pela internet (decisão do usuário em 2026-10-12).
