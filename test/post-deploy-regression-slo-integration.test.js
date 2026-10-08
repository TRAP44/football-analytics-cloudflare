import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminReleaseMonitorModule } from '../public/modules/admin-release-monitor.js';

const releaseApi=fs.readFileSync('src/release-monitor-api-runtime.js','utf8');
const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');

test('release monitor exposes regression SLO dashboard derived from ops history',()=>{
  assert.match(releaseApi,/const activeDeploySha=String\(currentReleaseIdentity\(cfg\)\?\.deploySha \|\| ''\)\.toLowerCase\(\)/);
  assert.match(releaseApi,/const postDeployRegressionSlo=buildPostDeployRegressionSloDashboard\(source\.items,/);
  assert.match(releaseApi,/postDeployRegression:\{/);
  assert.match(releaseApi,/slo:postDeployRegressionSlo/);
});

test('admin regression panel shows existing ACK and recovery SLO thresholds',()=>{
  const start=releaseMonitor.indexOf('const regressionData =');
  const end=releaseMonitor.indexOf('const codes = c.topCodes || [];',start);
  assert.ok(start>=0 && end>start);
  const block=releaseMonitor.slice(start,end);
  assert.match(block,/ACK latency/);
  assert.match(block,/Investigation latency/);
  assert.match(block,/Recovery latency/);
  assert.match(block,/Resolution latency/);
  assert.match(block,/ackCriticalMinutes/);
  assert.match(block,/recoveryMinutes/);
  assert.match(block,/метрика без отдельного SLA/);
});

test('SLO visualization does not add automatic remediation actions',()=>{
  const start=releaseMonitor.indexOf('const regressionData =');
  const end=releaseMonitor.indexOf('const codes = c.topCodes || [];',start);
  const block=releaseMonitor.slice(start,end);
  assert.doesNotMatch(block,/rollbackTo|switchProvider|disableFeature|runtimeControlsSaving/);
  assert.doesNotMatch(block,/investigationTargetMinutes\s*:\s*[1-9]/);
  assert.doesNotMatch(block,/resolutionTargetMinutes\s*:\s*[1-9]/);
});



function regressionSloHtml(current={}){
  const elements=new Map();
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',className:'',querySelectorAll:()=>[]});
    return elements.get(id);
  };
  const module=createAdminReleaseMonitorModule({
    state:{releaseMonitor:{available:true,postDeployRegression:{
      slo:{current,thresholds:{},summary:{}},timeline:[],
    }}},
    $:element,isAdmin:()=>true,
    escapeHtml:String,relativeAge:()=>'',humanizeTechnicalText:String,dateTime:String,
    toast:()=>{},api:async()=>({}),
  });
  module.renderReleaseMonitor();
  return element('releaseMonitorRegression').innerHTML;
}

test('unmeasured ACK and recovery latency display as unavailable rather than instant success',()=>{
  const html=regressionSloHtml({
    ackLatencyMinutes:null,recoveryLatencyMinutes:null,
    investigationLatencyMinutes:null,resolutionLatencyMinutes:null,
  });
  for(const name of ['ACK','Recovery','Investigation','Resolution']){
    assert.match(html,new RegExp(name+' latency</span><strong>—</strong>'));
  }
  assert.doesNotMatch(html,/ACK latency<\/span><strong>0 мин/);
  assert.doesNotMatch(html,/Recovery latency<\/span><strong>0 мин/);
});

test('zero and fractional minute observations remain visible as legitimate timings',()=>{
  const html=regressionSloHtml({
    ackLatencyMinutes:0,recoveryLatencyMinutes:5.5,
    investigationLatencyMinutes:1,resolutionLatencyMinutes:0,
  });
  assert.match(html,/ACK latency<\/span><strong>0 мин<\/strong>/);
  assert.match(html,/Recovery latency<\/span><strong>5\.5 мин<\/strong>/);
  assert.match(html,/Investigation latency<\/span><strong>1 мин<\/strong>/);
  assert.match(html,/Resolution latency<\/span><strong>0 мин<\/strong>/);
});

test('SLO display rejects boolean, array, object, negative and infinite values',()=>{
  for(const value of [false,true,[],{},'',null,-1,'Infinity',Number.POSITIVE_INFINITY]){
    assert.match(regressionSloHtml({ackLatencyMinutes:value}),/ACK latency<\/span><strong>—<\/strong>/);
  }
});

test('SLO dashboard is deployment scoped while audit event history is redacted and bounded',()=>{
  assert.match(releaseApi,/buildPostDeployRegressionSloDashboard\(source\.items,\{\s*activeDeploySha,\s*asOfMs:end\.getTime\(\),\s*limit:20/);
  assert.match(releaseApi,/summarizePostDeployRegressionResponse\(source\.items,activeDeploySha\)/);
  assert.match(releaseApi,/String\(x\?\.metadata\?\.deploySha \|\| ''\)\.toLowerCase\(\)===activeDeploySha/);
  assert.match(releaseApi,/\.slice\(0,30\)\s*\.map\(/);
  assert.match(releaseApi,/message:redactOpsString\(x\.message \|\| '',180\)/);
});
