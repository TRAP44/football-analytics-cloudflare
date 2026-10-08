const RESPONSE_STATES = Object.freeze(['acknowledged','investigating','resolved']);
const LIFECYCLE_STATES = new Set(['watch','incident','recovered']);
const DEPLOY_SHA_RE=/^[0-9a-f]{40}$/i;
const RESPONSE_ORDER=Object.freeze({
  new:'acknowledged',
  acknowledged:'investigating',
  investigating:'resolved',
  resolved:null,
});

function normalizeDeploySha(value=''){
  const sha=typeof value==='string'?value.trim().toLowerCase():'';
  return DEPLOY_SHA_RE.test(sha)?sha:'';
}

function positiveSafeInteger(value){
  if(typeof value==='number') return Number.isSafeInteger(value)&&value>0?value:0;
  if(typeof value!=='string') return 0;
  const raw=value.trim();
  if(!/^\d+$/.test(raw)) return 0;
  const number=Number(raw);
  return Number.isSafeInteger(number)&&number>0?number:0;
}

function eventTime(row){
  const value=row?.created_at??row?.createdAt;
  if(typeof value!=='string'||!value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp)?timestamp:null;
}

function meta(row){
  return row?.metadata
    && typeof row.metadata==='object'
    && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
}

function responseState(row){
  const value=meta(row).responseState;
  return typeof value==='string'?value.trim().toLowerCase():'';
}

function lifecycleState(row){
  const value=meta(row).lifecycleState;
  return typeof value==='string'?value.trim().toLowerCase():'';
}

function lifecycleAnchor(row){
  const id=positiveSafeInteger(row?.id);
  if(id) return `event-${id}`;

  for(const value of [row?.transition_key,row?.transitionKey,meta(row).transitionKey]){
    if(typeof value!=='string') continue;
    const clean=value.trim();
    if(/^[A-Za-z0-9._:-]{1,160}$/.test(clean)) return `key-${clean}`;
  }

  const timestamp=eventTime(row);
  return timestamp===null?'':`at-${timestamp}`;
}

export function postDeployRegressionIncidentId(deploySha=''){
  const sha=normalizeDeploySha(deploySha);
  return sha ? `release-regression:${sha}` : '';
}

export function postDeployRegressionResponseRows(history=[],deploySha=''){
  const sha=normalizeDeploySha(deploySha);
  if(!sha) return [];

  return (Array.isArray(history)?history:[])
    .map((row,index)=>({row,index,time:eventTime(row)}))
    .filter(item=>item.time!==null)
    .filter(item=>String(item.row?.source||'')==='release_regression_response')
    .filter(item=>String(item.row?.event_type||item.row?.eventType||'')==='incident_response')
    .filter(item=>normalizeDeploySha(meta(item.row).deploySha)===sha)
    .filter(item=>RESPONSE_STATES.includes(responseState(item.row)))
    .sort((a,b)=>a.time-b.time||a.index-b.index)
    .map(item=>item.row);
}

function lifecycleRows(history=[],deploySha=''){
  const sha=normalizeDeploySha(deploySha);
  if(!sha) return [];

  return (Array.isArray(history)?history:[])
    .map((row,index)=>({
      row,
      index,
      time:eventTime(row),
      state:lifecycleState(row),
    }))
    .filter(item=>item.time!==null)
    .filter(item=>String(item.row?.source||'')==='release_regression')
    .filter(item=>String(item.row?.event_type||item.row?.eventType||'')==='post_deploy_regression')
    .filter(item=>normalizeDeploySha(meta(item.row).deploySha)===sha)
    .filter(item=>LIFECYCLE_STATES.has(item.state))
    .sort((a,b)=>a.time-b.time||a.index-b.index);
}

function currentIncidentEpisode(lifecycle=[]){
  const incidentIndex=lifecycle.findLastIndex(item=>item.state==='incident');
  if(incidentIndex<0) return null;

  const incident=lifecycle[incidentIndex];
  const after=lifecycle.slice(incidentIndex);
  const recovered=after.find(item=>item.state==='recovered')||null;
  const terminal=recovered||after.at(-1)||incident;
  const episodeKey=lifecycleAnchor(incident.row);
  if(!episodeKey) return null;

  return {
    incident,
    incidentAt:incident.time,
    recoveredAt:recovered?.time??null,
    lifecycleState:terminal.state,
    episodeKey,
  };
}

function responseEpisodeKey(row){
  const value=meta(row).incidentEpisodeKey;
  return typeof value==='string'?value.trim():'';
}

function canonicalResponseHistory(rows=[],episode={}){
  let state='new';
  const accepted=[];

  for(const row of rows){
    const time=eventTime(row);
    if(time===null||time<episode.incidentAt) continue;

    const explicitEpisodeKey=responseEpisodeKey(row);
    if(explicitEpisodeKey&&explicitEpisodeKey!==episode.episodeKey) continue;

    const next=RESPONSE_ORDER[state];
    const candidate=responseState(row);
    if(candidate===state) continue;
    if(candidate!==next) continue;
    if(candidate==='resolved' && (episode.recoveredAt===null || time<episode.recoveredAt)) continue;

    state=candidate;
    accepted.push(row);
    if(state==='resolved') break;
  }

  return {state,rows:accepted};
}

export function summarizePostDeployRegressionResponse(history=[],deploySha=''){
  const sha=normalizeDeploySha(deploySha);
  const incidentId=postDeployRegressionIncidentId(sha);
  if(!sha) return {available:false,reason:'missing_deploy_sha',incidentId:null,state:'unavailable',nextState:null};

  const lifecycle=lifecycleRows(history,sha);
  const episode=currentIncidentEpisode(lifecycle);
  if(!episode){
    return {
      available:false,
      reason:'no_incident',
      incidentId,
      state:'new',
      nextState:null,
      lifecycleState:lifecycle.at(-1)?.state||'healthy',
      history:[],
    };
  }

  const rows=postDeployRegressionResponseRows(history,sha);
  const canonical=canonicalResponseHistory(rows,episode);
  const state=canonical.state;
  const lifecycleState=episode.lifecycleState;

  let nextState=null;
  let reason='complete';
  if(state==='new'){
    nextState='acknowledged';
    reason='awaiting_acknowledgement';
  }else if(state==='acknowledged'){
    nextState='investigating';
    reason='awaiting_investigation';
  }else if(state==='investigating'){
    if(lifecycleState==='recovered'){
      nextState='resolved';
      reason='ready_to_resolve';
    }else{
      reason='awaiting_recovery';
    }
  }

  const normalizedHistory=canonical.rows.map(row=>({
    state:responseState(row),
    at:new Date(eventTime(row)).toISOString(),
    code:typeof row?.code==='string'?row.code:'',
  }));

  return {
    available:true,
    reason,
    incidentId,
    incidentEpisodeKey:episode.episodeKey,
    incidentStartedAt:new Date(episode.incidentAt).toISOString(),
    deploySha:sha,
    lifecycleState,
    state,
    nextState,
    canTransition:Boolean(nextState),
    acknowledgedAt:normalizedHistory.find(x=>x.state==='acknowledged')?.at||null,
    investigatingAt:normalizedHistory.find(x=>x.state==='investigating')?.at||null,
    resolvedAt:normalizedHistory.find(x=>x.state==='resolved')?.at||null,
    history:normalizedHistory,
  };
}

export function planPostDeployRegressionResponseTransition(history=[],deploySha='',targetState=''){
  const target=typeof targetState==='string'?targetState.trim().toLowerCase():'';
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

  const transitionKey=`release-regression-response:${status.deploySha}:${status.incidentEpisodeKey}:${target}`;
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
      incidentEpisodeKey:status.incidentEpisodeKey,
      incidentStartedAt:status.incidentStartedAt,
      responseState:target,
      previousResponseState:status.state,
      lifecycleState:status.lifecycleState,
      actorRole:'admin',
      transitionKey,
    },
  };
}
