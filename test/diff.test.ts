import { describe, expect, it } from "vitest";
import { annotatePatch, buildDiff, isReviewable } from "../src/diff.js";

const PATCH = [
  "@@ -10,4 +10,5 @@ function f() {",
  " keep1",
  "-old",
  "+new1",
  "+new2",
  " keep2",
].join("\n");

describe("annotatePatch", () => {
  it("numbers context and added lines by their NEW-file line, leaves removed lines blank", () => {
    const lines = annotatePatch(PATCH).split("\n");
    expect(lines[0]).toBe("@@ -10,4 +10,5 @@ function f() {");
    expect(lines[1]).toBe("   10  keep1");
    expect(lines[2]).toBe("      -old");
    expect(lines[3]).toBe("   11 +new1");
    expect(lines[4]).toBe("   12 +new2");
    expect(lines[5]).toBe("   13  keep2");
  });

  it("restarts numbering at each hunk", () => {
    const out = annotatePatch("@@ -1 +1 @@\n+a\n@@ -50 +60 @@\n+b");
    expect(out).toContain("    1 +a");
    expect(out).toContain("   60 +b");
  });
});

describe("isReviewable", () => {
  it("filters lockfiles, minified and binary-ish files", () => {
    expect(isReviewable("package-lock.json")).toBe(false);
    expect(isReviewable("web/app.min.js")).toBe(false);
    expect(isReviewable("logo.png")).toBe(false);
    expect(isReviewable("src/index.ts")).toBe(true);
  });
});

describe("buildDiff", () => {
  const limits = { maxFiles: 2, maxPatchChars: 1000, maxTotalChars: 100000 };
  const f = (filename: string, patch?: string, status = "modified") => ({
    filename,
    status,
    additions: 1,
    deletions: 0,
    patch,
  });

  it("reports every skipped file with a reason", () => {
    const d = buildDiff(
      [f("a.ts", PATCH), f("yarn.lock", PATCH), f("img.bin"), f("gone.ts", PATCH, "removed"), f("b.ts", PATCH), f("c.ts", PATCH)],
      limits,
    );
    expect(d.included).toEqual(["a.ts", "b.ts"]);
    expect(d.skipped.map((s) => s.file)).toEqual(["yarn.lock", "img.bin", "gone.ts", "c.ts"]);
    expect(d.skipped.find((s) => s.file === "c.ts")!.reason).toMatch(/max-files/);
  });

  it("flags truncated patches instead of silently cutting them", () => {
    const big = "@@ -1 +1 @@\n" + "+x\n".repeat(2000);
    const d = buildDiff([f("big.ts", big)], limits);
    expect(d.text).toContain("patch truncated");
  });
});
