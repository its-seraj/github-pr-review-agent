import { z } from "zod";

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const ReviewSchema = z.object({
  highlights: z
    .array(
      z.object({
        title: z.string().describe("Max 8 words."),
        detail: z.string().describe("ONE sentence of specific praise that references the actual code."),
        file: z.string().optional(),
      }),
    )
    .max(3)
    .describe("Up to 3 things done well. Specific, never generic."),
  issues: z
    .array(
      z.object({
        title: z.string().describe("Max 10 words, e.g. 'Unvalidated External API URL Construction'."),
        severity: z.enum(SEVERITIES),
        file: z.string(),
        line_start: z.number().int().describe("First line of the offending code in the NEW version of the file."),
        line_end: z.number().int().optional().describe("Last line, if the code spans several lines."),
        problems: z
          .array(z.string())
          .min(1)
          .max(3)
          .describe("1-3 short bullets (max ~20 words each) saying what is wrong and what can break."),
        language: z.string().describe("Code fence language for the snippets, e.g. typescript, python, go."),
        error_code: z.string().describe("The offending code, copied from the diff (1-8 lines, no line numbers or +/- markers)."),
        fixed_code: z
          .string()
          .describe("The recommended replacement code (1-15 lines). A brief comment above a changed line is fine."),
      }),
    )
    .describe("Real bugs and security problems only. No style or best-practice remarks."),
  missing_tests: z.array(
    z.object({
      file: z.string().describe("The source file whose behaviour lacks coverage."),
      what_to_test: z.string().describe("One line naming the specific cases to cover."),
    }),
  ),
});

export type Review = z.infer<typeof ReviewSchema>;
