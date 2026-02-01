import { randomUUID } from "node:crypto";

import type { Job } from "./jobStore.js";
import { updateJob } from "./jobStore.js";

import { createOpenAiClient } from "../ai/openaiJson.js";
import { generateOutline } from "../ai/agents/outlineAgent.js";
import { generateTheme } from "../ai/agents/themeAgent.js";
import { generateSlideContent } from "../ai/agents/slideContentAgent.js";
import { buildSlidePrompt } from "../ai/promptBuilder.js";
import { OutlineSchema, SlideContentSchema, ThemeSchema, type Outline, type SlideContent, type Theme } from "../ai/schemas.js";

import { generateImageToProject } from "../image/imageClient.js";
import { resolveProjectRootPath } from "../projectLocator.js";
import { getLatestOutline, getLatestTheme, getProjectRow, withProjectDb } from "../projectState.js";
import { nowIso } from "../utils/time.js";

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function setSlideStatus(
  db: any,
  slideId: string,
  status: string,
  patch?: { errorMessage?: string | null; contentJson?: string | null },
) {
  db.prepare(
    `
    UPDATE slides
    SET status = @status,
        error_message = @error_message,
        content_json = COALESCE(@content_json, content_json),
        updated_at = @updated_at
    WHERE id = @id
    `,
  ).run({
    id: slideId,
    status,
    error_message: patch?.errorMessage ?? null,
    content_json: patch?.contentJson ?? null,
    updated_at: nowIso(),
  });
}

function nextVersion(db: any, table: "outline_versions" | "theme_versions", projectId: string): number {
  const row = db.prepare(`SELECT MAX(version) as v FROM ${table} WHERE project_id = ?`).get(projectId) as any;
  return (row?.v ? Number(row.v) : 0) + 1;
}

function clearSlides(db: any, projectId: string): void {
  const slideIds = (db.prepare("SELECT id FROM slides WHERE project_id = ?").all(projectId) as any[]).map((r) => String(r.id));
  const delImages = db.prepare("DELETE FROM slide_image_versions WHERE slide_id = ?");
  for (const id of slideIds) delImages.run(id);
  db.prepare("DELETE FROM slides WHERE project_id = ?").run(projectId);
}

export async function runGenerateStyle(job: Job): Promise<void> {
  updateJob(job.id, { status: "running", progress: { step: "style", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  const projectRootPath = await resolveProjectRootPath(job.projectId);
  const project = withProjectDb(projectRootPath, (db) => getProjectRow(db, job.projectId));
  const outline = withProjectDb(projectRootPath, (db) => getLatestOutline(db, job.projectId));

  const { client, model } = await createOpenAiClient();

  const theme = await generateTheme(client, model, {
    projectName: project.name,
    sourceText: project.source_text,
    outline: outline ? OutlineSchema.parse(outline) : null,
  });

  withProjectDb(projectRootPath, (db) => {
    const themeVersion = nextVersion(db, "theme_versions", job.projectId);
    db.prepare(
      `INSERT INTO theme_versions (id, project_id, version, theme_json, created_at)
       VALUES (@id, @project_id, @version, @theme_json, @created_at)`,
    ).run({
      id: randomUUID(),
      project_id: job.projectId,
      version: themeVersion,
      theme_json: JSON.stringify(theme),
      created_at: nowIso(),
    });
  });

  updateJob(job.id, { status: "completed", finishedAt: nowIso(), progress: { step: "style", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });
}

export async function runGenerateOutlineStep(job: Job): Promise<void> {
  updateJob(job.id, { status: "running", progress: { step: "outline", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  const projectRootPath = await resolveProjectRootPath(job.projectId);
  const project = withProjectDb(projectRootPath, (db) => getProjectRow(db, job.projectId));
  const { client, model } = await createOpenAiClient();

  const outline = await generateOutline(client, model, { projectName: project.name, sourceText: project.source_text });

  const slideCount = withProjectDb(projectRootPath, (db) => {
    const outlineVersion = nextVersion(db, "outline_versions", job.projectId);

    clearSlides(db, job.projectId);

    db.prepare(
      `INSERT INTO outline_versions (id, project_id, version, outline_json, created_at)
       VALUES (@id, @project_id, @version, @outline_json, @created_at)`,
    ).run({
      id: randomUUID(),
      project_id: job.projectId,
      version: outlineVersion,
      outline_json: JSON.stringify(outline),
      created_at: nowIso(),
    });

    const insertSlide = db.prepare(
      `INSERT INTO slides (id, project_id, section_index, slide_index, title, summary, content_json, status, error_message, updated_at)
       VALUES (@id, @project_id, @section_index, @slide_index, @title, @summary, NULL, @status, NULL, @updated_at)`,
    );

    let deckIndex = 0;
    outline.sections.forEach((section, sectionIndex) => {
      section.slides.forEach((slide, slideIndex) => {
        insertSlide.run({
          id: randomUUID(),
          project_id: job.projectId,
          section_index: sectionIndex,
          slide_index: slideIndex,
          title: slide.title,
          summary: slide.summary,
          status: "pending",
          updated_at: nowIso(),
        });
        deckIndex += 1;
      });
    });
    return deckIndex;
  });

  updateJob(job.id, {
    status: "completed",
    finishedAt: nowIso(),
    progress: { step: "outline", totalSlides: slideCount, completedSlides: slideCount, failedSlides: 0 },
  });
}

type SlideRow = {
  id: string;
  sectionIndex: number;
  slideIndex: number;
  title: string;
  summary: string;
};

function listSlidesForProject(projectRootPath: string, projectId: string): SlideRow[] {
  return withProjectDb(projectRootPath, (db) => {
    const rows = db
      .prepare(
        `SELECT id, section_index as sectionIndex, slide_index as slideIndex, title, summary
         FROM slides
         WHERE project_id = ?
         ORDER BY section_index ASC, slide_index ASC`,
      )
      .all(projectId) as any[];

    return rows.map((r) => ({
      id: String(r.id),
      sectionIndex: Number(r.sectionIndex),
      slideIndex: Number(r.slideIndex),
      title: String(r.title),
      summary: String(r.summary),
    }));
  });
}

function requireLatestOutline(projectRootPath: string, projectId: string): Outline {
  const outline = withProjectDb(projectRootPath, (db) => getLatestOutline(db, projectId));
  if (!outline) throw new Error("大纲尚未生成");
  return OutlineSchema.parse(outline);
}

function requireLatestTheme(projectRootPath: string, projectId: string): Theme {
  const theme = withProjectDb(projectRootPath, (db) => getLatestTheme(db, projectId));
  if (!theme) throw new Error("风格尚未生成");
  return ThemeSchema.parse(theme);
}

export async function runGenerateContentStep(job: Job): Promise<void> {
  updateJob(job.id, { status: "running", progress: { step: "content", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  const projectRootPath = await resolveProjectRootPath(job.projectId);
  const project = withProjectDb(projectRootPath, (db) => getProjectRow(db, job.projectId));
  const outline = requireLatestOutline(projectRootPath, job.projectId);
  const theme = requireLatestTheme(projectRootPath, job.projectId);

  const slides = listSlidesForProject(projectRootPath, job.projectId);
  if (slides.length === 0) throw new Error("没有页面可生成，请先生成大纲");

  updateJob(job.id, { progress: { step: "content", totalSlides: slides.length, completedSlides: 0, failedSlides: 0 } });

  const { client, model } = await createOpenAiClient();

  let completedSlides = 0;
  let failedSlides = 0;

  const tasks = slides.map(async (s) => {
    try {
      const sectionTitle = outline.sections[s.sectionIndex]?.title;
      if (!sectionTitle) throw new Error("大纲结构与页面索引不一致，请先保存/重新生成大纲");

      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "generating_text", { errorMessage: null }));

      const content = await generateSlideContent(client, model, {
        projectName: project.name,
        sourceText: project.source_text,
        outline,
        theme,
        sectionTitle,
        slideTitle: s.title,
        slideSummary: s.summary,
      });

      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "text_ready", { errorMessage: null, contentJson: JSON.stringify(content) }));

      completedSlides += 1;
      updateJob(job.id, { progress: { step: "content", totalSlides: slides.length, completedSlides, failedSlides } });
    } catch (err) {
      failedSlides += 1;
      const message = toErrorMessage(err);
      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "error", { errorMessage: message }));
      updateJob(job.id, { progress: { step: "content", totalSlides: slides.length, completedSlides, failedSlides } });
    }
  });

  await Promise.all(tasks);

  updateJob(job.id, { status: "completed", finishedAt: nowIso(), progress: { step: "content", totalSlides: slides.length, completedSlides, failedSlides } });
}

function tryParseSlideContent(raw: string | null): SlideContent | null {
  if (!raw) return null;
  try {
    return SlideContentSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function runGenerateImagesStep(job: Job): Promise<void> {
  updateJob(job.id, { status: "running", progress: { step: "images", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  const projectRootPath = await resolveProjectRootPath(job.projectId);
  const theme = requireLatestTheme(projectRootPath, job.projectId);

  const slides = withProjectDb(projectRootPath, (db) => {
    const rows = db
      .prepare(
        `SELECT id, section_index as sectionIndex, slide_index as slideIndex, title, summary, content_json as contentJson
         FROM slides
         WHERE project_id = ?
         ORDER BY section_index ASC, slide_index ASC`,
      )
      .all(job.projectId) as any[];

    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      content: tryParseSlideContent(r.contentJson ?? null),
      deckIndex: 0,
    }));
  });

  if (slides.length === 0) throw new Error("没有页面可生成，请先生成大纲");

  slides.forEach((s, idx) => {
    s.deckIndex = idx;
  });

  updateJob(job.id, { progress: { step: "images", totalSlides: slides.length, completedSlides: 0, failedSlides: 0 } });

  let completedSlides = 0;
  let failedSlides = 0;

  const tasks = slides.map(async (s) => {
    try {
      if (!s.content) throw new Error("内容未生成");

      const promptText = buildSlidePrompt({
        theme,
        slideTitle: s.title,
        bullets: s.content.bullets,
        imageDescription: s.content.imageDescription,
      });

      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "generating_image", { errorMessage: null }));

      const version = withProjectDb(projectRootPath, (db) => {
        const row = db.prepare("SELECT MAX(version) as v FROM slide_image_versions WHERE slide_id = ?").get(s.id) as any;
        return (row?.v ? Number(row.v) : 0) + 1;
      });

      const image = await generateImageToProject({
        projectRootPath,
        deckIndex: s.deckIndex,
        version,
        promptText,
      });

      withProjectDb(projectRootPath, (db) => {
        db.prepare(
          `INSERT INTO slide_image_versions
           (id, slide_id, version, prompt_text, image_path, provider, request_json, response_json, created_at)
           VALUES (@id, @slide_id, @version, @prompt_text, @image_path, @provider, @request_json, @response_json, @created_at)`,
        ).run({
          id: randomUUID(),
          slide_id: s.id,
          version,
          prompt_text: promptText,
          image_path: image.imagePath,
          provider: "vectorengine",
          request_json: JSON.stringify(image.requestJson),
          response_json: JSON.stringify(image.responseJson),
          created_at: image.createdAt,
        });

        setSlideStatus(db, s.id, "ready", { errorMessage: null });
      });

      completedSlides += 1;
      updateJob(job.id, { progress: { step: "images", totalSlides: slides.length, completedSlides, failedSlides } });
    } catch (err) {
      failedSlides += 1;
      const message = toErrorMessage(err);
      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "error", { errorMessage: message }));
      updateJob(job.id, { progress: { step: "images", totalSlides: slides.length, completedSlides, failedSlides } });
    }
  });

  await Promise.all(tasks);

  updateJob(job.id, { status: "completed", finishedAt: nowIso(), progress: { step: "images", totalSlides: slides.length, completedSlides, failedSlides } });
}

