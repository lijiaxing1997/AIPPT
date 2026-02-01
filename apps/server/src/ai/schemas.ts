import { z } from "zod";

export const OutlineSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        slides: z
          .array(
            z.object({
              title: z.string().min(1),
              summary: z.string().min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export type Outline = z.infer<typeof OutlineSchema>;

export const ThemeSchema = z.object({
  styleName: z.string().min(1),
  stylePrompt: z.string().min(1),
});

export type Theme = z.infer<typeof ThemeSchema>;

export const SlideContentSchema = z.object({
  bullets: z.array(z.string().min(1)).min(2).max(8),
  speakerNotes: z.string().min(1),
  imageDescription: z.string().min(1),
});

export type SlideContent = z.infer<typeof SlideContentSchema>;

