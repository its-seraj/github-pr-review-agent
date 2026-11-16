import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { GitHubClient, GitHubError, type PrRef } from "./github.js";

const MAX_READ_LINES = 400;
const MAX_READ_CHARS = 30_000;
const MAX_LIST_RESULTS = 80;

export interface ToolContext {
  gh: GitHubClient;
  ref: PrRef;
  headSha: string;
  onCall?: (name: string, input: unknown) => void;
}

function badPath(p: string): boolean {
  return p.startsWith("/") || p.split(/[\\/]/).includes("..");
}

/**
 * Read-only tools that look at the PR's head commit through the GitHub API.
 * There is no shell, no filesystem access and no write capability, so even a
 * prompt-injected PR can't make the agent do anything beyond reading this repo.
 */
export function buildTools(ctx: ToolContext) {
  let treeCache: Promise<{ paths: string[]; truncated: boolean }> | undefined;
  const tree = () => (treeCache ??= ctx.gh.getTree(ctx.ref, ctx.headSha));

  const readFile = betaZodTool({
    name: "read_file",
    description:
      "Read a file from the repository at the PR's head commit, with line numbers. " +
      "Use it to see surrounding code, callers, or the full definition of something the diff touches. " +
      `Returns at most ${MAX_READ_LINES} lines; pass start_line/end_line to page through large files.`,
    inputSchema: z.object({
      path: z.string().describe("Repo-relative path, e.g. src/auth/login.ts"),
      start_line: z.number().int().min(1).optional(),
      end_line: z.number().int().min(1).optional(),
    }),
    run: async (input) => {
      ctx.onCall?.("read_file", input);
      if (badPath(input.path)) return "Error: path must be repo-relative with no '..'.";
      try {
        const text = await ctx.gh.getFileAtRef(ctx.ref, input.path, ctx.headSha);
        if (text === null) return `File not found at PR head: ${input.path}`;
        const lines = text.split("\n");
        const start = input.start_line ?? 1;
        const end = Math.min(input.end_line ?? start + MAX_READ_LINES - 1, start + MAX_READ_LINES - 1, lines.length);
        let out = lines
          .slice(start - 1, end)
          .map((l, i) => `${String(start + i).padStart(5)} ${l}`)
          .join("\n");
        let note = "";
        if (out.length > MAX_READ_CHARS) {
          out = out.slice(0, MAX_READ_CHARS);
          note = "\n[output truncated by size limit; request a smaller line range]";
        }
        if (end < lines.length) note += `\n[showing lines ${start}-${end} of ${lines.length}]`;
        return out + note;
      } catch (e) {
        return `Error: ${e instanceof GitHubError ? e.message : String(e)}`;
      }
    },
  });

  const listFiles = betaZodTool({
    name: "list_files",
    description:
      "List repository file paths at the PR head whose path contains the given substring (case-insensitive). " +
      "Use it to locate related modules and existing tests, e.g. 'auth', '.test.', '_test.go', 'spec'.",
    inputSchema: z.object({
      contains: z.string().min(1).describe("Substring to match against the full path"),
    }),
    run: async (input) => {
      ctx.onCall?.("list_files", input);
      try {
        const { paths, truncated } = await tree();
        const needle = input.contains.toLowerCase();
        const hits = paths.filter((p) => p.toLowerCase().includes(needle));
        const shown = hits.slice(0, MAX_LIST_RESULTS);
        const more = hits.length > shown.length ? `\n[${hits.length - shown.length} more not shown; narrow the substring]` : "";
        const warn = truncated ? "\n[warning: repository tree was truncated by GitHub; list may be incomplete]" : "";
        return (shown.join("\n") || "No matching files.") + more + warn;
      } catch (e) {
        return `Error: ${e instanceof GitHubError ? e.message : String(e)}`;
      }
    },
  });

  const searchCode = betaZodTool({
    name: "search_code",
    description:
      "Search code in the repository (GitHub code search; indexes the DEFAULT branch, so brand-new code in this PR won't appear). " +
      "Use it to find usages/callers of an existing function or whether a symbol is already tested. Returns matching file paths only.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search terms, e.g. a function or symbol name"),
    }),
    run: async (input) => {
      ctx.onCall?.("search_code", input);
      try {
        const items = await ctx.gh.searchCode(ctx.ref, input.query);
        return items.map((i) => i.path).join("\n") || "No results.";
      } catch (e) {
        return `Error: ${e instanceof GitHubError ? e.message : String(e)}`;
      }
    },
  });

  return [readFile, listFiles, searchCode];
}
