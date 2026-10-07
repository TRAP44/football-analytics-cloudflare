import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PRODUCTION_URL = 'https://football-analytics-cloudflare.wok-side.workers.dev';

const ENDPOINTS = Object.freeze([
  Object.freeze({ name: 'live', path: '/health/live' }),
  Object.freeze({ name: 'ready', path: '/health/ready' }),
  Object.freeze({ name: 'public_status', path: '/api/public-status' }),
]);
const ENDPOINT_KINDS = new Set(ENDPOINTS.map(item=>item.name));

function plainObject(value) {
  try {
    return value && typeof value === 'object' && !Array.isArray(value)
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function numericConfig(value,fallback,min,max) {
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

function statusCodeValue(value) {
  return typeof value==='number'
    && Number.isSafeInteger(value)
    && value>=0
    && value<=999
    ? value
    : 0;
}

function nonNegativeMetric(value) {
  return typeof value==='number'
    && Number.isFinite(value)
    && value>=0
    ? value
    : null;
}

function normalizeBaseUrl(value) {
  const absent=value===undefined
    || value===null
    || (typeof value==='string' && !value.trim());
  const raw=absent ? DEFAULT_PRODUCTION_URL : value;
  if (typeof raw!=='string') {
    throw new TypeError('Production URL must be a string.');
  }
  let url;
  try {
    url=new URL(raw.trim());
  } catch {
    throw new Error('Production URL is invalid.');
  }
  if (!['http:','https:'].includes(url.protocol)) {
    throw new Error('Production URL protocol must be HTTP or HTTPS.');
  }
  const host=String(url.hostname || '').toLowerCase();
  const loopback=['127.0.0.1','localhost','::1','[::1]'].includes(host);
  if (url.protocol!=='https:' && !loopback) {
    throw new Error('Production URL must use HTTPS except for loopback development targets.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Production URL must not contain credentials, query or hash.',
    );
  }
  if (url.pathname && url.pathname !== '/') {
    throw new Error('Production URL must be an origin URL without a path.');
  }
  url.pathname='/';
  return url.origin;
}

function escapeMarkdownCell(value) {
  const text=typeof value==='string'
    ? value
    : typeof value==='number' || typeof value==='bigint'
      ? String(value)
      : '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

function safeObserved(kind, body) {
  const value=plainObject(body);
  if (!value || !ENDPOINT_KINDS.has(kind)) return null;
  if (kind === 'live') {
    return {
      ok: safeRead(value,'ok') === true,
      status: safeText(safeRead(value,'status'),80),
      version: safeText(safeRead(value,'version'),80),
      releaseCandidate:safeText(safeRead(value,'releaseCandidate'),80),
    };
  }
  if (kind === 'ready') {
    return {
      ok: safeRead(value,'ok') === true,
      status: safeText(safeRead(value,'status'),80),
      version: safeText(safeRead(value,'version'),80),
      releaseCandidate:safeText(safeRead(value,'releaseCandidate'),80),
      latencyMs:nonNegativeMetric(safeRead(value,'latencyMs')),
      checks:plainObject(safeRead(value,'checks')),
    };
  }
  return {
    ok: safeRead(value,'ok') === true,
    status:safeText(safeRead(value,'status'),80),
    label:safeText(safeRead(value,'label'),120),
    version:safeText(safeRead(value,'version'),80),
    releaseCandidate:safeText(safeRead(value,'releaseCandidate'),80),
  };
}

export function evaluateEndpoint(kind, response = {}, options = {}) {
  if (!ENDPOINT_KINDS.has(kind)) {
    return {
      passed:false,
      warning:false,
      reason:'Unknown external monitor endpoint kind.',
      observed:null,
    };
  }

  const responseValue=plainObject(response) || {};
  const body=plainObject(safeRead(responseValue,'body'));
  const statusCode=statusCodeValue(safeRead(responseValue,'statusCode'));
  const transportOk=statusCode>=200 && statusCode<300 && body!==null;

  if (kind === 'live') {
    const passed=transportOk
      && safeRead(body,'ok')===true
      && safeRead(body,'status')==='alive';
    return {
      passed,
      warning:false,
      reason:passed
        ? 'ok'
        : `Expected HTTP 2xx with {ok:true,status:"alive"}; got HTTP ${statusCode || 'network_error'}.`,
      observed:safeObserved(kind,body),
    };
  }

  if (kind === 'ready') {
    const passed=transportOk
      && safeRead(body,'ok')===true
      && safeRead(body,'status')==='ready';
    const warningBudgetMs=numericConfig(
      safeRead(options,'readyWarningMs'),
      3000,
      500,
      9000,
    );
    const clientElapsedMs=nonNegativeMetric(
      safeRead(responseValue,'elapsedMs'),
    ) ?? 0;
    const serverLatencyMs=nonNegativeMetric(safeRead(body,'latencyMs'));
    const observedLatencyMs=serverLatencyMs===null
      ? clientElapsedMs
      : Math.max(clientElapsedMs,serverLatencyMs);
    const warning=passed && observedLatencyMs>=warningBudgetMs;
    return {
      passed,
      warning,
      reason:!passed
        ? `Expected HTTP 2xx with {ok:true,status:"ready"}; got HTTP ${statusCode || 'network_error'}.`
        : warning
          ? `Readiness latency ${observedLatencyMs} ms exceeds warning budget ${warningBudgetMs} ms.`
          : 'ok',
      observed:safeObserved(kind,body),
    };
  }

  const status=safeText(safeRead(body,'status'),80);
  const allowed=new Set(['operational','degraded','maintenance']);
  const passed=transportOk && allowed.has(status);
  const warning=passed && status!=='operational';
  return {
    passed,
    warning,
    reason:!passed
      ? `Expected HTTP 2xx public status response; got HTTP ${statusCode || 'network_error'}.`
      : warning
        ? `Public status reports ${status}.`
        : 'ok',
    observed:safeObserved(kind,body),
  };
}

async function fetchJson(url, { timeoutMs = 10000, fetchImpl = fetch } = {}) {
  const startedAt=Date.now();
  const controller=new AbortController();
  const boundedTimeoutMs=numericConfig(timeoutMs,10000,1000,30000);
  const timeout=setTimeout(()=>controller.abort(),boundedTimeoutMs);
  try {
    if (typeof fetchImpl!=='function') throw new TypeError('fetch implementation is required');
    const response=await fetchImpl(url,{
      method:'GET',
      redirect:'manual',
      headers:{
        accept:'application/json',
        'cache-control':'no-cache',
        'user-agent':'MatchRadar-External-Monitor/1.0',
      },
      signal:controller.signal,
    });
    const textFn=safeRead(response,'text');
    if (typeof textFn!=='function') {
      throw new Error('response text reader unavailable');
    }
    const text=await textFn.call(response);
    const rawText=typeof text==='string' ? text : '';
    let body=null;
    try {
      body=rawText ? JSON.parse(rawText) : null;
    } catch {
      body=null;
    }
    return {
      statusCode:statusCodeValue(safeRead(response,'status')),
      elapsedMs:Math.max(0,Date.now()-startedAt),
      body:plainObject(body),
      parseOk:plainObject(body)!==null,
    };
  } catch (error) {
    return {
      statusCode:0,
      elapsedMs:Math.max(0,Date.now()-startedAt),
      body:null,
      parseOk:false,
      error:safeText(
        safeRead(error,'name') || safeRead(error,'message'),
        160,
      ) || 'request_failed',
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
  const normalized=normalizeBaseUrl(baseUrl);
  const checkedAtToken=Date.now();
  const entries=await Promise.all(ENDPOINTS.map(async endpoint=>{
    const url=`${normalized}${endpoint.path}?external_monitor=${checkedAtToken}`;
    const response=await fetchJson(url,{timeoutMs,fetchImpl});
    const evaluation=evaluateEndpoint(
      endpoint.name,
      response,
      {readyWarningMs},
    );
    return [endpoint.name,{
      endpoint:endpoint.path,
      statusCode:response.statusCode,
      elapsedMs:response.elapsedMs,
      parseOk:response.parseOk,
      transportError:response.error || '',
      ...evaluation,
    }];
  }));
  const checks=Object.fromEntries(entries);

  return {
    ok:Object.values(checks).every(item=>item.passed===true),
    warning:Object.values(checks).some(item=>item.warning===true),
    checkedAt:new Date().toISOString(),
    baseUrl:normalized,
    checks,
  };
}

function toMarkdown(result, attempts) {
  const lines=[
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
  for (const [name,check] of Object.entries(result.checks)) {
    lines.push(
      `| ${name} | ${check.statusCode || 'network'} | ${check.elapsedMs} ms | ${check.passed ? (check.warning ? 'WARNING' : 'PASS') : 'FAIL'} | ${escapeMarkdownCell(check.reason)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function main() {
  const baseUrl=normalizeBaseUrl(
    process.env.PRODUCTION_URL || DEFAULT_PRODUCTION_URL,
  );
  const retries=numericConfig(
    process.env.EXTERNAL_MONITOR_RETRIES,
    3,
    1,
    5,
  );
  const retryDelayMs=numericConfig(
    process.env.EXTERNAL_MONITOR_RETRY_DELAY_MS,
    10000,
    0,
    60000,
  );
  const timeoutMs=numericConfig(
    process.env.EXTERNAL_MONITOR_TIMEOUT_MS,
    10000,
    1000,
    30000,
  );
  const readyWarningMs=numericConfig(
    process.env.EXTERNAL_MONITOR_READY_WARNING_MS,
    3000,
    500,
    9000,
  );

  let finalResult=null;
  let attemptsUsed=0;

  for (let attempt=1;attempt<=retries;attempt+=1) {
    attemptsUsed=attempt;
    finalResult=await runMonitorAttempt({
      baseUrl,
      timeoutMs,
      readyWarningMs,
    });
    if (finalResult.ok) break;
    if (attempt<retries) await sleep(retryDelayMs);
  }

  const result={
    ...finalResult,
    attempts:attemptsUsed,
    retriesConfigured:retries,
  };
  const markdown=toMarkdown(result,attemptsUsed);

  fs.writeFileSync(
    'monitor-result.json',
    JSON.stringify(result,null,2)+'\n',
  );
  fs.writeFileSync('monitor-result.md',markdown);

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown);
  }

  process.stdout.write(markdown);
  process.exitCode=result.ok ? 0 : 1;
}

const invokedPath=process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url===invokedPath) {
  await main();
}
