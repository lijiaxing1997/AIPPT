import OpenAI from "openai";

import { callChatJson } from "../openaiJson.js";
import { OutlineSchema, type Outline } from "../schemas.js";

export async function generateOutline(client: OpenAI, model: string, input: { projectName: string; sourceText: string }): Promise<Outline> {
  const system = [
    "你是一个 PPT 大纲生成 Agent。",
    "请根据用户提供的 PPT 创作内容，生成「章节」与「每页标题 + 概要」。",
    "为了让 PPT 更完整，你必须包含这些页面：封面、目录、谢幕/结束页。",
    "输出必须是严格 JSON（不要 Markdown，不要多余解释），格式：",
    JSON.stringify(
      {
        sections: [
          {
            title: "章节标题",
            slides: [
              { title: "每页标题", summary: "该页要讲什么" },
            ],
          },
        ],
      },
      null,
      2,
    ),
    "结构要求：",
    "- 第一个章节建议用于「封面与目录」，至少包含 2 页：封面、目录（目录页概要中写清将列出哪些章节标题）。",
    "- 最后必须有「谢幕/结束」相关章节或页面（例如：总结、Q&A、谢谢）。",
    "页数由你决定：保证内容完整且不过度冗余，通常 8-20 页左右即可（可根据主题调整）。",
    "语言：中文。",
  ].join("\n");

  const user = [
    `项目名称：${input.projectName}`,
    "PPT 创作内容：",
    input.sourceText,
  ].join("\n");

  return await callChatJson(client, {
    model,
    label: "OutlineAgent",
    schema: OutlineSchema,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    maxTokens: 2600,
  });
}
