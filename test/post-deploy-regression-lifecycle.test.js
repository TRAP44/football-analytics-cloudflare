import test from 'node:test';
import assert from 'node:assert/strict';
import { planPostDeployRegressionLifecycle } from '../src/post-deploy-regression-lifecycle.js';

const sha='a'.repeat(40);
const report=(state,minutes=15)=>({
  deploySha:sha,
  completedWindows:minutes===60?3:minutes===30?2:1,
  windows:[
    {minutes:15,phase:'complete',state:minutes===15?state:'healthy',signals:minutes===15&&state!=='healthy'?[{code:'error_volume_regression'}]:[]},
    ...(minutes>=30?[{minutes:30,phase:'complete',state:minutes===30?state:'healthy',signals:minutes===30&&state!=='healthy'?[{code:'auth_failures_increased'}]:[]}]:[]),
    ...(minutes>=60?[{minutes:60,phase:'complete',state,signals:state!=='healthy'?[{code:'latency_p95_regression'}]:[]}]:[]),
  ],
});

const event=(state,minutes,code='POST_DEPLOY_REGRESSION_WATCH')=>({
  created_at:'2026-09-29T13:20:00Z',
  source:'release_regression',
  event_type:'post_deploy_regression',
  code,
  metadata:{deploySha:sha,lifecycleState:state,windowMinutes:minutes},
});

test('opens one watch event for the latest completed regression window',()=>{
  const plan=planPostDeployRegressionLifecycle(report('watch',15),[]);
  assert.equal(plan.action,'record');
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_WATCH');
  assert.equal(plan.meta.windowMinutes,15);
});

test('opens incident separately from watch and preserves signal codes',()=>{
  const plan=planPostDeployRegressionLifecycle(report('incident',30),[event('watch',15)]);
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_INCIDENT');
  assert.equal(plan.severity,'error');
  assert.deepEqual(plan.meta.signalCodes,['auth_failures_increased']);
});

test('deduplicates repeated monitor runs for the same completed window state',()=>{
  const plan=planPostDeployRegressionLifecycle(report('watch',15),[event('watch',15)]);
  assert.deepEqual(plan,{action:'none',reason:'window_state_already_recorded'});
});

test('records recovery when a later completed window is healthy',()=>{
  const plan=planPostDeployRegressionLifecycle(report('healthy',30),[event('incident',15,'POST_DEPLOY_REGRESSION_INCIDENT')]);
  assert.equal(plan.code,'POST_DEPLOY_REGRESSION_RECOVERED');
  assert.equal(plan.meta.previousLifecycleState,'incident');
  assert.equal(plan.meta.windowMinutes,30);
});

test('does not create lifecycle events while windows are still collecting',()=>{
  const plan=planPostDeployRegressionLifecycle({deploySha:sha,completedWindows:0,windows:[{minutes:15,phase:'collecting',state:'collecting'}]},[]);
  assert.deepEqual(plan,{action:'none',reason:'no_completed_window'});
});

test('history from another deployment never suppresses the current deployment',()=>{
  const other={...event('watch',15),metadata:{deploySha:'b'.repeat(40),lifecycleState:'watch',windowMinutes:15}};
  const plan=planPostDeployRegressionLifecycle(report('watch',15),[other]);
  assert.equal(plan.action,'record');
});
