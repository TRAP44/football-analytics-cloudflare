function lifecycleRows(items=[],deploySha=''){
  const sha=String(deploySha||'').toLowerCase();
  return (Array.isArray(items)?items:[])
    .filter(row=>String(row?.source||'')==='release_regression')
    .filter(row=>String(row?.event_type||'')==='post_deploy_regression')
    .filter(row=>String(row?.metadata?.deploySha||'').toLowerCase()===sha)
    .sort((a,b)=>Date.parse(a?.created_at||'')-Date.parse(b?.created_at||''));
}

function latestCompletedWindow(report={}){
  return (Array.isArray(report?.windows)?report.windows:[])
    .filter(window=>window?.phase==='complete')
    .sort((a,b)=>Number(a?.minutes||0)-Number(b?.minutes||0))
    .at(-1) || null;
}

function signalCodes(window){
  return (Array.isArray(window?.signals)?window.signals:[])
    .map(signal=>String(signal?.code||''))
    .filter(Boolean);
}

export function planPostDeployRegressionLifecycle(report={},history=[]){
  const deploySha=String(report?.deploySha||'').toLowerCase();
  const current=latestCompletedWindow(report);
  if(!deploySha || !current){
    return {action:'none',reason:'no_completed_window'};
  }

  const rows=lifecycleRows(history,deploySha);
  const previous=rows.at(-1) || null;
  const previousState=String(previous?.metadata?.lifecycleState||'');
  const previousEventId=String(previous?.id ?? previous?.metadata?.transitionEventId ?? 'root');
  const currentState=String(current?.state||'healthy');
  const currentWindow=Number(current?.minutes||0);

  if(['watch','incident'].includes(currentState)){
    if(previousState===currentState){
      return {action:'none',reason:'lifecycle_state_already_recorded'};
    }
    const transitionKey=`${deploySha}:${previousEventId}:${currentState}`;
    return {
      action:'record',
      severity:currentState==='incident' ? 'error' : 'warning',
      source:'release_regression',
      eventType:'post_deploy_regression',
      code:currentState==='incident' ? 'POST_DEPLOY_REGRESSION_INCIDENT' : 'POST_DEPLOY_REGRESSION_WATCH',
      message:currentState==='incident'
        ? 'Post-deploy regression incident detected.'
        : 'Post-deploy regression watch condition detected.',
      endpoint:'cron:production-monitor',
      transitionKey,
      meta:{
        deploySha,
        transitionKey,
        lifecycleState:currentState,
        previousLifecycleState:previousState || null,
        windowMinutes:currentWindow,
        signalCodes:signalCodes(current),
        completedWindows:Number(report?.completedWindows||0),
      },
    };
  }

  if(currentState==='healthy' && ['watch','incident'].includes(previousState)){
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
        completedWindows:Number(report?.completedWindows||0),
      },
    };
  }

  return {action:'none',reason:'healthy_without_active_regression'};
}
