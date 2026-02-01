import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, X } from "lucide-react";

import type { AppBootResponse, ProjectSummary } from "@aippt/shared";

import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";

export function ProjectLauncherDialog({
  open,
  boot,
  currentProject,
  onClose,
  onOpenProject,
  onUpdateCurrentProject,
}: {
  open: boolean;
  boot: AppBootResponse;
  currentProject: ProjectSummary;
  onClose: () => void;
  onOpenProject: (project: ProjectSummary) => void;
  onUpdateCurrentProject: (project: ProjectSummary) => void;
}) {
  const queryClient = useQueryClient();

  const [rightTab, setRightTab] = useState<"create" | "current">("create");
  const [name, setName] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [openPath, setOpenPath] = useState("");
  const [currentDraft, setCurrentDraft] = useState<null | { name: string; sourceText: string }>(null);
  const canPickFolder = typeof window !== "undefined" && typeof window.aippt?.selectProjectFolder === "function";

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
      onOpenProject(project);
      setRightTab("create");
      setCurrentDraft(null);
      onClose();
    },
  });

  const openMutation = useMutation({
    mutationFn: api.openProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
      onOpenProject(project);
      setRightTab("create");
      setCurrentDraft(null);
      onClose();
    },
  });

  const currentConfigQuery = useQuery({
    queryKey: ["projectConfig", currentProject.id],
    queryFn: () => api.getProjectConfig(currentProject.id),
    enabled: open && rightTab === "current",
  });

  const currentNameValue = currentDraft?.name ?? currentConfigQuery.data?.project.name ?? "";
  const currentSourceTextValue = currentDraft?.sourceText ?? currentConfigQuery.data?.sourceText ?? "";

  const updateConfigMutation = useMutation({
    mutationFn: async () => {
      return await api.updateProjectConfig(currentProject.id, { name: currentNameValue, sourceText: currentSourceTextValue });
    },
    onSuccess: async (updated) => {
      onUpdateCurrentProject(updated.project);
      setCurrentDraft(null);
      queryClient.setQueryData(["projectConfig", currentProject.id], updated);
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
      await queryClient.invalidateQueries({ queryKey: ["projectState", currentProject.id] });
      await queryClient.invalidateQueries({ queryKey: ["projectConfig", currentProject.id] });
    },
  });

  const createEnabled = useMemo(
    () => name.trim().length > 0 && sourceText.trim().length > 0 && !createMutation.isPending,
    [name, sourceText, createMutation.isPending],
  );

  const updateEnabled = useMemo(
    () =>
      currentNameValue.trim().length > 0 &&
      currentSourceTextValue.trim().length > 0 &&
      !updateConfigMutation.isPending &&
      !currentConfigQuery.isFetching,
    [currentNameValue, currentSourceTextValue, updateConfigMutation.isPending, currentConfigQuery.isFetching],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-border/70 bg-panel shadow-soft">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-sm font-semibold">项目</div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRightTab("create");
                setCurrentDraft(null);
                onClose();
              }}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="border-b border-border/70 px-4 py-2 text-xs text-muted">
          默认项目目录：<span className="font-mono text-[11px] text-text/90">{boot.defaultProjectsDir}</span>
        </div>

        <div className="grid gap-6 p-4 md:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-border/70 bg-panel/40 shadow-soft">
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

          <section className="overflow-hidden rounded-xl border border-border/70 bg-panel/40 shadow-soft">
            <div className="border-b border-border/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex rounded-lg border border-border/70 bg-panel2/40 p-1">
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-accent/70",
                      rightTab === "create" ? "bg-panel2/80 text-text shadow-soft" : "text-muted hover:bg-panel2/60 hover:text-text",
                    )}
                    onClick={() => setRightTab("create")}
                  >
                    创建新项目
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-accent/70",
                      rightTab === "current" ? "bg-panel2/80 text-text shadow-soft" : "text-muted hover:bg-panel2/60 hover:text-text",
                    )}
                    onClick={() => setRightTab("current")}
                  >
                    当前项目配置
                  </button>
                </div>
                <div className="max-w-[16rem] truncate text-xs text-muted">{currentProject.name}</div>
              </div>
              <div className="mt-2 text-xs text-muted">
                {rightTab === "create"
                  ? "输入项目名称与创作内容，创建后可进入工作区。"
                  : "修改项目名称与创作内容，会影响后续生成的内容。"}
              </div>
            </div>
            {rightTab === "create" ? (
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
            ) : (
              <div className="space-y-3 p-4">
                <div className="rounded-lg border border-border/70 bg-panel2/40 px-3 py-2 text-xs text-muted">
                  当前项目路径：<span className="font-mono text-[11px] text-text/90">{currentProject.rootPath}</span>
                </div>

                {currentConfigQuery.isLoading ? (
                  <div className="px-1 py-6 text-sm text-muted">正在加载当前项目配置…</div>
                ) : currentConfigQuery.isError ? (
                  <div className="text-xs text-accent2">{(currentConfigQuery.error as Error).message}</div>
                ) : (
                  <>
                    <label className="block space-y-1">
                      <div className="text-xs text-muted">项目名称</div>
                      <Input
                        value={currentNameValue}
                        onChange={(e) => setCurrentDraft({ name: e.target.value, sourceText: currentSourceTextValue })}
                        placeholder="例如：AI 编程带来的变革"
                      />
                    </label>
                    <label className="block space-y-1">
                      <div className="text-xs text-muted">PPT 创作内容</div>
                      <Textarea
                        value={currentSourceTextValue}
                        onChange={(e) => setCurrentDraft({ name: currentNameValue, sourceText: e.target.value })}
                        placeholder="描述你希望 PPT 表达的主题、受众、风格、要点…"
                        className="h-56 font-mono text-[12px] leading-5"
                      />
                    </label>
                    {updateConfigMutation.isError ? (
                      <div className="text-xs text-accent2">{(updateConfigMutation.error as Error).message}</div>
                    ) : updateConfigMutation.isSuccess ? (
                      <div className="text-xs text-accent">已保存</div>
                    ) : null}
                    <div className="flex items-center justify-end">
                      <Button onClick={() => updateConfigMutation.mutate()} disabled={!updateEnabled}>
                        保存配置
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
