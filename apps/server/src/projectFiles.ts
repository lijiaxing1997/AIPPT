import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const ProjectJsonSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  dbFile: z.literal("aippt.sqlite"),
});

export type ProjectJson = z.infer<typeof ProjectJsonSchema>;

export async function readProjectJson(projectRootPath: string): Promise<ProjectJson> {
  const projectJsonPath = path.join(projectRootPath, "project.json");
  const raw = await fs.readFile(projectJsonPath, "utf-8");
  const parsed = ProjectJsonSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new Error("project.json 无效");
  }
  return parsed.data;
}

export async function writeProjectJson(projectRootPath: string, data: ProjectJson): Promise<void> {
  const projectJsonPath = path.join(projectRootPath, "project.json");
  await fs.writeFile(projectJsonPath, JSON.stringify(data, null, 2), "utf-8");
}

export async function isValidProjectDir(projectRootPath: string): Promise<boolean> {
  try {
    await readProjectJson(projectRootPath);
    return true;
  } catch {
    return false;
  }
}
