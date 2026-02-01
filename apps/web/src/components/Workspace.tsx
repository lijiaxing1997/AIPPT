import { useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, History, Image, ListTree, Loader2, RefreshCcw } from "lucide-react";

import type { ProjectSummary } from "@aippt/shared";

import { api, type Outline } from "../lib/api";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { Input } from "./Input";
import { PanelHeader } from "./PanelHeader";
import { ResizeHandle } from "./ResizeHandle";
import { SlideVersionsDialog } from "./SlideVersionsDialog";
import { Textarea } from "./Textarea";

export function Workspace({
  project,
  jobStatus,
  jobProgress,
  makeOpen,
  onCloseMake,
  onStartJob,
}: {
  project: ProjectSummary;
  jobStatus: "queued" | "running" | "completed" | "failed" | null;
  jobProgress: null | { step: string; totalSlides: number; completedSlides: number; failedSlides: number };
  makeOpen: boolean;
  onCloseMake: () => void;
  onStartJob: (jobId: string) => void;
}) {
  const queryClient = useQueryClient();

  const stateQuery = useQuery({
    queryKey: ["projectState", project.id],
    queryFn: () => api.getProjectState(project.id),
    refetchInterval: jobStatus === "queued" || jobStatus === "running" ? 1200 : false,
  });

  const slides = useMemo(() => stateQuery.data?.slides ?? [], [stateQuery.data?.slides]);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const stepRunning = jobStatus === "queued" || jobStatus === "running";

  const effectiveSelectedSlideId = useMemo(() => {
    if (selectedSlideId && slides.some((s) => s.id === selectedSlideId)) return selectedSlideId;
    return slides[0]?.id ?? null;
  }, [selectedSlideId, slides]);

  const selectedSlide = useMemo(() => {
    if (!effectiveSelectedSlideId) return null;
    return slides.find((s) => s.id === effectiveSelectedSlideId) ?? null;
  }, [slides, effectiveSelectedSlideId]);

  const slideDetailsQuery = useQuery({
    queryKey: ["slide", project.id, selectedSlide?.id ?? null],
    queryFn: () => api.getSlide(project.id, selectedSlide!.id),
    enabled: Boolean(selectedSlide?.id),
    refetchInterval: stepRunning ? 1200 : false,
  });

  const [versionsSlideId, setVersionsSlideId] = useState<string | null>(null);
  const versionsOpen = Boolean(selectedSlide?.id && versionsSlideId === selectedSlide.id);

  const [promptDraftBySlide, setPromptDraftBySlide] = useState<null | { slideId: string; text: string }>(null);
  const promptDraft =
    selectedSlide && promptDraftBySlide?.slideId === selectedSlide.id ? promptDraftBySlide.text : selectedSlide?.promptText ?? "";

  const promptDirty = selectedSlide ? promptDraft.trim() !== (selectedSlide.promptText ?? "").trim() : false;

  const [bottomTab, setBottomTab] = useState<"content" | "prompt">("prompt");

  const [bulletsDraftBySlide, setBulletsDraftBySlide] = useState<null | { slideId: string; text: string }>(null);
  const [speakerNotesDraftBySlide, setSpeakerNotesDraftBySlide] = useState<null | { slideId: string; text: string }>(null);
  const [imageDescriptionDraftBySlide, setImageDescriptionDraftBySlide] = useState<null | { slideId: string; text: string }>(null);

  const content = slideDetailsQuery.data?.content ?? null;

  const bulletsDraft =
    selectedSlide && bulletsDraftBySlide?.slideId === selectedSlide.id ? bulletsDraftBySlide.text : content ? content.bullets.join("\n") : "";
  const speakerNotesDraft =
    selectedSlide && speakerNotesDraftBySlide?.slideId === selectedSlide.id ? speakerNotesDraftBySlide.text : content ? content.speakerNotes : "";
  const imageDescriptionDraft =
    selectedSlide && imageDescriptionDraftBySlide?.slideId === selectedSlide.id
      ? imageDescriptionDraftBySlide.text
      : content
        ? content.imageDescription
        : "";

  const regenerateMutation = useMutation({
    mutationFn: async (vars: { slideId: string; promptText?: string }) => {
      return await api.regenerateSlideImage(project.id, vars.slideId, vars.promptText);
    },
    onSuccess: async (result, vars) => {
      setPromptDraftBySlide({ slideId: vars.slideId, text: result.promptText });
    },
    onSettled: async (_res, _err, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["projectState", project.id] });
      await queryClient.invalidateQueries({ queryKey: ["slide", project.id, vars.slideId] });
    },
  });

  const contentDirty = useMemo(() => {
    const bullets = bulletsDraft
      .split("\n")
      .map((s) => s.trim().replace(/^[-•]\s*/, ""))
      .filter(Boolean);

    const next = { bullets, speakerNotes: speakerNotesDraft.trim(), imageDescription: imageDescriptionDraft.trim() };
    if (!content) return Boolean(next.bullets.length || next.speakerNotes || next.imageDescription);
    return (
      JSON.stringify(next.bullets) !== JSON.stringify(content.bullets) ||
      next.speakerNotes !== content.speakerNotes.trim() ||
      next.imageDescription !== content.imageDescription.trim()
    );
  }, [bulletsDraft, content, imageDescriptionDraft, speakerNotesDraft]);

  const saveContentMutation = useMutation({
    mutationFn: async (vars: { slideId: string; bulletsText: string; speakerNotes: string; imageDescription: string }) => {
      const bullets = vars.bulletsText
        .split("\n")
        .map((s) => s.trim().replace(/^[-•]\s*/, ""))
        .filter(Boolean);
      if (bullets.length < 2) throw new Error("要点至少需要 2 条");
      if (bullets.length > 8) throw new Error("要点最多 8 条");
      const speakerNotes = vars.speakerNotes.trim();
      const imageDescription = vars.imageDescription.trim();
      if (!speakerNotes) throw new Error("讲稿不能为空");
      if (!imageDescription) throw new Error("配图描述不能为空");
      return await api.saveSlideContent(project.id, vars.slideId, { bullets, speakerNotes, imageDescription });
    },
    onSuccess: async (_res, vars) => {
      setBulletsDraftBySlide((prev) => (prev?.slideId === vars.slideId ? null : prev));
      setSpeakerNotesDraftBySlide((prev) => (prev?.slideId === vars.slideId ? null : prev));
      setImageDescriptionDraftBySlide((prev) => (prev?.slideId === vars.slideId ? null : prev));
      await queryClient.invalidateQueries({ queryKey: ["projectState", project.id] });
      await queryClient.invalidateQueries({ queryKey: ["slide", project.id, vars.slideId] });
    },
  });

  const outline = stateQuery.data?.outline;
  const theme = stateQuery.data?.theme;
  const themeStyleName = theme?.styleName ?? null;
  const themeStylePrompt = theme?.stylePrompt ?? null;

  const hasTheme = Boolean(themeStyleName && themeStylePrompt);
  const hasOutline = Boolean(outline?.sections?.length);
  const hasSlides = slides.length > 0;

  const contentReadyCount = useMemo(() => {
    return slides.filter((s) => s.status === "text_ready" || s.status === "generating_image" || s.status === "ready").length;
  }, [slides]);

  const imageReadyCount = useMemo(() => {
    return slides.filter((s) => Boolean(s.imageUrl)).length;
  }, [slides]);

  const allContentReady = hasSlides && contentReadyCount === slides.length;
  const allImagesReady = hasSlides && imageReadyCount === slides.length;

  const suggestedStep = useMemo((): 1 | 2 | 3 | 4 => {
    if (!hasTheme) return 1;
    if (!hasOutline) return 2;
    if (!allContentReady) return 3;
    return 4;
  }, [allContentReady, hasOutline, hasTheme]);

  const [stepOverride, setStepOverride] = useState<null | 1 | 2 | 3 | 4>(null);
  const activeStep = makeOpen ? (stepOverride ?? suggestedStep) : suggestedStep;

  const [passModeByProject, setPassModeByProject] = useState<Record<string, boolean>>({});
  const passMode = passModeByProject[project.id] ?? true;

  const [styleNameDraftByProject, setStyleNameDraftByProject] = useState<null | { projectId: string; value: string }>(null);
  const [stylePromptDraftByProject, setStylePromptDraftByProject] = useState<null | { projectId: string; value: string }>(null);

  const styleNameDraft =
    styleNameDraftByProject?.projectId === project.id ? styleNameDraftByProject.value : themeStyleName ?? "";
  const stylePromptDraft =
    stylePromptDraftByProject?.projectId === project.id ? stylePromptDraftByProject.value : themeStylePrompt ?? "";

  const styleDirty = useMemo(() => {
    return styleNameDraft.trim() !== (themeStyleName ?? "").trim() || stylePromptDraft.trim() !== (themeStylePrompt ?? "").trim();
  }, [styleNameDraft, stylePromptDraft, themeStyleName, themeStylePrompt]);

  const [outlineDraftByProject, setOutlineDraftByProject] = useState<null | { projectId: string; value: Outline }>(null);
  const outlineDraft = outlineDraftByProject?.projectId === project.id ? outlineDraftByProject.value : null;

  const outlineDirty = useMemo(() => {
    if (!outlineDraft) return false;
    return JSON.stringify(outlineDraft) !== JSON.stringify(outline);
  }, [outline, outlineDraft]);

  const generateStyleMutation = useMutation({
    mutationFn: async () => {
      return await api.generateStyle(project.id);
    },
    onSuccess: (res) => onStartJob(res.jobId),
  });

  const generateOutlineMutation = useMutation({
    mutationFn: async () => {
      return await api.generateOutline(project.id);
    },
    onSuccess: (res) => onStartJob(res.jobId),
  });

  const generateContentMutation = useMutation({
    mutationFn: async () => {
      return await api.generateContent(project.id);
    },
    onSuccess: (res) => onStartJob(res.jobId),
  });

  const generateImagesMutation = useMutation({
    mutationFn: async () => {
      return await api.generateImages(project.id);
    },
    onSuccess: (res) => onStartJob(res.jobId),
  });

  const generateAllMutation = useMutation({
    mutationFn: async () => {
      return await api.generateProject(project.id);
    },
    onSuccess: (res) => onStartJob(res.jobId),
  });

  const saveThemeMutation = useMutation({
    mutationFn: async () => {
      const styleName = styleNameDraft.trim();
      const stylePrompt = stylePromptDraft.trim();
      if (!styleName) throw new Error("风格名称不能为空");
      if (!stylePrompt) throw new Error("风格提示词不能为空");
      return await api.saveTheme(project.id, { styleName, stylePrompt });
    },
    onSuccess: async () => {
      setStyleNameDraftByProject((prev) => (prev?.projectId === project.id ? null : prev));
      setStylePromptDraftByProject((prev) => (prev?.projectId === project.id ? null : prev));
      await queryClient.invalidateQueries({ queryKey: ["projectState", project.id] });
    },
  });

  const saveOutlineMutation = useMutation({
    mutationFn: async (nextOutline: Outline) => {
      if (!nextOutline?.sections?.length) throw new Error("大纲为空");
      return await api.saveOutline(project.id, nextOutline);
    },
    onSuccess: async () => {
      setOutlineDraftByProject((prev) => (prev?.projectId === project.id ? null : prev));
      await queryClient.invalidateQueries({ queryKey: ["projectState", project.id] });
    },
  });

  const deleteSlideMutation = useMutation({
    mutationFn: async (slideId: string) => {
      return await api.deleteSlide(project.id, slideId);
    },
    onSuccess: async () => {
      setOutlineMenu(null);
      setOutlineDraftByProject((prev) => (prev?.projectId === project.id ? null : prev));
      await queryClient.invalidateQueries({ queryKey: ["projectState", project.id] });
      await queryClient.invalidateQueries({ queryKey: ["slide", project.id] });
    },
  });

  const editingStyle = makeOpen && activeStep === 1;
  const editingOutline = makeOpen && activeStep === 2;
  const outlineView = editingOutline ? (outlineDraft ?? outline) : outline;

  const [outlineMenu, setOutlineMenu] = useState<null | { slideId: string; x: number; y: number }>(null);

  useEffect(() => {
    if (!outlineMenu) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOutlineMenu(null);
    }

    function onMouseDown() {
      setOutlineMenu(null);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [outlineMenu]);

  return (
    <div className="h-[calc(100vh-2.75rem)]">
      {selectedSlide ? (
        <SlideVersionsDialog
          open={versionsOpen}
          projectId={project.id}
          slideId={selectedSlide.id}
          slideTitle={selectedSlide.title}
          onClose={() => setVersionsSlideId(null)}
        />
      ) : null}
      <PanelGroup direction="horizontal" className="h-full">
        <Panel defaultSize={20} minSize={15} className="bg-panel/40">
          <div className="flex h-full flex-col">
            <PanelHeader title="大纲 / 风格" />
            <div className="flex-1 overflow-auto p-3">
              {makeOpen ? (
                <div className="mb-3 overflow-hidden rounded-xl border border-border/70 bg-panel2/40">
                  <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                    <div className="text-sm font-semibold">开始制作</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setStepOverride(null);
                        onCloseMake();
                      }}
                      aria-label="Close"
                    >
                      ×
                    </Button>
                  </div>

                  <div className="px-3 py-3">
                    <div className="relative">
                      <div className="absolute left-0 right-0 top-4 h-px bg-border/70" />
                      <div className="relative grid grid-cols-4 gap-2">
                        {(
                          [
                            { id: 1, label: "风格", done: hasTheme },
                            { id: 2, label: "大纲", done: hasOutline },
                            { id: 3, label: "内容", done: allContentReady },
                            { id: 4, label: "图片", done: allImagesReady },
                          ] as const
                        ).map((s) => {
                          const locked =
                            (s.id === 2 && (!hasTheme || styleDirty)) ||
                            (s.id === 3 && (!hasTheme || !hasOutline || styleDirty || outlineDirty)) ||
                            (s.id === 4 && (!hasTheme || !hasOutline || !allContentReady || styleDirty || outlineDirty));
                          const active = s.id === activeStep;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => !locked && setStepOverride(s.id)}
                              disabled={locked}
                              className={cn("group flex flex-col items-center gap-1 text-center", locked && "cursor-not-allowed opacity-60")}
                            >
                              <div
                                className={cn(
                                  "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
                                  "bg-panel shadow-soft",
                                  s.done ? "border-emerald-500/35 text-emerald-200" : "border-border/70 text-text",
                                  active && (s.done ? "ring-2 ring-emerald-500/25" : "ring-2 ring-accent/40"),
                                  "group-focus-visible:outline-none group-focus-visible:ring-2 group-focus-visible:ring-accent/70",
                                )}
                              >
                                {s.done ? <Check className="h-4 w-4" /> : s.id}
                              </div>
                              <div className={cn("text-[11px]", active ? "text-text" : "text-muted")}>{s.label}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-start gap-2">
                      <div className="flex shrink-0 flex-nowrap items-center gap-2">
                        {passMode ? (
                          <Button
                            size="sm"
                            className="h-7 shrink-0 whitespace-nowrap px-2 text-xs"
                            onClick={() => {
                              const dirtyNote = styleDirty || outlineDirty ? "（将丢弃未保存修改）" : "";
                              const overwriteNote = hasTheme || hasOutline || hasSlides ? "一键开始会覆盖已生成内容/图片，" : "";
                              const ok = confirm(`一键开始？${overwriteNote}${dirtyNote}`);
                              if (!ok) return;
                              generateAllMutation.mutate();
                            }}
                            disabled={stepRunning || generateAllMutation.isPending}
                          >
                            一键开始
                          </Button>
                        ) : null}
                        {!passMode && activeStep === 1 ? (
                          <Button
                            size="sm"
                            className="h-7 shrink-0 whitespace-nowrap px-2 text-xs"
                            onClick={() => generateStyleMutation.mutate()}
                            disabled={stepRunning || generateStyleMutation.isPending}
                          >
                            生成风格
                          </Button>
                        ) : null}

                        {!passMode && activeStep === 2 ? (
                          <Button
                            size="sm"
                            className="h-7 shrink-0 whitespace-nowrap px-2 text-xs"
                            onClick={() => generateOutlineMutation.mutate()}
                            disabled={!hasTheme || styleDirty || stepRunning || generateOutlineMutation.isPending}
                            title={!hasTheme ? "请先生成并保存风格" : styleDirty ? "请先保存风格修改" : undefined}
                          >
                            生成大纲
                          </Button>
                        ) : null}

                        {!passMode && activeStep === 3 ? (
                          <Button
                            size="sm"
                            className="h-7 shrink-0 whitespace-nowrap px-2 text-xs"
                            onClick={() => generateContentMutation.mutate()}
                            disabled={!hasTheme || !hasOutline || styleDirty || outlineDirty || stepRunning || generateContentMutation.isPending}
                            title={
                              !hasTheme || !hasOutline
                                ? "请先完成风格与大纲"
                                : styleDirty || outlineDirty
                                  ? "请先保存修改"
                                  : undefined
                            }
                          >
                            生成内容
                          </Button>
                        ) : null}

                        {!passMode && activeStep === 4 ? (
                          <Button
                            size="sm"
                            className="h-7 shrink-0 whitespace-nowrap px-2 text-xs"
                            onClick={() => generateImagesMutation.mutate()}
                            disabled={!hasTheme || !hasOutline || !allContentReady || styleDirty || outlineDirty || stepRunning || generateImagesMutation.isPending}
                            title={
                              !hasTheme || !hasOutline || !allContentReady
                                ? "请先完成风格、大纲与内容"
                                : styleDirty || outlineDirty
                                  ? "请先保存修改"
                                  : undefined
                            }
                          >
                            生成图片
                          </Button>
                        ) : null}

                        <div className="text-xs text-muted">通关模式</div>
                        <button
                          type="button"
                          role="switch"
                          aria-label="通关模式"
                          aria-checked={passMode}
                          title={passMode ? "通关模式：开（显示一键开始）" : "通关模式：关（分步执行）"}
                          onClick={() => setPassModeByProject((prev) => ({ ...prev, [project.id]: !passMode }))}
                          disabled={stepRunning}
                          className={cn(
                            "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
                            passMode ? "border-accent/50 bg-accent/30" : "border-border/70 bg-panel2/60",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                            "focus:outline-none focus:ring-2 focus:ring-accent/70",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute left-0.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-text shadow-soft transition-transform",
                              passMode ? "translate-x-4" : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {generateAllMutation.isError ? (
                      <div className="mt-2 text-xs text-accent2">{(generateAllMutation.error as Error).message}</div>
                    ) : null}
                    {generateStyleMutation.isError ? (
                      <div className="mt-2 text-xs text-accent2">{(generateStyleMutation.error as Error).message}</div>
                    ) : null}
                    {generateOutlineMutation.isError ? (
                      <div className="mt-2 text-xs text-accent2">{(generateOutlineMutation.error as Error).message}</div>
                    ) : null}
                    {generateContentMutation.isError ? (
                      <div className="mt-2 text-xs text-accent2">{(generateContentMutation.error as Error).message}</div>
                    ) : null}
                    {generateImagesMutation.isError ? (
                      <div className="mt-2 text-xs text-accent2">{(generateImagesMutation.error as Error).message}</div>
                    ) : null}

                    {(styleDirty && activeStep !== 1) || (outlineDirty && activeStep !== 2) ? (
                      <div className="mt-2 text-xs text-accent2">
                        检测到未保存修改：{styleDirty ? "风格" : null}
                        {styleDirty && outlineDirty ? "、" : null}
                        {outlineDirty ? "大纲" : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {themeStyleName || themeStylePrompt || editingStyle ? (
                <div className="mb-3 rounded-lg border border-border/70 bg-panel2/40 p-3">
                  <div className="text-xs font-semibold tracking-wide text-muted">风格</div>

                  {editingStyle ? (
                    <div className="mt-2 space-y-2">
                      <label className="block space-y-1">
                        <div className="text-xs text-muted">风格名称</div>
                        <Input
                          value={styleNameDraft}
                          onChange={(e) => setStyleNameDraftByProject({ projectId: project.id, value: e.target.value })}
                          placeholder="例如：极简科技风"
                          className="h-8 px-2 text-sm"
                        />
                      </label>
                      <label className="block space-y-1">
                        <div className="text-xs text-muted">风格提示词</div>
                        <Textarea
                          value={stylePromptDraft}
                          onChange={(e) => setStylePromptDraftByProject({ projectId: project.id, value: e.target.value })}
                          placeholder="用于拼接到每页提示词前的全局视觉风格描述"
                          className="h-28 font-mono text-[11px] leading-5"
                        />
                      </label>

                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted">{styleDirty ? "已修改" : "未修改"}</div>
                        <div className="flex items-center gap-2">
                          {saveThemeMutation.isError ? <div className="text-xs text-accent2">{(saveThemeMutation.error as Error).message}</div> : null}
                          <Button size="sm" onClick={() => saveThemeMutation.mutate()} disabled={!styleDirty || stepRunning || saveThemeMutation.isPending}>
                            <Loader2 className={cn("h-4 w-4", saveThemeMutation.isPending && "animate-spin")} />
                            保存风格
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {themeStyleName ? <div className="mt-1 text-sm font-medium">{themeStyleName}</div> : null}
                      {themeStylePrompt ? (
                        <div className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-5 text-muted">
                          {themeStylePrompt}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}

              {outlineView?.sections?.length ? (
                <div className="space-y-3">
                  {outlineView.sections.map((sec, secIdx) => (
                    <div key={secIdx} className="rounded-lg border border-border/70 bg-panel2/40">
                      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
                        <ListTree className="h-4 w-4 text-muted" />
                        {editingOutline ? (
                          <Input
                            value={sec.title}
                            onChange={(e) => {
                              const nextTitle = e.target.value;
                              setOutlineDraftByProject((prev) => {
                                const base = prev?.projectId === project.id ? prev.value : outlineView;
                                if (!base) return prev;
                                const nextSections = base.sections.map((s, idx) => (idx === secIdx ? { ...s, title: nextTitle } : s));
                                return { projectId: project.id, value: { ...base, sections: nextSections } };
                              });
                            }}
                            className="h-8 px-2 text-sm"
                            placeholder="章节标题"
                          />
                        ) : (
                          <div className="truncate text-sm font-semibold">{sec.title}</div>
                        )}
                      </div>

                      <div className="p-2">
                        <div className="space-y-2">
                          {sec.slides.map((sl, idx) => {
                            const match = slides.find((s) => s.sectionIndex === secIdx && s.slideIndex === idx);
                            const active = match?.id === effectiveSelectedSlideId;

                            if (editingOutline) {
                              return (
                                <div
                                  key={idx}
                                  className={cn(
                                    "rounded-md border px-2.5 py-2",
                                    active ? "border-accent/60 bg-panel/60" : "border-border/40 bg-panel/20",
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[11px] text-muted">第 {idx + 1} 页</div>
                                    <button
                                      type="button"
                                      onClick={() => match?.id && setSelectedSlideId(match.id)}
                                      className={cn(
                                        "rounded-md border px-2 py-1 text-[11px] transition-colors",
                                        "border-border/70 bg-panel/40 hover:bg-panel/60",
                                        "focus:outline-none focus:ring-2 focus:ring-accent/70",
                                      )}
                                      disabled={!match?.id}
                                    >
                                      选择
                                    </button>
                                  </div>

                                  <div className="mt-2 space-y-2">
                                    <Input
                                      value={sl.title}
                                      onChange={(e) => {
                                        const nextTitle = e.target.value;
                                        setOutlineDraftByProject((prev) => {
                                          const base = prev?.projectId === project.id ? prev.value : outlineView;
                                          if (!base) return prev;
                                          const nextSections = base.sections.map((s, sIdx) => {
                                            if (sIdx !== secIdx) return s;
                                            const nextSlides = s.slides.map((slide, slideIdx) => (slideIdx === idx ? { ...slide, title: nextTitle } : slide));
                                            return { ...s, slides: nextSlides };
                                          });
                                          return { projectId: project.id, value: { ...base, sections: nextSections } };
                                        });
                                      }}
                                      className="h-8 px-2 text-sm"
                                      placeholder="页面标题"
                                    />
                                    <Textarea
                                      value={sl.summary}
                                      onChange={(e) => {
                                        const nextSummary = e.target.value;
                                        setOutlineDraftByProject((prev) => {
                                          const base = prev?.projectId === project.id ? prev.value : outlineView;
                                          if (!base) return prev;
                                          const nextSections = base.sections.map((s, sIdx) => {
                                            if (sIdx !== secIdx) return s;
                                            const nextSlides = s.slides.map((slide, slideIdx) => (slideIdx === idx ? { ...slide, summary: nextSummary } : slide));
                                            return { ...s, slides: nextSlides };
                                          });
                                          return { projectId: project.id, value: { ...base, sections: nextSections } };
                                        });
                                      }}
                                      className="h-20 text-[11px] leading-5"
                                      placeholder="页面概要"
                                    />
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={idx}
                                className={cn(
                                  "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-sm",
                                  active ? "border-accent/60 bg-panel/60" : "border-transparent hover:border-border/70 hover:bg-panel/40",
                                  "focus:outline-none focus:ring-2 focus:ring-accent/70",
                                )}
                                onClick={() => match?.id && setSelectedSlideId(match.id)}
                                onContextMenu={(e) => {
                                  if (stepRunning) return;
                                  if (!hasOutline || !outline) return;
                                  e.preventDefault();
                                  match?.id && setSelectedSlideId(match.id);
                                  if (!match?.id) return;
                                  setOutlineMenu({ slideId: match.id, x: e.clientX, y: e.clientY });
                                }}
                                onDoubleClick={(e) => {
                                  if (stepRunning) return;
                                  if (!hasOutline || !outline) return;
                                  e.preventDefault();
                                  match?.id && setSelectedSlideId(match.id);
                                  if (!match?.id) return;
                                  setOutlineMenu({ slideId: match.id, x: e.clientX, y: e.clientY });
                                }}
                                disabled={!match?.id}
                              >
                                <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-muted/60" />
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{sl.title}</div>
                                  <div className="line-clamp-2 text-[11px] leading-4 text-muted">{sl.summary}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}

                  {editingOutline ? (
                    <div className="rounded-lg border border-border/70 bg-panel2/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-muted">{outlineDirty ? "已修改（保存会重建页面并清空已生成内容/图片）" : "未修改"}</div>
                        <div className="flex items-center gap-2">
                          {saveOutlineMutation.isError ? <div className="text-xs text-accent2">{(saveOutlineMutation.error as Error).message}</div> : null}
                          <Button
                            size="sm"
                            onClick={() => {
                              if (!outlineDraft) return;
                              saveOutlineMutation.mutate(outlineDraft);
                            }}
                            disabled={!outlineDirty || stepRunning || saveOutlineMutation.isPending}
                          >
                            <Loader2 className={cn("h-4 w-4", saveOutlineMutation.isPending && "animate-spin")} />
                            保存大纲
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border border-border/70 bg-panel2/40 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ListTree className="h-4 w-4 text-muted" />
                    大纲尚未生成
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    点击顶部 <span className="font-medium text-text">开始制作</span> 后，在第一步/第二步生成风格与大纲。
                  </div>
                </div>
              )}
            </div>
          </div>
        </Panel>

        <ResizeHandle direction="horizontal" />

        <Panel defaultSize={60} minSize={35} className="bg-bg">
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={70} minSize={35}>
              <div className="flex h-full flex-col">
                <PanelHeader
                  title="预览"
                  right={
                    selectedSlide ? (
                      <>
                        <div className="text-xs text-muted">
                          {selectedSlide.slideIndex + 1}. {selectedSlide.title}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => selectedSlide && setVersionsSlideId(selectedSlide.id)}
                        >
                          <History className="h-4 w-4" />
                          历史
                        </Button>
                      </>
                    ) : (
                      <div className="text-xs text-muted">{project.name}</div>
                    )
                  }
                />
                <div className="flex flex-1 items-center justify-center p-6">
                  {selectedSlide?.imageUrl ? (
                    <div className="w-full max-w-5xl">
                      <div className="relative w-full overflow-hidden rounded-xl border border-border/70 bg-panel/40 shadow-soft">
                        <div className="aspect-video w-full bg-black/30">
                          <img
                            src={selectedSlide.imageUrl}
                            alt={selectedSlide.title}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        </div>
                        <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-xs text-muted">
                          <div className="truncate">
                            {slideStatusLabel(selectedSlide.status)}
                            {selectedSlide.imageVersion != null ? ` · 版本${selectedSlide.imageVersion}` : ""}
                          </div>
                          {selectedSlide.errorMessage ? (
                            <div className="flex items-center gap-1 text-accent2">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              <span className="truncate">{selectedSlide.errorMessage}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={cn("w-full max-w-4xl rounded-xl border border-border/70 bg-panel/40 p-8")}>
                      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-border/70 bg-panel2/60">
                          <Image className="h-6 w-6 text-muted" />
                        </div>
                        <div className="mt-4 text-lg font-semibold">{slides.length ? "图片尚未就绪" : "暂无预览"}</div>
                        <div className="mt-2 text-sm text-muted">
                          {slides.length
                            ? "生成中或失败时，这里会显示状态；完成后会展示该页图片。"
                            : "点击顶部 开始制作后，会按步骤生成并在这里预览。"}
                        </div>
                        {selectedSlide?.errorMessage ? (
                          <div className="mt-4 rounded-lg border border-border/70 bg-panel2/40 px-3 py-2 text-left text-xs text-accent2">
                            {selectedSlide.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <ResizeHandle direction="vertical" />

            <Panel defaultSize={30} minSize={20} className="bg-panel/30">
              <div className="flex h-full flex-col">
                <PanelHeader
                  title="内容 / 提示词"
                  right={
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-md border border-border/70 bg-panel2/40 p-0.5">
                        <button
                          type="button"
                          onClick={() => setBottomTab("content")}
                          className={cn(
                            "h-7 rounded-md px-2 text-xs transition-colors",
                            bottomTab === "content" ? "bg-panel/70 text-text" : "text-muted hover:text-text",
                            "focus:outline-none focus:ring-2 focus:ring-accent/70",
                          )}
                        >
                          内容
                        </button>
                        <button
                          type="button"
                          onClick={() => setBottomTab("prompt")}
                          className={cn(
                            "h-7 rounded-md px-2 text-xs transition-colors",
                            bottomTab === "prompt" ? "bg-panel/70 text-text" : "text-muted hover:text-text",
                            "focus:outline-none focus:ring-2 focus:ring-accent/70",
                          )}
                        >
                          提示词
                        </button>
                      </div>

                      {bottomTab === "content" ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              selectedSlide &&
                              saveContentMutation.mutate({
                                slideId: selectedSlide.id,
                                bulletsText: bulletsDraft,
                                speakerNotes: speakerNotesDraft,
                                imageDescription: imageDescriptionDraft,
                              })
                            }
                            disabled={!selectedSlide || saveContentMutation.isPending || stepRunning}
                          >
                            <Loader2 className={cn("h-4 w-4", saveContentMutation.isPending && "animate-spin")} />
                            保存内容
                          </Button>

                          {selectedSlide?.status === "text_ready" ? (
                            <Button
                              size="sm"
                              onClick={() => selectedSlide && regenerateMutation.mutate({ slideId: selectedSlide.id })}
                              disabled={
                                !selectedSlide ||
                                stepRunning ||
                                regenerateMutation.isPending ||
                                saveContentMutation.isPending ||
                                contentDirty ||
                                !(selectedSlide.promptText ?? "").trim()
                              }
                              title={
                                !(selectedSlide.promptText ?? "").trim()
                                  ? "缺少提示词（请先生成并保存风格，或检查内容是否已生成）"
                                  : contentDirty
                                    ? "请先保存内容修改"
                                    : undefined
                              }
                            >
                              {regenerateMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Image className="h-4 w-4" />
                              )}
                              生成图片
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() =>
                            selectedSlide &&
                            regenerateMutation.mutate({
                              slideId: selectedSlide.id,
                              promptText: promptDraft.trim() || undefined,
                            })
                          }
                          disabled={!selectedSlide || regenerateMutation.isPending}
                        >
                          <RefreshCcw className={cn("h-4 w-4", regenerateMutation.isPending && "animate-spin")} />
                          重新生成
                        </Button>
                      )}
                    </div>
                  }
                />
                <div className="flex-1 overflow-auto p-3">
                  {bottomTab === "prompt" ? (
                    <Textarea
                      value={promptDraft}
                      onChange={(e) => selectedSlide && setPromptDraftBySlide({ slideId: selectedSlide.id, text: e.target.value })}
                      placeholder="这里会展示当前页图片的提示词。你可以修改后重新生成。"
                      className="h-full font-mono text-[12px] leading-5"
                    />
                  ) : slideDetailsQuery.isLoading ? (
                    <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-muted">加载中…</div>
                  ) : !selectedSlide ? (
                    <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-muted">未选择页面</div>
                  ) : !slideDetailsQuery.data?.content ? (
                    <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-muted">
                      内容尚未生成。请在开始制作第 3 步生成每页内容。
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <label className="block space-y-1">
                        <div className="text-xs font-semibold tracking-wide text-muted">要点（每行一条）</div>
                        <Textarea
                          value={bulletsDraft}
                          onChange={(e) => selectedSlide && setBulletsDraftBySlide({ slideId: selectedSlide.id, text: e.target.value })}
                          placeholder={"- 要点1\n- 要点2"}
                          className="h-28 font-mono text-[12px] leading-5"
                        />
                      </label>

                      <label className="block space-y-1">
                        <div className="text-xs font-semibold tracking-wide text-muted">讲稿</div>
                        <Textarea
                          value={speakerNotesDraft}
                          onChange={(e) => selectedSlide && setSpeakerNotesDraftBySlide({ slideId: selectedSlide.id, text: e.target.value })}
                          placeholder="用于演讲者的讲稿/旁白"
                          className="h-28 text-[12px] leading-5"
                        />
                      </label>

                      <label className="block space-y-1">
                        <div className="text-xs font-semibold tracking-wide text-muted">配图描述</div>
                        <Textarea
                          value={imageDescriptionDraft}
                          onChange={(e) => selectedSlide && setImageDescriptionDraftBySlide({ slideId: selectedSlide.id, text: e.target.value })}
                          placeholder="这页画面/插画/图形设计该怎么表现"
                          className="h-24 text-[12px] leading-5"
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-xs">
                  <div className="min-w-0 text-muted">
                    {selectedSlide ? (
                      <>
                        状态：<span className="text-text">{slideStatusLabel(selectedSlide.status)}</span>
                        {selectedSlide.imageVersion != null ? <span className="text-muted"> · 版本{selectedSlide.imageVersion}</span> : null}
                      </>
                    ) : (
                      "未选择页面"
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {stepRunning ? (
                      <div className="flex min-w-0 items-center gap-1.5 text-muted">
                        <svg
                          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-90"
                            d="M22 12a10 10 0 0 1-10 10"
                            stroke="currentColor"
                            strokeWidth="4"
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="min-w-0 truncate">
                          {jobStatus === "queued" ? "排队中…" : `执行中：${jobStepLabel(jobProgress?.step ?? "")}`}
                          {jobProgress?.totalSlides
                            ? ` · ${jobProgress.completedSlides}/${jobProgress.totalSlides} · err ${jobProgress.failedSlides}`
                            : ""}
                        </div>
                      </div>
                    ) : null}
                    {bottomTab === "content" && saveContentMutation.isError ? (
                      <div className="text-accent2">{(saveContentMutation.error as Error).message}</div>
                    ) : null}
                    {regenerateMutation.isError ? <div className="text-accent2">{(regenerateMutation.error as Error).message}</div> : null}
                    <div className={cn("text-muted", (bottomTab === "prompt" ? promptDirty : contentDirty) && "text-accent")}>
                      {bottomTab === "prompt"
                        ? promptDirty
                          ? "已修改"
                          : "未修改"
                        : contentDirty
                          ? "已修改"
                          : "未修改"}
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <ResizeHandle direction="horizontal" />

        <Panel defaultSize={20} minSize={15} className="bg-panel/40">
          <div className="flex h-full flex-col">
            <PanelHeader title="页面" right={<div className="text-xs text-muted">{slides.length}</div>} />
            <div className="flex-1 overflow-auto p-3">
              {stateQuery.isLoading ? (
                <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-muted">加载中…</div>
              ) : slides.length === 0 ? (
                <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-muted">
                  暂无页面。点击顶部 开始制作后，在第 2 步生成大纲会出现页面列表。
                </div>
              ) : (
                <div className="space-y-2">
                  {slides.map((s) => {
                    const active = s.id === effectiveSelectedSlideId;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSlideId(s.id)}
                        className={cn(
                          "group w-full rounded-lg border px-2 py-2 text-left transition-colors",
                          active ? "border-accent/60 bg-panel/60" : "border-border/70 bg-panel2/40 hover:bg-panel2/60",
                          "focus:outline-none focus:ring-2 focus:ring-accent/70",
                        )}
	                      >
	                        <div className="flex items-start gap-2">
	                          <div className="mt-0.5 w-16 shrink-0">
	                            <div className="aspect-video overflow-hidden rounded-md border border-border/70 bg-black/20">
	                              {s.imageUrl ? (
	                                <img src={s.imageUrl} alt={s.title} className="h-full w-full object-cover" loading="lazy" />
	                              ) : (
	                                <div className="flex h-full w-full items-center justify-center text-[10px] text-muted">
	                                  {s.status === "error" ? "失败" : "…"}
	                                </div>
	                              )}
	                            </div>
	                          </div>
	                          <div className="min-w-0 flex-1">
	                            <div className="flex items-center justify-between gap-2">
	                              <div className="truncate text-sm font-medium">
	                                {s.slideIndex + 1}. {s.title}
	                              </div>
	                              <div className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px]", statusChipClass(s.status))}>
	                                {slideStatusLabel(s.status)}
	                              </div>
	                            </div>
	                            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted">{s.summary}</div>
	                            {s.errorMessage ? <div className="mt-1 line-clamp-1 text-[11px] text-accent2">{s.errorMessage}</div> : null}
	                          </div>
	                        </div>
	                      </button>
	                    );
	                  })}
                </div>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>

      {outlineMenu ? (
        <div className="fixed inset-0 z-50">
          <div
            className="fixed min-w-40 rounded-lg border border-border/70 bg-panel shadow-soft"
            style={{ left: outlineMenu.x, top: outlineMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-accent2 hover:bg-panel2/60"
              onClick={() => {
                if (slides.length <= 1) {
                  alert("至少需要保留 1 页，无法删除最后一页。");
                  return;
                }

                const discardDraft = outlineDirty ? "（将丢弃未保存的大纲修改）" : "";
                const ok = confirm(`删除该页只会删除该页内容/图片，其他页面不受影响${discardDraft}，继续？`);
                if (!ok) return;

                setOutlineMenu(null);
                deleteSlideMutation.mutate(outlineMenu.slideId, {
                  onError: (err) => alert(err instanceof Error ? err.message : String(err)),
                });
              }}
            >
              <span>删除</span>
              <span className="text-xs text-muted">⌫</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function jobStepLabel(step: string): string {
  if (!step) return "任务";
  if (step === "style") return "生成 PPT 风格";
  if (step === "outline") return "生成大纲";
  if (step === "content") return "生成每页内容";
  if (step === "images") return "生成图片";
  if (step === "slides") return "生成页面";
  return step;
}

function statusChipClass(status: string): string {
  if (status === "ready") {
    return [
      "bg-emerald-500/15 text-emerald-200 border border-emerald-500/25",
      "[html[data-theme=light]_&]:bg-emerald-100 [html[data-theme=light]_&]:text-emerald-800 [html[data-theme=light]_&]:border-emerald-300",
    ].join(" ");
  }
  if (status === "error") {
    return [
      "bg-rose-500/15 text-rose-200 border border-rose-500/25",
      "[html[data-theme=light]_&]:bg-rose-100 [html[data-theme=light]_&]:text-rose-800 [html[data-theme=light]_&]:border-rose-300",
    ].join(" ");
  }
  if (status === "generating_image") {
    return [
      "bg-sky-500/15 text-sky-200 border border-sky-500/25",
      "[html[data-theme=light]_&]:bg-sky-100 [html[data-theme=light]_&]:text-sky-800 [html[data-theme=light]_&]:border-sky-300",
    ].join(" ");
  }
  if (status === "generating_text") {
    return [
      "bg-indigo-500/15 text-indigo-200 border border-indigo-500/25",
      "[html[data-theme=light]_&]:bg-indigo-100 [html[data-theme=light]_&]:text-indigo-800 [html[data-theme=light]_&]:border-indigo-300",
    ].join(" ");
  }
  if (status === "text_ready") {
    return [
      "bg-amber-500/15 text-amber-200 border border-amber-500/25",
      "[html[data-theme=light]_&]:bg-amber-100 [html[data-theme=light]_&]:text-amber-900 [html[data-theme=light]_&]:border-amber-300",
    ].join(" ");
  }
  return [
    "bg-slate-500/15 text-slate-200 border border-slate-500/25",
    "[html[data-theme=light]_&]:bg-slate-100 [html[data-theme=light]_&]:text-slate-800 [html[data-theme=light]_&]:border-slate-300",
  ].join(" ");
}

function slideStatusLabel(status: string): string {
  if (status === "pending") return "待生成";
  if (status === "generating_text") return "生成内容中";
  if (status === "text_ready") return "内容就绪";
  if (status === "generating_image") return "生成图片中";
  if (status === "ready") return "已完成";
  if (status === "error") return "失败";
  return status;
}
