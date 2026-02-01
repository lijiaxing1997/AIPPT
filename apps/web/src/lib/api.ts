import type {
  ApiErrorResponse,
  AppBootResponse,
  CreateProjectRequest,
  OpenProjectRequest,
  ProjectConfigResponse,
  ProjectSummary,
  UpdateProjectConfigRequest,
} from "@aippt/shared";

export type AppConfigResponse = {
  openai: { baseURL: string; model: string; hasApiKey: boolean };
  image: { baseURL: string; aspectRatio: string; imageSize: string; timeoutSec: number; cacheEnabled: boolean; hasApiKey: boolean };
  proxy: { enabled: boolean; host: string; port: number };
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  const inputHeaders = init?.headers;

  if (Array.isArray(inputHeaders)) {
    for (const [k, v] of inputHeaders) headers[k] = v;
  } else if (inputHeaders instanceof Headers) {
    inputHeaders.forEach((v, k) => {
      headers[k] = v;
    });
  } else if (inputHeaders) {
    Object.assign(headers, inputHeaders);
  }

  const hasBody = init?.body != null;
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
  if (hasBody && !hasContentType) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    ...init,
    headers,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? ((await res.json()) as unknown) : await res.text();

  if (!res.ok) {
    const err = body as ApiErrorResponse;
    throw new Error(err?.error || `Request failed: ${res.status}`);
  }

  return body as T;
}

export const api = {
  boot(): Promise<AppBootResponse> {
    return apiFetch<AppBootResponse>("/api/app/boot");
  },
  createProject(input: CreateProjectRequest): Promise<ProjectSummary> {
    return apiFetch<ProjectSummary>("/api/projects", { method: "POST", body: JSON.stringify(input) });
  },
  openProject(input: OpenProjectRequest): Promise<ProjectSummary> {
    return apiFetch<ProjectSummary>("/api/projects/open", { method: "POST", body: JSON.stringify(input) });
  },
  getProjectConfig(projectId: string): Promise<ProjectConfigResponse> {
    return apiFetch<ProjectConfigResponse>(`/api/projects/${projectId}/config`);
  },
  updateProjectConfig(projectId: string, patch: UpdateProjectConfigRequest): Promise<ProjectConfigResponse> {
    return apiFetch<ProjectConfigResponse>(`/api/projects/${projectId}/config`, { method: "PUT", body: JSON.stringify(patch) });
  },
  getConfig(): Promise<AppConfigResponse> {
    return apiFetch<AppConfigResponse>("/api/config");
  },
  updateConfig(patch: {
    openai?: { baseURL?: string; model?: string; apiKey?: string };
    image?: { baseURL?: string; aspectRatio?: string; imageSize?: string; timeoutSec?: number; cacheEnabled?: boolean; apiKey?: string };
    proxy?: { enabled?: boolean; host?: string; port?: number };
  }): Promise<AppConfigResponse> {
    return apiFetch<AppConfigResponse>("/api/config", { method: "PUT", body: JSON.stringify(patch) });
  },
  getProjectState(projectId: string): Promise<ProjectStateResponse> {
    return apiFetch<ProjectStateResponse>(`/api/projects/${projectId}/state`);
  },
  generateProject(projectId: string): Promise<{ jobId: string; status: string }> {
    return apiFetch<{ jobId: string; status: string }>(`/api/projects/${projectId}/generate`, { method: "POST", body: "{}" });
  },
  generateStyle(projectId: string): Promise<{ jobId: string; status: string }> {
    return apiFetch<{ jobId: string; status: string }>(`/api/projects/${projectId}/generate/style`, { method: "POST", body: "{}" });
  },
  generateOutline(projectId: string): Promise<{ jobId: string; status: string }> {
    return apiFetch<{ jobId: string; status: string }>(`/api/projects/${projectId}/generate/outline`, { method: "POST", body: "{}" });
  },
  generateContent(projectId: string): Promise<{ jobId: string; status: string }> {
    return apiFetch<{ jobId: string; status: string }>(`/api/projects/${projectId}/generate/content`, { method: "POST", body: "{}" });
  },
  generateImages(projectId: string): Promise<{ jobId: string; status: string }> {
    return apiFetch<{ jobId: string; status: string }>(`/api/projects/${projectId}/generate/images`, { method: "POST", body: "{}" });
  },
  saveTheme(projectId: string, theme: Theme): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/api/projects/${projectId}/theme`, { method: "PUT", body: JSON.stringify(theme) });
  },
  saveOutline(projectId: string, outline: Outline): Promise<{ ok: true; slideCount: number }> {
    return apiFetch<{ ok: true; slideCount: number }>(`/api/projects/${projectId}/outline`, { method: "PUT", body: JSON.stringify(outline) });
  },
  saveSlideContent(projectId: string, slideId: string, content: SlideContent): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/api/projects/${projectId}/slides/${slideId}/content`, { method: "PUT", body: JSON.stringify(content) });
  },
  getJob(jobId: string): Promise<JobResponse> {
    return apiFetch<JobResponse>(`/api/jobs/${jobId}`);
  },
  getSlide(projectId: string, slideId: string): Promise<SlideDetailsResponse> {
    return apiFetch<SlideDetailsResponse>(`/api/projects/${projectId}/slides/${slideId}`);
  },
  deleteSlide(projectId: string, slideId: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/api/projects/${projectId}/slides/${slideId}`, { method: "DELETE" });
  },
  regenerateSlideImage(projectId: string, slideId: string, promptText?: string): Promise<{ version: number; promptText: string; imagePath: string; imageUrl: string }> {
    return apiFetch<{ version: number; promptText: string; imagePath: string; imageUrl: string }>(
      `/api/projects/${projectId}/slides/${slideId}/image/generate`,
      { method: "POST", body: JSON.stringify({ promptText }) },
    );
  },
  listSlideImages(projectId: string, slideId: string): Promise<{ versions: SlideImageVersion[] }> {
    return apiFetch<{ versions: SlideImageVersion[] }>(`/api/projects/${projectId}/slides/${slideId}/images`);
  },
  restoreSlideImage(projectId: string, slideId: string, version: number): Promise<{ version: number; promptText: string; imagePath: string; imageUrl: string }> {
    return apiFetch<{ version: number; promptText: string; imagePath: string; imageUrl: string }>(
      `/api/projects/${projectId}/slides/${slideId}/image/restore`,
      { method: "POST", body: JSON.stringify({ version }) },
    );
  },
  exportProject(projectId: string, type: ExportType): Promise<ExportItem> {
    return apiFetch<ExportItem>(`/api/projects/${projectId}/export`, { method: "POST", body: JSON.stringify({ type }) });
  },
  listExports(projectId: string): Promise<{ exports: ExportItem[] }> {
    return apiFetch<{ exports: ExportItem[] }>(`/api/projects/${projectId}/exports`);
  },
};

export type ExportType = "pdf" | "pptx";

export type ExportItem = {
  type: ExportType;
  fileName: string;
  relPath: string;
  absPath: string;
  createdAt: string;
  sizeBytes: number;
  fileUrl: string;
};

export type SlideImageVersion = {
  version: number;
  promptText: string;
  imagePath: string;
  imageUrl: string;
  createdAt: string;
};

export type SlideListItem = {
  id: string;
  sectionIndex: number;
  slideIndex: number;
  title: string;
  summary: string;
  status: string;
  errorMessage: string | null;
  updatedAt: string;
  imageVersion: number | null;
  imagePath: string | null;
  promptText: string | null;
  imageUrl: string | null;
};

export type ProjectStateResponse = {
  project: ProjectSummary;
  outline: Outline | null;
  theme: Theme | null;
  slides: SlideListItem[];
};

export type JobResponse = {
  id: string;
  type: "generate";
  projectId: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  progress: null | {
    step: string;
    totalSlides: number;
    completedSlides: number;
    failedSlides: number;
  };
  error: string | null;
};

export type SlideDetailsResponse = {
  id: string;
  sectionIndex: number;
  slideIndex: number;
  title: string;
  summary: string;
  status: string;
  errorMessage: string | null;
  content: SlideContent | null;
  latestImage: null | { version: number; promptText: string; imagePath: string; imageUrl: string };
};

export type Theme = { styleName: string; stylePrompt: string };

export type Outline = {
  sections: Array<{
    title: string;
    slides: Array<{
      title: string;
      summary: string;
    }>;
  }>;
};

export type SlideContent = {
  bullets: string[];
  speakerNotes: string;
  imageDescription: string;
};
