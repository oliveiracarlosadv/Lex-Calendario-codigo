"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn, initials } from "@/lib/utils";

export function Avatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  return (
    <AvatarPrimitive.Root className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full bg-olive-100 dark:bg-olive-800", className)}>
      {src && <AvatarPrimitive.Image src={src} alt={name ?? ""} className="aspect-square size-full object-cover" />}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-[11px] font-semibold text-olive-700 dark:text-olive-100">
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
