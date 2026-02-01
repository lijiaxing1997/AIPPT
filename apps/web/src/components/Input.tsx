import type { InputHTMLAttributes } from "react";

import { cn } from "../lib/cn";

type Props = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: Props) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-border/70 bg-panel2/60 px-3 text-sm text-text",
        "placeholder:text-muted/70",
        "focus:outline-none focus:ring-2 focus:ring-accent/70",
        className,
      )}
      {...props}
    />
  );
}

