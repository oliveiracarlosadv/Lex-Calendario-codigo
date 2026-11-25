# Assinaturas — como ativar a cobrança mensal

O Lex Calendário já traz tudo o que é preciso para ter assinantes: entrada por e-mail + código,
período de teste grátis e cobrança mensal pelo Asaas. **Enquanto os passos abaixo não forem feitos,
o aplicativo continua livre, sem login e sem cobrança.**

## Como funciona

1. O assinante abre o aplicativo, informa o e-mail e recebe um código de 6 números para entrar.
2. Começa o teste grátis (14 dias, ajustável). Os dados dele ficam no computador dele.
3. Ao assinar, informa nome e CPF/CNPJ; o Lex abre a página do Asaas (Pix, boleto ou cartão).
4. O Asaas avisa o servidor quando o pagamento entra; o aplicativo libera por mais um mês.
5. Sem pagamento, há 5 dias de tolerância e depois o aplicativo bloqueia. Mesmo bloqueado, o
   assinante consegue baixar o backup dos próprios dados.
6. Sem internet, o aplicativo segue funcionando por até 7 dias desde a última conferência.

## O que precisa existir (contas criadas pelo titular)

| Serviço | Para quê | Custo |
|---|---|---|
| Supabase | Banco de dados do servidor de assinaturas | plano gratuito atende no início |
| Vercel | Onde o servidor fica no ar (um endereço https) | plano gratuito atende no início |
| Asaas | Cobrança recorrente (Pix, boleto, cartão) | taxa por cobrança paga |
| Uma conta de e-mail | Enviar os códigos de entrada | a do escritório serve |

O repositório já tem a publicação automática na Vercel e no Supabase (`.github/workflows/deploy.yml`);
ela liga sozinha quando as variáveis `SUPABASE_PROJECT_REF` e `VERCEL_ENABLED=true` e os segredos
correspondentes forem cadastrados no GitHub.

## Configuração do servidor (variáveis de ambiente na Vercel)

| Variável | Valor |
|---|---|
| `ASAAS_API_KEY` | chave de API gerada no painel do Asaas |
| `ASAAS_WEBHOOK_TOKEN` | um texto longo inventado por você; o mesmo é informado no webhook do Asaas |
| `ASAAS_SANDBOX` | `1` enquanto estiver testando no ambiente de testes do Asaas; apague para valer |
| `LICENSE_PRICE` | mensalidade, por exemplo `49.90` |
| `LICENSE_TRIAL_DAYS` | dias de teste grátis (padrão `14`) |
| `LICENSE_SMTP_HOST`, `LICENSE_SMTP_PORT`, `LICENSE_SMTP_USER`, `LICENSE_SMTP_PASSWORD`, `LICENSE_SMTP_FROM` | conta de e-mail que envia os códigos |
| `LICENSE_ADMIN_EMAILS` | e-mails que podem ver a página `/assinantes` |

No Asaas, em **Integrações → Webhooks**, crie um webhook para
`https://SEU-ENDERECO/api/licenca/asaas`, com o token igual ao `ASAAS_WEBHOOK_TOKEN` e os eventos
de **cobranças** e **assinaturas**.

## Ligar a assinatura no aplicativo

No GitHub (Settings → Secrets and variables → Actions → Variables), crie a variável
`LICENSE_SERVER_URL` com o endereço do servidor (`https://…`). A próxima versão gerada já pede a
entrada e aplica o teste grátis. Para voltar a ser livre, apague a variável e gere outra versão.

## Painel do titular

Entre no servidor (endereço da Vercel) com um dos e-mails de `LICENSE_ADMIN_EMAILS` e abra
`/assinantes`: quantos estão em teste, em dia e bloqueados, e a receita mensal prevista.
Pagamentos, estornos e notas ficam no painel do Asaas.

## Limites desta primeira versão

- O bloqueio é feito na tela do aplicativo; não há proteção contra quem altere o programa.
- Vale para o aplicativo instalado. A versão web não exige assinatura.
- Não foi testado com uma conta real do Asaas: faça o primeiro teste no ambiente de testes (`ASAAS_SANDBOX=1`).
