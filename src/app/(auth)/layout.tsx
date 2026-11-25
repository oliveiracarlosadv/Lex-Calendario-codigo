import { Logo, OliveBranch } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_520px]">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-olive-600 to-olive-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo className="[&_span]:text-white" />
        <div className="space-y-6">
          <OliveBranch className="h-24 w-80 text-olive-100/90" />
          <h2 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">A agenda jurídica que pensa como você.</h2>
          <p className="max-w-md text-lg text-white/75">Audiências, prazos contados pelo CPC, processos monitorados e sugestões automáticas — tudo num calendário elegante.</p>
        </div>
        <p className="text-sm text-white/60">© 2026 Carlos A. A. Oliveira</p>
      </div>
      <div className="flex items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
