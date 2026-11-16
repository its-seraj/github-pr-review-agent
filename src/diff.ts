import type { PrFile } from "./github.js";

const SKIP_NAME = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/,
  /\.min\.(js|css)$/,
  /\.(map|snap|svg|png|jpe?g|gif|ico|pdf|woff2?|ttf|eot|zip|gz|jar|class|lock)$/i,
  /(^|\/)(dist|build|node_modules|vendor|__generated__)\//,
  /\.(pb\.go|generated\.\w+)$/,
];

export function isReviewable(filename: string): boolean {
  return !SKIP_NAME.some((re) => re.test(filename));
}

/**
 * Prefix every line of a unified-diff patch with its line number in the NEW file
 * (`+` and context lines) so the model can cite real line numbers instead of counting.
 * Removed lines get a blank gutter. Hunk headers are kept.
 */
export function annotatePatch(patch: string): string {
  const out: string[] = [];
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      out.push(raw);
      continue;
    }
    if (raw.startsWith("\\")) {
      out.push(raw); // "\ No newline at end of file"
    } else if (raw.startsWith("-")) {
      out.push(`      ${raw}`);
    } else {
      out.push(`${String(newLine).padStart(5)} ${raw}`);
      newLine++;
    }
  }
  return out.join("\n");
}

export interface DiffBundle {
  text: string;
  included: string[];
  skipped: { file: string; reason: string }[];
}

export interface DiffLimits {
  maxFiles: number;
  maxPatchChars: number;
  maxTotalChars: number;
}

export function buildDiff(files: PrFile[], limits: DiffLimits): DiffBundle {
  const included: string[] = [];
  const skipped: DiffBundle["skipped"] = [];
  const parts: string[] = [];
  let total = 0;

  for (const f of files) {
    if (!isReviewable(f.filename)) {
      skipped.push({ file: f.filename, reason: "lockfile / generated / binary-type file" });
      continue;
    }
    if (f.status === "removed") {
      skipped.push({ file: f.filename, reason: "file deleted" });
      continue;
    }
    if (!f.patch) {
      skipped.push({ file: f.filename, reason: "no textual patch (binary or too large for GitHub to diff)" });
      continue;
    }
    if (included.length >= limits.maxFiles) {
      skipped.push({ file: f.filename, reason: `over the --max-files limit (${limits.maxFiles})` });
      continue;
    }
    let patch = annotatePatch(f.patch);
    let note = "";
    if (patch.length > limits.maxPatchChars) {
      patch = patch.slice(0, limits.maxPatchChars);
      note = "\n[... patch truncated; use read_file to see the rest ...]";
    }
    const block = `=== ${f.filename} (${f.status}, +${f.additions}/-${f.deletions}) ===\n${patch}${note}\n`;
    if (total + block.length > limits.maxTotalChars) {
      skipped.push({ file: f.filename, reason: "total diff size limit reached" });
      continue;
    }
    total += block.length;
    parts.push(block);
    included.push(f.filename);
  }

  return { text: parts.join("\n"), included, skipped };
}
