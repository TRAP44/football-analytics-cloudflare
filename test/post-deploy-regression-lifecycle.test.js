import test from 'node:test';
import assert from 'node:assert/strict';
import { planPostDeployRegressionLifecycle } from '../src/post-deploy-regression-lifecycle.js';

const sha='a'.repeat(40);
const otherSha='b'.repeat(40);

const report=(state,minutes=15,deploySha=sha)=>({
  deploySha,
  completedWindows:minutes===60?3:minutes===30?2:1,
  windows:[
    {minutes:15,phase:'complete',state:minutes===15?state:'healthy',signals:minutes===15&&state!=='healthy'?[{code:'error_volume_regression'}]:[]},
    ...(minutes>=30?[{minutes:30,phase:'complete',state:minutes===30?state:'healthy',signals:minutes===30&&state!=='healthy'?[{code:'auth_failures_increased'}]:[]}]:[]),
    ...(minutes>=60?[{minutes:60,phase:'complete',state,signals:state!=='healthy'?[{code:'latency_p95_regression'}]:[]}]:[]),
  ],
});

const event=(state,minutes,options={})=>({
  id:options.id ?? 101,
  created_at:options.createdAt || '2026-09-29T13:20:00Z',
  source:'release_regression',
  event_type:'post_deploy_regression',
  code:options.code || (state==='incident'?'POST_DEPLOY_REGRESSION_INCIDENT':state==='recovered'?'POST_DEPLOY_REGRESSION_RECOVERED':'POST_DEPLOY_REGRESSION_WATCH'),
  metadata:{
    deploySha:options.deploySha || sha,
    lifecycleState:state,
    windowMinutes:minutes,
    transitionKey:options.transitionKey || null,
  },
});

test('lifecycle rejects malformed deploy identities and malformed completed windows',()=>{
  assert.deepEqual(
    planPostDeployRegressionLifecycle({...report('watch',15),deploySha:'not-a-sha'},[]),
    {action:'none',reason:'no_completed_window'},
  );

  assert.deepEqual(
    planPostDeployRegressionLifecycle({
      deploySha:sha,
      completedWindows:true,
      windows:[
        {minutes:true,phase:'complete',state:'incident',signals:[{code:'bad'}]},
        {minutes:15,phase:'complete',state:'unknown',signals:[{code:'bad'}]},
      ],
    },[]),
    {action:'none',reason:'no_completed_window'},
  );
});

test('lifecycle ignores malformed or foreign history rows before choosing previous state',()=>{
  const history=[
    event('watch',15,{id:201,createdAt:'2026-09-29T13:20:00Z'}),
    event('incident',30,{id:202,createdAt:'not-a-date'}),
    event('incident',30,{id:203,createdAt:'2026-09-29T13:40:00Z',deploySha:otherSha}),
    {
      id:204,
      created_at:'2026-09-29T13:50:00Z',
      source:'release_regression',
      event_type:'post_deploy_regression',
      metadata:{deploySha:sha,lifecycleState:'broken'},
    },
  ];
  const plan=planPostDeployRegressionLifecycle(report('incident',30),history);
  assert.equal(plan.action,'record');
  assert.equal(plan.meta.previousLifecycleState,'watch');
  assert.equal(plan.transitionKey,`${sha}:201:incident`);
});

test('INCIDENT never downgrades back to WATCH before an explicit recovery',()=>{
  const history=[event('incident',15,{id:211})];
  const plan=planPostDeployRegressionLifecycle(report('watch',30),history);
  assert.deepEqual(plan,{action:'none',reason:'incident_remains_active'});
});

test('signal codes are canonicalized and bounded without coercing non-strings',()=>{
  const custom=report('incident',30);
  custom.completedWindows='2';
  custom.windows[1].signals=[
    {code:' auth_failures_increased '},
    {code:'auth_failures_increased'},
    {code:true},
    {},
  ];
  const plan=planPostDeployRegressionLifecycle(custom,[]);
  assert.equal(plan.action,'record');
  assert.deepEqual(plan.meta.signalCodes,['auth_failures_increased']);
  assert.equal(plan.meta.completedWindows,2);
});

test('A healthy regression report creates no lifecycle transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('healthy',15),[]);
  assert.deepEqual(plan,{action:'none',reason:'healthy_without_active_regression'});
});

test('B first regression signal opens exactly one WATCH transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('watch',15),[]);
  assert.equal(plan.action,'record');
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_WATCH');
  assert.equal(plan.meta.windowMinutes,15);
  assert.equal(plan.transitionKey,`${sha}:root:watch`);
  assert.equal(plan.meta.transitionKey,plan.transitionKey);
});

test('C repeated WATCH is deduplicated across later windows',()=>{
  const history=[event('watch',15,{id:111})];
  const sameWindow=planPostDeployRegressionLifecycle(report('watch',15),history);
  const laterWindow=planPostDeployRegressionLifecycle(report('watch',30),history);
  assert.deepEqual(sameWindow,{action:'none',reason:'lifecycle_state_already_recorded'});
  assert.deepEqual(laterWindow,{action:'none',reason:'lifecycle_state_already_recorded'});
});

test('D confirmed regression escalates WATCH to one INCIDENT transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('incident',30),[event('watch',15,{id:121})]);
  assert.equal(plan.action,'record');
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_INCIDENT');
  assert.equal(plan.severity,'error');
  assert.deepEqual(plan.meta.signalCodes,['auth_failures_increased']);
  assert.equal(plan.transitionKey,`${sha}:121:incident`);
});

test('E repeated INCIDENT is deduplicated across later windows',()=>{
  const history=[event('watch',15,{id:131}),event('incident',30,{id:132,createdAt:'2026-09-29T13:35:00Z'})];
  const plan=planPostDeployRegressionLifecycle(report('incident',60),history);
  assert.deepEqual(plan,{action:'none',reason:'lifecycle_state_already_recorded'});
});

test('F recovery from WATCH records one RECOVERED transition',()=>{
  const plan=planPostDeployRegressionLifecycle(report('healthy',30),[event('watch',15,{id:141})]);
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_RECOVERED');
  assert.equal(plan.meta.previousLifecycleState,'watch');
  assert.equal(plan.transitionKey,`${sha}:141:recovered`);
});

test('G recovery from INCIDENT records once and later healthy runs stay silent',()=>{
  const incident=event('incident',30,{id:151});
  const recovery=planPostDeployRegressionLifecycle(report('healthy',60),[incident]);
  assert.equal(recovery.code,'POST_DEPLOY_REGRESSION_RECOVERED');
  const recoveredRow=event('recovered',60,{id:152,createdAt:'2026-09-29T14:05:00Z'});
  const repeated=planPostDeployRegressionLifecycle(report('healthy',60),[incident,recoveredRow]);
  assert.deepEqual(repeated,{action:'none',reason:'healthy_without_active_regression'});
});

test('H new deployment starts a new lifecycle generation',()=>{
  const old=event('watch',15,{id:161,deploySha:otherSha});
  const plan=planPostDeployRegressionLifecycle(report('watch',15,sha),[old]);
  assert.equal(plan.action,'record');
  assert.equal(plan.transitionKey,`${sha}:root:watch`);
});

test('I collecting/insufficient window creates no false lifecycle event',()=>{
  const plan=planPostDeployRegressionLifecycle({
    deploySha:sha,
    completedWindows:0,
    windows:[{minutes:15,phase:'collecting',state:'collecting'}],
  },[]);
  assert.deepEqual(plan,{action:'none',reason:'no_completed_window'});
});

test('J recovery transition identity is stable for retry after persistence uncertainty',()=>{
  const history=[event('incident',30,{id:171})];
  const first=planPostDeployRegressionLifecycle(report('healthy',60),history);
  const retry=planPostDeployRegressionLifecycle(report('healthy',60),history);
  assert.equal(first.transitionKey,retry.transitionKey);
  assert.equal(first.transitionKey,`${sha}:171:recovered`);
});

test('transition identity falls back safely when persisted event id is malformed',()=>{
  const history=[event('watch',15,{id:'not-an-id'})];
  history[0].metadata.transitionEventId='stable-event-42';
  const plan=planPostDeployRegressionLifecycle(report('incident',30),history);
  assert.equal(plan.transitionKey,`${sha}:stable-event-42:incident`);

  history[0].metadata.transitionEventId='unsafe/event';
  const fallback=planPostDeployRegressionLifecycle(report('incident',30),history);
  assert.equal(fallback.transitionKey,`${sha}:root:incident`);
});

test('K concurrent planners produce the same atomic transition identity',()=>{
  const history=[event('watch',15,{id:181})];
  const first=planPostDeployRegressionLifecycle(report('incident',30),history);
  const second=planPostDeployRegressionLifecycle(report('incident',30),history);
  assert.equal(first.action,'record');
  assert.equal(second.action,'record');
  assert.equal(first.transitionKey,second.transitionKey);
  assert.equal(first.transitionKey,`${sha}:181:incident`);
});



test('the newest completed time window wins regardless of out-of-order report entries',()=>{
  const mixed={
    deploySha:sha,
    completedWindows:3,
    windows:[
      {minutes:60,phase:'complete',state:'healthy',signals:[]},
      {minutes:15,phase:'complete',state:'incident',signals:[{code:'stale_signal'}]},
      {minutes:30,phase:'collecting',state:'incident',signals:[{code:'incomplete_signal'}]},
    ],
  };
  assert.deepEqual(
    planPostDeployRegressionLifecycle(mixed,[]),
    {action:'none',reason:'healthy_without_active_regression'},
  );
});

test('only same-deployment, correctly typed lifecycle history affects escalation',()=>{
  const history=[
    event('watch',15,{deploySha:otherSha,id:201,createdAt:'2026-09-29T15:00:00Z'}),
    {...event('incident',30,{id:202,createdAt:'2026-09-29T15:05:00Z'}),source:'unrelated'},
    {...event('incident',30,{id:203,createdAt:'2026-09-29T15:06:00Z'}),event_type:'wrong_type'},
    event('watch',15,{id:204,createdAt:'2026-09-29T15:07:00Z'}),
  ];
  const result=planPostDeployRegressionLifecycle(report('incident',30),history);
  assert.equal(result.action,'record');
  assert.equal(result.meta.previousLifecycleState,'watch');
  assert.equal(result.transitionKey,sha+':204:incident');
});

test('lifecycle suppresses invalid, duplicated and excessive signal codes without implicit coercion',()=>{
  const many=report('incident',30);
  many.windows[1].signals=[
    ...Array.from({length:55},(_,i)=>({code:'signal_'+i})),
    {code:' signal_0 '},{code:false},{code:null},{code:4},
  ];
  const result=planPostDeployRegressionLifecycle(many,[]);
  assert.equal(result.action,'record');
  assert.equal(result.meta.signalCodes.length,50);
  assert.equal(new Set(result.meta.signalCodes).size,50);
  assert.equal(result.meta.signalCodes[0],'signal_0');
  assert.ok(result.meta.signalCodes.every(code=>typeof code==='string'));
});

test('incident recovers only after the latest completed healthy window and does not reopen on repetition',()=>{
  const incident=event('incident',30,{id:301});
  const recovered=planPostDeployRegressionLifecycle(report('healthy',60),[incident]);
  assert.equal(recovered.code,'POST_DEPLOY_REGRESSION_RECOVERED');
  assert.equal(recovered.meta.previousLifecycleState,'incident');
  assert.equal(recovered.severity,'info');
  const recoveredRow=event('recovered',60,{id:302,createdAt:'2026-09-29T16:00:00Z'});
  const repeated=planPostDeployRegressionLifecycle(report('healthy',60),[incident,recoveredRow]);
  assert.deepEqual(repeated,{action:'none',reason:'healthy_without_active_regression'});
});
