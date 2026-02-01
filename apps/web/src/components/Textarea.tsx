import type { TextareaHTMLAttributes } from "react";

import { cn } from "../lib/cn";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: Props) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-md border border-border/70 bg-panel2/60 px-3 py-2 text-sm text-text",
        "placeholder:text-muted/70",
        "focus:outline-none focus:ring-2 focus:ring-accent/70",
        className,
      )}
      {...props}
    />
  );
}

