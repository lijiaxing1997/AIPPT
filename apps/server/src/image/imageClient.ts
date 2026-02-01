import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

import { loadConfig } from "../configStore.js";
import { createConcurrencyLimiter } from "../utils/concurrency.js";
import { nowIso } from "../utils/time.js";

import { decodeMaybeDataUrl, iterInlineImages, mimeToExt, truncateInlineData, isLikelyJson } from "./imageResponse.js";

export type ImageGenResult = {
  imagePath: string; // relative
  requestJson: unknown;
  responseJson: unknown;
  createdAt: string;
};

const limitImageGen = createConcurrencyLimiter(5);
const imageFetchDispatchers = new Map<string, Agent | ProxyAgent>();

function getImageFetchDispatcher(input: { timeoutMs: number; proxy?: { host: string; port: number } | null }): Agent | ProxyAgent {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));
  const proxyKey = input.proxy ? `${input.proxy.host}:${input.proxy.port}` : "direct";
  const key = `${proxyKey}|${timeoutMs}`;
  const existing = imageFetchDispatchers.get(key);
  if (existing) return existing;

  const dispatcher = input.proxy
    ? new ProxyAgent({
        uri: `http://${input.proxy.host}:${input.proxy.port}`,
        connectTimeout: timeoutMs,
        requestTls: { maxVersion: "TLSv1.2" },
      })
    : new Agent({
        connectTimeout: timeoutMs,
        connect: { maxVersion: "TLSv1.2" },
      });

  imageFetchDispatchers.set(key, dispatcher);
  return dispatcher;
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFileMaybe(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

function slideDirName(slideIndex: number): string {
  return `slide-${pad4(slideIndex + 1)}`;
}

function cacheKeyFrom(params: { baseURL: string; promptText: string; aspectRatio: string; imageSize: string }): string {
  return createHash("sha256").update(JSON.stringify(params)).digest("hex");
}

async function fetchJsonWithTimeout(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  dispatcher: Agent | ProxyAgent;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await undiciFetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: controller.signal,
      dispatcher: input.dispatcher,
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`生图接口 HTTP ${res.status}：${rawText.slice(0, 800)}`);
    }

    if (!isLikelyJson(Object.fromEntries(res.headers.entries()), rawText)) {
      throw new Error(`生图接口返回了非 JSON 响应：${rawText.slice(0, 800)}`);
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch (err) {
      throw new Error(`生图接口返回的 JSON 无法解析：${String(err)}\n原始响应预览：${rawText.slice(0, 800)}`);
    }
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`生图接口请求超时（${Math.ceil(input.timeoutMs / 1000)}s）`);
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`生图接口请求超时（${Math.ceil(input.timeoutMs / 1000)}s）`);
    }
    if (err instanceof Error) {
      const cause = (err as any).cause;
      if (cause instanceof Error) {
        const code = typeof (cause as any).code === "string" ? String((cause as any).code) : null;
        if (code === "UND_ERR_CONNECT_TIMEOUT") {
          const attempted = /attempted addresses: (.*), timeout:/.exec(cause.message)?.[1]?.trim();
          const attemptedHint = attempted ? `（尝试地址：${attempted}）` : "";
          throw new Error(`生图接口连接超时（${Math.ceil(input.timeoutMs / 1000)}s）${attemptedHint}`);
        }
        throw new Error(`生图接口请求失败：${code ? `${code} ` : ""}${cause.message}`);
      }
      if (cause != null) {
        throw new Error(`生图接口请求失败：${String(cause)}`);
      }
      throw err;
    }
    throw new Error(`生图接口请求失败：${String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateImageToProject(
  input: {
    projectRootPath: string;
    deckIndex: number;
    version: number;
    promptText: string;
  },
): Promise<ImageGenResult> {
  const config = await loadConfig();
  const baseURL = config.image.baseURL?.trim();
  const apiKey = config.image.apiKey?.trim();

  if (!baseURL) throw new Error("缺少生图接口地址。请先在设置中填写生图接口地址。");
  if (!apiKey) throw new Error("缺少生图访问令牌。请先在设置中填写生图访问令牌。");

  const timeoutSec = Number.isFinite(config.image.timeoutSec) && config.image.timeoutSec > 0 ? config.image.timeoutSec : 120;
  const timeoutMs = Math.floor(timeoutSec * 1000);
  const cacheEnabled = Boolean(config.image.cacheEnabled);
  const proxy = config.proxy.enabled && config.proxy.host && config.proxy.port > 0 ? { host: config.proxy.host, port: config.proxy.port } : null;
  const dispatcher = getImageFetchDispatcher({ timeoutMs, proxy });

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: input.promptText }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: config.image.aspectRatio || "16:9",
        imageSize: config.image.imageSize || "2K",
      },
    },
  };

  const createdAt = nowIso();

  const cacheKey = cacheKeyFrom({
    baseURL,
    promptText: input.promptText,
    aspectRatio: payload.generationConfig.imageConfig.aspectRatio,
    imageSize: payload.generationConfig.imageConfig.imageSize,
  });
  const cacheMetaPath = path.join(input.projectRootPath, "cache", "image", `${cacheKey}.json`);

  if (cacheEnabled) {
    const meta = (await readJsonFileMaybe(cacheMetaPath)) as any;
    const relImagePath = meta?.relImagePath;
    if (typeof relImagePath === "string" && relImagePath) {
      const absCacheImgPath = path.join(input.projectRootPath, relImagePath);
      try {
        const cachedBytes = await fs.readFile(absCacheImgPath);
        const ext = path.extname(absCacheImgPath).replace(".", "") || "png";

        const imagesDir = path.join(input.projectRootPath, "images");
        const slideDir = path.join(imagesDir, slideDirName(input.deckIndex));
        await ensureDir(slideDir);

        const fileName = `v${input.version}.${ext}`;
        const absOutPath = path.join(slideDir, fileName);
        await fs.writeFile(absOutPath, cachedBytes);

        const relPath = path.posix.join("images", slideDirName(input.deckIndex), fileName);

        return {
          imagePath: relPath,
          requestJson: { ...payload, cache: { enabled: true, hit: true, key: cacheKey } },
          responseJson: { cache: { enabled: true, hit: true, key: cacheKey, relImagePath } },
          createdAt,
        };
      } catch {
        // cache miss due to missing/corrupt file: fall back to network
      }
    }
  }

  const respJson = await limitImageGen(async () => {
    return await fetchJsonWithTimeout({
      url: baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: payload,
      timeoutMs,
      dispatcher,
    });
  });

  const images = Array.from(iterInlineImages(respJson));
  if (images.length === 0) {
    throw new Error("生图接口响应中未找到图片数据（inlineData）。");
  }

  const first = images[0]!;
  const ext = mimeToExt(first.mimeType);
  const b64 = decodeMaybeDataUrl(first.base64Data);
  const bytes = Buffer.from(b64, "base64");

  const imagesDir = path.join(input.projectRootPath, "images");
  const slideDir = path.join(imagesDir, slideDirName(input.deckIndex));
  await ensureDir(slideDir);

  const fileName = `v${input.version}.${ext}`;
  const absOutPath = path.join(slideDir, fileName);
  await fs.writeFile(absOutPath, bytes);

  const relPath = path.posix.join("images", slideDirName(input.deckIndex), fileName);

  if (cacheEnabled) {
    const cacheDir = path.join(input.projectRootPath, "cache", "image");
    await ensureDir(cacheDir);
    const relCacheImagePath = path.posix.join("cache", "image", `${cacheKey}.${ext}`);
    const absCacheImagePath = path.join(input.projectRootPath, relCacheImagePath);
    await fs.writeFile(absCacheImagePath, bytes);
    await writeJsonAtomic(cacheMetaPath, {
      relImagePath: relCacheImagePath,
      mimeType: first.mimeType,
      createdAt,
    });
  }

  return {
    imagePath: relPath,
    requestJson: cacheEnabled ? { ...payload, cache: { enabled: true, hit: false, key: cacheKey } } : payload,
    responseJson: truncateInlineData(respJson),
    createdAt,
  };
}
