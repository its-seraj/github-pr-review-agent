import { describe, expect, it } from "vitest";
import { GitHubError, parsePrUrl } from "../src/github.js";

describe("parsePrUrl", () => {
  it("parses a plain PR URL", () => {
    expect(parsePrUrl("https://github.com/octo/repo/pull/42")).toEqual({ owner: "octo", repo: "repo", number: 42 });
  });
  it("accepts /files, query strings and fragments", () => {
    expect(parsePrUrl("https://github.com/octo/repo/pull/42/files?diff=split#diff-abc").number).toBe(42);
    expect(parsePrUrl("https://github.com/octo/repo/pull/7#issuecomment-1").number).toBe(7);
  });
  it("rejects non-PR and non-GitHub URLs", () => {
    expect(() => parsePrUrl("https://github.com/octo/repo/issues/42")).toThrow(GitHubError);
    expect(() => parsePrUrl("https://gitlab.com/octo/repo/pull/42")).toThrow(/github\.com/);
    expect(() => parsePrUrl("not a url")).toThrow(/valid URL/);
  });
});
