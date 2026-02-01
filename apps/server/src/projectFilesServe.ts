import fs from "node:fs";
import path from "node:path";

import { contentTypeFromExt } from "./image/imageResponse.js";

export function resolveSafeProjectFile(projectRootPath: string, relPath: string): { absPath: string; contentType: string } {
  const cleaned = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const abs = path.resolve(projectRootPath, cleaned);
  const root = path.resolve(projectRootPath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("路径无效");
  }
  const ext = path.extname(abs).replace(".", "");
  const contentType = contentTypeFromExt(ext);
  return { absPath: abs, contentType };
}

export function createReadStream(absPath: string): fs.ReadStream {
  return fs.createReadStream(absPath);
}
