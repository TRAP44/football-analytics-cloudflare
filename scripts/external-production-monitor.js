import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PRODUCTION_URL = 'https://football-analytics-cloudflare.wok-side.workers.dev';

const ENDPOINTS = Object.freeze([
  { name: 'live', path: '/health/live' },
  { name: 'ready', path: '/health/ready' },
  { name: 'public_status', path: '/api/public-status' },
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_PRODUCTION_URL).replace(/\/+$/, '');
}

function safeObserved(kind, body) {
  if (!body || typeof body !== 'object') return null;
  if (kind === 'live') {
    return {
      ok: body.ok === true,
      status: String(body.status || ''),
      version: String(body.version || ''),
      releaseCandidate: String(body.releaseCandidate || ''),
    };
  }
  if (kind === 'ready') {
    return {
      ok: body.ok === true,
      status: String(body.status || ''),
      version: String(body.version || ''),
      releaseCandidate: String(body.releaseCandidate || ''),
      latencyMs: Number.isFinite(Number(body.latencyMs)) ? Number(body.latencyMs) : null,
      checks: body.checks && typeof body.checks === 'object' ? body.checks : null,
    };
  }
  return {
    ok: body.ok === true,
    status: String(body.status || ''),
    label: String(body.label || ''),
    version: String(body.version || ''),
    releaseCandidate: String(body.releaseCandidate || ''),
  };
}

export function evaluateEndpoint(kind, response = {}, options = {}) {
  const statusCode = Number(response.statusCode || 0);
  const body = response.body && typeof response.body === 'object' ? response.body : null;
  const transportOk = statusCode >= 200 && statusCode < 300 && body;

  if (kind === 'live') {
    const passed = Boolean(transportOk && body.ok === true && body.status === 'alive');
    return {
      passed,
      warning: false,
      reason: passed ? 'ok' : `Expected HTTP 2xx with {ok:true,status:"alive"}; got HTTP ${statusCode || 'network_error'}.`,
      observed: safeObserved(kind, body),
    };
  }

  if (kind === 'ready') {
    const passed = Boolean(transportOk && body.ok === true && body.status === 'ready');
    const warningBudgetMs = Math.max(500, Math.min(9000, Number(options.readyWarningMs ?? 3000)));
    const elapsedMs = Math.max(0, Number(response.elapsedMs || 0));
    const warning = Boolean(passed && elapsedMs >= warningBudgetMs);
    return {
      passed,
      warning,
      reason: !passed
        ? `Expected HTTP 2xx with {ok:true,status:"ready"}; got HTTP ${statusCode || 'network_error'}.`
        : warning
          ? `Readiness latency ${elapsedMs} ms exceeds warning budget ${warningBudgetMs} ms.`
          : 'ok',
      observed: safeObserved(kind, body),
    };
  }

  const allowed = new Set(['operational', 'degraded', 'maintenance']);
  const passed = Boolean(transportOk && allowed.has(String(body.status || '')));
  const warning = Boolean(passed && body.status !== 'operational');
  return {
    passed,
    warning,
    reason: !passed
      ? `Expected HTTP 2xx public status response; got HTTP ${statusCode || 'network_error'}.`
      : warning
        ? `Public status reports ${body.status}.`
        : 'ok',
    observed: safeObserved(kind, body),
  };
}

async function fetchJson(url, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
        'user-agent': 'MatchRadar-External-Monitor/1.0',
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return {
      statusCode: response.status,
      elapsedMs: Date.now() - startedAt,
      body,
      parseOk: body !== null,
    };
  } catch (error) {
    return {
      statusCode: 0,
      elapsedMs: Date.now() - startedAt,
      body: null,
      parseOk: false,
      error: String(error?.name || error?.message || error || 'request_failed').slice(0, 160),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runMonitorAttempt({
  baseUrl = DEFAULT_PRODUCTION_URL,
  timeoutMs = 10000,
  readyWarningMs = 3000,
  fetchImpl = fetch,
} = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  const checks = {};

  for (const endpoint of ENDPOINTS) {
    const url = `${normalized}${endpoint.path}?external_monitor=${Date.now()}`;
    const response = await fetchJson(url, { timeoutMs, fetchImpl });
    const evaluation = evaluateEndpoint(endpoint.name, response, { readyWarningMs });
    checks[endpoint.name] = {
      endpoint: endpoint.path,
      statusCode: response.statusCode,
      elapsedMs: response.elapsedMs,
      parseOk: response.parseOk,
      transportError: response.error || '',
      ...evaluation,
    };
  }

  return {
    ok: Object.values(checks).every(item => item.passed),
    warning: Object.values(checks).some(item => item.warning),
    checkedAt: new Date().toISOString(),
    baseUrl: normalized,
    checks,
  };
}

function toMarkdown(result, attempts) {
  const lines = [
    '### MatchRadar external production monitor',
    '',
    `- Result: **${result.ok ? (result.warning ? 'WARNING' : 'PASS') : 'FAIL'}**`,
    `- Checked at: ${result.checkedAt}`,
    `- Attempts: ${attempts}`,
    `- Base URL: ${result.baseUrl}`,
    '',
    '| Check | HTTP | Latency | Result | Detail |',
    '| --- | ---: | ---: | --- | --- |',
  ];
  for (const [name, check] of Object.entries(result.checks)) {
    lines.push(
      `| ${name} | ${check.statusCode || 'network'} | ${check.elapsedMs} ms | ${check.passed ? (check.warning ? 'WARNING' : 'PASS') : 'FAIL'} | ${String(check.reason || '').replace(/\|/g, '\\|')} |`
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function main() {
  const baseUrl = normalizeBaseUrl(process.env.PRODUCTION_URL || DEFAULT_PRODUCTION_URL);
  const retries = Math.max(1, Math.min(5, Number(process.env.EXTERNAL_MONITOR_RETRIES || 3)));
  const retryDelayMs = Math.max(0, Math.min(60000, Number(process.env.EXTERNAL_MONITOR_RETRY_DELAY_MS || 10000)));
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.EXTERNAL_MONITOR_TIMEOUT_MS || 10000)));
  const readyWarningMs = Math.max(500, Math.min(9000, Number(process.env.EXTERNAL_MONITOR_READY_WARNING_MS || 3000)));

  let finalResult = null;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    attemptsUsed = attempt;
    finalResult = await runMonitorAttempt({ baseUrl, timeoutMs, readyWarningMs });
    if (finalResult.ok) break;
    if (attempt < retries) await sleep(retryDelayMs);
  }

  const result = {
    ...finalResult,
    attempts: attemptsUsed,
    retriesConfigured: retries,
  };
  const markdown = toMarkdown(result, attemptsUsed);

  fs.writeFileSync('monitor-result.json', JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync('monitor-result.md', markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }

  process.stdout.write(markdown);
  process.exitCode = result.ok ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  await main();
}
