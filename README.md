# pr-review-agent

A CLI AI agent that reviews a GitHub pull request, similar to Copilot code review. Give it a PR URL and it prints a short review and saves it as `reviews/<owner>-<repo>-pr<number>.md`:

- 📁 **Modified Files**: a plain list of every changed file
- 🌟 **What's Great**: up to 3 specific, honest points
- 🐞 **Possible Bugs & Security Issues**: for each, a title with severity, the location, the offending code, short "Issues" bullets, and a "Recommendation" code block with the fix
- 🧪 **Missing Tests**: one line per file naming the cases to cover

Style and "best practice" remarks are deliberately left out so the review stays on point.

The agent is a Claude tool-use loop. Besides the diff it can call read-only tools (`read_file`, `list_files`, `search_code`) to check surrounding code and existing tests before it reports something. It does not clone the repo and it never writes to GitHub.

## Setup

```bash
npm install
```

The variables below are read from your environment. A `.env` file is **not** loaded automatically; set them in your shell (PowerShell: `$env:ANTHROPIC_API_KEY = "..."`, bash: `export ANTHROPIC_API_KEY=...`), or in your OS environment settings.

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Read access to the repo (`repo` scope for private repos). Optional for public repos, but raises rate limits. |
| `ANTHROPIC_API_KEY` | Anthropic key. Alternatively run `ant auth login`. |

## Usage

```bash
npm run dev -- https://github.com/<owner>/<repo>/pull/<number>

# options
npm run dev -- <pr-url> --model claude-sonnet-5-5   # cheaper model
npm run dev -- <pr-url> --effort medium             # less thinking, lower cost
npm run dev -- <pr-url> --json                      # machine-readable output
```

| Flag | Default | |
|---|---|---|
| `--model` | `claude-opus-5-5` | Any Claude model ID |
| `--effort` | `high` | `low` / `medium` / `high` / `xhigh` / `max` |
| `--max-files` | `40` | Files included in the review. Skipped files are listed in the output. |
| `--max-turns` | `12` | Cap on agent tool-use rounds |
| `--out-dir` | `reviews` | Where the Markdown file is saved. Re-reviewing the same PR overwrites its file. |
| `--no-save` | off | Don't write the Markdown file |
| `--json` | off | Print the raw result as JSON instead of the formatted review |

To install as a command: `npm run build && npm link`, then `pr-review <url>`.

Progress (fetching, tool calls) goes to stderr and the review goes to stdout, so `pr-review <url> > review.txt` works.

## How it works

1. `github.ts` fetches PR metadata and per-file patches from the GitHub REST API.
2. `diff.ts` drops lockfiles, generated and binary files, and prefixes each diff line with its new-file line number so findings cite real lines. Anything skipped or truncated is reported to the model and in the output.
3. `review.ts` runs the agent loop (`tools.ts`). The final answer is schema-validated JSON (`schema.ts`).
4. `render.ts` renders it twice: coloured for the terminal and Markdown for the saved file.

## Safety

- PR content is untrusted. The prompt tells the model to treat it as data, and the tools are read-only and limited to the PR's repo.
- Tokens are read from the environment only and are never logged.
- Token use is capped by file count, diff size, turn count and `max_tokens`.

## Develop

```bash
npm test          # unit tests (vitest)
npm run typecheck
```
