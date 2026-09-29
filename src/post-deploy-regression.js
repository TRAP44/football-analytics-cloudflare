const AUTH_RE=/HTTP 401|PGRST303|invalid.*jwt|invalid.*api.?key/i;
const FAILURE_CODE_RE=/(?:FAIL|ERROR|INCIDENT|RATE_LIMIT|DEGRADED)/i;

function ts(row){
  const value=Date.parse(String(row?.created_at || ''));
  return Number.isFinite(value) ? value : null;
}

function percentile(values,p){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length) return null;
  const idx=Math.min(sorted.length-1,Math.max(0,Math.ceil((p/100)*sorted.length)-1));
  return sorted[idx];
}

function isErrorLike(row){
  return ['error','critical'].includes(String(row?.severity || '').toLowerCase());
}

function isProviderFailure(row){
  const source=String(row?.source || '').toLowerCase();
  const code=String(row?.code || '');
  return (source.includes('provider') || source.includes('football') || /^API_/i.test(code))
    && (isErrorLike(row) || FAILURE_CODE_RE.test(code));
}

function isTelegramFailure(row){
  const source=String(row?.source || '').toLowerCase();
  const code=String(row?.code || '');
  return (source.includes('telegram') || source.includes('digest_alert') || source.includes('provider_alert'))
    && (isErrorLike(row) || FAILURE_CODE_RE.test(code));
}

export function summarizeRegressionEvents(items=[]){
  const severity={info:0,warning:0,error:0,critical:0};
  const durations=[];
  let authFailures=0;
  let providerFailures=0;
  let telegramFailures=0;
  let clientErrors=0;

  for(const row of items){
    const sev=String(row?.severity || 'info').toLowerCase();
    if(sev in severity) severity[sev]+=1;
    if(AUTH_RE.test(String(row?.message || ''))) authFailures+=1;
    if(isProviderFailure(row)) providerFailures+=1;
    if(isTelegramFailure(row)) telegramFailures+=1;
    if(String(row?.code || '')==='CLIENT_ERROR' || String(row?.code || '')==='ACTION_ERROR') clientErrors+=1;
    const duration=Number(row?.duration_ms);
    if(Number.isFinite(duration) && duration>=0) durations.push(duration);
  }

  return {
    events:items.length,
    severity,
    errors:severity.error+severity.critical,
    authFailures,
    providerFailures,
    telegramFailures,
    clientErrors,
    latency:{
      samples:durations.length,
      avgMs:durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : null,
      p95Ms:percentile(durations,95),
    },
  };
}

function ratio(current,baseline){
  if(baseline<=0) return current>0 ? null : 1;
  return Number((current/baseline).toFixed(2));
}

export function compareRegressionWindow(post,baseline){
  const signals=[];
  const add=(severity,code,current,previous,detail)=>signals.push({
    severity,code,current,baseline:previous,ratio:ratio(current,previous),detail,
  });

  if(post.severity.critical>0 && baseline.severity.critical===0){
    add('incident','critical_introduced',post.severity.critical,baseline.severity.critical,'New critical events appeared after deploy.');
  }
  if(post.authFailures>baseline.authFailures){
    add('incident','auth_failures_increased',post.authFailures,baseline.authFailures,'Supabase/auth failures increased after deploy.');
  }
  if(post.errors>=baseline.errors+3 && (baseline.errors===0 || post.errors>=baseline.errors*2)){
    add('watch','error_volume_regression',post.errors,baseline.errors,'Error volume materially increased after deploy.');
  }
  if(post.providerFailures>=baseline.providerFailures+2 && (baseline.providerFailures===0 || post.providerFailures>=baseline.providerFailures*2)){
    add('watch','provider_failure_regression',post.providerFailures,baseline.providerFailures,'Provider failures materially increased after deploy.');
  }
  if(post.telegramFailures>=baseline.telegramFailures+2 && (baseline.telegramFailures===0 || post.telegramFailures>=baseline.telegramFailures*2)){
    add('watch','telegram_failure_regression',post.telegramFailures,baseline.telegramFailures,'Telegram delivery failures materially increased after deploy.');
  }
  if(post.clientErrors>=baseline.clientErrors+3 && (baseline.clientErrors===0 || post.clientErrors>=baseline.clientErrors*2)){
    add('watch','client_error_regression',post.clientErrors,baseline.clientErrors,'Client-side errors materially increased after deploy.');
  }
  if(
    post.latency.samples>=5
    && baseline.latency.samples>=5
    && Number(post.latency.p95Ms || 0)>=Number(baseline.latency.p95Ms || 0)+250
    && Number(post.latency.p95Ms || 0)>=Number(baseline.latency.p95Ms || 0)*1.5
  ){
    add('watch','latency_p95_regression',post.latency.p95Ms,baseline.latency.p95Ms,'p95 operational latency materially increased after deploy.');
  }

  const state=signals.some(item=>item.severity==='incident')
    ? 'incident'
    : signals.length ? 'watch' : 'healthy';
  return {state,signals};
}

export function postDeployRegressionReport(items=[],identity={},options={}){
  const startedAt=Date.parse(String(identity?.cloudflareVersionTimestamp || ''));
  const nowMs=Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const windows=Array.isArray(options.windowsMinutes) && options.windowsMinutes.length
    ? options.windowsMinutes
    : [15,30,60];

  if(!Number.isFinite(startedAt)){
    return {
      state:'unavailable',
      reason:'deployment_timestamp_unavailable',
      deploySha:String(identity?.deploySha || '') || null,
      deploymentStartedAt:null,
      windows:[],
    };
  }

  const rows=(Array.isArray(items)?items:[]).filter(row=>ts(row)!==null);
  const reports=windows.map(rawMinutes=>{
    const minutes=Math.max(1,Math.min(180,Number(rawMinutes || 0)));
    const span=minutes*60_000;
    const elapsed=Math.max(0,nowMs-startedAt);
    const postEnd=Math.min(nowMs,startedAt+span);
    const baselineStart=startedAt-span;
    const baselineRows=rows.filter(row=>{
      const t=ts(row); return t>=baselineStart && t<startedAt;
    });
    const postRows=rows.filter(row=>{
      const t=ts(row); return t>=startedAt && t<=postEnd;
    });
    const baseline=summarizeRegressionEvents(baselineRows);
    const post=summarizeRegressionEvents(postRows);
    const mature=elapsed>=span;
    const comparison=mature ? compareRegressionWindow(post,baseline) : {state:'collecting',signals:[]};
    return {
      minutes,
      phase:mature ? 'complete' : 'collecting',
      elapsedMinutes:Number((Math.min(elapsed,span)/60_000).toFixed(1)),
      baselineStart:new Date(baselineStart).toISOString(),
      deploymentStartedAt:new Date(startedAt).toISOString(),
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
      : completed.length ? 'healthy' : 'collecting';

  return {
    state,
    reason:completed.length ? 'completed_windows_evaluated' : 'awaiting_first_window',
    deploySha:String(identity?.deploySha || '') || null,
    deploymentStartedAt:new Date(startedAt).toISOString(),
    completedWindows:completed.length,
    windows:reports,
  };
}
