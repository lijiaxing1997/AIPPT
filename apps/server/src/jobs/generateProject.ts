import { randomUUID } from "node:crypto";

import type { Job } from "./jobStore.js";
import { updateJob } from "./jobStore.js";

import { createOpenAiClient } from "../ai/openaiJson.js";
import { generateOutline } from "../ai/agents/outlineAgent.js";
import { generateTheme } from "../ai/agents/themeAgent.js";
import { generateSlideContent } from "../ai/agents/slideContentAgent.js";
import type { Outline, Theme } from "../ai/schemas.js";
import { buildSlidePrompt } from "../ai/promptBuilder.js";

import { generateImageToProject } from "../image/imageClient.js";
import { resolveProjectRootPath } from "../projectLocator.js";
import { withProjectDb, getProjectRow } from "../projectState.js";
import { nowIso } from "../utils/time.js";

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function setSlideStatus(db: any, slideId: string, status: string, patch?: { errorMessage?: string | null; contentJson?: string | null }) {
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
  const row = db
    .prepare(`SELECT MAX(version) as v FROM ${table} WHERE project_id = ?`)
    .get(projectId) as any;
  return (row?.v ? Number(row.v) : 0) + 1;
}

function clearSlides(db: any, projectId: string): void {
  const slideIds = (db.prepare("SELECT id FROM slides WHERE project_id = ?").all(projectId) as any[]).map((r) => String(r.id));
  const delImages = db.prepare("DELETE FROM slide_image_versions WHERE slide_id = ?");
  for (const id of slideIds) delImages.run(id);
  db.prepare("DELETE FROM slides WHERE project_id = ?").run(projectId);
}

export async function runGenerateAll(job: Job): Promise<void> {
  updateJob(job.id, { status: "running", progress: { step: "outline", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  const projectRootPath = await resolveProjectRootPath(job.projectId);

  const project = withProjectDb(projectRootPath, (db) => getProjectRow(db, job.projectId));

  const { client, model } = await createOpenAiClient();

  const outline = await generateOutline(client, model, { projectName: project.name, sourceText: project.source_text });
  updateJob(job.id, { progress: { step: "style", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  const theme = await generateTheme(client, model, { projectName: project.name, sourceText: project.source_text, outline });
  updateJob(job.id, { progress: { step: "slides", totalSlides: 0, completedSlides: 0, failedSlides: 0 } });

  type SlideRow = { id: string; sectionTitle: string; title: string; summary: string; slideIndex: number; deckIndex: number };

  const slideRows: SlideRow[] = withProjectDb(projectRootPath, (db) => {
    const outlineVersion = nextVersion(db, "outline_versions", job.projectId);
    const themeVersion = nextVersion(db, "theme_versions", job.projectId);

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

    const insertSlide = db.prepare(
      `INSERT INTO slides (id, project_id, section_index, slide_index, title, summary, content_json, status, error_message, updated_at)
       VALUES (@id, @project_id, @section_index, @slide_index, @title, @summary, NULL, @status, NULL, @updated_at)`,
    );

    const created: SlideRow[] = [];
    let deckIndex = 0;
    outline.sections.forEach((section, sectionIndex) => {
      section.slides.forEach((slide, slideIndex) => {
        const id = randomUUID();
        insertSlide.run({
          id,
          project_id: job.projectId,
          section_index: sectionIndex,
          slide_index: slideIndex,
          title: slide.title,
          summary: slide.summary,
          status: "pending",
          updated_at: nowIso(),
        });
        created.push({ id, sectionTitle: section.title, title: slide.title, summary: slide.summary, slideIndex, deckIndex });
        deckIndex += 1;
      });
    });
    return created;
  });

  updateJob(job.id, { progress: { step: "slides", totalSlides: slideRows.length, completedSlides: 0, failedSlides: 0 } });

  let completedSlides = 0;
  let failedSlides = 0;

  const slideTasks = slideRows.map(async (s: SlideRow) => {
    try {
      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "generating_text", { errorMessage: null }));

      const content = await generateSlideContent(client, model, {
        projectName: project.name,
        sourceText: project.source_text,
        outline: outline as Outline,
        theme: theme as Theme,
        sectionTitle: s.sectionTitle,
        slideTitle: s.title,
        slideSummary: s.summary,
      });

      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "text_ready", { errorMessage: null, contentJson: JSON.stringify(content) }));

      const promptText = buildSlidePrompt({
        theme: theme as Theme,
        slideTitle: s.title,
        bullets: content.bullets,
        imageDescription: content.imageDescription,
      });

      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "generating_image", { errorMessage: null }));

      const version = withProjectDb(projectRootPath, (db) => {
        const row = db
          .prepare("SELECT MAX(version) as v FROM slide_image_versions WHERE slide_id = ?")
          .get(s.id) as any;
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
      updateJob(job.id, {
        progress: { step: "slides", totalSlides: slideRows.length, completedSlides, failedSlides },
      });
    } catch (err) {
      failedSlides += 1;
      const message = toErrorMessage(err);
      withProjectDb(projectRootPath, (db) => setSlideStatus(db, s.id, "error", { errorMessage: message }));
      updateJob(job.id, {
        progress: { step: "slides", totalSlides: slideRows.length, completedSlides, failedSlides },
      });
    }
  });

  await Promise.all(slideTasks);

  updateJob(job.id, {
    status: "completed",
    finishedAt: nowIso(),
    progress: { step: "slides", totalSlides: slideRows.length, completedSlides, failedSlides },
  });
}
