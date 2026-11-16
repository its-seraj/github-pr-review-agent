const API = "https://api.github.com";

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Accepts https://github.com/o/r/pull/123 plus /files, /commits, query strings and fragments. */
export function parsePrUrl(input: string): PrRef {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new GitHubError(`Not a valid URL: ${input}`);
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new GitHubError(`Only github.com pull request URLs are supported (got ${url.hostname}).`);
  }
  const m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
  if (!m) {
    throw new GitHubError(
      `Not a pull request URL. Expected https://github.com/<owner>/<repo>/pull/<number>, got ${input}`,
    );
  }
  return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
}

export interface PrInfo {
  title: string;
  body: string;
  author: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  state: string;
  draft: boolean;
  changedFiles: number;
  additions: number;
  deletions: number;
}

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export class GitHubClient {
  constructor(private readonly token: string | undefined) {}

  private async request(path: string, accept = "application/vnd.github+json"): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pr-review-agent",
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, { headers });
    if (res.ok) return res;

    if (res.status === 401) {
      throw new GitHubError("GitHub rejected the token (401). Check GITHUB_TOKEN.", 401);
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
        const when = reset ? ` Resets at ${new Date(reset).toLocaleTimeString()}.` : "";
        throw new GitHubError(
          `GitHub rate limit exceeded.${when}${this.token ? "" : " Set GITHUB_TOKEN to raise the limit."}`,
          res.status,
        );
      }
      throw new GitHubError(`GitHub denied access (${res.status}). The token may lack access to this repo.`, res.status);
    }
    if (res.status === 404) {
      throw new GitHubError(
        `Not found (404): ${path}${this.token ? "" : " (if this repo is private, set GITHUB_TOKEN)"}`,
        404,
      );
    }
    throw new GitHubError(`GitHub API error ${res.status} for ${path}`, res.status);
  }

  private async json<T>(path: string): Promise<T> {
    return (await this.request(path)).json() as Promise<T>;
  }

  /** Follows pagination until `max` items are collected. */
  private async paginate<T>(path: string, max: number): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; out.length < max; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const items = await this.json<T[]>(`${path}${sep}per_page=100&page=${page}`);
      out.push(...items);
      if (items.length < 100) break;
    }
    return out.slice(0, max);
  }

  async getPr(ref: PrRef): Promise<PrInfo> {
    const pr = await this.json<any>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
    return {
      title: pr.title ?? "",
      body: pr.body ?? "",
      author: pr.user?.login ?? "unknown",
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      state: pr.state,
      draft: Boolean(pr.draft),
      changedFiles: pr.changed_files ?? 0,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
    };
  }

  async getPrFiles(ref: PrRef, max: number): Promise<PrFile[]> {
    return this.paginate<PrFile>(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files`, max);
  }

  /** Returns the raw text of a file at a ref, or null if it does not exist. */
  async getFileAtRef(ref: PrRef, path: string, sha: string): Promise<string | null> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    try {
      const res = await this.request(
        `/repos/${ref.owner}/${ref.repo}/contents/${encoded}?ref=${encodeURIComponent(sha)}`,
        "application/vnd.github.raw+json",
      );
      return await res.text();
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  async getTree(ref: PrRef, sha: string): Promise<{ paths: string[]; truncated: boolean }> {
    const t = await this.json<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      `/repos/${ref.owner}/${ref.repo}/git/trees/${sha}?recursive=1`,
    );
    return { paths: t.tree.filter((n) => n.type === "blob").map((n) => n.path), truncated: t.truncated };
  }

  async searchCode(ref: PrRef, query: string): Promise<{ path: string }[]> {
    const q = encodeURIComponent(`${query} repo:${ref.owner}/${ref.repo}`);
    const r = await this.json<{ items: { path: string }[] }>(`/search/code?q=${q}&per_page=15`);
    return r.items;
  }
}
