export type ProjectId = string;

export type ProjectSummary = {
  id: ProjectId;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

export type RecentProject = {
  id: ProjectId;
  name: string;
  rootPath: string;
  lastOpenedAt: string;
};

export type AppBootResponse = {
  defaultProjectsDir: string;
  lastProject: ProjectSummary | null;
  recentProjects: RecentProject[];
};

export type CreateProjectRequest = {
  name: string;
  sourceText: string;
  rootDir?: string;
};

export type OpenProjectRequest = {
  projectRootPath: string;
};

export type ProjectConfigResponse = {
  project: ProjectSummary;
  sourceText: string;
};

export type UpdateProjectConfigRequest = {
  name?: string;
  sourceText?: string;
};

export type ApiErrorResponse = {
  error: string;
  details?: unknown;
};
