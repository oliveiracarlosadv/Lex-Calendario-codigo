"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { color?: string }
>(({ className, color, style, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    style={color ? ({ "--cb": color, ...style } as React.CSSProperties) : style}
    className={cn(
      "peer size-[18px] shrink-0 rounded-[5px] border-[1.5px] border-muted-foreground/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=checked]:border-transparent",
      color ? "data-[state=checked]:bg-[var(--cb)]" : "data-[state=checked]:bg-primary",
      "text-white",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <Check className="size-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
