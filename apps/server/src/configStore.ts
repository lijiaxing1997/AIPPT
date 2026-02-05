import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { getConfigDir, getConfigFilePath } from "./appConfig.js";

const IsoDateString = z.string().min(1);

export const RecentProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  lastOpenedAt: IsoDateString,
});

export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const AppConfigSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  openai: z
    .object({
      baseURL: z.string(),
      apiKey: z.string(),
      model: z.string(),
    })
    .default({ baseURL: "https://api.qhaigc.net/v1", apiKey: "", model: "gpt-4.1-mini" }),
  image: z
    .object({
      baseURL: z.string(),
      apiKey: z.string(),
      aspectRatio: z.string(),
      imageSize: z.string(),
      timeoutMs: z.number().int().positive().optional(),
      timeoutSec: z.number().int().positive().optional(),
      cacheEnabled: z.boolean().default(false),
    })
    .default({
      baseURL: "https://api.qhaigc.net/v1beta/models/gemini-3-pro-image-preview:generateContent",
      apiKey: "",
      aspectRatio: "16:9",
      imageSize: "2K",
    }),
  proxy: z
    .object({
      enabled: z.boolean().default(false),
      host: z.string().default(""),
      port: z.number().int().min(0).max(65535).default(0),
    })
    .default({ enabled: false, host: "", port: 0 }),
  recentProjects: z.array(RecentProjectSchema).default([]),
  lastOpenedProjectRootPath: z.string().nullable().default(null),
});

export type AppConfig = Omit<z.infer<typeof AppConfigSchema>, "schemaVersion" | "image"> & {
  schemaVersion: 3;
  image: {
    baseURL: string;
    apiKey: string;
    aspectRatio: string;
    imageSize: string;
    timeoutSec: number;
    cacheEnabled: boolean;
  };
  proxy: {
    enabled: boolean;
    host: string;
    port: number;
  };
};

function normalizeToV3(config: z.infer<typeof AppConfigSchema>): AppConfig {
  const timeoutSecRaw =
    typeof config.image.timeoutSec === "number"
      ? config.image.timeoutSec
      : typeof config.image.timeoutMs === "number"
        ? Math.round(config.image.timeoutMs / 1000)
        : 120;
  const timeoutSec = Number.isFinite(timeoutSecRaw) && timeoutSecRaw > 0 ? Math.floor(timeoutSecRaw) : 120;

  const proxyEnabled = Boolean(config.proxy?.enabled);
  const proxyHost = typeof config.proxy?.host === "string" ? config.proxy.host.trim() : "";
  const proxyPort = Number.isFinite(config.proxy?.port) ? Math.floor(Number(config.proxy.port)) : 0;

  return {
    schemaVersion: 3,
    openai: config.openai,
    image: {
      baseURL: config.image.baseURL,
      apiKey: config.image.apiKey,
      aspectRatio: config.image.aspectRatio,
      imageSize: config.image.imageSize,
      timeoutSec,
      cacheEnabled: config.image.cacheEnabled,
    },
    proxy: {
      enabled: proxyEnabled && proxyHost.length > 0 && proxyPort > 0,
      host: proxyHost,
      port: proxyPort > 0 ? proxyPort : 0,
    },
    recentProjects: config.recentProjects,
    lastOpenedProjectRootPath: config.lastOpenedProjectRootPath,
  };
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function loadConfig(): Promise<AppConfig> {
  const configPath = getConfigFilePath();
  const raw = await readJsonFile(configPath);
  const parsed = AppConfigSchema.safeParse(raw);
  if (parsed.success) {
    const next = normalizeToV3(parsed.data);
    if (raw && (raw as any).schemaVersion === 3 && (raw as any)?.image?.timeoutSec != null && (raw as any)?.proxy != null) return next;
    await writeJsonAtomic(configPath, next);
    return next;
  }

  const freshRaw = AppConfigSchema.parse({ schemaVersion: 3 });
  const fresh = normalizeToV3(freshRaw);
  await writeJsonAtomic(configPath, fresh);
  return fresh;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigFilePath();
  await writeJsonAtomic(configPath, config);
}

export async function upsertRecentProject(project: RecentProject): Promise<void> {
  const config = await loadConfig();
  const next = config.recentProjects.filter((p) => p.id !== project.id);
  next.unshift(project);
  config.recentProjects = next.slice(0, 20);
  config.lastOpenedProjectRootPath = project.rootPath;
  await saveConfig(config);
}

export async function setLastOpenedProjectRootPath(rootPath: string | null): Promise<void> {
  const config = await loadConfig();
  config.lastOpenedProjectRootPath = rootPath;
  await saveConfig(config);
}

export async function ensureConfigDirExists(): Promise<void> {
  await ensureDir(getConfigDir());
}
