const RESPONSE_STATES = Object.freeze(['acknowledged','investigating','resolved']);

function ts(row){
  const value=Date.parse(String(row?.created_at || row?.createdAt || ''));
  return Number.isFinite(value) ? value : 0;
}

function meta(row){
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}

export function postDeployRegressionIncidentId(deploySha=''){
  const sha=String(deploySha || '').toLowerCase();
  return sha ? `release-regression:${sha}` : '';
}

export function postDeployRegressionResponseRows(history=[],deploySha=''){
  const sha=String(deploySha || '').toLowerCase();
  return (history || [])
    .filter(row=>String(row?.source || '')==='release_regression_response')
    .filter(row=>String(row?.event_type || row?.eventType || '')==='incident_response')
    .filter(row=>String(meta(row).deploySha || '').toLowerCase()===sha)
    .filter(row=>RESPONSE_STATES.includes(String(meta(row).responseState || '')))
    .sort((a,b)=>ts(a)-ts(b));
}

function lifecycleRows(history=[],deploySha=''){
  const sha=String(deploySha || '').toLowerCase();
  return (history || [])
    .filter(row=>String(row?.source || '')==='release_regression')
    .filter(row=>String(row?.event_type || row?.eventType || '')==='post_deploy_regression')
    .filter(row=>String(meta(row).deploySha || '').toLowerCase()===sha)
    .sort((a,b)=>ts(a)-ts(b));
}

export function summarizePostDeployRegressionResponse(history=[],deploySha=''){
  const sha=String(deploySha || '').toLowerCase();
  const incidentId=postDeployRegressionIncidentId(sha);
  if(!sha) return {available:false,reason:'missing_deploy_sha',incidentId:null,state:'unavailable',nextState:null};

  const lifecycle=lifecycleRows(history,sha);
  const incidentSeen=lifecycle.some(row=>String(meta(row).lifecycleState || '')==='incident');
  if(!incidentSeen){
    return {available:false,reason:'no_incident',incidentId,state:'new',nextState:null,lifecycleState:String(meta(lifecycle.at(-1)).lifecycleState || 'healthy'),history:[]};
  }

  const latestLifecycle=lifecycle.at(-1) || null;
  const lifecycleState=String(meta(latestLifecycle).lifecycleState || 'incident');
  const rows=postDeployRegressionResponseRows(history,sha);
  const last=rows.at(-1) || null;
  const state=String(meta(last).responseState || 'new');

  let nextState=null;
  let reason='complete';
  if(state==='new'){
    nextState='acknowledged';
    reason='awaiting_acknowledgement';
  } else if(state==='acknowledged'){
    nextState='investigating';
    reason='awaiting_investigation';
  } else if(state==='investigating'){
    if(lifecycleState==='recovered'){
      nextState='resolved';
      reason='ready_to_resolve';
    } else {
      reason='awaiting_recovery';
    }
  }

  const normalizedHistory=rows.map(row=>({
    state:String(meta(row).responseState || ''),
    at:new Date(ts(row)).toISOString(),
    code:String(row?.code || ''),
  }));

  return {
    available:true,
    reason,
    incidentId,
    deploySha:sha,
    lifecycleState,
    state,
    nextState,
    canTransition:Boolean(nextState),
    acknowledgedAt:normalizedHistory.find(x=>x.state==='acknowledged')?.at || null,
    investigatingAt:normalizedHistory.find(x=>x.state==='investigating')?.at || null,
    resolvedAt:normalizedHistory.find(x=>x.state==='resolved')?.at || null,
    history:normalizedHistory,
  };
}

export function planPostDeployRegressionResponseTransition(history=[],deploySha='',targetState=''){
  const target=String(targetState || '');
  const status=summarizePostDeployRegressionResponse(history,deploySha);
  if(!status.available) return {action:'none',reason:status.reason,status};
  if(!RESPONSE_STATES.includes(target)) return {action:'none',reason:'invalid_target_state',status};
  if(status.state===target) return {action:'none',reason:'already_recorded',status};
  if(status.nextState!==target) return {action:'none',reason:'invalid_transition',status};

  const code={
    acknowledged:'POST_DEPLOY_REGRESSION_ACKNOWLEDGED',
    investigating:'POST_DEPLOY_REGRESSION_INVESTIGATING',
    resolved:'POST_DEPLOY_REGRESSION_RESOLVED',
  }[target];

  const transitionKey=`release-regression-response:${status.deploySha}:${target}`;
  return {
    action:'record',
    severity:'info',
    source:'release_regression_response',
    eventType:'incident_response',
    code,
    message:{
      acknowledged:'Administrator acknowledged the post-deploy regression incident.',
      investigating:'Administrator started investigating the post-deploy regression incident.',
      resolved:'Administrator resolved the post-deploy regression incident after recovery.',
    }[target],
    endpoint:'api:post-deploy-regression-response',
    transitionKey,
    meta:{
      deploySha:status.deploySha,
      incidentId:status.incidentId,
      responseState:target,
      previousResponseState:status.state,
      lifecycleState:status.lifecycleState,
      actorRole:'admin',
      transitionKey,
    },
  };
}
