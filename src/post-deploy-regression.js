const AUTH_RE=/HTTP 401|PGRST303|invalid.*jwt|invalid.*api.?key/i;
const FAILURE_CODE_RE=/(?:FAIL|ERROR|INCIDENT|RATE_LIMIT|DEGRADED)/i;
const DEPLOY_SHA_RE=/^[0-9a-f]{40}$/i;
const STRICT_ISO_UTC_RE=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

function numericCandidate(value){
  if(typeof value==='number') return Number.isFinite(value)?value:null;
  if(typeof value!=='string') return null;
  const raw=value.trim();
  if(!/^-?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isFinite(number)?number:null;
}

function nonNegativeInteger(value,fallback=0){
  const number=numericCandidate(value);
  return Number.isSafeInteger(number)&&number>=0?number:fallback;
}

function timestampMsCandidate(value){
  const number=numericCandidate(value);
  return number!==null&&number>=0&&number<=8.64e15?number:null;
}

function positiveInteger(value){
  const number=numericCandidate(value);
  return Number.isSafeInteger(number)&&number>0?number:null;
}

function normalizeDeploySha(value=''){
  const sha=typeof value==='string'?value.trim().toLowerCase():'';
  return DEPLOY_SHA_RE.test(sha)?sha:'';
}

function canonicalIsoUtc(value){
  if(typeof value!=='string') return null;
  const raw=value.trim();
  const match=STRICT_ISO_UTC_RE.exec(raw);
  if(!match) return null;
  const timestamp=Date.parse(raw);
  if(!Number.isFinite(timestamp)) return null;
  const parsed=new Date(timestamp);
  if(
    parsed.getUTCFullYear()!==Number(match[1])
    || parsed.getUTCMonth()+1!==Number(match[2])
    || parsed.getUTCDate()!==Number(match[3])
    || parsed.getUTCHours()!==Number(match[4])
    || parsed.getUTCMinutes()!==Number(match[5])
    || parsed.getUTCSeconds()!==Number(match[6])
  ) return null;
  return parsed.toISOString();
}

function ts(row){
  const value=row?.created_at??row?.createdAt;
  if(typeof value!=='string'||!value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp)?timestamp:null;
}

function percentile(values,p){
  const sorted=(Array.isArray(values)?values:[]).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length) return null;
  const percentileValue=numericCandidate(p);
  const bounded=percentileValue===null?95:Math.max(0,Math.min(100,percentileValue));
  const idx=Math.min(sorted.length-1,Math.max(0,Math.ceil((bounded/100)*sorted.length)-1));
  return sorted[idx];
}

function cleanText(value){
  return typeof value==='string'?value:'';
}

function isErrorLike(row){
  return ['error','critical'].includes(cleanText(row?.severity).trim().toLowerCase());
}

function isProviderFailure(row){
  const source=cleanText(row?.source).toLowerCase();
  const code=cleanText(row?.code);
  return (source.includes('provider')||source.includes('football')||/^API_/i.test(code))
    && (isErrorLike(row)||FAILURE_CODE_RE.test(code));
}

function isTelegramFailure(row){
  const source=cleanText(row?.source).toLowerCase();
  const code=cleanText(row?.code);
  return (source.includes('telegram')||source.includes('digest_alert')||source.includes('provider_alert'))
    && (isErrorLike(row)||FAILURE_CODE_RE.test(code));
}

export function summarizeRegressionEvents(items=[]){
  const rows=(Array.isArray(items)?items:[])
    .filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
  const severity={info:0,warning:0,error:0,critical:0};
  const durations=[];
  let authFailures=0;
  let providerFailures=0;
  let telegramFailures=0;
  let clientErrors=0;

  for(const row of rows){
    const sev=cleanText(row?.severity).trim().toLowerCase()||'info';
    if(Object.hasOwn(severity,sev)) severity[sev]+=1;
    const code=cleanText(row?.code);
    const authText=`${code} ${cleanText(row?.message)}`;
    if(AUTH_RE.test(authText)) authFailures+=1;
    if(isProviderFailure(row)) providerFailures+=1;
    if(isTelegramFailure(row)) telegramFailures+=1;
    if(code==='CLIENT_ERROR'||code==='ACTION_ERROR') clientErrors+=1;
    const duration=numericCandidate(row?.duration_ms??row?.durationMs);
    if(duration!==null&&duration>=0) durations.push(duration);
  }

  return {
    events:rows.length,
    severity,
    errors:severity.error+severity.critical,
    authFailures,
    providerFailures,
    telegramFailures,
    clientErrors,
    latency:{
      samples:durations.length,
      avgMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,
      p95Ms:percentile(durations,95),
    },
  };
}

function normalizeSummary(summary={}){
  const value=summary&&typeof summary==='object'&&!Array.isArray(summary)?summary:{};
  const severity=value.severity&&typeof value.severity==='object'&&!Array.isArray(value.severity)
    ? value.severity
    : {};
  const latency=value.latency&&typeof value.latency==='object'&&!Array.isArray(value.latency)
    ? value.latency
    : {};
  return {
    severity:{
      info:nonNegativeInteger(severity.info),
      warning:nonNegativeInteger(severity.warning),
      error:nonNegativeInteger(severity.error),
      critical:nonNegativeInteger(severity.critical),
    },
    errors:nonNegativeInteger(value.errors),
    authFailures:nonNegativeInteger(value.authFailures),
    providerFailures:nonNegativeInteger(value.providerFailures),
    telegramFailures:nonNegativeInteger(value.telegramFailures),
    clientErrors:nonNegativeInteger(value.clientErrors),
    latency:{
      samples:nonNegativeInteger(latency.samples),
      p95Ms:numericCandidate(latency.p95Ms),
    },
  };
}

function ratio(current,baseline){
  const currentValue=nonNegativeInteger(current);
  const baselineValue=nonNegativeInteger(baseline);
  if(baselineValue<=0) return currentValue>0?null:1;
  return Number((currentValue/baselineValue).toFixed(2));
}

export function compareRegressionWindow(post={},baseline={}){
  const current=normalizeSummary(post);
  const previous=normalizeSummary(baseline);
  const signals=[];
  const add=(severity,code,value,prior,detail)=>signals.push({
    severity,code,current:value,baseline:prior,ratio:ratio(value,prior),detail,
  });

  if(current.severity.critical>0&&previous.severity.critical===0){
    add('incident','critical_introduced',current.severity.critical,previous.severity.critical,'New critical events appeared after deploy.');
  }
  if(current.authFailures>previous.authFailures){
    add('incident','auth_failures_increased',current.authFailures,previous.authFailures,'Supabase/auth failures increased after deploy.');
  }
  if(current.errors>=previous.errors+3&&(previous.errors===0||current.errors>=previous.errors*2)){
    add('watch','error_volume_regression',current.errors,previous.errors,'Error volume materially increased after deploy.');
  }
  if(current.providerFailures>=previous.providerFailures+2&&(previous.providerFailures===0||current.providerFailures>=previous.providerFailures*2)){
    add('watch','provider_failure_regression',current.providerFailures,previous.providerFailures,'Provider failures materially increased after deploy.');
  }
  if(current.telegramFailures>=previous.telegramFailures+2&&(previous.telegramFailures===0||current.telegramFailures>=previous.telegramFailures*2)){
    add('watch','telegram_failure_regression',current.telegramFailures,previous.telegramFailures,'Telegram delivery failures materially increased after deploy.');
  }
  if(current.clientErrors>=previous.clientErrors+3&&(previous.clientErrors===0||current.clientErrors>=previous.clientErrors*2)){
    add('watch','client_error_regression',current.clientErrors,previous.clientErrors,'Client-side errors materially increased after deploy.');
  }
  if(
    current.latency.samples>=5
    && previous.latency.samples>=5
    && current.latency.p95Ms!==null
    && previous.latency.p95Ms!==null
    && current.latency.p95Ms>=previous.latency.p95Ms+250
    && current.latency.p95Ms>=previous.latency.p95Ms*1.5
  ){
    add('watch','latency_p95_regression',current.latency.p95Ms,previous.latency.p95Ms,'p95 operational latency materially increased after deploy.');
  }

  const state=signals.some(item=>item.severity==='incident')
    ? 'incident'
    : signals.length?'watch':'healthy';
  return {state,signals};
}

function normalizedWindows(value){
  const input=Array.isArray(value)&&value.length?value:[15,30,60];
  const output=[];
  const seen=new Set();
  for(const raw of input){
    const minutes=positiveInteger(raw);
    if(minutes===null||minutes>180||seen.has(minutes)) continue;
    seen.add(minutes);
    output.push(minutes);
  }
  return output.length?output:[15,30,60];
}

function unavailable(reason,deploySha=null){
  return {
    state:'unavailable',
    reason,
    deploySha,
    deploymentStartedAt:null,
    completedWindows:0,
    windows:[],
  };
}

export function postDeployRegressionReport(items=[],identity={},options={}){
  const deploySha=normalizeDeploySha(identity?.deploySha);
  if(!deploySha) return unavailable('deployment_identity_unavailable',null);

  const deploymentStartedAt=canonicalIsoUtc(identity?.cloudflareVersionTimestamp);
  if(!deploymentStartedAt) return unavailable('deployment_timestamp_unavailable',deploySha);
  const startedAt=Date.parse(deploymentStartedAt);

  const hasNow=Object.hasOwn(options||{},'nowMs');
  const nowCandidate=hasNow?timestampMsCandidate(options?.nowMs):Date.now();
  if(nowCandidate===null) return unavailable('monitor_clock_unavailable',deploySha);
  const nowMs=nowCandidate;
  const windows=normalizedWindows(options?.windowsMinutes);

  const rows=(Array.isArray(items)?items:[])
    .filter(row=>ts(row)!==null);

  const reports=windows.map(minutes=>{
    const span=minutes*60_000;
    const elapsed=Math.max(0,nowMs-startedAt);
    const postEnd=Math.min(nowMs,startedAt+span);
    const baselineStart=startedAt-span;
    const baselineRows=rows.filter(row=>{
      const time=ts(row);
      return time!==null&&time>=baselineStart&&time<startedAt;
    });
    const postRows=rows.filter(row=>{
      const time=ts(row);
      return time!==null&&time>=startedAt&&time<=postEnd;
    });
    const baseline=summarizeRegressionEvents(baselineRows);
    const post=summarizeRegressionEvents(postRows);
    const mature=elapsed>=span;
    const comparison=mature?compareRegressionWindow(post,baseline):{state:'collecting',signals:[]};
    return {
      minutes,
      phase:mature?'complete':'collecting',
      elapsedMinutes:Number((Math.min(elapsed,span)/60_000).toFixed(1)),
      baselineStart:new Date(baselineStart).toISOString(),
      deploymentStartedAt,
      observationEndsAt:new Date(startedAt+span).toISOString(),
      baseline,
      post,
      state:comparison.state,
      signals:comparison.signals,
    };
  });

  const completed=reports.filter(item=>item.phase==='complete');
  const state=completed.some(item=>item.state==='incident')
    ? 'incident'
    : completed.some(item=>item.state==='watch')
      ? 'watch'
      : completed.length?'healthy':'collecting';

  return {
    state,
    reason:completed.length?'completed_windows_evaluated':'awaiting_first_window',
    deploySha,
    deploymentStartedAt,
    completedWindows:completed.length,
    windows:reports,
  };
}
