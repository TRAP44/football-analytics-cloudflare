import { pathToFileURL } from 'node:url';
import { DEFAULT_PRODUCTION_URL, runMonitorAttempt } from './external-production-monitor.js';

export const AVAILABILITY_INCIDENT_TITLE = '[monitor] MatchRadar production availability incident';
export const INFRASTRUCTURE_INCIDENT_TITLE = '[monitor-infra] External Production Monitor execution failure';

function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeText(value,max=240) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function boundedNumericConfig(value,fallback,min,max) {
  let parsed=null;
  if (typeof value==='number' && Number.isFinite(value)) {
    parsed=value;
  } else if (
    typeof value==='string'
    && /^\d+(?:\.\d+)?$/.test(value.trim())
  ) {
    parsed=Number(value.trim());
  }
  if (parsed===null || !Number.isFinite(parsed)) return fallback;
  return Math.max(min,Math.min(max,parsed));
}

export function parseTrackingIssueNumber(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const n=Number(raw);
  return Number.isSafeInteger(n) && n>0 ? n : 0;
}

export function selectInfrastructureIncidentTarget(openIssues = [], configuredNumber = 0) {
  const number=parseTrackingIssueNumber(configuredNumber);
  if (number>0) {
    const tracked=(Array.isArray(openIssues) ? openIssues : [])
      .find(issue=>{
        const value=plainObject(issue);
        return value
          && safeRead(value,'pull_request')===undefined
          && parseTrackingIssueNumber(safeRead(value,'number'))===number;
      });
    if (tracked) return {kind:'tracking',number};
  }
  return {kind:'dedicated',number:0};
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeRepository(value) {
  const repo=safeText(value,200);
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
  timeoutMs = 15000,
} = {}) {
  const repo = normalizeRepository(repository);
  const boundedTimeoutMs=boundedNumericConfig(timeoutMs,15000,1000,30000);
  const response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: githubHeaders(token),
    body: body === null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(boundedTimeoutMs),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (safeRead(response,'ok')!==true) {
    const detail=safeText(
      safeRead(plainObject(parsed),'message')
        || (typeof text==='string' ? text : '')
        || safeRead(response,'statusText'),
      240,
    ) || 'github_request_failed';
    const status=parseTrackingIssueNumber(safeRead(response,'status')) || 'unknown';
    throw new Error(`GitHub API ${method} ${path} failed with HTTP ${status}: ${detail}`);
  }
  return parsed;
}

async function findOpenIssueByTitle(title, options = {}) {
  const issues=await githubRequest('/issues?state=open&per_page=100',options);
  return Array.isArray(issues)
    ? issues.find(issue=>{
        const value=plainObject(issue);
        return value
          && safeRead(value,'pull_request')===undefined
          && safeRead(value,'title')===title;
      }) || null
    : null;
}

async function upsertIncident(title, markdown, options = {}) {
  const existing = await findOpenIssueByTitle(title, options);
  const existingNumber=parseTrackingIssueNumber(safeRead(existing,'number'));
  if (existingNumber) {
    await githubRequest(`/issues/${existingNumber}/comments`, {
      ...options,
      method: 'POST',
      body: { body: markdown },
    });
    return { action:'commented', number:existingNumber };
  }
  const created = await githubRequest('/issues', {
    ...options,
    method: 'POST',
    body: { title, body: markdown },
  });
  return {
    action:'created',
    number:parseTrackingIssueNumber(safeRead(created,'number')) || null,
  };
}

async function upsertInfrastructureIncident(markdown, options = {}) {
  const issues = await githubRequest('/issues?state=open&per_page=100', options);
  const target = selectInfrastructureIncidentTarget(
    issues,
    process.env.MONITOR_INFRA_TRACKING_ISSUE,
  );

  if (target.kind === 'tracking') {
    await githubRequest(`/issues/${target.number}/comments`, {
      ...options,
      method:'POST',
      body:{
        body:[
          '### External Production Monitor infrastructure signal',
          '',
          'Production fallback evidence is attached below. This is tracked under the existing runner/redundancy incident instead of opening another duplicate issue.',
          '',
          markdown,
        ].join('\n'),
      },
    });
    return { action:'commented_tracking', number:target.number };
  }

  return await upsertIncident(INFRASTRUCTURE_INCIDENT_TITLE, markdown, options);
}

async function closeIncident(title, markdown, options = {}) {
  const existing = await findOpenIssueByTitle(title, options);
  const existingNumber=parseTrackingIssueNumber(safeRead(existing,'number'));
  if (!existingNumber) return {action:'absent',number:null};
  if (markdown) {
    await githubRequest(`/issues/${existingNumber}/comments`, {
      ...options,
      method: 'POST',
      body: { body: markdown },
    });
  }
  await githubRequest(`/issues/${existingNumber}`, {
    ...options,
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' },
  });
  return {action:'closed',number:existingNumber};
}

function primaryEvidence(outcome) {
  const runId = String(process.env.GITHUB_RUN_ID || '').trim();
  const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
  const serverUrl = String(process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/+$/, '');
  const runUrl = runId && repository
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
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
  if (!Array.isArray(jobs) || jobs.length===0) {
    return {
      category:'monitor_infrastructure',
      reason:'no_jobs',
      requiresFallback:true,
    };
  }

  const monitorJob=jobs
    .map(plainObject)
    .filter(Boolean)
    .find(job=>safeRead(job,'name')==='monitor');
  const job=monitorJob || jobs.map(plainObject).filter(Boolean)[0] || null;
  const rawSteps=safeRead(job,'steps');
  const steps=Array.isArray(rawSteps)
    ? rawSteps.map(plainObject).filter(Boolean)
    : [];
  if (steps.length===0) {
    return {
      category:'monitor_infrastructure',
      reason:'zero_step_failure',
      requiresFallback:true,
    };
  }

  const probe=steps.find(
    step=>safeRead(step,'name')==='Check production from external runner',
  );
  const conclusion=safeRead(probe,'conclusion');
  if (conclusion==='success') {
    return {
      category:'monitor_infrastructure',
      reason:'production_probe_passed_before_workflow_failure',
      requiresFallback:false,
    };
  }
  if (conclusion==='failure') {
    return {
      category:'ambiguous',
      reason:'production_probe_failed',
      requiresFallback:true,
    };
  }

  return {
    category:'monitor_infrastructure',
    reason:'production_probe_not_executed',
    requiresFallback:true,
  };
}

export function decideDiagnosticActions(primary, fallbackOk) {
  const value=plainObject(primary);
  const category=safeRead(value,'category');
  const requiresFallback=safeRead(value,'requiresFallback');
  const infraDefinitelyBroken=category==='monitor_infrastructure';
  if (requiresFallback===false) {
    return {availability:'close',infrastructure:'open'};
  }
  if (fallbackOk===true) {
    return {availability:'close',infrastructure:'open'};
  }
  if (fallbackOk===false) {
    return {
      availability:'open',
      infrastructure:infraDefinitelyBroken ? 'open' : 'close',
    };
  }
  return {
    availability:'unchanged',
    infrastructure:infraDefinitelyBroken ? 'open' : 'unchanged',
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
  const retries=boundedNumericConfig(
    process.env.DIAGNOSTIC_MONITOR_RETRIES,
    2,
    1,
    3,
  );
  const timeoutMs=boundedNumericConfig(
    process.env.EXTERNAL_MONITOR_TIMEOUT_MS,
    10000,
    1000,
    30000,
  );
  const readyWarningMs=boundedNumericConfig(
    process.env.EXTERNAL_MONITOR_READY_WARNING_MS,
    3000,
    500,
    9000,
  );
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
  const runId=parseTrackingIssueNumber(process.env.PRIMARY_RUN_ID);
  if (!runId) {
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
    await upsertInfrastructureIncident(evidence);
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
