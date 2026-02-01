import { loadConfig } from "./configStore.js";
import { readProjectJson } from "./projectFiles.js";

export async function resolveProjectRootPath(projectId: string): Promise<string> {
  const config = await loadConfig();
  const fromRecent = config.recentProjects.find((p) => p.id === projectId)?.rootPath;
  if (fromRecent) return fromRecent;

  const last = config.lastOpenedProjectRootPath;
  if (last) {
    try {
      const pj = await readProjectJson(last);
      if (pj.id === projectId) return last;
    } catch {
      // ignore
    }
  }

  throw new Error("未知项目。请先在欢迎页打开该项目文件夹。");
}
