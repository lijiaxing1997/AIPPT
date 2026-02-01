import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus } from "lucide-react";

import type { AppBootResponse, ProjectSummary } from "@aippt/shared";

import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";

export function WelcomeScreen({
  boot,
  startupError,
  onOpenProject,
  onOpenSettings,
}: {
  boot: AppBootResponse;
  startupError?: string | null;
  onOpenProject: (project: ProjectSummary) => void;
  onOpenSettings: () => void;
}) {
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [openPath, setOpenPath] = useState("");
  const canPickFolder = typeof window !== "undefined" && typeof window.aippt?.selectProjectFolder === "function";

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
      onOpenProject(project);
    },
  });

  const openMutation = useMutation({
    mutationFn: api.openProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
      onOpenProject(project);
    },
  });

  const createEnabled = useMemo(() => name.trim().length > 0 && sourceText.trim().length > 0 && !createMutation.isPending, [name, sourceText, createMutation.isPending]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-2xl font-semibold tracking-tight">兴河PPT</div>
            <div className="mt-3 text-xs text-muted">
              默认项目目录：<span className="font-mono text-[11px] text-text/90">{boot.defaultProjectsDir}</span>
            </div>
            {startupError ? (
              <div className="mt-4 max-w-2xl rounded-lg border border-accent2/30 bg-accent2/10 px-3 py-2 text-xs text-accent2">
                无法打开上次项目：{startupError}
              </div>
            ) : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            设置
          </Button>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-border/70 bg-panel/60 shadow-soft">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="text-sm font-semibold">最近项目</div>
              <div className="mt-1 text-xs text-muted">点击打开；也可以粘贴项目路径打开。</div>
            </div>
            <div className="p-2">
              {boot.recentProjects.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted">暂无最近项目。</div>
              ) : (
                <div className="space-y-1">
                  {boot.recentProjects.slice(0, 5).map((p) => (
                    <button
                      key={p.id}
                      className={cn(
                        "group flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left",
                        "hover:border-border/70 hover:bg-panel2/50",
                        "focus:outline-none focus:ring-2 focus:ring-accent/70",
                      )}
                      onClick={() => openMutation.mutate({ projectRootPath: p.rootPath })}
                      disabled={openMutation.isPending}
                    >
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-panel2/60">
                        <FolderOpen className="h-4 w-4 text-muted" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.name}</div>
                        <div className="truncate font-mono text-[11px] text-muted">{p.rootPath}</div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted">{new Date(p.lastOpenedAt).toLocaleString()}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-border/70 p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={openPath}
                  onChange={(e) => setOpenPath(e.target.value)}
                  placeholder="粘贴项目文件夹路径，例如 /Users/.../MyProject"
                  className="min-w-0 flex-1"
                />
                {canPickFolder ? (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      const selected = await window.aippt?.selectProjectFolder?.();
                      if (!selected) return;
                      setOpenPath(selected);
                      openMutation.mutate({ projectRootPath: selected });
                    }}
                    disabled={openMutation.isPending}
                    className="shrink-0 whitespace-nowrap"
                  >
                    <FolderOpen className="h-4 w-4" />
                    选择
                  </Button>
                ) : null}
                <Button
                  onClick={() => openMutation.mutate({ projectRootPath: openPath })}
                  disabled={openMutation.isPending || openPath.trim().length === 0}
                  className="shrink-0 whitespace-nowrap"
                >
                  打开
                </Button>
              </div>
              {openMutation.isError ? <div className="mt-2 text-xs text-accent2">{(openMutation.error as Error).message}</div> : null}
            </div>
          </section>

          <section className="rounded-xl border border-border/70 bg-panel/60 shadow-soft">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="text-sm font-semibold">创建新项目</div>
              <div className="mt-1 text-xs text-muted">输入项目名称与创作内容，创建后可进入工作区。</div>
            </div>
            <div className="space-y-3 p-4">
              <label className="block space-y-1">
                <div className="text-xs text-muted">项目名称</div>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：AI 编程带来的变革" />
              </label>
              <label className="block space-y-1">
                <div className="text-xs text-muted">PPT 创作内容</div>
                <Textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="描述你希望 PPT 表达的主题、受众、风格、要点…"
                  className="h-56 font-mono text-[12px] leading-5"
                />
              </label>
              {createMutation.isError ? <div className="text-xs text-accent2">{(createMutation.error as Error).message}</div> : null}
              <div className="flex items-center justify-end">
                <Button onClick={() => createMutation.mutate({ name, sourceText })} disabled={!createEnabled}>
                  <Plus className="h-4 w-4" />
                  创建项目
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
