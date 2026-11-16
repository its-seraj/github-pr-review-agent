#!/usr/bin/env node
import Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { GitHubClient, GitHubError, parsePrUrl } from "./github.js";
import { makeStyle, renderMarkdown, renderTerminal } from "./render.js";
import { ReviewError, reviewPullRequest, type Effort } from "./review.js";

const USAGE = `Usage: pr-review <github-pr-url> [options]

Options:
  --model <id>        Claude model (default: claude-opus-5-5)
  --effort <level>    low | medium | high | xhigh | max (default: high)
  --max-files <n>     Max files to include in the review (default: 40)
  --max-turns <n>     Max agent turns / tool-use rounds (default: 12)
  --out-dir <dir>     Where to save the Markdown review (default: reviews)
  --no-save           Don't write the Markdown file
  --json              Print the raw result as JSON instead of the formatted review
  -h, --help          Show this help

The review is saved to <out-dir>/<owner>-<repo>-pr<number>.md (re-reviewing the same PR overwrites it).

Environment:
  GITHUB_TOKEN        GitHub token (needed for private repos; raises rate limits)
  ANTHROPIC_API_KEY   Anthropic API key (or run \`ant auth login\`)`;

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: "string", default: "claude-opus-5-5" },
      effort: { type: "string", default: "high" },
      "max-files": { type: "string", default: "40" },
      "max-turns": { type: "string", default: "12" },
      "out-dir": { type: "string", default: "reviews" },
      "no-save": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help || positionals.length !== 1) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  if (!EFFORTS.includes(values.effort!)) {
    console.error(`--effort must be one of: ${EFFORTS.join(", ")}`);
    return 2;
  }
  const maxFiles = Number(values["max-files"]);
  const maxTurns = Number(values["max-turns"]);
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || !Number.isInteger(maxTurns) || maxTurns < 1) {
    console.error("--max-files and --max-turns must be positive integers.");
    return 2;
  }

  const ref = parsePrUrl(positionals[0]!);
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Warning: GITHUB_TOKEN is not set. Public repos only, with a low rate limit.");
  }

  const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && !values.json;
  const result = await reviewPullRequest(ref, new GitHubClient(token), new Anthropic(), {
    model: values.model!,
    effort: values.effort as Effort,
    maxFiles,
    maxTurns,
    log: (m) => console.error(m),
  });

  console.log(values.json ? JSON.stringify(result, null, 2) : renderTerminal(result, makeStyle(useColor)));

  if (!values["no-save"]) {
    const safe = (s: string) => s.replace(/[^\w.-]/g, "_");
    const file = path.resolve(values["out-dir"]!, `${safe(ref.owner)}-${safe(ref.repo)}-pr${ref.number}.md`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, renderMarkdown(result), "utf8");
    console.error(`Saved review to ${file}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof GitHubError || err instanceof ReviewError) {
      console.error(`Error: ${err.message}`);
    } else if (err instanceof Error && /apiKey|authToken|credentials/i.test(err.message)) {
      console.error("Error: no Anthropic credentials found. Set ANTHROPIC_API_KEY or run `ant auth login`.");
    } else {
      console.error(err);
    }
    process.exit(1);
  },
);
