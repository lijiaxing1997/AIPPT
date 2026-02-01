import { PanelResizeHandle } from "react-resizable-panels";

import { cn } from "../lib/cn";

export function ResizeHandle({ direction }: { direction: "horizontal" | "vertical" }) {
  return (
    <PanelResizeHandle
      className={cn(
        "group relative shrink-0 bg-border/50 transition-colors",
        direction === "horizontal" ? "w-px hover:w-1" : "h-px hover:h-1",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100",
          "bg-accent/40",
        )}
      />
    </PanelResizeHandle>
  );
}

