import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileDown, FolderOpen, Loader2, X } from "lucide-react";

import type { ProjectSummary } from "@aippt/shared";

import { api, type ExportItem, type ExportType } from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "./Button";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function typeLabel(t: ExportType): string {
  return t.toUpperCase();
}

async function openUrl(url: string): Promise<void> {
  const resolved = (() => {
    if (typeof window === "undefined") return url;
    try {
      return new URL(url, window.location.href).toString();
    } catch {
      return url;
    }
  })();

  if (typeof window !== "undefined" && typeof window.aippt?.openExternal === "function") {
    await window.aippt.openExternal(resolved);
    return;
  }
  window.open(resolved, "_blank", "noopener,noreferrer");
}

export function ExportDialog({
  open,
  project,
  onClose,
}: {
  open: boolean;
  project: ProjectSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [openError, setOpenError] = useState<string | null>(null);

  function handleClose(): void {
    setOpenError(null);
    onClose();
  }

  const exportsQuery = useQuery({
    queryKey: ["exports", project.id],
    queryFn: () => api.listExports(project.id),
    enabled: open,
  });

  async function openExportFile(item: ExportItem): Promise<void> {
    setOpenError(null);
    try {
      if (typeof window !== "undefined" && typeof window.aippt?.openPath === "function") {
        await window.aippt.openPath(item.absPath);
        return;
      }
      await openUrl(item.fileUrl);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openExportFolder(item: ExportItem): Promise<void> {
    setOpenError(null);
    try {
      if (typeof window !== "undefined" && typeof window.aippt?.showItemInFolder === "function") {
        await window.aippt.showItemInFolder(item.absPath);
        return;
      }
      throw new Error("当前环境不支持打开所在目录");
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  const exportMutation = useMutation({
    mutationFn: async (type: ExportType) => {
      return await api.exportProject(project.id, type);
    },
    onSuccess: async (item) => {
      await queryClient.invalidateQueries({ queryKey: ["exports", project.id] });
      await openExportFile(item);
    },
  });

  const exports = useMemo(() => exportsQuery.data?.exports ?? [], [exportsQuery.data?.exports]);
  const isBusy = exportsQuery.isLoading || exportMutation.isPending;

  const lastItem = exports[0] ?? null;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl border border-border/70 bg-panel shadow-soft">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-sm font-semibold">导出</div>
          <Button variant="ghost" size="sm" onClick={handleClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-panel2/40 p-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">导出当前项目</div>
              <div className="mt-1 text-xs text-muted">
                使用每页 <span className="text-text">最新图片版本</span> 生成 {typeLabel("pdf")} / {typeLabel("pptx")}。
              </div>
              {lastItem ? (
                <div className="mt-2 text-xs text-muted">
                  最近一次：<span className="text-text">{lastItem.fileName}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => exportMutation.mutate("pdf")}
                disabled={isBusy}
                className={cn(exportMutation.isPending && exportMutation.variables === "pdf" && "opacity-90")}
              >
                {exportMutation.isPending && exportMutation.variables === "pdf" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                导出 PDF
              </Button>
              <Button
                onClick={() => exportMutation.mutate("pptx")}
                disabled={isBusy}
                className={cn(exportMutation.isPending && exportMutation.variables === "pptx" && "opacity-90")}
              >
                {exportMutation.isPending && exportMutation.variables === "pptx" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                导出 PPTX
              </Button>
            </div>
          </div>

          {exportMutation.isError ? (
            <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-accent2">{(exportMutation.error as Error).message}</div>
          ) : null}
          {openError ? (
            <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-accent2">{openError}</div>
          ) : null}

          <div className="rounded-lg border border-border/70 bg-panel2/40">
            <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
              <div className="text-xs font-semibold tracking-wide text-muted">已导出文件</div>
              <div className="text-xs text-muted">{exports.length}</div>
            </div>
            <div className="max-h-[360px] overflow-auto p-2">
              {exportsQuery.isLoading ? (
                <div className="rounded-md border border-border/70 bg-panel/40 p-3 text-sm text-muted">加载中…</div>
              ) : exportsQuery.isError ? (
                <div className="rounded-md border border-border/70 bg-panel/40 p-3 text-sm text-accent2">{(exportsQuery.error as Error).message}</div>
              ) : exports.length === 0 ? (
                <div className="rounded-md border border-border/70 bg-panel/40 p-3 text-sm text-muted">还没有导出文件。</div>
              ) : (
                <div className="space-y-2">
                  {exports.map((e: ExportItem) => (
                    <div
                      key={e.relPath}
                      className="flex flex-col gap-2 rounded-md border border-border/70 bg-panel/40 px-3 py-2 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{e.fileName}</div>
                        <div className="mt-1 text-xs text-muted">
                          {typeLabel(e.type)} · {formatBytes(e.sizeBytes)} · {new Date(e.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => void openExportFile(e)}>
                          <Download className="h-4 w-4" />
                          打开
                        </Button>
                        {typeof window !== "undefined" && typeof window.aippt?.showItemInFolder === "function" ? (
                          <Button size="sm" variant="ghost" onClick={() => void openExportFolder(e)}>
                            <FolderOpen className="h-4 w-4" />
                            打开所在目录
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-border/70 px-4 py-3">
          <Button variant="ghost" onClick={handleClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
