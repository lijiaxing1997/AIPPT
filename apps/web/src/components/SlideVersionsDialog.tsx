import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, RotateCcw, X } from "lucide-react";

import { api, type SlideImageVersion } from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { Textarea } from "./Textarea";

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

export function SlideVersionsDialog({
  open,
  projectId,
  slideId,
  slideTitle,
  onClose,
}: {
  open: boolean;
  projectId: string;
  slideId: string;
  slideTitle: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const versionsQuery = useQuery({
    queryKey: ["slideImages", projectId, slideId],
    queryFn: () => api.listSlideImages(projectId, slideId),
    enabled: open,
  });

  const versions = useMemo(() => versionsQuery.data?.versions ?? [], [versionsQuery.data?.versions]);

  const activeVersion = useMemo(() => {
    if (selectedVersion != null && versions.some((v) => v.version === selectedVersion)) return selectedVersion;
    return versions[0]?.version ?? null;
  }, [selectedVersion, versions]);

  const active = useMemo(() => {
    if (activeVersion == null) return null;
    return versions.find((v) => v.version === activeVersion) ?? null;
  }, [versions, activeVersion]);

  const restoreMutation = useMutation({
    mutationFn: async (version: number) => {
      return await api.restoreSlideImage(projectId, slideId, version);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["slideImages", projectId, slideId] });
      await queryClient.invalidateQueries({ queryKey: ["projectState", projectId] });
      onClose();
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border/70 bg-panel shadow-soft">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 text-muted" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">版本管理</div>
              <div className="truncate text-xs text-muted">{slideTitle}</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid flex-1 min-h-0 gap-3 overflow-hidden p-4 md:grid-cols-[260px_1fr]">
          <div className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-panel2/40">
            <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
              <div className="text-xs font-semibold tracking-wide text-muted">版本</div>
              <div className="text-xs text-muted">{versions.length}</div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-2">
              {versionsQuery.isLoading ? (
                <div className="rounded-md border border-border/70 bg-panel/40 p-3 text-sm text-muted">加载中…</div>
              ) : versionsQuery.isError ? (
                <div className="rounded-md border border-border/70 bg-panel/40 p-3 text-sm text-accent2">{(versionsQuery.error as Error).message}</div>
              ) : versions.length === 0 ? (
                <div className="rounded-md border border-border/70 bg-panel/40 p-3 text-sm text-muted">还没有生成图片版本。</div>
              ) : (
                <div className="space-y-2">
                  {versions.map((v: SlideImageVersion) => {
                    const activeRow = v.version === activeVersion;
                    return (
                      <button
                        key={v.version}
                        onClick={() => setSelectedVersion(v.version)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm",
                          activeRow ? "border-accent/60 bg-panel/60" : "border-border/70 bg-panel/40 hover:bg-panel/60",
                          "focus:outline-none focus:ring-2 focus:ring-accent/70",
                        )}
                      >
                        <div className="w-16 shrink-0">
                          <div className="aspect-video overflow-hidden rounded-md border border-border/70 bg-black/20">
                            <img src={v.imageUrl} alt={`版本 ${v.version}`} className="h-full w-full object-cover" loading="lazy" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate font-medium">版本 {v.version}</div>
                            <div className="shrink-0 text-[10px] text-muted">{new Date(v.createdAt).toLocaleString()}</div>
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">{v.promptText}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-panel2/40">
            <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
              <div className="text-xs font-semibold tracking-wide text-muted">预览</div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => active && void openUrl(active.imageUrl)}
                  disabled={!active}
                >
                  打开
                </Button>
                <Button
                  size="sm"
                  onClick={() => active && restoreMutation.mutate(active.version)}
                  disabled={!active || restoreMutation.isPending}
                >
                  {restoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  恢复为当前
                </Button>
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-3 p-3 min-h-0">
              {active ? (
                <>
                  <div className="flex flex-[7] min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-panel/40">
                    <div className="flex-1 bg-black/30">
                      <img src={active.imageUrl} alt={`版本 ${active.version}`} className="h-full w-full object-contain" loading="lazy" />
                    </div>
                    <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-xs text-muted">
                      <div className="truncate">
                        版本 {active.version} · {new Date(active.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <Textarea value={active.promptText} readOnly className="flex-[3] min-h-0 font-mono text-[12px] leading-5" />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-border/70 bg-panel/40 p-6 text-sm text-muted">
                  请选择一个版本。
                </div>
              )}

              {restoreMutation.isError ? (
                <div className="rounded-lg border border-border/70 bg-panel/40 p-3 text-sm text-accent2">{(restoreMutation.error as Error).message}</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-border/70 px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
