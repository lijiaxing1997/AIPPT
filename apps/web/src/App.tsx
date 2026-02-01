import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ProjectSummary } from "@aippt/shared";

import { api } from "./lib/api";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExportDialog } from "./components/ExportDialog";
import { AppTitle, ProjectActions, ToolbarActions, TopBar } from "./components/TopBar";
import { WindowControls } from "./components/WindowControls";
import { ProjectLauncherDialog } from "./components/ProjectLauncherDialog";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { Workspace } from "./components/Workspace";

export default function App() {
  const queryClient = useQueryClient();
  const bootQuery = useQuery({ queryKey: ["boot"], queryFn: api.boot });
  const configQuery = useQuery({ queryKey: ["config"], queryFn: api.getConfig });
  const [currentProject, setCurrentProject] = useState<ProjectSummary | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [makeOpen, setMakeOpen] = useState(false);
  const [autoOpenError, setAutoOpenError] = useState<string | null>(null);
  const autoOpenAttemptedRef = useRef(false);

  function setActiveProject(project: ProjectSummary | null) {
    setCurrentProject(project);
    setJobId(null);
    setExportOpen(false);
    setMakeOpen(false);
    if (project) setAutoOpenError(null);
  }

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === "queued" || status === "running") return 1000;
      return false;
    },
  });

  useEffect(() => {
    if (!currentProject) return;
    const status = jobQuery.data?.status;
    if (status !== "completed" && status !== "failed") return;
    void queryClient.invalidateQueries({ queryKey: ["projectState", currentProject.id] });
  }, [jobQuery.data?.status, currentProject, queryClient]);

  const restoreLastProjectMutation = useMutation({
    mutationFn: async (projectRootPath: string) => {
      return await api.openProject({ projectRootPath });
    },
    onSuccess: async (project) => {
      setActiveProject(project);
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
    },
    onError: (err) => {
      setAutoOpenError(err instanceof Error ? err.message : String(err));
    },
  });

  useEffect(() => {
    if (!bootQuery.data) return;
    if (autoOpenAttemptedRef.current) return;
    autoOpenAttemptedRef.current = true;
    if (!bootQuery.data.lastProject) return;
    restoreLastProjectMutation.mutate(bootQuery.data.lastProject.rootPath);
  }, [bootQuery.data, restoreLastProjectMutation]);

  if (bootQuery.isLoading) {
    return <div className="min-h-screen bg-bg text-text" />;
  }

  if (bootQuery.isError || !bootQuery.data) {
    return (
      <div className="min-h-screen bg-bg px-6 py-10 text-text">
        <div className="mx-auto max-w-3xl rounded-xl border border-border/70 bg-panel/60 p-6">
          <div className="text-sm font-semibold">启动失败</div>
          <div className="mt-2 text-sm text-muted">{(bootQuery.error as Error).message}</div>
        </div>
      </div>
    );
  }

  const restoringLastProject =
    Boolean(bootQuery.data.lastProject) &&
    !currentProject &&
    restoreLastProjectMutation.isPending;
  if (restoringLastProject) {
    return (
      <div className="min-h-screen bg-bg px-6 py-10 text-text">
        <div className="mx-auto max-w-3xl rounded-xl border border-border/70 bg-panel/60 p-6">
          <div className="text-sm font-semibold">正在打开上次项目…</div>
          {bootQuery.data.lastProject?.name ? <div className="mt-2 text-sm text-muted">{bootQuery.data.lastProject.name}</div> : null}
        </div>
      </div>
    );
  }

  const canGenerate = Boolean(configQuery.data?.openai.hasApiKey && configQuery.data?.image.hasApiKey);
  const generating = Boolean(jobQuery.data?.status === "queued" || jobQuery.data?.status === "running");
  const progressText = jobQuery.data?.progress?.totalSlides
    ? `${jobQuery.data.progress.completedSlides}/${jobQuery.data.progress.totalSlides} · err ${jobQuery.data.progress.failedSlides}`
    : jobQuery.data?.status === "failed"
      ? jobQuery.data.error
      : null;

  return (
    <div className="min-h-screen bg-bg text-text">
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {currentProject ? (
        <>
          <ProjectLauncherDialog
            open={projectsOpen}
            boot={bootQuery.data}
            currentProject={currentProject}
            onClose={() => setProjectsOpen(false)}
            onOpenProject={(p) => setActiveProject(p)}
            onUpdateCurrentProject={(p) => setCurrentProject(p)}
          />
          <ExportDialog open={exportOpen} project={currentProject} onClose={() => setExportOpen(false)} />
          <TopBar
            left={
              <AppTitle
                projectName={currentProject.name}
                projectPath={currentProject.rootPath}
                actions={
                  <ProjectActions
                    onOpenProjects={() => setProjectsOpen(true)}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                }
              />
            }
            right={
              <>
                <ToolbarActions
                  onGenerate={() => {
                    if (!canGenerate) {
                      setSettingsOpen(true);
                      return;
                    }
                    setMakeOpen(true);
                  }}
                  onExport={() => setExportOpen(true)}
                  generating={generating}
                  canGenerate={canGenerate}
                  exporting={false}
                  canExport={true}
                  progressText={progressText}
                />
                <WindowControls className="ml-2" />
              </>
            }
          />
          <Workspace
            project={currentProject}
            jobStatus={jobQuery.data?.status ?? null}
            jobProgress={jobQuery.data?.progress ?? null}
            makeOpen={makeOpen}
            onCloseMake={() => setMakeOpen(false)}
            onStartJob={(id) => setJobId(id)}
          />
        </>
      ) : (
        <WelcomeScreen
          boot={bootQuery.data}
          startupError={autoOpenError}
          onOpenProject={(p) => setActiveProject(p)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
    </div>
  );
}
