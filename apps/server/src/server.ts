import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ensureConfigDirExists, loadConfig, saveConfig } from "./configStore.js";
import { createGenerateJob, findRunningGenerateJob, getJob, updateJob } from "./jobs/jobStore.js";
import { runGenerateAll } from "./jobs/generateProject.js";
import { runGenerateContentStep, runGenerateImagesStep, runGenerateOutlineStep, runGenerateStyle } from "./jobs/generatePipeline.js";
import { exportProject, listProjectExports } from "./exportService.js";
import { resolveProjectRootPath } from "./projectLocator.js";
import { withProjectDb, getLatestOutline, getLatestTheme, getProjectRow, getSlideDetails, listSlides } from "./projectState.js";
import { createReadStream, resolveSafeProjectFile } from "./projectFilesServe.js";
import { listSlideImageVersions, regenerateSlideImage, restoreSlideImageVersion } from "./slideService.js";
import { nowIso } from "./utils/time.js";
import { OutlineSchema, SlideContentSchema, ThemeSchema } from "./ai/schemas.js";

const ApiErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});

function toApiError(error: unknown): z.infer<typeof ApiErrorSchema> {
  if (error instanceof z.ZodError) {
    return { error: "请求参数无效", details: error.flatten() };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: "未知错误", details: error };
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

export type StartServerOptions = {
  port?: number;
  host?: string;
  logger?: boolean;
  webDistDir?: string | null;
};

function resolveWebDistDir(opts: { webDistDir?: string | null }): string | null {
  if (typeof opts.webDistDir === "string" && opts.webDistDir.trim()) return path.resolve(opts.webDistDir);
  if (typeof process.env.AIPPT_WEB_DIST_DIR === "string" && process.env.AIPPT_WEB_DIST_DIR.trim()) {
    return path.resolve(process.env.AIPPT_WEB_DIST_DIR);
  }
  if (process.env.NODE_ENV !== "production") return null;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
}

export async function buildServer(opts?: StartServerOptions) {
  const app = Fastify({
    logger: opts?.logger ?? true,
  });

  await app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    credentials: true,
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/api/app/boot", async () => {
    const { getBootState } = await import("./projectService.js");
    return await getBootState();
  });

  app.get("/api/projects/recent", async () => {
    const { getBootState } = await import("./projectService.js");
    const boot = await getBootState();
    return { recentProjects: boot.recentProjects };
  });

  app.get("/api/config", async () => {
    const config = await loadConfig();
    return {
      openai: {
        baseURL: config.openai.baseURL,
        model: config.openai.model,
        hasApiKey: Boolean(config.openai.apiKey),
      },
      image: {
        baseURL: config.image.baseURL,
        aspectRatio: config.image.aspectRatio,
        imageSize: config.image.imageSize,
        timeoutSec: config.image.timeoutSec,
        cacheEnabled: config.image.cacheEnabled,
        hasApiKey: Boolean(config.image.apiKey),
      },
      proxy: {
        enabled: config.proxy.enabled,
        host: config.proxy.host,
        port: config.proxy.port,
      },
    };
  });

  const UpdateConfigSchema = z.object({
    openai: z
      .object({
        baseURL: z.string().optional(),
        apiKey: z.string().optional(),
        model: z.string().optional(),
      })
      .optional(),
    image: z
      .object({
        baseURL: z.string().optional(),
        apiKey: z.string().optional(),
        aspectRatio: z.string().optional(),
        imageSize: z.string().optional(),
        timeoutSec: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
        cacheEnabled: z.boolean().optional(),
      })
      .optional(),
    proxy: z
      .object({
        enabled: z.boolean().optional(),
        host: z.string().optional(),
        port: z.number().int().min(0).max(65535).optional(),
      })
      .optional(),
  });

  app.put("/api/config", async (req, reply) => {
    try {
      const patch = UpdateConfigSchema.parse(req.body);
      const config = await loadConfig();

      if (patch.openai) {
        if (typeof patch.openai.baseURL === "string") config.openai.baseURL = patch.openai.baseURL;
        if (typeof patch.openai.model === "string") config.openai.model = patch.openai.model;
        if (typeof patch.openai.apiKey === "string" && patch.openai.apiKey.trim() !== "") config.openai.apiKey = patch.openai.apiKey;
      }

      if (patch.image) {
        if (typeof patch.image.baseURL === "string") config.image.baseURL = patch.image.baseURL;
        if (typeof patch.image.aspectRatio === "string") config.image.aspectRatio = patch.image.aspectRatio;
        if (typeof patch.image.imageSize === "string") config.image.imageSize = patch.image.imageSize;
        if (typeof patch.image.timeoutSec === "number") config.image.timeoutSec = patch.image.timeoutSec;
        if (typeof patch.image.timeoutMs === "number") config.image.timeoutSec = Math.max(1, Math.round(patch.image.timeoutMs / 1000));
        if (typeof patch.image.cacheEnabled === "boolean") config.image.cacheEnabled = patch.image.cacheEnabled;
        if (typeof patch.image.apiKey === "string" && patch.image.apiKey.trim() !== "") config.image.apiKey = patch.image.apiKey;
      }

      if (patch.proxy) {
        if (typeof patch.proxy.enabled === "boolean") config.proxy.enabled = patch.proxy.enabled;
        if (typeof patch.proxy.host === "string") config.proxy.host = patch.proxy.host;
        if (typeof patch.proxy.port === "number") config.proxy.port = patch.proxy.port;
        if (config.proxy.enabled) {
          config.proxy.host = config.proxy.host.trim();
          if (!config.proxy.host) throw new Error("代理已启用，但未填写代理 IP/域名。");
          if (!(config.proxy.port > 0)) throw new Error("代理已启用，但端口无效。");
        }
      }

      await saveConfig(config);
      return {
        openai: {
          baseURL: config.openai.baseURL,
          model: config.openai.model,
          hasApiKey: Boolean(config.openai.apiKey),
        },
        image: {
          baseURL: config.image.baseURL,
          aspectRatio: config.image.aspectRatio,
          imageSize: config.image.imageSize,
          timeoutSec: config.image.timeoutSec,
          cacheEnabled: config.image.cacheEnabled,
          hasApiKey: Boolean(config.image.apiKey),
        },
        proxy: {
          enabled: config.proxy.enabled,
          host: config.proxy.host,
          port: config.proxy.port,
        },
      };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects", async (req, reply) => {
    try {
      const { createProject, parseCreateProjectInput } = await import("./projectService.js");
      const input = parseCreateProjectInput(req.body);
      const project = await createProject(input);
      return project;
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects/open", async (req, reply) => {
    try {
      const { openProject, parseOpenProjectInput } = await import("./projectService.js");
      const input = parseOpenProjectInput(req.body);
      const project = await openProject(input);
      return project;
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.get("/api/projects/:projectId/config", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const projectRootPath = await resolveProjectRootPath(projectId);
      return withProjectDb(projectRootPath, (db) => {
        const project = getProjectRow(db, projectId);
        return {
          project: {
            id: project.id,
            name: project.name,
            rootPath: project.root_path,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
          },
          sourceText: project.source_text,
        };
      });
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  const UpdateProjectConfigSchema = z
    .object({
      name: z.string().min(1).max(80).optional(),
      sourceText: z.string().min(1).max(50_000).optional(),
    })
    .refine((v) => typeof v.name === "string" || typeof v.sourceText === "string", { message: "请至少提供一个需要更新的字段。" });

  app.put("/api/projects/:projectId/config", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const patch = UpdateProjectConfigSchema.parse(req.body);
      const projectRootPath = await resolveProjectRootPath(projectId);
      const updatedAt = nowIso();

      const updated = withProjectDb(projectRootPath, (db) => {
        const project = getProjectRow(db, projectId);
        const nextName = typeof patch.name === "string" ? patch.name.trim() : project.name;
        const nextSourceText = typeof patch.sourceText === "string" ? patch.sourceText : project.source_text;
        if (!nextName.trim()) throw new Error("项目名称不能为空。");
        if (!nextSourceText.trim()) throw new Error("PPT 创作内容不能为空。");

        db.prepare("UPDATE projects SET name = ?, source_text = ?, updated_at = ? WHERE id = ?").run(nextName, nextSourceText, updatedAt, projectId);
        return {
          ...project,
          name: nextName,
          source_text: nextSourceText,
          updated_at: updatedAt,
        };
      });

      const { readProjectJson, writeProjectJson } = await import("./projectFiles.js");
      const projectJson = await readProjectJson(projectRootPath);
      await writeProjectJson(projectRootPath, {
        ...projectJson,
        name: updated.name,
        updatedAt,
      });

      if (typeof patch.name === "string") {
        const config = await loadConfig();
        const idx = config.recentProjects.findIndex((p) => p.id === projectId);
        if (idx >= 0) {
          const prev = config.recentProjects[idx];
          if (prev) {
            config.recentProjects[idx] = { ...prev, name: updated.name };
            await saveConfig(config);
          }
        }
      }

      return {
        project: {
          id: updated.id,
          name: updated.name,
          rootPath: updated.root_path,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
        sourceText: updated.source_text,
      };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.get("/api/projects/:projectId/state", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const projectRootPath = await resolveProjectRootPath(projectId);
      return withProjectDb(projectRootPath, (db) => {
        const project = getProjectRow(db, projectId);
        const outline = getLatestOutline(db, projectId);
        const theme = getLatestTheme(db, projectId);
        const slides = listSlides(db, projectId).map((s) => ({
          ...s,
          imageUrl: s.imagePath ? `/api/projects/${projectId}/files/${s.imagePath}` : null,
        }));
        return {
          project: {
            id: project.id,
            name: project.name,
            rootPath: project.root_path,
            createdAt: project.created_at,
            updatedAt: project.updated_at,
          },
          outline,
          theme,
          slides,
        };
      });
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.get("/api/projects/:projectId/slides/:slideId", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const slideId = String((req.params as any).slideId);
      const projectRootPath = await resolveProjectRootPath(projectId);
      return withProjectDb(projectRootPath, (db) => {
        const slide = getSlideDetails(db, slideId);
        return {
          ...slide,
          latestImage: slide.latestImage
            ? { ...slide.latestImage, imageUrl: `/api/projects/${projectId}/files/${slide.latestImage.imagePath}` }
            : null,
        };
      });
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.delete("/api/projects/:projectId/slides/:slideId", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const slideId = String((req.params as any).slideId);
      const projectRootPath = await resolveProjectRootPath(projectId);

      withProjectDb(projectRootPath, (db) => {
        const slide = db
          .prepare("SELECT section_index as sectionIndex, slide_index as slideIndex FROM slides WHERE id = ? AND project_id = ?")
          .get(slideId, projectId) as any;
        if (!slide) throw new Error("页面不存在。");

        const slideCountRow = db.prepare("SELECT COUNT(1) as c FROM slides WHERE project_id = ?").get(projectId) as any;
        const slideCount = slideCountRow?.c ? Number(slideCountRow.c) : 0;
        if (slideCount <= 1) throw new Error("至少需要保留 1 页，无法删除最后一页。");

        const outlineRaw = getLatestOutline(db, projectId);
        if (!outlineRaw) throw new Error("大纲尚未生成");

        const outline = OutlineSchema.parse(outlineRaw);
        const sectionIndex = Number(slide.sectionIndex);
        const slideIndex = Number(slide.slideIndex);

        const nextOutline = structuredClone(outline);
        const section = nextOutline.sections[sectionIndex];
        if (!section?.slides?.[slideIndex]) throw new Error("大纲与页面索引不一致，请刷新后重试。");
        section.slides.splice(slideIndex, 1);

        let removedSection = false;
        if (section.slides.length === 0) {
          nextOutline.sections.splice(sectionIndex, 1);
          removedSection = true;
        }

        if (nextOutline.sections.length === 0) throw new Error("至少需要保留 1 个章节与 1 页，无法删除最后一页。");
        OutlineSchema.parse(nextOutline);

        const tx = db.transaction(() => {
          db.prepare("DELETE FROM slide_image_versions WHERE slide_id = ?").run(slideId);
          db.prepare("DELETE FROM slides WHERE id = ? AND project_id = ?").run(slideId, projectId);

          if (removedSection) {
            db.prepare("UPDATE slides SET section_index = section_index - 1 WHERE project_id = ? AND section_index > ?").run(projectId, sectionIndex);
          } else {
            db.prepare(
              "UPDATE slides SET slide_index = slide_index - 1 WHERE project_id = ? AND section_index = ? AND slide_index > ?",
            ).run(projectId, sectionIndex, slideIndex);
          }

          const outlineVersion = nextVersion(db, "outline_versions", projectId);
          db.prepare(
            `INSERT INTO outline_versions (id, project_id, version, outline_json, created_at)
             VALUES (@id, @project_id, @version, @outline_json, @created_at)`,
          ).run({
            id: randomUUID(),
            project_id: projectId,
            version: outlineVersion,
            outline_json: JSON.stringify(nextOutline),
            created_at: nowIso(),
          });
        });

        tx();
      });

      return { ok: true };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  const RegenerateSchema = z.object({
    promptText: z.string().optional(),
  });

  // NOTE: Avoid ":" inside a path segment because Fastify/router can interpret it as a param marker.
  app.post("/api/projects/:projectId/slides/:slideId/image/generate", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const slideId = String((req.params as any).slideId);
      const body = RegenerateSchema.parse(req.body);
      const result = await regenerateSlideImage({ projectId, slideId, promptText: body.promptText });
      return { ...result, imageUrl: `/api/projects/${projectId}/files/${result.imagePath}` };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.get("/api/projects/:projectId/slides/:slideId/images", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const slideId = String((req.params as any).slideId);
      const versions = await listSlideImageVersions({ projectId, slideId });
      return {
        versions: versions.map((v) => ({
          ...v,
          imageUrl: `/api/projects/${projectId}/files/${v.imagePath}`,
        })),
      };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  const RestoreSchema = z.object({
    version: z.number().int().positive(),
  });

  app.post("/api/projects/:projectId/slides/:slideId/image/restore", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const slideId = String((req.params as any).slideId);
      const body = RestoreSchema.parse(req.body);
      const result = await restoreSlideImageVersion({ projectId, slideId, version: body.version });
      return { ...result, imageUrl: `/api/projects/${projectId}/files/${result.imagePath}` };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects/:projectId/generate", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      await resolveProjectRootPath(projectId);

      const running = findRunningGenerateJob(projectId);
      if (running) return { jobId: running.id, status: running.status };

      const job = createGenerateJob(projectId);
      updateJob(job.id, { status: "queued" });
      void runGenerateAll(job).catch((err) => {
        updateJob(job.id, { status: "failed", finishedAt: nowIso(), error: err instanceof Error ? err.message : String(err) });
      });
      return { jobId: job.id, status: "queued" };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects/:projectId/generate/style", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      await resolveProjectRootPath(projectId);

      const running = findRunningGenerateJob(projectId);
      if (running) return { jobId: running.id, status: running.status };

      const job = createGenerateJob(projectId);
      updateJob(job.id, { status: "queued" });
      void runGenerateStyle(job).catch((err) => {
        updateJob(job.id, { status: "failed", finishedAt: nowIso(), error: err instanceof Error ? err.message : String(err) });
      });
      return { jobId: job.id, status: "queued" };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects/:projectId/generate/outline", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      await resolveProjectRootPath(projectId);

      const running = findRunningGenerateJob(projectId);
      if (running) return { jobId: running.id, status: running.status };

      const job = createGenerateJob(projectId);
      updateJob(job.id, { status: "queued" });
      void runGenerateOutlineStep(job).catch((err) => {
        updateJob(job.id, { status: "failed", finishedAt: nowIso(), error: err instanceof Error ? err.message : String(err) });
      });
      return { jobId: job.id, status: "queued" };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects/:projectId/generate/content", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      await resolveProjectRootPath(projectId);

      const running = findRunningGenerateJob(projectId);
      if (running) return { jobId: running.id, status: running.status };

      const job = createGenerateJob(projectId);
      updateJob(job.id, { status: "queued" });
      void runGenerateContentStep(job).catch((err) => {
        updateJob(job.id, { status: "failed", finishedAt: nowIso(), error: err instanceof Error ? err.message : String(err) });
      });
      return { jobId: job.id, status: "queued" };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.post("/api/projects/:projectId/generate/images", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      await resolveProjectRootPath(projectId);

      const running = findRunningGenerateJob(projectId);
      if (running) return { jobId: running.id, status: running.status };

      const job = createGenerateJob(projectId);
      updateJob(job.id, { status: "queued" });
      void runGenerateImagesStep(job).catch((err) => {
        updateJob(job.id, { status: "failed", finishedAt: nowIso(), error: err instanceof Error ? err.message : String(err) });
      });
      return { jobId: job.id, status: "queued" };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.put("/api/projects/:projectId/theme", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const theme = ThemeSchema.parse(req.body);
      const projectRootPath = await resolveProjectRootPath(projectId);

      withProjectDb(projectRootPath, (db) => {
        const themeVersion = nextVersion(db, "theme_versions", projectId);
        db.prepare(
          `INSERT INTO theme_versions (id, project_id, version, theme_json, created_at)
           VALUES (@id, @project_id, @version, @theme_json, @created_at)`,
        ).run({
          id: randomUUID(),
          project_id: projectId,
          version: themeVersion,
          theme_json: JSON.stringify(theme),
          created_at: nowIso(),
        });
      });

      return { ok: true };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.put("/api/projects/:projectId/outline", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const outline = OutlineSchema.parse(req.body);
      const projectRootPath = await resolveProjectRootPath(projectId);

      const slideCount = withProjectDb(projectRootPath, (db) => {
        const outlineVersion = nextVersion(db, "outline_versions", projectId);

        clearSlides(db, projectId);

        db.prepare(
          `INSERT INTO outline_versions (id, project_id, version, outline_json, created_at)
           VALUES (@id, @project_id, @version, @outline_json, @created_at)`,
        ).run({
          id: randomUUID(),
          project_id: projectId,
          version: outlineVersion,
          outline_json: JSON.stringify(outline),
          created_at: nowIso(),
        });

        const insertSlide = db.prepare(
          `INSERT INTO slides (id, project_id, section_index, slide_index, title, summary, content_json, status, error_message, updated_at)
           VALUES (@id, @project_id, @section_index, @slide_index, @title, @summary, NULL, @status, NULL, @updated_at)`,
        );

        let total = 0;
        outline.sections.forEach((section, sectionIndex) => {
          section.slides.forEach((slide, slideIndex) => {
            insertSlide.run({
              id: randomUUID(),
              project_id: projectId,
              section_index: sectionIndex,
              slide_index: slideIndex,
              title: slide.title,
              summary: slide.summary,
              status: "pending",
              updated_at: nowIso(),
            });
            total += 1;
          });
        });
        return total;
      });

      return { ok: true, slideCount };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.put("/api/projects/:projectId/slides/:slideId/content", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const slideId = String((req.params as any).slideId);
      const content = SlideContentSchema.parse(req.body);
      const projectRootPath = await resolveProjectRootPath(projectId);

      withProjectDb(projectRootPath, (db) => {
        const slide = db.prepare("SELECT id FROM slides WHERE id = ? AND project_id = ?").get(slideId, projectId) as any;
        if (!slide) throw new Error("页面不存在。");

        db.prepare(
          `UPDATE slides
           SET content_json = @content_json,
               status = @status,
               error_message = NULL,
               updated_at = @updated_at
           WHERE id = @id AND project_id = @project_id`,
        ).run({
          id: slideId,
          project_id: projectId,
          content_json: JSON.stringify(content),
          status: "text_ready",
          updated_at: nowIso(),
        });
      });

      return { ok: true };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  const ExportSchema = z.object({
    type: z.enum(["pdf", "pptx"]),
  });

  app.post("/api/projects/:projectId/export", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const body = ExportSchema.parse(req.body);
      const item = await exportProject({ projectId, type: body.type });
      return { ...item, fileUrl: `/api/projects/${projectId}/files/${item.relPath}` };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.get("/api/projects/:projectId/exports", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const exports = await listProjectExports({ projectId });
      return {
        exports: exports.map((e) => ({
          ...e,
          fileUrl: `/api/projects/${projectId}/files/${e.relPath}`,
        })),
      };
    } catch (err) {
      reply.code(400);
      return toApiError(err);
    }
  });

  app.get("/api/jobs/:jobId", async (req, reply) => {
    const jobId = String((req.params as any).jobId);
    const job = getJob(jobId);
    if (!job) {
      reply.code(404);
      return { error: "任务不存在" };
    }
    return job;
  });

  app.get("/api/projects/:projectId/files/*", async (req, reply) => {
    try {
      const projectId = String((req.params as any).projectId);
      const relPath = String((req.params as any)["*"] || "");
      if (!relPath.startsWith("images/") && !relPath.startsWith("exports/")) {
        reply.code(403);
        return { error: "禁止访问" };
      }
      const projectRootPath = await resolveProjectRootPath(projectId);
      const { absPath, contentType } = resolveSafeProjectFile(projectRootPath, relPath);
      reply.type(contentType);
      return reply.send(createReadStream(absPath));
    } catch (err) {
      reply.code(404);
      return toApiError(err);
    }
  });

  const webDistDir = resolveWebDistDir({ webDistDir: opts?.webDistDir ?? null });
  if (webDistDir) {
    await app.register(fastifyStatic, { root: webDistDir, wildcard: false });
    app.get("/*", async (_req, reply) => {
      return reply.sendFile("index.html");
    });
  }

  return app;
}

export async function startServer(opts?: StartServerOptions): Promise<{ app: Awaited<ReturnType<typeof buildServer>>; address: string }> {
  await ensureConfigDirExists();
  const app = await buildServer(opts);
  const port = typeof opts?.port === "number" ? opts.port : Number(process.env.PORT || 8787);
  const host = opts?.host ?? "127.0.0.1";
  const address = await app.listen({ port, host });
  return { app, address };
}

export async function startServerFromEnv(): Promise<void> {
  const { address } = await startServer({
    port: Number(process.env.PORT || 8787),
    host: "127.0.0.1",
    logger: true,
  });
  // eslint-disable-next-line no-console
  console.log(`Server listening: ${address}`);
}
