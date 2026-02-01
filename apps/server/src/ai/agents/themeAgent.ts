import OpenAI from "openai";

import { callChatJson } from "../openaiJson.js";
import { ThemeSchema, type Theme, type Outline } from "../schemas.js";

export async function generateTheme(
  client: OpenAI,
  model: string,
  input: { projectName: string; sourceText: string; outline?: Outline | null },
): Promise<Theme> {
  const system = [
    "你是一个 PPT 主题风格生成 Agent。",
    "目标：生成一段可复用的「全局风格提示词 stylePrompt」，用于每页 PPT 图片生成，保证统一视觉风格。",
    "输出必须是严格 JSON（不要 Markdown，不要多余解释），格式：",
    JSON.stringify({ styleName: "风格名称", stylePrompt: "风格提示词（包含视觉风格/色彩/构图/字体/插画/质感等）" }, null, 2),
    "要求：",
    "- stylePrompt 必须可直接拼接到每页提示词前面使用",
    "- 语言：中文",
  ].join("\n");

  const userParts = [`项目名称：${input.projectName}`, "PPT 创作内容：", input.sourceText];

  if (input.outline) {
    userParts.push("", "大纲（供你理解主题）：", JSON.stringify(input.outline, null, 2));
  } else {
    userParts.push("", "说明：当前还没有大纲，请直接基于创作内容生成统一的 PPT 视觉风格。");
  }

  return await callChatJson(client, {
    model,
    label: "ThemeAgent",
    schema: ThemeSchema,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userParts.join("\n") },
    ],
    temperature: 0.4,
    maxTokens: 1600,
  });
}
