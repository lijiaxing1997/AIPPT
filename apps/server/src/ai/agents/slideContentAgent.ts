import OpenAI from "openai";

import { callChatJson } from "../openaiJson.js";
import { SlideContentSchema, type SlideContent, type Outline, type Theme } from "../schemas.js";

export async function generateSlideContent(
  client: OpenAI,
  model: string,
  input: {
    projectName: string;
    sourceText: string;
    outline: Outline;
    theme: Theme;
    sectionTitle: string;
    slideTitle: string;
    slideSummary: string;
  },
): Promise<SlideContent> {
  const system = [
    "你是一个 PPT 单页内容生成 Agent。",
    "请为指定的这一页生成：要点 bullets、演讲者备注 speakerNotes、图片描述 imageDescription。",
    "输出必须是严格 JSON（不要 Markdown，不要多余解释），格式：",
    JSON.stringify(
      {
        bullets: ["要点 1", "要点 2", "要点 3"],
        speakerNotes: "讲稿（可稍长）",
        imageDescription: "用于生成该页视觉画面的描述（插画/图表/场景），要和标题要点一致",
      },
      null,
      2,
    ),
    "要求：",
    "- bullets 2-6 条",
    "- speakerNotes 用于讲解，可比 bullets 更具体（可包含例子/比喻/数据点）",
    "- imageDescription 要能生成「一张 16:9 的 PPT 页面图片」，需要包含：标题 + 内容 + 关键插画/图形的构图建议；",
    "- 语言：中文",
  ].join("\n");

  const user = [
    `项目名称：${input.projectName}`,
    "项目创作内容：",
    input.sourceText,
    "",
    `主题风格（参考）：${input.theme.styleName}`,
    "",
    `章节：${input.sectionTitle}`,
    `本页标题：${input.slideTitle}`,
    `本页概要：${input.slideSummary}`,
  ].join("\n");

  return await callChatJson(client, {
    model,
    label: "SlideContentAgent",
    schema: SlideContentSchema,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    maxTokens: 1800,
  });
}

