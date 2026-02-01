import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { buildSlidePrompt } from "./ai/promptBuilder.js";
import type { SlideContent, Theme } from "./ai/schemas.js";
import { generateImageToProject } from "./image/imageClient.js";
import { resolveProjectRootPath } from "./projectLocator.js";
import { withProjectDb } from "./projectState.js";
import { nowIso } from "./utils/time.js";

function ensureWithinProject(projectRootPath: string, relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const abs = path.resolve(projectRootPath, cleaned);
  const root = path.resolve(projectRootPath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("文件路径无效");
  }
  return abs;
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function slideDirName(deckIndex: number): string {
  return `slide-${pad4(deckIndex + 1)}`;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function setSlideStatus(db: any, slideId: string, status: string, errorMessage: string | null) {
  db.prepare(
    `UPDATE slides SET status = @status, error_message = @error_message, updated_at = @updated_at WHERE id = @id`,
  ).run({ id: slideId, status, error_message: errorMessage, updated_at: nowIso() });
}

function tryParseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function regenerateSlideImage(input: {
  projectId: string;
  slideId: string;
  promptText?: string;
}): Promise<{ version: number; promptText: string; imagePath: string }> {
  const projectRootPath = await resolveProjectRootPath(input.projectId);

  const resolved = await withProjectDb(projectRootPath, (db) => {
    const slide = db
      .prepare(
        `SELECT id, section_index as sectionIndex, slide_index as slideIndex, title, summary, content_json as contentJson, status
         FROM slides WHERE id = ? AND project_id = ?`,
      )
      .get(input.slideId, input.projectId) as any;
    if (!slide) throw new Error("页面不存在。");

    const orderRow = db
      .prepare(
        `SELECT COUNT(1) as c FROM slides
         WHERE project_id = ?
           AND (section_index < ? OR (section_index = ? AND slide_index < ?))`,
      )
      .get(input.projectId, Number(slide.sectionIndex), Number(slide.sectionIndex), Number(slide.slideIndex)) as any;

    const latest = db
      .prepare(
        `SELECT prompt_text as promptText FROM slide_image_versions
         WHERE slide_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(input.slideId) as any;

    const themeRow = db
      .prepare(`SELECT theme_json as themeJson FROM theme_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1`)
      .get(input.projectId) as any;

    const versionRow = db
      .prepare(`SELECT MAX(version) as v FROM slide_image_versions WHERE slide_id = ?`)
      .get(input.slideId) as any;

    return {
      deckIndex: Number(orderRow?.c ?? 0),
      slideTitle: String(slide.title),
      slideSummary: String(slide.summary),
      status: String(slide.status),
      contentJson: tryParseJson<SlideContent>(slide.contentJson),
      latestPromptText: latest?.promptText ? String(latest.promptText) : null,
      themeJson: tryParseJson<Theme>(themeRow?.themeJson),
      nextVersion: (versionRow?.v ? Number(versionRow.v) : 0) + 1,
    };
  });

  const promptTextFromInput = input.promptText?.trim() || null;
  const promptTextFromContent =
    resolved.themeJson && resolved.contentJson
      ? buildSlidePrompt({
          theme: resolved.themeJson,
          slideTitle: resolved.slideTitle,
          bullets: resolved.contentJson.bullets,
          imageDescription: resolved.contentJson.imageDescription,
        })
      : null;

  const promptText =
    promptTextFromInput ||
    (resolved.status === "text_ready" && promptTextFromContent ? promptTextFromContent : null) ||
    resolved.latestPromptText ||
    promptTextFromContent ||
    "";

  if (!promptText) throw new Error("没有可用的提示词，无法重新生成。");

  await withProjectDb(projectRootPath, (db) => setSlideStatus(db, input.slideId, "generating_image", null));

  try {
    const image = await generateImageToProject({
      projectRootPath,
      deckIndex: resolved.deckIndex,
      version: resolved.nextVersion,
      promptText,
    });

    await withProjectDb(projectRootPath, (db) => {
      db.prepare(
        `INSERT INTO slide_image_versions
         (id, slide_id, version, prompt_text, image_path, provider, request_json, response_json, created_at)
         VALUES (@id, @slide_id, @version, @prompt_text, @image_path, @provider, @request_json, @response_json, @created_at)`,
      ).run({
        id: randomUUID(),
        slide_id: input.slideId,
        version: resolved.nextVersion,
        prompt_text: promptText,
        image_path: image.imagePath,
        provider: "vectorengine",
        request_json: JSON.stringify(image.requestJson),
        response_json: JSON.stringify(image.responseJson),
        created_at: image.createdAt,
      });

      setSlideStatus(db, input.slideId, "ready", null);
    });

    return { version: resolved.nextVersion, promptText, imagePath: image.imagePath };
  } catch (err) {
    const msg = toErrorMessage(err);
    await withProjectDb(projectRootPath, (db) => setSlideStatus(db, input.slideId, "error", msg));
    throw err;
  }
}

export async function listSlideImageVersions(input: {
  projectId: string;
  slideId: string;
}): Promise<Array<{ version: number; promptText: string; imagePath: string; createdAt: string }>> {
  const projectRootPath = await resolveProjectRootPath(input.projectId);
  return await withProjectDb(projectRootPath, (db) => {
    const slide = db.prepare("SELECT id FROM slides WHERE id = ? AND project_id = ?").get(input.slideId, input.projectId) as any;
    if (!slide) throw new Error("页面不存在。");

    const rows = db
      .prepare(
        `SELECT version, prompt_text as promptText, image_path as imagePath, created_at as createdAt
         FROM slide_image_versions
         WHERE slide_id = ?
         ORDER BY version DESC`,
      )
      .all(input.slideId) as any[];

    return rows.map((r) => ({
      version: Number(r.version),
      promptText: String(r.promptText),
      imagePath: String(r.imagePath),
      createdAt: String(r.createdAt),
    }));
  });
}

export async function restoreSlideImageVersion(input: {
  projectId: string;
  slideId: string;
  version: number;
}): Promise<{ version: number; promptText: string; imagePath: string }> {
  const projectRootPath = await resolveProjectRootPath(input.projectId);

  const resolved = await withProjectDb(projectRootPath, (db) => {
    const slide = db
      .prepare(
        `SELECT section_index as sectionIndex, slide_index as slideIndex
         FROM slides WHERE id = ? AND project_id = ?`,
      )
      .get(input.slideId, input.projectId) as any;
    if (!slide) throw new Error("页面不存在。");

    const orderRow = db
      .prepare(
        `SELECT COUNT(1) as c FROM slides
         WHERE project_id = ?
           AND (section_index < ? OR (section_index = ? AND slide_index < ?))`,
      )
      .get(input.projectId, Number(slide.sectionIndex), Number(slide.sectionIndex), Number(slide.slideIndex)) as any;

    const src = db
      .prepare(
        `SELECT prompt_text as promptText, image_path as imagePath
         FROM slide_image_versions
         WHERE slide_id = ? AND version = ?`,
      )
      .get(input.slideId, input.version) as any;
    if (!src) throw new Error("图片版本不存在。");

    const versionRow = db.prepare(`SELECT MAX(version) as v FROM slide_image_versions WHERE slide_id = ?`).get(input.slideId) as any;

    return {
      deckIndex: Number(orderRow?.c ?? 0),
      srcPromptText: String(src.promptText),
      srcImagePath: String(src.imagePath),
      nextVersion: (versionRow?.v ? Number(versionRow.v) : 0) + 1,
    };
  });

  await withProjectDb(projectRootPath, (db) => setSlideStatus(db, input.slideId, "generating_image", null));

  try {
    const ext = path.extname(resolved.srcImagePath).replace(".", "") || "png";
    const destRelPath = path.posix.join("images", slideDirName(resolved.deckIndex), `v${resolved.nextVersion}.${ext}`);
    const absSrc = ensureWithinProject(projectRootPath, resolved.srcImagePath);
    const absDest = ensureWithinProject(projectRootPath, destRelPath);
    await fs.mkdir(path.dirname(absDest), { recursive: true });
    await fs.copyFile(absSrc, absDest);

    await withProjectDb(projectRootPath, (db) => {
      db.prepare(
        `INSERT INTO slide_image_versions
         (id, slide_id, version, prompt_text, image_path, provider, request_json, response_json, created_at)
         VALUES (@id, @slide_id, @version, @prompt_text, @image_path, @provider, NULL, NULL, @created_at)`,
      ).run({
        id: randomUUID(),
        slide_id: input.slideId,
        version: resolved.nextVersion,
        prompt_text: resolved.srcPromptText,
        image_path: destRelPath,
        provider: "restore",
        created_at: nowIso(),
      });

      setSlideStatus(db, input.slideId, "ready", null);
    });

    return { version: resolved.nextVersion, promptText: resolved.srcPromptText, imagePath: destRelPath };
  } catch (err) {
    const msg = toErrorMessage(err);
    await withProjectDb(projectRootPath, (db) => setSlideStatus(db, input.slideId, "error", msg));
    throw err;
  }
}
