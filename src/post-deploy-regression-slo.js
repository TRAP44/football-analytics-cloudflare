export const POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES = 30;
export const POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES = 120;
export const POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES = 360;

function eventTime(row){
  const value=Date.parse(String(row?.created_at || row?.createdAt || ''));
  return Number.isFinite(value) ? value : null;
}

function metadata(row){
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}

function minutesBetween(startMs,endMs){
  return Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0,Math.round((endMs-startMs)/60000))
    : null;
}

function deployShaOf(row){
  return String(metadata(row).deploySha || '').toLowerCase();
}

function firstByState(rows,state,key){
  return rows.find(row=>String(metadata(row)[key] || '')===state) || null;
}

export function buildPostDeployRegressionIncidentEpisode(history=[],deploySha='',asOfMs=Date.now()){
  const sha=String(deploySha || '').toLowerCase();
  if(!sha) return null;

  const lifecycle=(history || [])
    .filter(row=>String(row?.source || '')==='release_regression')
    .filter(row=>String(row?.event_type || row?.eventType || '')==='post_deploy_regression')
    .filter(row=>deployShaOf(row)===sha)
    .sort((a,b)=>(eventTime(a) || 0)-(eventTime(b) || 0));

  const responses=(history || [])
    .filter(row=>String(row?.source || '')==='release_regression_response')
    .filter(row=>String(row?.event_type || row?.eventType || '')==='incident_response')
    .filter(row=>deployShaOf(row)===sha)
    .sort((a,b)=>(eventTime(a) || 0)-(eventTime(b) || 0));

  const incident=firstByState(lifecycle,'incident','lifecycleState');
  if(!incident) return null;

  const incidentAt=eventTime(incident);
  const recovered=lifecycle.find(row=>{
    const at=eventTime(row);
    return at!==null
      && at>=incidentAt
      && String(metadata(row).lifecycleState || '')==='recovered';
  }) || null;
  const acknowledged=firstByState(responses,'acknowledged','responseState');
  const investigating=firstByState(responses,'investigating','responseState');
  const resolved=firstByState(responses,'resolved','responseState');

  const recoveredAt=eventTime(recovered);
  const acknowledgedAt=eventTime(acknowledged);
  const investigatingAt=eventTime(investigating);
  const resolvedAt=eventTime(resolved);

  const terminalForAck=Number.isFinite(recoveredAt) ? recoveredAt : asOfMs;
  const elapsedMinutes=minutesBetween(incidentAt,Number.isFinite(resolvedAt) ? resolvedAt : asOfMs);
  const ackLatencyMinutes=minutesBetween(incidentAt,acknowledgedAt);
  const investigationLatencyMinutes=minutesBetween(incidentAt,investigatingAt);
  const recoveryLatencyMinutes=minutesBetween(incidentAt,recoveredAt);
  const resolutionLatencyMinutes=minutesBetween(incidentAt,resolvedAt);
  const postRecoveryResolutionMinutes=minutesBetween(recoveredAt,resolvedAt);

  const ackElapsedMinutes=minutesBetween(incidentAt,terminalForAck);
  const ackEligible=Number.isFinite(acknowledgedAt)
    || Number(ackElapsedMinutes || 0)>=POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES;
  const ackMet=ackEligible
    && Number.isFinite(ackLatencyMinutes)
    && ackLatencyMinutes<=POST_DEPLOY_REGRESSION_ACK_SLO_MINUTES;
  const ackBreached=ackEligible && !ackMet;

  const recoveryElapsedMinutes=minutesBetween(incidentAt,Number.isFinite(recoveredAt) ? recoveredAt : asOfMs);
  const recoveryEligible=Number.isFinite(recoveredAt)
    || Number(recoveryElapsedMinutes || 0)>=POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES;
  const recoveryMet=recoveryEligible
    && Number.isFinite(recoveryLatencyMinutes)
    && recoveryLatencyMinutes<=POST_DEPLOY_REGRESSION_RECOVERY_SLO_MINUTES;
  const recoveryBreached=recoveryEligible && !recoveryMet;

  return {
    deploySha:sha,
    incidentAt:new Date(incidentAt).toISOString(),
    acknowledgedAt:Number.isFinite(acknowledgedAt) ? new Date(acknowledgedAt).toISOString() : null,
    investigatingAt:Number.isFinite(investigatingAt) ? new Date(investigatingAt).toISOString() : null,
    recoveredAt:Number.isFinite(recoveredAt) ? new Date(recoveredAt).toISOString() : null,
    resolvedAt:Number.isFinite(resolvedAt) ? new Date(resolvedAt).toISOString() : null,
    active:!Number.isFinite(recoveredAt),
    responseOpen:!Number.isFinite(resolvedAt),
    elapsedMinutes,
    ackLatencyMinutes,
    investigationLatencyMinutes,
    recoveryLatencyMinutes,
    resolutionLatencyMinutes,
    postRecoveryResolutionMinutes,
    ackStatus:ackMet ? 'met' : ackBreached ? 'breached' : 'pending',
    recoveryStatus:recoveryMet ? 'met' : recoveryBreached ? 'breached' : 'pending',
    ackEligible,
    ackMet,
    ackBreached,
    recoveryEligible,
    recoveryMet,
    recoveryBreached,
    ackCriticalOverdue:!Number.isFinite(acknowledgedAt)
      && !Number.isFinite(recoveredAt)
      && Number(ackElapsedMinutes || 0)>=POST_DEPLOY_REGRESSION_ACK_CRITICAL_MINUTES,
  };
}

export function buildPostDeployRegressionSloDashboard(history=[],{
  activeDeploySha='',
  asOfMs=Date.now(),
  limit=20,
}={}){
  const deploys=[...new Set((history || [])
    .filter(row=>String(row?.source || '')==='release_regression')
    .map(deployShaOf)
    .filter(Boolean))];

  const episodes=deploys
    .map(sha=>buildPostDeployRegressionIncidentEpisode(history,sha,asOfMs))
    .filter(Boolean)
    .sort((a,b)=>Date.parse(b.incidentAt)-Date.parse(a.incidentAt))
    .slice(0,Math.max(1,Math.min(100,Number(limit || 20))));

  const ackEligible=episodes.filter(x=>x.ackEligible).length;
  const ackMet=episodes.filter(x=>x.ackMet).length;
  const recoveryEligible=episodes.filter(x=>x.recoveryEligible).length;
  const recoveryMet=episodes.filter(x=>x.recoveryMet).length;
  const avg=(values)=>{
    const list=values.filter(Number.isFinite);
    return list.length ? Math.round((list.reduce((a,b)=>a+b,0)/list.length)*10)/10 : null;
  };
  const pct=(met,eligible)=>eligible>0 ? Math.round((met/eligible)*1000)/10 : null;

  const activeSha=String(activeDeploySha || '').toLowerCase();
  const current=activeSha
    ? episodes.find(x=>x.deploySha===activeSha) || buildPostDeployRegressionIncidentEpisode(history,activeSha,asOfMs)
    : null;

  return {
    available:true,
    generatedAt:new Date(asOfMs).toISOString(),
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
