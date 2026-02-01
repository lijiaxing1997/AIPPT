import type { IncomingHttpHeaders } from "node:http";

export type InlineImage = {
  mimeType: string | null;
  base64Data: string;
};

export function truncateInlineData(node: unknown, maxLen = 120): unknown {
  if (Array.isArray(node)) return node.map((v) => truncateInlineData(v, maxLen));
  if (!node || typeof node !== "object") return node;

  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "inlineData" && v && typeof v === "object") {
      const inline = v as Record<string, unknown>;
      const data = inline.data;
      if (typeof data === "string" && data.length > 0) {
        out[k] = { ...inline, data: `${data.slice(0, maxLen)}...(truncated, len=${data.length})` };
        continue;
      }
    }
    out[k] = truncateInlineData(v, maxLen);
  }
  return out;
}

export function* iterInlineImages(node: unknown): Generator<InlineImage> {
  if (Array.isArray(node)) {
    for (const item of node) yield* iterInlineImages(item);
    return;
  }

  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  const inlineData = obj.inlineData;
  if (inlineData && typeof inlineData === "object") {
    const inline = inlineData as Record<string, unknown>;
    const data = inline.data;
    const mimeType = inline.mimeType;
    if (typeof data === "string" && data.length > 0) {
      yield {
        mimeType: typeof mimeType === "string" ? mimeType : null,
        base64Data: data,
      };
    }
  }

  for (const v of Object.values(obj)) {
    yield* iterInlineImages(v);
  }
}

export function decodeMaybeDataUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("data:")) return trimmed;
  const comma = trimmed.indexOf(",");
  if (comma === -1) return trimmed;
  return trimmed.slice(comma + 1).trim();
}

export function mimeToExt(mimeType: string | null): string {
  const m = (mimeType || "").toLowerCase().trim();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "image/bmp") return "bmp";
  if (m === "image/tiff") return "tiff";
  return "png";
}

export function contentTypeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "bmp") return "image/bmp";
  if (e === "tiff") return "image/tiff";
  if (e === "pdf") return "application/pdf";
  if (e === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

export function isLikelyJson(headers: IncomingHttpHeaders, fallbackBody: string): boolean {
  const ct = String(headers["content-type"] || "");
  if (ct.includes("application/json")) return true;
  const t = fallbackBody.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}
