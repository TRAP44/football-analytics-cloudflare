import fs from 'node:fs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function selectMergedPullRequest(pulls, baseBranch = 'main') {
  if (!Array.isArray(pulls)) return null;
  return pulls.find((pull) => (
    pull
    && pull.state === 'closed'
    && typeof pull.merged_at === 'string'
    && pull.merged_at.length > 0
    && pull.base?.ref === baseBranch
    && Number.isInteger(pull.number)
  )) || null;
}

export async function fetchAssociatedPullRequests({
  repository,
  sha,
  token,
  fetchImpl = fetch,
}) {
  if (!REPO_RE.test(repository || '')) {
    throw new Error('repository must use owner/name format');
  }
  if (!SHA_RE.test(sha || '')) {
    throw new Error('sha must be a full 40-character commit SHA');
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/commits/${sha}/pulls`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub commit provenance lookup failed with HTTP ${response.status}`);
  }

  const pulls = await response.json();
  if (!Array.isArray(pulls)) {
    throw new Error('GitHub commit provenance lookup returned an invalid payload');
  }
  return pulls;
}

function appendSummary(message) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) fs.appendFileSync(summary, `${message}\n`);
}

export async function verifyMainPrProvenance({
  repository,
  sha,
  token,
  baseBranch = 'main',
  fetchImpl = fetch,
}) {
  const pulls = await fetchAssociatedPullRequests({
    repository,
    sha,
    token,
    fetchImpl,
  });
  const mergedPull = selectMergedPullRequest(pulls, baseBranch);
  if (!mergedPull) {
    throw new Error(
      `production deploy blocked: commit ${sha} is not associated with a merged PR into ${baseBranch}`,
    );
  }
  return mergedPull;
}

async function main() {
  const [repository, sha, baseBranch = 'main'] = process.argv.slice(2);
  try {
    const pull = await verifyMainPrProvenance({
      repository,
      sha,
      baseBranch,
      token: process.env.GITHUB_TOKEN,
    });
    appendSummary('### Main PR provenance verified');
    appendSummary(
      `Production deploy SHA ${sha} is associated with merged PR #${pull.number} into ${baseBranch}.`,
    );
    console.log(`Verified merged PR #${pull.number} provenance for ${sha}.`);
  } catch (error) {
    appendSummary('### Main PR provenance gate failed');
    appendSummary(String(error?.message || error));
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : '';
if (import.meta.url === invokedPath) {
  await main();
}
