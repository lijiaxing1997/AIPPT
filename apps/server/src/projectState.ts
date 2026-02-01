import { z } from "zod";

import { openProjectDb } from "./projectDb.js";
import type { ProjectDb } from "./projectDb.js";

import { buildSlidePrompt } from "./ai/promptBuilder.js";
import { OutlineSchema, ThemeSchema, SlideContentSchema } from "./ai/schemas.js";
import type { SlideContent, Theme } from "./ai/schemas.js";

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
};

function safeParseJson<T>(raw: string | null, schema: z.ZodSchema<T>): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const v = schema.safeParse(parsed);
    if (!v.success) return null;
    return v.data;
  } catch {
    return null;
  }
}

export function getProjectRow(db: ProjectDb, projectId: string): { id: string; name: string; root_path: string; source_text: string; created_at: string; updated_at: string } {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!row) throw new Error("项目不存在。");
  return row;
}

export function getLatestOutline(db: ProjectDb, projectId: string): unknown | null {
  const row = db
    .prepare("SELECT outline_json FROM outline_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1")
    .get(projectId) as any;
  return safeParseJson(row?.outline_json ?? null, OutlineSchema);
}

export function getLatestTheme(db: ProjectDb, projectId: string): unknown | null {
  const row = db
    .prepare("SELECT theme_json FROM theme_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1")
    .get(projectId) as any;
  return safeParseJson(row?.theme_json ?? null, ThemeSchema);
}

export function listSlides(db: ProjectDb, projectId: string): SlideListItem[] {
  const themeRaw = getLatestTheme(db, projectId);
  const themeParsed = themeRaw ? ThemeSchema.safeParse(themeRaw) : null;
  const theme: Theme | null = themeParsed && themeParsed.success ? themeParsed.data : null;

  const rows = db
    .prepare(
      `
      SELECT
        s.id,
        s.section_index as sectionIndex,
        s.slide_index as slideIndex,
        s.title,
        s.summary,
        s.content_json as contentJson,
        s.status,
        s.error_message as errorMessage,
        s.updated_at as updatedAt,
        siv.version as imageVersion,
        siv.image_path as imagePath,
        siv.prompt_text as promptText
      FROM slides s
      LEFT JOIN slide_image_versions siv ON siv.id = (
        SELECT id FROM slide_image_versions
        WHERE slide_id = s.id
        ORDER BY version DESC
        LIMIT 1
      )
      WHERE s.project_id = ?
      ORDER BY s.section_index ASC, s.slide_index ASC
      `,
    )
    .all(projectId) as any[];

  return rows.map((r) => ({
    ...((): { promptText: string | null } => {
      if (r.promptText) return { promptText: String(r.promptText) };
      if (!theme) return { promptText: null };
      const content = safeParseJson<SlideContent>(r.contentJson ?? null, SlideContentSchema);
      if (!content) return { promptText: null };
      return {
        promptText: buildSlidePrompt({
          theme,
          slideTitle: String(r.title),
          bullets: content.bullets,
          imageDescription: content.imageDescription,
        }),
      };
    })(),
    id: String(r.id),
    sectionIndex: Number(r.sectionIndex),
    slideIndex: Number(r.slideIndex),
    title: String(r.title),
    summary: String(r.summary),
    status: String(r.status),
    errorMessage: r.errorMessage ? String(r.errorMessage) : null,
    updatedAt: String(r.updatedAt),
    imageVersion: r.imageVersion == null ? null : Number(r.imageVersion),
    imagePath: r.imagePath ? String(r.imagePath) : null,
  }));
}

export function getSlideDetails(db: ProjectDb, slideId: string): {
  id: string;
  sectionIndex: number;
  slideIndex: number;
  title: string;
  summary: string;
  status: string;
  errorMessage: string | null;
  content: unknown | null;
  latestImage: { version: number; promptText: string; imagePath: string } | null;
} {
  const s = db
    .prepare(
      `
      SELECT
        id,
        section_index as sectionIndex,
        slide_index as slideIndex,
        title,
        summary,
        content_json as contentJson,
        status,
        error_message as errorMessage
      FROM slides WHERE id = ?`,
    )
    .get(slideId) as any;

  if (!s) throw new Error("页面不存在。");

  const latest = db
    .prepare(
      `
      SELECT version, prompt_text as promptText, image_path as imagePath
      FROM slide_image_versions
      WHERE slide_id = ?
      ORDER BY version DESC
      LIMIT 1
      `,
    )
    .get(slideId) as any;

  return {
    id: String(s.id),
    sectionIndex: Number(s.sectionIndex),
    slideIndex: Number(s.slideIndex),
    title: String(s.title),
    summary: String(s.summary),
    status: String(s.status),
    errorMessage: s.errorMessage ? String(s.errorMessage) : null,
    content: safeParseJson(s.contentJson ?? null, SlideContentSchema),
    latestImage: latest
      ? { version: Number(latest.version), promptText: String(latest.promptText), imagePath: String(latest.imagePath) }
      : null,
  };
}

export function withProjectDb<T>(projectRootPath: string, fn: (db: ProjectDb) => T): T {
  const db = openProjectDb(projectRootPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
