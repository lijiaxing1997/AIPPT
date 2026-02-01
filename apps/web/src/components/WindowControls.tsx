import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";

import { cn } from "../lib/cn";
import { Button } from "./Button";

export function WindowControls({ className }: { className?: string }) {
  const isElectron = typeof window !== "undefined" && Boolean(window.aippt?.isElectron);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isElectron) return;
    let cancelled = false;
    void window.aippt
      ?.isMaximized?.()
      .then((v) => {
        if (cancelled) return;
        setMaximized(Boolean(v));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isElectron]);

  if (!isElectron) return null;

  return (
    <div className={cn("flex items-center gap-1 border-l border-border/70 pl-2", className)}>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 px-0"
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => void window.aippt?.minimize?.()}
      >
        <Minus className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 px-0"
        aria-label={maximized ? "还原窗口" : "最大化窗口"}
        title={maximized ? "还原" : "最大化"}
        onClick={async () => {
          try {
            await window.aippt?.toggleMaximize?.();
            const next = await window.aippt?.isMaximized?.();
            if (typeof next === "boolean") setMaximized(next);
          } catch {
            // ignore
          }
        }}
      >
        <Square className="h-4 w-4" />
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 px-0 hover:bg-accent2/25 hover:text-text"
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => void window.aippt?.closeWindow?.()}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
