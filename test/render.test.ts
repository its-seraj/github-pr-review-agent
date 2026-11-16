import { describe, expect, it } from "vitest";
import { cleanCode, makeStyle, renderMarkdown, renderTerminal } from "../src/render.js";
import type { ReviewResult } from "../src/review.js";
import { ReviewSchema } from "../src/schema.js";

const review = {
  highlights: [{ title: "Clean limiter abstraction", detail: "RateLimiter is easy to swap.", file: "a.ts" }],
  issues: [
    {
      title: "Off by one",
      severity: "low" as const,
      file: "a.ts",
      line_start: 3,
      problems: ["Loop skips the last item."],
      language: "typescript",
      error_code: "i <= n",
      fixed_code: "i < n",
    },
    {
      title: "Unvalidated External API URL Construction",
      severity: "high" as const,
      file: "b.ts",
      line_start: 40,
      line_end: 42,
      problems: ["tenantId is interpolated into the URL without validation", "Possible URL injection"],
      language: "typescript",
      error_code: "axios.post(`${base}/predict/${tenantId}`, batch)",
      fixed_code: "if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) return;\naxios.post(`${base}/predict/${tenantId}`, batch)",
    },
  ],
  missing_tests: [{ file: "a.ts", what_to_test: "burst over limit; reset after window" }],
};

const result: ReviewResult = {
  review,
  meta: {
    title: "Add rate limit",
    author: "dev",
    url: "https://github.com/o/r/pull/5",
    ref: { owner: "o", repo: "r", number: 5 },
    headSha: "abcdef1234567",
    changedFiles: 3,
    files: [
      { file: "a.ts", status: "added", additions: 10, deletions: 0 },
      { file: "b.ts", status: "modified", additions: 2, deletions: 1 },
      { file: "yarn.lock", status: "modified", additions: 99, deletions: 90 },
    ],
    reviewedFiles: ["a.ts", "b.ts"],
    skipped: [{ file: "yarn.lock", reason: "lockfile / generated / binary-type file" }],
    usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    turns: 1,
    model: "m",
  },
};

describe("ReviewSchema", () => {
  it("accepts a good review and rejects bad ones", () => {
    expect(ReviewSchema.safeParse(review).success).toBe(true);
    expect(ReviewSchema.safeParse({ ...review, issues: [{ ...review.issues[0], problems: [] }] }).success).toBe(false);
    expect(ReviewSchema.safeParse({ ...review, issues: [{ ...review.issues[0], fixed_code: undefined }] }).success).toBe(false);
    expect(ReviewSchema.safeParse({ ...review, highlights: Array(4).fill(review.highlights[0]) }).success).toBe(false);
  });
});

describe("renderMarkdown", () => {
  const md = renderMarkdown(result);
  const idx = (s: string) => md.indexOf(s);

  it("has the requested sections in order, separated by rules", () => {
    const order = ["## 📁 Modified Files", "## 🌟 What's Great", "## 🐞 Possible Bugs & Security Issues", "## 🧪 Missing Tests"];
    const positions = order.map(idx);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(md.match(/^---$/gm)).toHaveLength(3);
    expect(md).not.toMatch(/best practice/i);
  });

  it("lists modified files as a bare bullet list with no extra info", () => {
    const section = md.slice(idx("## 📁 Modified Files"), idx("---"));
    expect(section).toContain("- `a.ts`\n- `b.ts`\n- `yarn.lock`");
    expect(section).not.toMatch(/\+\d|added|modified|not reviewed/);
  });

  it("renders each issue as title (SEVERITY), location, code, Issues, Recommendation", () => {
    const issue = md.slice(idx("### 1."), idx("### 2."));
    expect(issue.startsWith("### 1. Unvalidated External API URL Construction (HIGH)")).toBe(true);
    expect(issue).toContain("**Location:** `b.ts` · Lines 40-42");
    expect(issue).toContain("```typescript\naxios.post(`${base}/predict/${tenantId}`, batch)\n```");
    expect(issue).toContain("**Issues:**\n\n- tenantId is interpolated");
    expect(issue.indexOf("**Issues:**")).toBeLessThan(issue.indexOf("**Recommendation:**"));
    expect(md).toContain("**Location:** `a.ts` · Line 3");
    expect(idx("Unvalidated External")).toBeLessThan(idx("Off by one"));
  });

  it("omits the file name from Location when only one file was reviewed, like the reference format", () => {
    const single = structuredClone(result);
    single.meta.reviewedFiles = ["b.ts"];
    const text = renderMarkdown(single);
    expect(text).toContain("**Location:** Lines 40-42\n");
    expect(text).toContain("**Location:** Line 3\n");
    expect(text).not.toContain("**Location:** `");
  });

  it("strips shared indentation so code blocks are flush-left", () => {
    const indented = structuredClone(result);
    indented.review.issues[0]!.error_code = "  let a;\n  try {\n    x();\n  } catch (e) {";
    const text = renderMarkdown(indented);
    expect(text).toContain("```typescript\nlet a;\ntry {\n  x();\n} catch (e) {\n```");
  });

  it("uses a longer fence when code contains backticks", () => {
    const tricky = structuredClone(result);
    tricky.review.issues[0]!.error_code = "const s = ```x```";
    expect(renderMarkdown(tricky)).toContain("````typescript");
  });

  it("says so when there is nothing to report", () => {
    const text = renderMarkdown({ ...result, review: { ...review, issues: [], missing_tests: [], highlights: [] } });
    expect(text).toContain("_None found._");
    expect(text).toContain("_None._");
  });
});

describe("cleanCode", () => {
  it("dedents, trims trailing space and leading blank lines, keeps relative indentation", () => {
    expect(cleanCode("\n    a\n      b\n    c\n\n")).toBe("a\n  b\nc");
    expect(cleanCode("x")).toBe("x");
    expect(cleanCode("")).toBe("");
  });
});

describe("renderTerminal", () => {
  it("renders the same sections without ANSI when colour is off", () => {
    const text = renderTerminal(result, makeStyle(false));
    for (const s of ["Modified Files", "What's Great", "Bugs & Security", "Missing Tests", "Recommendation:", "(HIGH)"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toMatch(/\x1b\[/);
  });
});
