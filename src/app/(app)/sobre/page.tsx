import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/app-shell";
import { LogoMark, OliveBranch } from "@/components/layout/logo";
import { LEGAL_LINKS, publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Sobre" };



export default function AboutPage() {
  const version = process.env.LEX_DESKTOP_VERSION || publicEnv.appVersion;
  return (
    <div>
      <PageHeader title="Sobre" description="O Lex Calendário e seu criador" />
      <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
        <section className="flex flex-col items-center gap-4 rounded-3xl border bg-card px-6 py-10 text-center">
          <LogoMark className="size-16 rounded-2xl" />
          <h2 className="text-2xl font-semibold tracking-tight">Lex Calendário</h2>
          <div className="flex flex-col items-center gap-1">
            <span className="rounded-full bg-primary px-4 py-1.5 text-lg font-semibold tracking-tight text-primary-foreground shadow-soft">
              Versão {version}
            </span>
            <Link href="/configuracoes/aplicativo" className="text-xs text-primary hover:underline">
              Atualizar o aplicativo
            </Link>
          </div>
          <p className="max-w-xl text-muted-foreground">
            Um calendário funcional, pensado por um advogado para advogados: audiências, prazos e compromissos organizados com a simplicidade do Apple Calendar,
            com prazos contados pelo CPC e sugestões automáticas a partir das movimentações processuais.
          </p>
          <OliveBranch className="h-10 w-40 text-olive-600 dark:text-olive-300" />
        </section>

        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Release</p>
            <CardTitle className="text-xl leading-snug">
              Advogado paraense cria agenda jurídica que lê o Diário de Justiça e avisa o colega antes do prazo vencer
            </CardTitle>
            <p className="text-sm text-muted-foreground">Belém (PA) · Lex Calendário</p>
          </CardHeader>
          <CardContent className="space-y-4 text-[15px] leading-relaxed">
            <p>
              O <strong>Lex Calendário</strong> nasceu da rotina de quem vive o dia a dia do fórum. Seu criador, o advogado{" "}
              <strong>Carlos Alexandre Albuquerque Oliveira</strong>, atua nas áreas cível, trabalhista e penal e dedica parte da carreira ao
              compliance empresarial e trabalhista. Antes da advocacia, trabalhou no serviço público de perícias científicas, onde aprendeu que
              cadeia de custódia e prazo não admitem improviso — lição que hoje orienta cada tela do aplicativo.
            </p>
            <p>
              A proposta é simples: reunir em um só lugar audiências, prazos, clientes e processos, com a clareza visual de um calendário moderno e a
              precisão que a advocacia exige. O app consulta o Diário de Justiça Eletrônico Nacional pela OAB do advogado, cadastra os processos
              intimados, conta os prazos em dias úteis segundo o CPC e transforma cada publicação em um compromisso com lembretes no computador e no
              Google Agenda.
            </p>
            <p>
              Depois de anos como sócio de escritório, coordenando equipe, planejamento e atendimento, Carlos percebeu que boa parte do estresse da
              profissão vem do controle manual de agendas espalhadas. Ao fundar sua própria assessoria e consultoria jurídica, decidiu construir a
              ferramenta que gostaria de ter usado desde o primeiro dia de OAB: gratuita, que funciona offline e guarda os dados no computador do
              próprio advogado, respeitando o sigilo profissional e a LGPD.
            </p>
            <p>
              O ramo de oliveira que assina o aplicativo vem da identidade visual do escritório do criador — símbolo de paz e de justiça — e resume o
              espírito do projeto: tecnologia a serviço de uma advocacia mais serena.
            </p>
            <div className="flex flex-wrap gap-4 pt-1 text-sm">
              <a href="https://lattes.cnpq.br/4151018791454248" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
                <ExternalLink className="size-4" /> Currículo Lattes
              </a>
              <a href="https://orcid.org/0000-0003-0680-4424" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
                <ExternalLink className="size-4" /> ORCID
              </a>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © 2026 Carlos A. A. Oliveira · As sugestões automáticas não substituem a conferência dos prazos pelo advogado responsável.
          <br />
          <a href={LEGAL_LINKS.privacy} target="_blank" rel="noreferrer" className="text-primary hover:underline">Política de Privacidade</a>
          {" · "}
          <a href={LEGAL_LINKS.terms} target="_blank" rel="noreferrer" className="text-primary hover:underline">Termos de Uso</a>
        </p>
      </div>
    </div>
  );
}
