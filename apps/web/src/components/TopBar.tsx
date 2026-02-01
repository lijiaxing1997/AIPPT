import type { ReactNode } from "react";
import { Cog, Download, FolderOpen, Loader2, Sparkles } from "lucide-react";

import { Button } from "./Button";

export function TopBar({
  left,
  right,
}: {
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <header className="aippt-drag flex h-11 items-center justify-between border-b border-border/70 bg-panel/60 px-3">
      <div className="min-w-0">{left}</div>
      <div className="aippt-no-drag flex items-center gap-1.5">{right}</div>
    </header>
  );
}

export function AppTitle({
  projectName,
  projectPath,
  actions,
}: {
  projectName?: string;
  projectPath?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-panel2/60 text-xs font-bold">
        AI
      </div>
      {actions ? <div className="aippt-no-drag flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{projectName ? projectName : "兴河PPT"}</div>
        {projectPath ? <div className="truncate text-[11px] text-muted">{projectPath}</div> : null}
      </div>
    </div>
  );
}

export function ProjectActions({
  onOpenProjects,
  onOpenSettings,
}: {
  onOpenProjects: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="ghost" onClick={onOpenProjects} aria-label="Projects" className="whitespace-nowrap">
        <FolderOpen className="h-4 w-4" />
        项目
      </Button>
      <Button size="sm" variant="ghost" onClick={onOpenSettings} aria-label="Settings" className="whitespace-nowrap">
        <Cog className="h-4 w-4" />
        设置
      </Button>
    </div>
  );
}

export function ToolbarActions({
  onGenerate,
  onExport,
  generating,
  canGenerate,
  exporting,
  canExport,
  progressText,
}: {
  onGenerate?: () => void;
  onExport?: () => void;
  generating?: boolean;
  canGenerate?: boolean;
  exporting?: boolean;
  canExport?: boolean;
  progressText?: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        onClick={onGenerate}
        disabled={!canGenerate || generating}
        className="aippt-rainbow-button whitespace-nowrap"
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generating ? "制作中…" : "开始制作"}
      </Button>
      {onExport ? (
        <Button size="sm" onClick={onExport} disabled={canExport === false || exporting} className="whitespace-nowrap">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          导出
        </Button>
      ) : null}
      {progressText ? <div className="hidden text-xs text-muted md:block">{progressText}</div> : null}
    </div>
  );
}
