import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export function PanelHeader({
  title,
  right,
  className,
}: {
  title: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border/70 px-3 py-2", className)}>
      <div className="text-xs font-semibold tracking-wide text-muted">{title}</div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

