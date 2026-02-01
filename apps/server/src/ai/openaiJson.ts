import OpenAI from "openai";
import { z } from "zod";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

import { loadConfig } from "../configStore.js";
import { withRetries } from "../utils/retry.js";

const openAiDispatchers = new Map<string, Agent | ProxyAgent>();

function getOpenAiDispatcher(proxy: { host: string; port: number } | null): Agent | ProxyAgent {
  const proxyKey = proxy ? `${proxy.host}:${proxy.port}` : "direct";
  const existing = openAiDispatchers.get(proxyKey);
  if (existing) return existing;
  const dispatcher = proxy
    ? new ProxyAgent({ uri: `http://${proxy.host}:${proxy.port}`, connectTimeout: 30_000 })
    : new Agent({ connectTimeout: 30_000 });
  openAiDispatchers.set(proxyKey, dispatcher);
  return dispatcher;
}

export async function createOpenAiClient(): Promise<{ client: OpenAI; model: string }> {
  const config = await loadConfig();
  const apiKey = config.openai.apiKey?.trim();
  const model = config.openai.model?.trim();

  if (!apiKey) throw new Error("缺少 OpenAI 密钥。请先在设置中填写 OpenAI 密钥。");
  if (!model) throw new Error("缺少 OpenAI 模型。请先在设置中填写 OpenAI 模型。");

  const baseURL = config.openai.baseURL?.trim() || undefined;
  const proxy = config.proxy.enabled && config.proxy.host && config.proxy.port > 0 ? { host: config.proxy.host, port: config.proxy.port } : null;
  const dispatcher = getOpenAiDispatcher(proxy);
  const client = new OpenAI({
    apiKey,
    baseURL,
    fetch: ((input: any, init: any) => undiciFetch(input as any, { ...((init || {}) as any), dispatcher }) as any) as any,
  });
  return { client, model };
}

export async function callChatJson<T>(
  client: OpenAI,
  params: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    schema: z.ZodSchema<T>;
    label: string;
    temperature?: number;
    maxTokens?: number;
  },
): Promise<T> {
  return await withRetries(3, async (attempt) => {
    const completion = await client.chat.completions.create({
      model: params.model,
      messages: params.messages,
      response_format: { type: "json_object" },
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 2500,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI 返回了空响应内容。");

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (err) {
      throw new Error(`OpenAI 返回的 JSON 无法解析（第 ${attempt} 次）：${String(err)}\n原始内容：${content.slice(0, 600)}`);
    }

    const parsed = params.schema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`OpenAI 返回的 JSON 结构不符合预期（第 ${attempt} 次）：${parsed.error.message}`);
    }
    return parsed.data;
  }, { label: params.label });
}
