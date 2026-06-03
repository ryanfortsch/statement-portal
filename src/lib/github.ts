/**
 * Minimal GitHub REST client, scoped to the stay-cape-ann repo.
 *
 * Helm's first cross-repo capability. Used by the Stay Cape Ann launch flow to
 * read data/ical-urls.json, commit a new listing entry onto a branch (as a real
 * GitHub user so Vercel will build it), open a PR, read the resulting Vercel
 * preview deployment, and squash-merge on approval.
 *
 * Style matches the existing native-fetch wrappers (stripeGet in
 * src/lib/stripe-sync.ts, guestyGet in src/lib/guesty-client.ts): no SDK, a thin
 * typed wrapper, Bearer auth. The token (GITHUB_TOKEN) is a fine-grained PAT
 * scoped to ONLY ryanfortsch/stay-cape-ann (Contents + Pull requests, RW). It is
 * read from the environment per-call and never logged or returned to a client.
 */

import {
  SCA_REPO_OWNER,
  SCA_REPO_NAME,
  SCA_COMMIT_AUTHOR,
} from '@/lib/sca-config';

const API = 'https://api.github.com';

function token(): string {
  const t = process.env.GITHUB_TOKEN || '';
  if (!t) throw new Error('GITHUB_TOKEN is not configured');
  return t;
}

export function isGithubConfigured(): boolean {
  return !!(process.env.GITHUB_TOKEN || '').trim();
}

const OWNER = SCA_REPO_OWNER;
const REPO = SCA_REPO_NAME;
const BASE = `/repos/${OWNER}/${REPO}`;

async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'helm-sca-launcher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    // GitHub error bodies never echo the token; safe to surface the message.
    const msg = (json as { message?: string } | null)?.message || res.statusText;
    const err = new Error(`GitHub ${method} ${path} failed (${res.status}): ${msg}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function b64encode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}
function b64decode(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

/**
 * Encode a git ref for use in a URL PATH segment: encode each segment but keep
 * the slashes literal, so a branch like `sca-launch/36_granite` resolves as a
 * ref (GitHub does not decode %2F in path positions).
 */
function refPath(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Returns the commit SHA at the tip of a branch (for branching off it). */
export async function getBranchHeadSha(branch: string): Promise<string> {
  const ref = await gh<{ object: { sha: string } }>('GET', `${BASE}/git/ref/heads/${branch}`);
  return ref.object.sha;
}

export type RepoFile = { sha: string; contentUtf8: string };

/** Reads a UTF-8 file at a ref. Returns null on 404. */
export async function getFile(path: string, ref: string): Promise<RepoFile | null> {
  try {
    const data = await gh<{ sha: string; content: string; encoding: string }>(
      'GET',
      `${BASE}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
    );
    const content = data.encoding === 'base64' ? b64decode(data.content) : data.content;
    return { sha: data.sha, contentUtf8: content };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function branchExists(branch: string): Promise<boolean> {
  try {
    await gh('GET', `${BASE}/git/ref/heads/${branch}`);
    return true;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return false;
    throw e;
  }
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createBranch(branch: string, fromSha: string): Promise<void> {
  await gh('POST', `${BASE}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha });
}

/**
 * Create or update a file on a branch. Sets author + committer to the real
 * Rising Tide identity so Vercel will build the resulting commit. Pass `sha`
 * when updating an existing file (required by the Contents API).
 */
export async function putFile(args: {
  path: string;
  branch: string;
  contentUtf8: string;
  message: string;
  sha?: string;
}): Promise<{ commitSha: string }> {
  const res = await gh<{ commit: { sha: string } }>(
    'PUT',
    `${BASE}/contents/${encodeURI(args.path)}`,
    {
      message: args.message,
      content: b64encode(args.contentUtf8),
      branch: args.branch,
      sha: args.sha,
      author: { ...SCA_COMMIT_AUTHOR },
      committer: { ...SCA_COMMIT_AUTHOR },
    },
  );
  return { commitSha: res.commit.sha };
}

export type PullRequest = {
  number: number;
  html_url: string;
  state: string;
  merged: boolean;
  head: { ref: string; sha: string };
};

export async function openPullRequest(args: {
  head: string;
  base: string;
  title: string;
  body: string;
}): Promise<PullRequest> {
  return gh<PullRequest>('POST', `${BASE}/pulls`, args);
}

export async function findOpenPrForBranch(branch: string): Promise<PullRequest | null> {
  const list = await gh<PullRequest[]>(
    'GET',
    `${BASE}/pulls?head=${encodeURIComponent(`${OWNER}:${branch}`)}&state=open`,
  );
  return list[0] ?? null;
}

export async function getPullRequest(number: number): Promise<PullRequest> {
  return gh<PullRequest>('GET', `${BASE}/pulls/${number}`);
}

export async function mergePullRequest(
  number: number,
  method: 'squash' | 'merge' | 'rebase' = 'squash',
): Promise<{ merged: boolean; sha: string }> {
  return gh<{ merged: boolean; sha: string }>('PUT', `${BASE}/pulls/${number}/merge`, {
    merge_method: method,
  });
}

export async function closePullRequest(number: number): Promise<void> {
  await gh('PATCH', `${BASE}/pulls/${number}`, { state: 'closed' });
}

/**
 * Trigger a workflow_dispatch on a workflow file (e.g. the Guesty snapshot
 * refresh). Requires the token to carry the Actions: write permission; callers
 * should treat a throw (403 when the scope is missing) as non-fatal.
 */
export async function dispatchWorkflow(workflowFile: string, ref: string): Promise<void> {
  await gh('POST', `${BASE}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, { ref });
}

export async function deleteBranch(branch: string): Promise<void> {
  try {
    await gh('DELETE', `${BASE}/git/refs/heads/${branch}`);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return;
    throw e;
  }
}

// ── Preview deployment status (read from GitHub, no Vercel token needed) ──────

export type PreviewState = 'none' | 'pending' | 'success' | 'failure';
export type PreviewStatus = { state: PreviewState; url: string | null };

function mapGhState(s: string): PreviewState {
  if (s === 'success') return 'success';
  if (s === 'failure' || s === 'error') return 'failure';
  if (s === 'pending' || s === 'in_progress' || s === 'queued') return 'pending';
  return 'none';
}

/**
 * Resolves the Vercel preview deployment for a branch by reading the GitHub
 * Deployments the Vercel GitHub app posts, with a fallback to commit statuses.
 * Returns a coarse state + the preview URL when available. Best-effort: any
 * lookup error degrades to {state:'none'}.
 */
export async function getBranchPreviewStatus(branch: string): Promise<PreviewStatus> {
  // 1. GitHub Deployments API (Vercel creates a deployment per push).
  try {
    const deployments = await gh<Array<{ id: number }>>(
      'GET',
      `${BASE}/deployments?ref=${encodeURIComponent(branch)}&per_page=1`,
    );
    if (deployments.length) {
      const statuses = await gh<
        Array<{ state: string; environment_url?: string; target_url?: string }>
      >('GET', `${BASE}/deployments/${deployments[0].id}/statuses?per_page=20`);
      if (statuses.length) {
        const latest = statuses[0]; // newest first
        const url = latest.environment_url || latest.target_url || null;
        const state = mapGhState(latest.state);
        if (url || state !== 'none') return { state, url };
      }
    }
  } catch {
    // fall through to commit statuses
  }

  // 2. Commit statuses. NOTE: the /statuses (plural) endpoint returns an ARRAY
  // of statuses, newest first — not the combined { state, statuses } object the
  // singular /status endpoint returns. Read it as an array.
  try {
    const statuses = await gh<Array<{ state: string; context: string; target_url?: string }>>(
      'GET',
      `${BASE}/commits/${refPath(branch)}/statuses`,
    );
    const vercel = (Array.isArray(statuses) ? statuses : []).find((s) =>
      (s.context || '').toLowerCase().includes('vercel'),
    );
    if (vercel) return { state: mapGhState(vercel.state), url: vercel.target_url || null };
  } catch {
    // ignore
  }

  return { state: 'none', url: null };
}
