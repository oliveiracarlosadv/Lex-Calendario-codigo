import Image from "next/image";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return <Image src="/brand/app-icon.svg" alt="" width={28} height={28} className={cn("size-7 rounded-[8px]", className)} priority />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">
        Lex <span className="font-normal text-muted-foreground">Calendário</span>
      </span>
    </span>
  );
}

/** Ramo de oliveira (marca) em cor corrente — usado em telas de entrada e vazias. */
export function OliveBranch({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block bg-current", className)}
      style={{
        WebkitMask: "url(/brand/olive-branch-mono.svg) center / contain no-repeat",
        mask: "url(/brand/olive-branch-mono.svg) center / contain no-repeat",
      }}
    />
  );
}
