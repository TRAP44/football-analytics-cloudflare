export const POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES = 30;
export const POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES = 120;
export const POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES = 360;

const DEPLOY_SHA_RE=/^[0-9a-f]{40}$/i;
const LIFECYCLE_STATES=new Set(['watch','incident','recovered']);
const RESPONSE_STATES=new Set(['acknowledged','investigating','resolved']);

function normalizeDeploySha(value=''){
  const sha=typeof value==='string'?value.trim().toLowerCase():'';
  return DEPLOY_SHA_RE.test(sha)?sha:'';
}

function eventTime(row){
  const value=row?.created_at??row?.createdAt;
  if(typeof value!=='string'||!value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp)?timestamp:null;
}

function metadata(row){
  return row?.metadata
    && typeof row.metadata==='object'
    && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function positiveSafeInteger(value){
  if(typeof value==='number') return Number.isSafeInteger(value)&&value>0?value:0;
  if(typeof value!=='string') return 0;
  const raw=value.trim();
  if(!/^\d+$/.test(raw)) return 0;
  const number=Number(raw);
  return Number.isSafeInteger(number)&&number>0?number:0;
}

function timestampCandidate(value,fallback=Date.now()){
  if(typeof value==='number'&&Number.isFinite(value)) return value;
  if(typeof value==='string'&&value.trim()){
    const timestamp=Date.parse(value.trim());
    if(Number.isFinite(timestamp)) return timestamp;
  }
  return fallback;
}

function minutesBetween(startMs,endMs){
  return Number.isFinite(startMs)&&Number.isFinite(endMs)
    ? Math.max(0,Math.round((endMs-startMs)/60000))
    : null;
}

function deployShaOf(row){
  return normalizeDeploySha(metadata(row).deploySha);
}

function lifecycleState(row){
  const value=metadata(row).lifecycleState;
  return typeof value==='string'?value.trim().toLowerCase():'';
}

function responseState(row){
  const value=metadata(row).responseState;
  return typeof value==='string'?value.trim().toLowerCase():'';
}

function lifecycleAnchor(row){
  const id=positiveSafeInteger(row?.id);
  if(id) return `event-${id}`;

  for(const value of [row?.transition_key,row?.transitionKey,metadata(row).transitionKey]){
    if(typeof value!=='string') continue;
    const clean=value.trim();
    if(/^[A-Za-z0-9._:-]{1,160}$/.test(clean)) return `key-${clean}`;
  }

  const timestamp=eventTime(row);
  return timestamp===null?'':`at-${timestamp}`;
}

function lifecycleRows(history=[],sha=''){
  if(!sha) return [];
  return (Array.isArray(history)?history:[])
    .map((row,index)=>({row,index,time:eventTime(row),state:lifecycleState(row)}))
    .filter(item=>item.time!==null)
    .filter(item=>String(item.row?.source||'')==='release_regression')
    .filter(item=>String(item.row?.event_type||item.row?.eventType||'')==='post_deploy_regression')
    .filter(item=>deployShaOf(item.row)===sha)
    .filter(item=>LIFECYCLE_STATES.has(item.state))
    .sort((a,b)=>a.time-b.time||a.index-b.index);
}

function responseRows(history=[],sha=''){
  if(!sha) return [];
  return (Array.isArray(history)?history:[])
    .map((row,index)=>({row,index,time:eventTime(row),state:responseState(row)}))
    .filter(item=>item.time!==null)
    .filter(item=>String(item.row?.source||'')==='release_regression_response')
    .filter(item=>String(item.row?.event_type||item.row?.eventType||'')==='incident_response')
    .filter(item=>deployShaOf(item.row)===sha)
    .filter(item=>RESPONSE_STATES.has(item.state))
    .sort((a,b)=>a.time-b.time||a.index-b.index);
}

function lifecycleEpisodes(rows=[]){
  const episodes=[];
  let active=null;

  for(const item of rows){
    if(item.state==='incident'){
      if(!active){
        const episodeKey=lifecycleAnchor(item.row);
        if(!episodeKey) continue;
        active={
          incident:item,
          incidentAt:item.time,
          incidentEpisodeKey:episodeKey,
          recovered:null,
        };
      }
      continue;
    }

    if(item.state==='recovered'&&active){
      active.recovered=item;
      episodes.push(active);
      active=null;
    }
  }

  if(active) episodes.push(active);
  return episodes;
}

function canonicalResponses(rows=[],episode={},nextIncidentAt=null){
  let state='new';
  const accepted=[];

  for(const item of rows){
    if(item.time<episode.incidentAt) continue;
    if(Number.isFinite(nextIncidentAt)&&item.time>=nextIncidentAt) continue;

    const explicitKey=metadata(item.row).incidentEpisodeKey;
    if(typeof explicitKey==='string'&&explicitKey.trim()&&explicitKey.trim()!==episode.incidentEpisodeKey) continue;

    const expected=state==='new'
      ? 'acknowledged'
      : state==='acknowledged'
        ? 'investigating'
        : state==='investigating'
          ? 'resolved'
          : null;

    if(item.state===state) continue;
    if(item.state!==expected) continue;
    if(item.state==='resolved'){
      const recoveredAt=episode.recovered?.time;
      if(!Number.isFinite(recoveredAt)||item.time<recoveredAt) continue;
    }

    state=item.state;
    accepted.push(item);
    if(state==='resolved') break;
  }

  return {state,accepted};
}

function buildEpisode(episode,responses,sha,asOfMs,nextIncidentAt=null){
  const nowMs=timestampCandidate(asOfMs);
  const canonical=canonicalResponses(responses,episode,nextIncidentAt);
  const byState=state=>canonical.accepted.find(item=>item.state===state)||null;

  const acknowledged=byState('acknowledged');
  const investigating=byState('investigating');
  const resolved=byState('resolved');
  const incidentAt=episode.incidentAt;
  const recoveredAt=episode.recovered?.time??null;
  const acknowledgedAt=acknowledged?.time??null;
  const investigatingAt=investigating?.time??null;
  const resolvedAt=resolved?.time??null;

  const terminalForAck=Number.isFinite(recoveredAt)?recoveredAt:nowMs;
  const elapsedMinutes=minutesBetween(incidentAt,Number.isFinite(resolvedAt)?resolvedAt:nowMs);
  const ackLatencyMinutes=minutesBetween(incidentAt,acknowledgedAt);
  const investigationLatencyMinutes=minutesBetween(incidentAt,investigatingAt);
  const recoveryLatencyMinutes=minutesBetween(incidentAt,recoveredAt);
  const resolutionLatencyMinutes=minutesBetween(incidentAt,resolvedAt);
  const postRecoveryResolutionMinutes=minutesBetween(recoveredAt,resolvedAt);

  const ackElapsedMs=Math.max(0,terminalForAck-incidentAt);
  const ackLimitMs=POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES*60000;
  const recoveryLimitMs=POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES*60000;
  const ackEligible=Number.isFinite(acknowledgedAt) || ackElapsedMs>=ackLimitMs;
  const ackMet=ackEligible
    && Number.isFinite(acknowledgedAt)
    && acknowledgedAt-incidentAt<=ackLimitMs;
  const ackBreached=ackEligible&&!ackMet;

  const recoveryElapsedMs=Math.max(0,(Number.isFinite(recoveredAt)?recoveredAt:nowMs)-incidentAt);
  const recoveryEligible=Number.isFinite(recoveredAt) || recoveryElapsedMs>=recoveryLimitMs;
  const recoveryMet=recoveryEligible
    && Number.isFinite(recoveredAt)
    && recoveredAt-incidentAt<=recoveryLimitMs;
  const recoveryBreached=recoveryEligible&&!recoveryMet;

  return {
    deploySha:sha,
    incidentEpisodeKey:episode.incidentEpisodeKey,
    incidentAt:new Date(incidentAt).toISOString(),
    acknowledgedAt:Number.isFinite(acknowledgedAt)?new Date(acknowledgedAt).toISOString():null,
    investigatingAt:Number.isFinite(investigatingAt)?new Date(investigatingAt).toISOString():null,
    recoveredAt:Number.isFinite(recoveredAt)?new Date(recoveredAt).toISOString():null,
    resolvedAt:Number.isFinite(resolvedAt)?new Date(resolvedAt).toISOString():null,
    active:!Number.isFinite(recoveredAt),
    responseOpen:!Number.isFinite(resolvedAt),
    elapsedMinutes,
    ackLatencyMinutes,
    investigationLatencyMinutes,
    recoveryLatencyMinutes,
    resolutionLatencyMinutes,
    postRecoveryResolutionMinutes,
    ackStatus:ackMet?'met':ackBreached?'breached':'pending',
    recoveryStatus:recoveryMet?'met':recoveryBreached?'breached':'pending',
    ackEligible,
    ackMet,
    ackBreached,
    recoveryEligible,
    recoveryMet,
    recoveryBreached,
    ackCriticalOverdue:!Number.isFinite(acknowledgedAt)
      && !Number.isFinite(recoveredAt)
      && ackElapsedMs>=POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES*60000,
  };
}

function incidentEpisodesForDeploy(history=[],deploySha='',asOfMs=Date.now()){
  const sha=normalizeDeploySha(deploySha);
  if(!sha) return [];

  const lifecycle=lifecycleRows(history,sha);
  const response=responseRows(history,sha);
  const episodes=lifecycleEpisodes(lifecycle);

  return episodes.map((episode,index)=>{
    const nextIncidentAt=episodes[index+1]?.incidentAt??null;
    return buildEpisode(episode,response,sha,asOfMs,nextIncidentAt);
  });
}

export function buildPostDeployRegressionIncidentEpisode(history=[],deploySha='',asOfMs=Date.now()){
  return incidentEpisodesForDeploy(history,deploySha,asOfMs).at(-1)||null;
}

function dashboardLimit(value){
  const parsed=positiveSafeInteger(value);
  return parsed?Math.min(100,parsed):20;
}

export function buildPostDeployRegressionSloDashboard(history=[],{
  activeDeploySha='',
  asOfMs=Date.now(),
  limit=20,
}={}){
  const source=Array.isArray(history)?history:[];
  const nowMs=timestampCandidate(asOfMs);
  const deploys=[...new Set(source
    .filter(row=>String(row?.source||'')==='release_regression')
    .map(deployShaOf)
    .filter(Boolean))];

  const episodes=deploys
    .flatMap(sha=>incidentEpisodesForDeploy(source,sha,nowMs))
    .sort((a,b)=>Date.parse(b.incidentAt)-Date.parse(a.incidentAt))
    .slice(0,dashboardLimit(limit));

  const ackEligible=episodes.filter(x=>x.ackEligible).length;
  const ackMet=episodes.filter(x=>x.ackMet).length;
  const recoveryEligible=episodes.filter(x=>x.recoveryEligible).length;
  const recoveryMet=episodes.filter(x=>x.recoveryMet).length;
  const avg=(values)=>{
    const list=values.filter(Number.isFinite);
    return list.length?Math.round((list.reduce((a,b)=>a+b,0)/list.length)*10)/10:null;
  };
  const pct=(met,eligible)=>eligible>0?Math.round((met/eligible)*1000)/10:null;

  const activeSha=normalizeDeploySha(activeDeploySha);
  const current=activeSha
    ? episodes.find(x=>x.deploySha===activeSha)
      || buildPostDeployRegressionIncidentEpisode(source,activeSha,nowMs)
    : null;

  return {
    available:true,
    generatedAt:new Date(nowMs).toISOString(),
    thresholds:{
      ackMinutes:POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES,
      ackCriticalMinutes:POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES,
      recoveryMinutes:POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES,
      source:'existing_operational_incident_slo',
      investigationTargetMinutes:null,
      resolutionTargetMinutes:null,
    },
    current,
    summary:{
      incidents:episodes.length,
      active:episodes.filter(x=>x.active).length,
      unresolved:episodes.filter(x=>x.responseOpen).length,
      ackEligible,
      ackMet,
      ackBreached:episodes.filter(x=>x.ackBreached).length,
      ackSloPct:pct(ackMet,ackEligible),
      recoveryEligible,
      recoveryMet,
      recoveryBreached:episodes.filter(x=>x.recoveryBreached).length,
      recoverySloPct:pct(recoveryMet,recoveryEligible),
      avgAckMinutes:avg(episodes.map(x=>x.ackLatencyMinutes)),
      avgInvestigationMinutes:avg(episodes.map(x=>x.investigationLatencyMinutes)),
      avgRecoveryMinutes:avg(episodes.map(x=>x.recoveryLatencyMinutes)),
      avgResolutionMinutes:avg(episodes.map(x=>x.resolutionLatencyMinutes)),
    },
    episodes,
  };
}
