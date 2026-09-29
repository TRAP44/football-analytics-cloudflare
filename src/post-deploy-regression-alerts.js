const MAX_DELIVERY_ATTEMPTS=3;

function finite(value,fallback=0){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}

function iso(value){
  const ms=Date.parse(String(value||''));
  return Number.isFinite(ms)?new Date(ms).toISOString():'';
}

function destinations(items=[]){
  return (Array.isArray(items)?items:[])
    .map((item,index)=>({
      slot:Number.isInteger(Number(item?.slot))?Number(item.slot):index,
      destinationKey:String(item?.destinationKey||item?.destination_key||'').trim(),
    }))
    .filter(item=>item.slot>=0&&item.destinationKey);
}

function lifecycleRows(items=[],deploySha=''){
  const sha=String(deploySha||'').toLowerCase();
  return (Array.isArray(items)?items:[])
    .filter(row=>String(row?.source||'')==='release_regression')
    .filter(row=>String(row?.event_type||'')==='post_deploy_regression')
    .filter(row=>String(row?.metadata?.deploySha||'').toLowerCase()===sha)
    .map(row=>({
      id:row?.id??null,
      createdAt:iso(row?.created_at),
      state:String(row?.metadata?.lifecycleState||''),
      windowMinutes:Number(row?.metadata?.windowMinutes||0),
      signalCodes:Array.isArray(row?.metadata?.signalCodes)?row.metadata.signalCodes.map(String):[],
      releaseCandidate:String(row?.metadata?.releaseCandidate||''),
      appVersion:String(row?.metadata?.appVersion||''),
      deploySha:sha,
    }))
    .sort((a,b)=>Date.parse(a.createdAt||0)-Date.parse(b.createdAt||0));
}

function plannedLifecycleRow(plan={},deploySha='',nowMs=Date.now()){
  if(plan?.action!=='record') return null;
  const sha=String(deploySha||'').toLowerCase();
  if(String(plan?.meta?.deploySha||'').toLowerCase()!==sha) return null;
  return {
    id:null,
    createdAt:new Date(Number(nowMs)).toISOString(),
    state:String(plan?.meta?.lifecycleState||''),
    windowMinutes:Number(plan?.meta?.windowMinutes||0),
    signalCodes:Array.isArray(plan?.meta?.signalCodes)?plan.meta.signalCodes.map(String):[],
    releaseCandidate:'',
    appVersion:'',
    deploySha:sha,
    planned:true,
  };
}

function ledgerRows(rows=[],incidentId=''){
  return (Array.isArray(rows)?rows:[])
    .filter(row=>String(row?.incident_id||row?.incidentId||'')===String(incidentId||''));
}

function targetState(rows=[],alertKey='',targets=[],nowMs=Date.now()){
  const matching=(rows||[]).filter(row=>String(row?.alert_key||row?.alertKey||'')===String(alertKey||''));
  const byDestination=new Map();
  for(const row of matching){
    const key=String(row?.destination_key||row?.destinationKey||'');
    if(key) byDestination.set(key,row);
  }

  const pending=[];
  const states=[];
  for(const target of targets){
    const row=byDestination.get(target.destinationKey)||null;
    if(!row){
      pending.push(target);
      states.push('missing');
      continue;
    }
    const status=String(row?.status||'').toLowerCase();
    states.push(status||'unknown');
    if(status==='retry_pending'){
      const attempts=Math.max(0,finite(row?.attempts));
      const retryAt=Date.parse(String(row?.retry_at||row?.retryAt||''));
      if(attempts<MAX_DELIVERY_ATTEMPTS&&(!Number.isFinite(retryAt)||retryAt<=nowMs)){
        pending.push(target);
      }
    }
  }

  let reason='no_pending_recipients';
  if(states.includes('sending')) reason='delivery_waiting';
  else if(states.includes('retry_pending')) reason='retry_waiting';
  else if(states.includes('unknown')) reason='delivery_outcome_unknown';
  else if(states.includes('terminal_failed')) reason='delivery_exhausted';
  else if(states.length&&states.every(state=>state==='sent')) reason='already_delivered';

  return {pending,reason,rows:matching};
}

export function postDeployRegressionIncidentId(deploySha=''){
  const sha=String(deploySha||'').toLowerCase();
  return sha?'release-regression:'+sha:'';
}

export function planPostDeployRegressionAlert(
  lifecycleHistory=[],
  deliveryLedger=[],
  {deploySha='',plannedTransition=null,destinations:targetDestinations=[],nowMs=Date.now()}={},
){
  const sha=String(deploySha||'').toLowerCase();
  const targets=destinations(targetDestinations);
  if(!sha) return {action:'none',reason:'deployment_identity_unavailable'};
  if(!targets.length) return {action:'none',reason:'no_admin_recipients'};

  const history=lifecycleRows(lifecycleHistory,sha);
  const planned=plannedLifecycleRow(plannedTransition,sha,nowMs);
  const timeline=planned?[...history,planned]:history;
  const latest=timeline.at(-1)||null;
  if(!latest) return {action:'none',reason:'no_lifecycle_transition'};
  if(latest.state==='watch') return {action:'none',reason:'watch_not_alertable'};

  const incidentId=postDeployRegressionIncidentId(sha);
  const rows=ledgerRows(deliveryLedger,incidentId);

  if(latest.state==='incident'){
    const alertKey=incidentId+':incident';
    const delivery=targetState(rows,alertKey,targets,nowMs);
    if(!delivery.pending.length) return {action:'none',reason:delivery.reason,incidentId};
    return {
      action:'send',
      kind:'incident',
      incidentId,
      alertKey,
      deliveryKey:alertKey,
      severity:'error',
      targetDeliveries:delivery.pending,
      targetSlots:delivery.pending.map(item=>item.slot),
      incident:{
        incidentId,
        deploySha:sha,
        state:'incident',
        startedAt:latest.createdAt,
        windowMinutes:latest.windowMinutes,
        signalCodes:latest.signalCodes,
        releaseCandidate:latest.releaseCandidate,
        appVersion:latest.appVersion,
      },
    };
  }

  if(latest.state==='recovered'){
    const priorIncident=[...timeline.slice(0,-1)].reverse().find(item=>item.state==='incident')||null;
    if(!priorIncident) return {action:'none',reason:'recovery_without_incident',incidentId};
    const openKey=incidentId+':incident';
    const hadIncidentAttempt=rows.some(row=>String(row?.alert_key||row?.alertKey||'')===openKey);
    if(!hadIncidentAttempt) return {action:'none',reason:'recovery_without_prior_incident_alert',incidentId};

    const alertKey=incidentId+':recovery';
    const delivery=targetState(rows,alertKey,targets,nowMs);
    if(!delivery.pending.length) return {action:'none',reason:delivery.reason,incidentId};
    return {
      action:'send',
      kind:'recovery',
      incidentId,
      alertKey,
      deliveryKey:alertKey,
      severity:'info',
      targetDeliveries:delivery.pending,
      targetSlots:delivery.pending.map(item=>item.slot),
      incident:{
        incidentId,
        deploySha:sha,
        state:'recovered',
        startedAt:priorIncident.createdAt,
        recoveredAt:latest.createdAt,
        windowMinutes:latest.windowMinutes,
        signalCodes:priorIncident.signalCodes,
        releaseCandidate:latest.releaseCandidate||priorIncident.releaseCandidate,
        appVersion:latest.appVersion||priorIncident.appVersion,
      },
    };
  }

  return {action:'none',reason:'lifecycle_not_alertable',incidentId};
}

function shortSha(value=''){
  const sha=String(value||'');
  return sha?sha.slice(0,12):'—';
}

export function formatPostDeployRegressionAlert(plan={}){
  const incident=plan.incident||{};
  const signals=Array.isArray(incident.signalCodes)&&incident.signalCodes.length
    ? incident.signalCodes.join(', ')
    : '—';
  if(plan.kind==='recovery'){
    return [
      '✅ Post-deploy regression recovered',
      '',
      'Deploy: '+shortSha(incident.deploySha),
      'Release: '+String(incident.releaseCandidate||incident.appVersion||'—'),
      'Incident ID: '+String(incident.incidentId||plan.incidentId||'—'),
      'Восстановление: '+(iso(incident.recoveredAt)||'—'),
      'Окно: '+String(Number(incident.windowMinutes||0))+' мин',
      'Итоговое состояние: healthy',
    ].join('\n');
  }

  return [
    '🚨 Post-deploy regression incident',
    '',
    'Deploy: '+shortSha(incident.deploySha),
    'Release: '+String(incident.releaseCandidate||incident.appVersion||'—'),
    'Состояние: incident',
    'Окно подтверждения: '+String(Number(incident.windowMinutes||0))+' мин',
    'Signals: '+signals,
    'Начало: '+(iso(incident.startedAt)||'—'),
    'Incident ID: '+String(incident.incidentId||plan.incidentId||'—'),
    '',
    'Проверь release.regression и ops_events. Автоматический rollback, смена provider и отключение функций не выполняются.',
  ].join('\n');
}

export function postDeployRegressionAlertOpsEvents(plan={},delivery={}){
  const outcomes=Array.isArray(delivery?.outcomes)?delivery.outcomes:[];
  const groups=new Map();
  for(const item of outcomes){
    const state=String(item?.state||'unknown');
    if(!groups.has(state)) groups.set(state,[]);
    groups.get(state).push(item);
  }

  const events=[];
  for(const [state,items] of groups.entries()){
    const spec={
      sent:['info',plan.kind==='recovery'?'POST_DEPLOY_REGRESSION_RECOVERY_ALERT_SENT':'POST_DEPLOY_REGRESSION_INCIDENT_ALERT_SENT'],
      duplicate:['info','POST_DEPLOY_REGRESSION_ALERT_DUPLICATE_SUPPRESSED'],
      retry_pending:['warning','POST_DEPLOY_REGRESSION_ALERT_RETRY_PENDING'],
      terminal_failed:['warning','POST_DEPLOY_REGRESSION_ALERT_TERMINAL_FAILED'],
      unknown:['warning','POST_DEPLOY_REGRESSION_ALERT_UNKNOWN'],
      persistence_failure:['error','POST_DEPLOY_REGRESSION_ALERT_PERSISTENCE_FAILED'],
    }[state]||['warning','POST_DEPLOY_REGRESSION_ALERT_STATE'];

    events.push({
      severity:spec[0],
      source:'release_regression_alert',
      eventType:'alert_delivery',
      code:spec[1],
      message:'Post-deploy regression alert delivery state: '+state+'.',
      endpoint:'cron:production-monitor',
      meta:{
        incidentId:plan.incidentId||null,
        alertKind:String(plan.kind||''),
        deliveryKey:String(plan.alertKey||plan.deliveryKey||''),
        deploySha:String(plan.incident?.deploySha||''),
        windowMinutes:Number(plan.incident?.windowMinutes||0),
        signalCodes:Array.isArray(plan.incident?.signalCodes)?plan.incident.signalCodes:[],
        recipientSlots:items.map(item=>Number(item?.slot)).filter(Number.isInteger),
        recipientCount:items.length,
      },
    });
  }
  return events;
}
