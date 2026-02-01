import type { SlideContent, Theme } from "./schemas.js";

export function buildSlidePrompt(input: {
  theme: Theme;
  slideTitle: string;
  bullets: string[];
  imageDescription: string;
}): string {
  const bulletsText = input.bullets.map((b) => `- ${b}`).join("\n");

  return [
    input.theme.stylePrompt.trim(),
    "",
    "请生成一张 16:9 的 PPT 页面图片（横版），适合投影展示，文字清晰、留白充足。",
    "页面内容（请把文字直接排版进画面里，中文）：",
    `标题：${input.slideTitle}`,
    "要点：",
    bulletsText,
    "",
    "画面/插画/图形设计：",
    input.imageDescription.trim(),
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

