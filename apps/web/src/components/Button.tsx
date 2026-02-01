import type { ButtonHTMLAttributes } from "react";

import { cn } from "../lib/cn";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost";
  size?: "sm" | "md";
};

export function Button({ className, variant = "default", size = "md", ...props }: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-accent/70 focus:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "default" && "border-border/70 bg-panel2/70 text-text hover:bg-panel2/90",
        variant === "ghost" && "border-transparent bg-transparent text-muted hover:bg-panel2/60 hover:text-text",
        size === "sm" && "h-8 px-2.5",
        size === "md" && "h-9 px-3",
        className,
      )}
      {...props}
    />
  );
}

