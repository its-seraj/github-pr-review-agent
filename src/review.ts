import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { buildDiff } from "./diff.js";
import { GitHubClient, type PrRef } from "./github.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt.js";
import { ReviewSchema, type Review } from "./schema.js";
import { buildTools } from "./tools.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ReviewOptions {
  model: string;
  effort: Effort;
  maxFiles: number;
  maxTurns: number;
  log: (msg: string) => void;
}

export interface ReviewResult {
  review: Review;
  meta: {
    title: string;
    author: string;
    url: string;
    ref: PrRef;
    headSha: string;
    changedFiles: number;
    /** Every file in the PR, with GitHub's own stats (not model-generated). */
    files: { file: string; status: string; additions: number; deletions: number }[];
    reviewedFiles: string[];
    skipped: { file: string; reason: string }[];
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
    turns: number;
    model: string;
  };
}

export class ReviewError extends Error {}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}

export async function reviewPullRequest(
  ref: PrRef,
  gh: GitHubClient,
  client: Anthropic,
  opts: ReviewOptions,
): Promise<ReviewResult> {
  opts.log(`Fetching PR ${ref.owner}/${ref.repo}#${ref.number}...`);
  const pr = await gh.getPr(ref);
  const files = await gh.getPrFiles(ref, 3000);
  const diff = buildDiff(files, {
    maxFiles: opts.maxFiles,
    maxPatchChars: 40_000,
    maxTotalChars: 300_000,
  });
  if (diff.included.length === 0) {
    throw new ReviewError("This PR has no reviewable text changes (only lockfiles, binaries or deletions).");
  }
  opts.log(
    `Reviewing ${diff.included.length} file(s)` +
      (diff.skipped.length ? `, skipping ${diff.skipped.length}` : "") +
      ` with ${opts.model} (effort: ${opts.effort})...`,
  );

  const tools = buildTools({
    gh,
    ref,
    headSha: pr.headSha,
    onCall: (name, input) => opts.log(`  tool: ${name} ${JSON.stringify(input)}`),
  });

  const runner = client.beta.messages.toolRunner({
    model: opts.model,
    max_tokens: 16000,
    max_iterations: opts.maxTurns,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort, format: betaZodOutputFormat(ReviewSchema) },
    // Server-side refusal fallback (recommended default for Opus 5.5).
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Cache the system prompt + diff across the agent loop's turns.
    cache_control: { type: "ephemeral" },
    system: SYSTEM_PROMPT,
    tools,
    messages: [{ role: "user", content: buildUserPrompt(ref, pr, diff) }],
  });

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let turns = 0;
  let last: Anthropic.Beta.BetaMessage | undefined;
  try {
    for await (const message of runner) {
      turns++;
      last = message;
      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ReviewError("Anthropic authentication failed. Check ANTHROPIC_API_KEY (or run `ant auth login`).");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ReviewError("Anthropic rate limit hit. Wait a bit and retry.");
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new ReviewError(`Model not found: ${opts.model}. Check --model.`);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ReviewError(`Anthropic API error ${err.status}: ${err.message}`);
    }
    throw err;
  }

  if (!last) throw new ReviewError("The model returned no response.");
  if (last.stop_reason === "refusal") {
    throw new ReviewError(`The model declined to review this PR (${last.stop_details?.category ?? "policy"}).`);
  }
  if (last.stop_reason === "max_tokens") {
    throw new ReviewError("The review was cut off (max_tokens). Try a smaller PR or --max-files.");
  }
  if (last.stop_reason === "tool_use" || last.stop_reason === "pause_turn") {
    throw new ReviewError(`The agent hit the --max-turns limit (${opts.maxTurns}) before finishing. Raise --max-turns.`);
  }

  const text = last.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let parsed: Review;
  try {
    parsed = ReviewSchema.parse(extractJson(text));
  } catch (e) {
    throw new ReviewError(`The model's answer was not a valid review: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    review: parsed,
    meta: {
      title: pr.title,
      author: pr.author,
      url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
      ref,
      headSha: pr.headSha,
      changedFiles: pr.changedFiles,
      files: files.map((f) => ({ file: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
      reviewedFiles: diff.included,
      skipped: diff.skipped,
      usage,
      turns,
      model: opts.model,
    },
  };
}
