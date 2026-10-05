import { pathToFileURL } from 'node:url';
import { DEFAULT_PRODUCTION_URL, runMonitorAttempt } from './external-production-monitor.js';

export const AVAILABILITY_INCIDENT_TITLE = '[monitor] MatchRadar production availability incident';
export const INFRASTRUCTURE_INCIDENT_TITLE = '[monitor-infra] External Production Monitor execution failure';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeRepository(value) {
  const repo = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('GITHUB_REPOSITORY is missing or invalid');
  }
  return repo;
}

function githubHeaders(token) {
  if (!token) throw new Error('GITHUB_TOKEN is required');
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'MatchRadar-External-Monitor-Control-Plane/1.0',
    'x-github-api-version': '2022-11-28',
  };
}

async function githubRequest(path, {
  method = 'GET',
  body = null,
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  fetchImpl = fetch,
} = {}) {
  const repo = normalizeRepository(repository);
  const response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: githubHeaders(token),
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const detail = String(parsed?.message || text || response.statusText || 'github_request_failed').slice(0, 240);
    throw new Error(`GitHub API ${method} ${path} failed with HTTP ${response.status}: ${detail}`);
  }
  return parsed;
}

async function findOpenIssueByTitle(title, options = {}) {
  const issues = await githubRequest('/issues?state=open&per_page=100', options);
  return Array.isArray(issues)
    ? issues.find(issue => !issue?.pull_request && issue?.title === title) || null
    : null;
}

async function upsertIncident(title, markdown, options = {}) {
  const existing = await findOpenIssueByTitle(title, options);
  if (existing?.number) {
    await githubRequest(`/issues/${existing.number}/comments`, {
      ...options,
      method: 'POST',
      body: { body: markdown },
    });
    return { action: 'commented', number: existing.number };
  }
  const created = await githubRequest('/issues', {
    ...options,
    method: 'POST',
    body: { title, body: markdown },
  });
  return { action: 'created', number: created?.number || null };
}

async function closeIncident(title, markdown, options = {}) {
  const existing = await findOpenIssueByTitle(title, options);
  if (!existing?.number) return { action: 'absent', number: null };
  if (markdown) {
    await githubRequest(`/issues/${existing.number}/comments`, {
      ...options,
      method: 'POST',
      body: { body: markdown },
    });
  }
  await githubRequest(`/issues/${existing.number}`, {
    ...options,
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' },
  });
  return { action: 'closed', number: existing.number };
}

function primaryEvidence(outcome) {
  const runId = String(process.env.GITHUB_RUN_ID || '').trim();
  const runUrl = runId
    ? `https://github.com/TRAP44/football-analytics-cloudflare/actions/runs/${runId}`
    : 'GitHub Actions run URL unavailable';
  return [
    '### MatchRadar external production monitor',
    '',
    `- Workflow outcome: **${outcome.toUpperCase()}**`,
    `- Run: ${runId ? `[${runId}](${runUrl})` : runUrl}`,
    `- Detailed endpoint evidence: GitHub Actions artifact \`external-production-monitor-${runId || 'unknown'}\``,
  ].join('\n');
}

export function classifyPrimaryRunJobs(jobs = []) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return {
      category: 'monitor_infrastructure',
      reason: 'no_jobs',
      requiresFallback: true,
    };
  }

  const steps = jobs.flatMap(job => Array.isArray(job?.steps) ? job.steps : []);
  if (steps.length === 0) {
    return {
      category: 'monitor_infrastructure',
      reason: 'zero_step_failure',
      requiresFallback: true,
    };
  }

  const probe = steps.find(step => step?.name === 'Check production from external runner');
  if (probe?.conclusion === 'success') {
    return {
      category: 'monitor_infrastructure',
      reason: 'production_probe_passed_before_workflow_failure',
      requiresFallback: false,
    };
  }
  if (probe?.conclusion === 'failure') {
    return {
      category: 'ambiguous',
      reason: 'production_probe_failed',
      requiresFallback: true,
    };
  }

  return {
    category: 'monitor_infrastructure',
    reason: 'production_probe_not_executed',
    requiresFallback: true,
  };
}

export function decideDiagnosticActions(primary, fallbackOk) {
  const infraDefinitelyBroken = primary?.category === 'monitor_infrastructure';
  if (primary?.requiresFallback === false) {
    return { availability: 'close', infrastructure: 'open' };
  }
  if (fallbackOk === true) {
    return { availability: 'close', infrastructure: 'open' };
  }
  if (fallbackOk === false) {
    return {
      availability: 'open',
      infrastructure: infraDefinitelyBroken ? 'open' : 'close',
    };
  }
  return {
    availability: 'unchanged',
    infrastructure: infraDefinitelyBroken ? 'open' : 'unchanged',
  };
}

function checkRows(result) {
  if (!result?.checks || typeof result.checks !== 'object') return [];
  return Object.entries(result.checks).map(([name, check]) => (
    `| ${name} | ${check.statusCode || 'network'} | ${check.elapsedMs ?? 0} ms | ${check.passed ? 'PASS' : 'FAIL'} | ${String(check.reason || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`
  ));
}

function diagnosisMarkdown({
  runId,
  runUrl,
  primary,
  fallbackResult,
  fallbackAttempts = 0,
}) {
  const fallbackLabel = fallbackResult
    ? (fallbackResult.ok ? 'PASS' : 'FAIL')
    : 'not required';
  const lines = [
    '### External Production Monitor failure diagnosis',
    '',
    `- Primary run: ${runUrl ? `[${runId}](${runUrl})` : runId}`,
    `- Primary classification: **${primary.category}**`,
    `- Primary reason: \`${primary.reason}\``,
    `- Fallback production probe: **${fallbackLabel}**`,
  ];
  if (fallbackResult) {
    lines.push(
      `- Fallback checked at: ${fallbackResult.checkedAt}`,
      `- Fallback attempts: ${fallbackAttempts}`,
      '',
      '| Check | HTTP | Latency | Result | Detail |',
      '| --- | ---: | ---: | --- | --- |',
      ...checkRows(fallbackResult),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function runFallbackProbe() {
  const baseUrl = String(process.env.PRODUCTION_URL || DEFAULT_PRODUCTION_URL).replace(/\/+$/, '');
  const retries = Math.max(1, Math.min(3, Number(process.env.DIAGNOSTIC_MONITOR_RETRIES || 2)));
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.EXTERNAL_MONITOR_TIMEOUT_MS || 10000)));
  const readyWarningMs = Math.max(500, Math.min(9000, Number(process.env.EXTERNAL_MONITOR_READY_WARNING_MS || 3000)));
  let result = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    attempts = attempt;
    result = await runMonitorAttempt({ baseUrl, timeoutMs, readyWarningMs });
    if (result.ok) break;
    if (attempt < retries) await sleep(2000);
  }
  return { result, attempts };
}

async function primaryMode() {
  const outcome = String(process.env.MONITOR_OUTCOME || '').trim();
  const evidence = primaryEvidence(outcome);
  if (outcome === 'failure') {
    await upsertIncident(AVAILABILITY_INCIDENT_TITLE, evidence);
    return;
  }
  if (outcome !== 'success') {
    throw new Error(`Unsupported MONITOR_OUTCOME: ${outcome || 'empty'}`);
  }

  const recovery = [
    '### Recovery confirmed',
    '',
    'The independent external production probe is healthy again.',
    '',
    evidence,
  ].join('\n');
  await closeIncident(AVAILABILITY_INCIDENT_TITLE, recovery);
  await closeIncident(
    INFRASTRUCTURE_INCIDENT_TITLE,
    '### Monitor infrastructure recovery confirmed\n\nThe independent External Production Monitor completed successfully again.\n',
  );
}

async function diagnosticsMode() {
  const runId = Number(process.env.PRIMARY_RUN_ID || 0);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error('PRIMARY_RUN_ID is required');
  }
  const runUrl = String(process.env.PRIMARY_RUN_URL || '').trim();
  const jobsPayload = await githubRequest(`/actions/runs/${runId}/jobs?per_page=100`);
  const primary = classifyPrimaryRunJobs(jobsPayload?.jobs || []);

  let fallbackResult = null;
  let fallbackAttempts = 0;
  if (primary.requiresFallback) {
    const fallback = await runFallbackProbe();
    fallbackResult = fallback.result;
    fallbackAttempts = fallback.attempts;
  }

  const actions = decideDiagnosticActions(primary, fallbackResult?.ok);
  const evidence = diagnosisMarkdown({
    runId,
    runUrl,
    primary,
    fallbackResult,
    fallbackAttempts,
  });

  if (actions.availability === 'open') {
    await upsertIncident(AVAILABILITY_INCIDENT_TITLE, evidence);
  } else if (actions.availability === 'close') {
    await closeIncident(
      AVAILABILITY_INCIDENT_TITLE,
      `### Availability reclassified / recovered\n\nA fallback probe found production healthy while the primary monitoring workflow failed.\n\n${evidence}`,
    );
  }

  if (actions.infrastructure === 'open') {
    await upsertIncident(INFRASTRUCTURE_INCIDENT_TITLE, evidence);
  } else if (actions.infrastructure === 'close') {
    await closeIncident(
      INFRASTRUCTURE_INCIDENT_TITLE,
      `### Monitor infrastructure recovered\n\nThe primary monitor executed its production probe; the current failure is classified as a production availability failure rather than monitor execution failure.\n\n${evidence}`,
    );
  }

  if (actions.availability === 'open' || actions.infrastructure === 'open') {
    process.exitCode = 1;
  }
}

export async function main() {
  const mode = String(process.argv[2] || '').trim();
  if (mode === 'primary') return primaryMode();
  if (mode === 'diagnose') return diagnosticsMode();
  throw new Error('Usage: node scripts/external-monitor-control-plane.js <primary|diagnose>');
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  await main();
}
