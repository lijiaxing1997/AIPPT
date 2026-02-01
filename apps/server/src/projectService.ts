import fs from "node:fs/promises";
import path from "node:path";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { getDefaultProjectsDir } from "./appConfig.js";
import { loadConfig, upsertRecentProject } from "./configStore.js";
import { openProjectDb } from "./projectDb.js";
import { ProjectJsonSchema, readProjectJson, writeProjectJson } from "./projectFiles.js";

const CreateProjectInputSchema = z.object({
  name: z.string().min(1).max(80),
  sourceText: z.string().min(1).max(50_000),
  rootDir: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

const OpenProjectInputSchema = z.object({
  projectRootPath: z.string().min(1),
});

export type OpenProjectInput = z.infer<typeof OpenProjectInputSchema>;

export type ProjectSummary = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeFolderName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "Untitled";
  return trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function makeUniqueDir(parentDir: string, baseName: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const candidate = path.join(parentDir, `${baseName}-${timestamp}`);
  if (!(await pathExists(candidate))) return candidate;
  let i = 2;
  while (true) {
    const next = path.join(parentDir, `${baseName}-${timestamp}-${i}`);
    if (!(await pathExists(next))) return next;
    i += 1;
  }
}

export function parseCreateProjectInput(raw: unknown): CreateProjectInput {
  return CreateProjectInputSchema.parse(raw);
}

export function parseOpenProjectInput(raw: unknown): OpenProjectInput {
  return OpenProjectInputSchema.parse(raw);
}

export async function createProject(input: CreateProjectInput): Promise<ProjectSummary> {
  const baseDir = input.rootDir?.trim() || getDefaultProjectsDir();
  await fs.mkdir(baseDir, { recursive: true });

  const folderBase = sanitizeFolderName(input.name);
  const projectRootPath = await makeUniqueDir(baseDir, folderBase);
  await fs.mkdir(projectRootPath, { recursive: true });
  await fs.mkdir(path.join(projectRootPath, "images"), { recursive: true });
  await fs.mkdir(path.join(projectRootPath, "exports"), { recursive: true });

  const id = randomUUID();
  const createdAt = nowIso();
  const projectJson = ProjectJsonSchema.parse({
    schemaVersion: 1,
    id,
    name: input.name.trim(),
    createdAt,
    updatedAt: createdAt,
    dbFile: "aippt.sqlite",
  });
  await writeProjectJson(projectRootPath, projectJson);

  const db = openProjectDb(projectRootPath);
  db.prepare(
    `INSERT INTO projects (id, name, root_path, source_text, created_at, updated_at)
     VALUES (@id, @name, @root_path, @source_text, @created_at, @updated_at)`,
  ).run({
    id: projectJson.id,
    name: projectJson.name,
    root_path: projectRootPath,
    source_text: input.sourceText,
    created_at: createdAt,
    updated_at: createdAt,
  });
  db.close();

  const summary: ProjectSummary = {
    id: projectJson.id,
    name: projectJson.name,
    rootPath: projectRootPath,
    createdAt,
    updatedAt: createdAt,
  };

  await upsertRecentProject({ ...summary, lastOpenedAt: nowIso() });
  return summary;
}

export async function openProject(input: OpenProjectInput): Promise<ProjectSummary> {
  const projectRootPath = input.projectRootPath.trim();
  const projectJson = await readProjectJson(projectRootPath);
  openProjectDb(projectRootPath).close();

  const summary: ProjectSummary = {
    id: projectJson.id,
    name: projectJson.name,
    rootPath: projectRootPath,
    createdAt: projectJson.createdAt,
    updatedAt: projectJson.updatedAt,
  };

  await upsertRecentProject({ ...summary, lastOpenedAt: nowIso() });
  return summary;
}

export async function getBootState(): Promise<{
  defaultProjectsDir: string;
  lastProject: ProjectSummary | null;
  recentProjects: { id: string; name: string; rootPath: string; lastOpenedAt: string }[];
}> {
  const config = await loadConfig();
  const defaultProjectsDir = getDefaultProjectsDir();
  const recentProjects = config.recentProjects;

  const lastRootPath = config.lastOpenedProjectRootPath;
  if (!lastRootPath) {
    return { defaultProjectsDir, lastProject: null, recentProjects };
  }

  try {
    const projectJson = await readProjectJson(lastRootPath);
    const projectSummary: ProjectSummary = {
      id: projectJson.id,
      name: projectJson.name,
      rootPath: lastRootPath,
      createdAt: projectJson.createdAt,
      updatedAt: projectJson.updatedAt,
    };
    return { defaultProjectsDir, lastProject: projectSummary, recentProjects };
  } catch {
    return { defaultProjectsDir, lastProject: null, recentProjects };
  }
}

