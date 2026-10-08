import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminReleaseMonitorModule } from '../public/modules/admin-release-monitor.js';

const html=fs.readFileSync('public/admin.html','utf8');
const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');

test('admin release monitor exposes a dedicated post-deploy regression response panel',()=>{
  assert.match(html,/id="releaseMonitorRegression"/);
  assert.match(releaseMonitor,/Post-deploy regression/);
  assert.match(releaseMonitor,/release_regression_alert/);
  assert.match(releaseMonitor,/Regression timeline/);
  assert.match(releaseMonitor,/Ручное действие/);
});

test('manual regression response controls do not introduce automatic remediation',()=>{
  const start=releaseMonitor.indexOf("const regressionData =");
  const end=releaseMonitor.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=releaseMonitor.slice(start,end);
  assert.doesNotMatch(block,/runtimeControlsSaving|saveRuntime|rollbackTo|switchProvider|disableFeature/);
  assert.match(block,/Auto-rollback/);
  assert.match(block,/RESOLVED разрешён только после RECOVERED/);
});

test('regression response derives lifecycle alert and audit state from release monitor payload',()=>{
  const start=releaseMonitor.indexOf("const regressionData =");
  const end=releaseMonitor.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=releaseMonitor.slice(start,end);
  assert.match(block,/r\.postDeployRegression/);
  assert.match(block,/Array\.isArray\(regressionData\.timeline\)/);
  assert.match(block,/x\?\.source === 'release_regression'/);
  assert.match(block,/x\?\.source === 'release_regression_alert'/);
  assert.match(block,/x\?\.source === 'release_regression_response'/);
  assert.match(block,/lifecycleState/);
});



function regressionMonitorHarness({isAdmin=true, pending=false, api} = {}){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{
      className:'',textContent:'',innerHTML:'',
      querySelectorAll:()=>[],
    });
    return elements.get(id);
  };
  const state={
    releaseRegressionResponsePending:pending,
    releaseMonitor:{available:false,postDeployRegression:{response:{deploySha:'a'.repeat(40)}}},
  };
  const calls=[];
  const notices=[];
  const monitor=createAdminReleaseMonitorModule({
    state,$:element,isAdmin:()=>isAdmin,
    escapeHtml:String,relativeAge:()=>'',humanizeTechnicalText:String,dateTime:String,
    toast:message=>notices.push(message),
    api:api|| (async (url,options)=>{
      calls.push({url,options});
      return url==='/api/post-deploy-regression-response'
        ? {state:'acknowledged'} : {available:false};
    }),
  });
  return {state,monitor,calls,notices,elements};
}

test('non-admin users cannot render, load or submit incident-response transitions',async()=>{
  let requests=0;
  const h=regressionMonitorHarness({isAdmin:false,api:async()=>{requests++;return {};}});
  h.monitor.renderReleaseMonitor();
  await h.monitor.loadReleaseMonitor(true);
  await h.monitor.transitionPostDeployRegressionResponse('acknowledged');
  assert.equal(requests,0);
  assert.equal(h.state.releaseRegressionResponsePending,false);
});

test('manual incident response submits the deployment SHA once with retries disabled',async()=>{
  const h=regressionMonitorHarness();
  await h.monitor.transitionPostDeployRegressionResponse('acknowledged');
  assert.equal(h.calls.length,2);
  const post=h.calls[0];
  assert.equal(post.url,'/api/post-deploy-regression-response');
  assert.equal(post.options.method,'POST');
  assert.equal(post.options.retry,false);
  assert.equal(post.options.dedupe,false);
  assert.equal(post.options.timeoutMs,10000);
  assert.deepEqual(JSON.parse(post.options.body),{
    state:'acknowledged',
    deploySha:'a'.repeat(40),
  });
  assert.match(h.calls[1].url,/^\/api\/release-monitor\?/);
  assert.match(h.calls[1].url,/refresh=1/);
  assert.equal(h.state.releaseRegressionResponsePending,false);
});

test('pending regression response blocks duplicate submissions and clears after API failure',async()=>{
  const pending=regressionMonitorHarness({pending:true});
  await pending.monitor.transitionPostDeployRegressionResponse('investigating');
  assert.equal(pending.calls.length,0);
  let attempts=0;
  const failed=regressionMonitorHarness({api:async()=>{attempts++;throw new Error('temporary failure');}});
  await failed.monitor.transitionPostDeployRegressionResponse('acknowledged');
  assert.equal(attempts,1);
  assert.equal(failed.state.releaseRegressionResponsePending,false);
  assert.match(failed.notices[0],/temporary failure/);
});

test('regression-response dashboard keeps audit content escaped and blocks autonomous rollback',()=>{
  const begin=releaseMonitor.indexOf('const regressionData =');
  const end=releaseMonitor.indexOf('const codes = c.topCodes || [];',begin);
  assert.ok(begin>=0 && end>begin);
  const code=releaseMonitor.slice(begin,end);
  assert.match(code,/escapeHtml\(regressionResponse\.reason \|\| '—'\)/);
  assert.match(code,/escapeHtml\(operatorAction\)/);
  assert.match(code,/escapeHtml\(nextResponseState\)/);
  assert.match(code,/escapeHtml\(humanizeTechnicalText\(x\.code \|\| x\.source \|\| ''\)\)/);
  assert.match(code,/releaseRegressionResponsePending \? 'disabled'/);
  assert.doesNotMatch(code,/runtimeControlsSaving|rollbackTo|switchProvider/);
});
