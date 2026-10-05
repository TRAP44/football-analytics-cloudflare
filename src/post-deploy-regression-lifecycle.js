const DEPLOY_SHA_RE=/^[0-9a-f]{40}$/i;
const LIFECYCLE_STATES=new Set(['watch','incident','recovered']);
const WINDOW_STATES=new Set(['healthy','watch','incident']);

function normalizeDeploySha(value=''){
  const sha=typeof value==='string'?value.trim().toLowerCase():'';
  return DEPLOY_SHA_RE.test(sha)?sha:'';
}

function integerCandidate(value){
  if(typeof value==='number') return Number.isSafeInteger(value)?value:null;
  if(typeof value!=='string') return null;
  const raw=value.trim();
  if(!/^\d+$/.test(raw)) return null;
  const number=Number(raw);
  return Number.isSafeInteger(number)?number:null;
}

function positiveInteger(value,{min=1,max=Number.MAX_SAFE_INTEGER}={}){
  const number=integerCandidate(value);
  return number!==null&&number>=min&&number<=max?number:null;
}

function eventTime(value){
  if(typeof value!=='string'||!value.trim()) return null;
  const timestamp=Date.parse(value.trim());
  return Number.isFinite(timestamp)?timestamp:null;
}

function lifecycleRows(items=[],deployShaValue=''){
  const sha=normalizeDeploySha(deployShaValue);
  if(!sha) return [];

  return (Array.isArray(items)?items:[])
    .filter(row=>String(row?.source||'')==='release_regression')
    .filter(row=>String(row?.event_type||row?.eventType||'')==='post_deploy_regression')
    .filter(row=>normalizeDeploySha(row?.metadata?.deploySha)===sha)
    .map(row=>{
      const createdAt=eventTime(row?.created_at??row?.createdAt);
      const state=String(row?.metadata?.lifecycleState||'').trim().toLowerCase();
      const id=positiveInteger(row?.id);
      const transitionEventId=typeof row?.metadata?.transitionEventId==='string'
        ? row.metadata.transitionEventId.trim()
        : '';
      const anchor=id
        ? String(id)
        : /^[A-Za-z0-9._:-]{1,120}$/.test(transitionEventId)
          ? transitionEventId
          : 'root';
      return {row,createdAt,state,anchor,id:id||0};
    })
    .filter(item=>item.createdAt!==null&&LIFECYCLE_STATES.has(item.state))
    .sort((a,b)=>a.createdAt-b.createdAt||a.id-b.id);
}

function latestCompletedWindow(report={}){
  return (Array.isArray(report?.windows)?report.windows:[])
    .map((window,index)=>({
      window,
      index,
      minutes:positiveInteger(window?.minutes,{min:1,max:180}),
      state:String(window?.state||'').trim().toLowerCase(),
    }))
    .filter(item=>item.window?.phase==='complete'&&item.minutes!==null&&WINDOW_STATES.has(item.state))
    .sort((a,b)=>a.minutes-b.minutes||a.index-b.index)
    .at(-1) || null;
}

function signalCodes(window){
  return [...new Set(
    (Array.isArray(window?.signals)?window.signals:[])
      .map(signal=>typeof signal?.code==='string'?signal.code.trim():'')
      .filter(Boolean),
  )].slice(0,50);
}

function completedWindowCount(report={}){
  const count=positiveInteger(report?.completedWindows,{min:1,max:100});
  return count??0;
}

export function planPostDeployRegressionLifecycle(report={},history=[]){
  const deploySha=normalizeDeploySha(report?.deploySha);
  const currentEntry=latestCompletedWindow(report);
  if(!deploySha||!currentEntry){
    return {action:'none',reason:'no_completed_window'};
  }

  const current=currentEntry.window;
  const rows=lifecycleRows(history,deploySha);
  const previous=rows.at(-1)||null;
  const previousState=previous?.state||'';
  const previousEventId=previous?.anchor||'root';
  const currentState=currentEntry.state;
  const currentWindow=currentEntry.minutes;

  if(previousState==='incident'&&currentState==='watch'){
    return {action:'none',reason:'incident_remains_active'};
  }

  if(['watch','incident'].includes(currentState)){
    if(previousState===currentState){
      return {action:'none',reason:'lifecycle_state_already_recorded'};
    }
    const transitionKey=`${deploySha}:${previousEventId}:${currentState}`;
    return {
      action:'record',
      severity:currentState==='incident'?'error':'warning',
      source:'release_regression',
      eventType:'post_deploy_regression',
      code:currentState==='incident'?'POST_DEPLOY_REGRESSION_INCIDENT':'POST_DEPLOY_REGRESSION_WATCH',
      message:currentState==='incident'
        ? 'Post-deploy regression incident detected.'
        : 'Post-deploy regression watch condition detected.',
      endpoint:'cron:production-monitor',
      transitionKey,
      meta:{
        deploySha,
        transitionKey,
        lifecycleState:currentState,
        previousLifecycleState:previousState||null,
        windowMinutes:currentWindow,
        signalCodes:signalCodes(current),
        completedWindows:completedWindowCount(report),
      },
    };
  }

  if(currentState==='healthy'&&['watch','incident'].includes(previousState)){
    const transitionKey=`${deploySha}:${previousEventId}:recovered`;
    return {
      action:'record',
      severity:'info',
      source:'release_regression',
      eventType:'post_deploy_regression',
      code:'POST_DEPLOY_REGRESSION_RECOVERED',
      message:'Post-deploy regression returned to healthy state.',
      endpoint:'cron:production-monitor',
      transitionKey,
      meta:{
        deploySha,
        transitionKey,
        lifecycleState:'recovered',
        previousLifecycleState:previousState,
        windowMinutes:currentWindow,
        signalCodes:[],
        completedWindows:completedWindowCount(report),
      },
    };
  }

  return {action:'none',reason:'healthy_without_active_regression'};
}
