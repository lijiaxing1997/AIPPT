import envPaths from "env-paths";
import os from "node:os";
import path from "node:path";

export const APP_NAME = "兴河PPT";

export function getDefaultProjectsDir(): string {
  const override = process.env.AIPPT_PROJECTS_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), "Documents", "兴河PPT Projects");
}

export function getConfigDir(): string {
  const override = process.env.AIPPT_CONFIG_DIR?.trim();
  if (override) return override;
  const paths = envPaths(APP_NAME);
  return paths.config;
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), "config.json");
}
