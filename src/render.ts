import { SEVERITIES, type Review } from "./schema.js";
import type { ReviewResult } from "./review.js";

export function makeStyle(enabled: boolean) {
  const wrap = (open: number, close = 39) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31),
    yellow: wrap(33),
    green: wrap(32),
    blue: wrap(34),
    cyan: wrap(36),
    magenta: wrap(35),
  };
}
export type Style = ReturnType<typeof makeStyle>;

type Issue = Review["issues"][number];

const sortIssues = (issues: Issue[]) =>
  [...issues].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

/** Trim trailing whitespace and strip the indentation shared by all lines, so snippets are flush-left. */
export function cleanCode(code: string): string {
  const ls = code.replace(/\s+$/, "").replace(/^\s*\n/, "").split("\n");
  const indents = ls.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const strip = indents.length ? Math.min(...indents) : 0;
  return ls.map((l) => l.slice(strip)).join("\n");
}

const lineRange = (i: Issue) =>
  i.line_end && i.line_end !== i.line_start ? `Lines ${i.line_start}-${i.line_end}` : `Line ${i.line_start}`;

/** "Lines 40-42", with the file name only when the PR has several reviewed files. */
const location = (i: Issue, meta: ReviewResult["meta"]) =>
  meta.reviewedFiles.length > 1 ? `\`${i.file}\` · ${lineRange(i)}` : lineRange(i);

/** A fence long enough that code containing ``` can't break out of it. */
function fence(body: string, lang = ""): string {
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((m) => m.length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${body}\n${f}`;
}

export function renderMarkdown({ review, meta }: ReviewResult): string {
  const out: string[] = [];
  out.push(`# PR Review: ${meta.title}`);
  out.push(`[${meta.ref.owner}/${meta.ref.repo}#${meta.ref.number}](${meta.url}) · by ${meta.author}`);

  out.push("", "## 📁 Modified Files", "");
  for (const f of meta.files) out.push(`- \`${f.file}\``);

  out.push("", "---", "", "## 🌟 What's Great", "");
  if (!review.highlights.length) out.push("_Nothing specific called out._");
  for (const h of review.highlights) {
    out.push(`- **${h.title}**${h.file ? ` (\`${h.file}\`)` : ""}: ${h.detail}`);
  }

  out.push("", "---", "", "## 🐞 Possible Bugs & Security Issues", "");
  const issues = sortIssues(review.issues);
  if (!issues.length) out.push("_None found._");
  issues.forEach((i, n) => {
    out.push(
      `### ${n + 1}. ${i.title} (${i.severity.toUpperCase()})`,
      "",
      `**Location:** ${location(i, meta)}`,
      "",
      fence(cleanCode(i.error_code), i.language),
      "",
      "**Issues:**",
      "",
      ...i.problems.map((p) => `- ${p}`),
      "",
      "**Recommendation:**",
      "",
      fence(cleanCode(i.fixed_code), i.language),
      "",
    );
  });

  out.push("", "---", "", "## 🧪 Missing Tests", "");
  if (!review.missing_tests.length) out.push("_None._");
  for (const t of review.missing_tests) out.push(`- \`${t.file}\`: ${t.what_to_test}`);

  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

export function renderTerminal({ review, meta }: ReviewResult, s: Style): string {
  const out: string[] = [];
  const h = (title: string) => `\n${s.bold(title)}`;

  out.push(s.bold(`PR review: ${meta.title}`) + s.dim(`  by ${meta.author}`));

  out.push(h("📁 Modified Files"));
  for (const f of meta.files) out.push(`  ${s.cyan(f.file)}`);

  out.push(h("🌟 What's Great"));
  if (!review.highlights.length) out.push(s.dim("  (nothing specific called out)"));
  for (const x of review.highlights) out.push(`  ${s.green("+")} ${s.bold(x.title)}: ${x.detail}`);

  const sevColor = { critical: s.red, high: s.red, medium: s.yellow, low: s.blue } as const;
  const issues = sortIssues(review.issues);
  out.push(h("🐞 Possible Bugs & Security Issues"));
  if (!issues.length) out.push(s.dim("  None found."));
  issues.forEach((i, n) => {
    out.push(`\n  ${n + 1}. ${s.bold(i.title)} ${sevColor[i.severity](`(${i.severity.toUpperCase()})`)}`);
    out.push(`     ${s.dim(location(i, meta).replace(/`/g, ""))}`);
    for (const l of cleanCode(i.error_code).split("\n")) out.push(`     ${s.red(l)}`);
    out.push(`     ${s.bold("Issues:")}`);
    for (const p of i.problems) out.push(`       • ${p}`);
    out.push(`     ${s.bold("Recommendation:")}`);
    for (const l of cleanCode(i.fixed_code).split("\n")) out.push(`     ${s.green(l)}`);
  });

  out.push(h("🧪 Missing Tests"));
  if (!review.missing_tests.length) out.push(s.dim("  None."));
  for (const t of review.missing_tests) out.push(`  ${s.magenta("•")} ${s.bold(t.file)}: ${t.what_to_test}`);

  out.push("");
  const u = meta.usage;
  out.push(
    s.dim(
      `${meta.model} · ${meta.turns} turn(s) · ${u.input} in / ${u.output} out tokens` +
        (u.cacheRead || u.cacheWrite ? ` (cache: ${u.cacheRead} read, ${u.cacheWrite} written)` : ""),
    ),
  );
  return out.join("\n");
}
