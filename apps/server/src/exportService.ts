import fs from "node:fs/promises";
import path from "node:path";

import { PDFDocument } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

import { resolveProjectRootPath } from "./projectLocator.js";
import { withProjectDb } from "./projectState.js";
import { nowIso } from "./utils/time.js";

export type ExportType = "pdf" | "pptx";

export type ExportItem = {
  type: ExportType;
  fileName: string;
  relPath: string;
  absPath: string;
  createdAt: string;
  sizeBytes: number;
};

type ExportSlide = {
  title: string;
  summary: string;
  contentJson: string | null;
  imagePath: string | null;
};

function sanitizeFileBaseName(input: string): string {
  const trimmed = input.trim() || "兴河PPT";
  return trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function exportTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function ensureWithinProject(projectRootPath: string, relPath: string): string {
  const cleaned = relPath.replace(/^\/+/, "").replace(/\\/g, "/");
  const abs = path.resolve(projectRootPath, cleaned);
  const root = path.resolve(projectRootPath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("文件路径无效");
  }
  return abs;
}

function tryParseSpeakerNotes(contentJson: string | null): string | null {
  if (!contentJson) return null;
  try {
    const parsed = JSON.parse(contentJson) as any;
    if (parsed && typeof parsed.speakerNotes === "string" && parsed.speakerNotes.trim()) return parsed.speakerNotes.trim();
    return null;
  } catch {
    return null;
  }
}

function listSlidesForExport(projectRootPath: string, projectId: string): ExportSlide[] {
  return withProjectDb(projectRootPath, (db) => {
    const rows = db
      .prepare(
        `
        SELECT
          s.title,
          s.summary,
          s.content_json as contentJson,
          siv.image_path as imagePath
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
      title: String(r.title),
      summary: String(r.summary),
      contentJson: r.contentJson ? String(r.contentJson) : null,
      imagePath: r.imagePath ? String(r.imagePath) : null,
    }));
  });
}

async function exportPdf(projectRootPath: string, slides: ExportSlide[], absOutPath: string): Promise<void> {
  const pdfDoc = await PDFDocument.create();

  for (const s of slides) {
    if (!s.imagePath) continue;
    const absImgPath = ensureWithinProject(projectRootPath, s.imagePath);
    const bytes = await fs.readFile(absImgPath);
    const ext = path.extname(absImgPath).toLowerCase();

    const img =
      ext === ".jpg" || ext === ".jpeg"
        ? await pdfDoc.embedJpg(bytes)
        : ext === ".png"
          ? await pdfDoc.embedPng(bytes)
          : (() => {
              throw new Error(`PDF 导出不支持该图片格式：${ext || "(无扩展名)"}`);
            })();

    const page = pdfDoc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  const out = await pdfDoc.save();
  await fs.writeFile(absOutPath, out);
}

async function exportPptx(projectRootPath: string, slides: ExportSlide[], absOutPath: string): Promise<void> {
  const PptxGenCtor: any = (PptxGenJS as any)?.default ?? (PptxGenJS as any)?.PptxGenJS ?? PptxGenJS;
  if (typeof PptxGenCtor !== "function") {
    throw new Error("PptxGenJS 导入失败（不是构造函数）");
  }

  const pptx = new PptxGenCtor();
  pptx.layout = "LAYOUT_WIDE";

  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;

  for (const s of slides) {
    if (!s.imagePath) continue;
    const absImgPath = ensureWithinProject(projectRootPath, s.imagePath);
    const slide = pptx.addSlide();
    slide.addImage({ path: absImgPath, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });

    const notes = tryParseSpeakerNotes(s.contentJson);
    if (notes) {
      slide.addNotes(`${s.title}\n\n${notes}`);
    } else {
      slide.addNotes(`${s.title}\n\n${s.summary}`);
    }
  }

  await pptx.writeFile({ fileName: absOutPath });
}

export async function exportProject(input: { projectId: string; type: ExportType }): Promise<ExportItem> {
  const projectRootPath = await resolveProjectRootPath(input.projectId);

  const slides = listSlidesForExport(projectRootPath, input.projectId);
  if (slides.length === 0) throw new Error("没有可导出的页面，请先生成内容。");

  const missing = slides
    .map((s, idx) => ({ idx, hasImage: Boolean(s.imagePath) }))
    .filter((v) => !v.hasImage)
    .map((v) => v.idx + 1);
  if (missing.length > 0) {
    throw new Error(`以下页面尚未生成图片：${missing.join(", ")}。请等待生图完成或重试失败页。`);
  }

  const projectName = withProjectDb(projectRootPath, (db) => {
    const row = db.prepare("SELECT name FROM projects WHERE id = ?").get(input.projectId) as any;
    return row?.name ? String(row.name) : "兴河PPT";
  });

  const createdAt = nowIso();
  const ts = exportTimestamp(new Date());
  const base = sanitizeFileBaseName(projectName);
  const ext = input.type === "pdf" ? "pdf" : "pptx";
  const fileName = `${base}-${ts}.${ext}`;
  const relPath = path.posix.join("exports", fileName);
  const absOutPath = ensureWithinProject(projectRootPath, relPath);

  await fs.mkdir(path.dirname(absOutPath), { recursive: true });

  if (input.type === "pdf") {
    await exportPdf(projectRootPath, slides, absOutPath);
  } else {
    await exportPptx(projectRootPath, slides, absOutPath);
  }

  const stat = await fs.stat(absOutPath);

  return {
    type: input.type,
    fileName,
    relPath,
    absPath: absOutPath,
    createdAt,
    sizeBytes: stat.size,
  };
}

export async function listProjectExports(input: { projectId: string }): Promise<ExportItem[]> {
  const projectRootPath = await resolveProjectRootPath(input.projectId);
  const dir = path.join(projectRootPath, "exports");

  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }

  const items: ExportItem[] = [];
  for (const fileName of files) {
    const lower = fileName.toLowerCase();
    const type: ExportType | null = lower.endsWith(".pdf") ? "pdf" : lower.endsWith(".pptx") ? "pptx" : null;
    if (!type) continue;
    const relPath = path.posix.join("exports", fileName);
    const abs = ensureWithinProject(projectRootPath, relPath);
    const stat = await fs.stat(abs);
    items.push({
      type,
      fileName,
      relPath,
      absPath: abs,
      createdAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
    });
  }

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}
