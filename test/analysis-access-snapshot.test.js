import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisAccessSnapshot} from '../src/analysis-access-snapshot.js';
import {buildAnalysisAccessUsage} from '../public/modules/analysis-access.js';

test('server snapshot preserves last Pass credit and excludes raw row and operation data',()=>{
  const snapshot=analysisAccessSnapshot({source:'pass',plan:'FREE',effectiveTier:'PREMIUM',userId:456,passes:{active:[{id:13,type:'WEEKEND_PASS',fixtureId:0,usageLimit:6,usageCount:5,payment_charge_id:'secret'}]}},{entitlementId:13,usageCount:6,operationId:'private'},{passAccess:true});
  const result=buildAnalysisAccessUsage({analysis:{quota:{plan:'FREE',used:3,limit:3,left:0}},entitlementBefore:snapshot.before,entitlementAfter:snapshot.after,fixtureId:777});
  assert.equal(result.passType,'WEEKEND_PASS');assert.equal(result.detail,'Осталось анализов: 0.');
  assert.doesNotMatch(JSON.stringify(snapshot),/userId|payment|secret|private|operationId/);
});

test('failed Pass reservation cannot be described as a Pass charge',()=>{
  const snapshot=analysisAccessSnapshot({source:'pass',passes:{active:[{id:1,type:'MATCH_PASS',fixtureId:777}]}},null,{passAccess:false});
  assert.equal(snapshot.before.entitlement.source,'free');assert.deepEqual(snapshot.before.entitlement.passes.active,[]);
});

test('cached and free recheck usage stays explicitly free',()=>{
  const snapshot=analysisAccessSnapshot({source:'pass',passes:{active:[]}},null,{freeRecheck:true});
  for(const analysis of [{cached:true},{recheck:{free:true}}]){
    const result=buildAnalysisAccessUsage({analysis,entitlementBefore:snapshot.before,entitlementAfter:snapshot.after});
    assert.equal(result.kind,analysis.cached?'cached':'free_recheck');
  }
});
