import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProviderDataRuntime } from '../src/provider-data-runtime.js';

const providerData=fs.readFileSync('src/provider-data-runtime.js','utf8');
const appCapabilities=fs.readFileSync('src/app-capabilities.js','utf8');
const analysis=fs.readFileSync('src/analysis-runtime.js','utf8');
const analysisContext=fs.readFileSync('src/analysis-context-runtime.js','utf8');
const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+providerData+'\n'+fs.readFileSync('src/analysis-runtime.js','utf8')+'\n'+fs.readFileSync('src/match-center-runtime.js','utf8');

test('RC104 classifies provider empty, skipped and failed states separately',()=>{
  assert.match(worker,/function providerFailureState\(/);
  assert.match(worker,/function providerDataState\(/);
  for(const state of ['empty_response','skipped','rate_limited','plan_limited','timeout','network_error','provider_error']){
    assert.ok(worker.includes("'" + state + "'"), 'missing provider state ' + state);
  }
  assert.match(worker,/function providerDataReliabilitySelfTest\(/);
});

test('RC104 pre-match AI does not swallow optional API-Football errors into empty arrays',()=>{
  const start=worker.indexOf("const injurySkipReason");
  const end=worker.indexOf("const webPromise",start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/safeAnalysisProviderFetch\(\{\s*feature:'injuries'/);
  assert.match(block,/safeAnalysisProviderFetch\(\{\s*feature:'predictions'/);
  assert.match(block,/safeAnalysisProviderFetch\(\{\s*feature:'odds'/);
  assert.match(block,/safeAnalysisProviderFetch\(\{\s*feature:'h2h'/);
  assert.match(block,/feature:'lineups'/);
  assert.doesNotMatch(block,/catch\(\(\) => \[\]\)/);
});

test('RC104 never describes unknown injury data as zero confirmed absences',()=>{
  assert.match(analysis,/assessFixtureAvailabilityQuality\(injuries/);
  assert.match(analysis,/annotateAvailabilityReliability\(/);
  assert.match(analysis,/sanitizeAvailabilityRows\(injuries,availabilityQuality\)/);
  assert.match(analysis,/let trustedInjuries=\[\]/);
});

test('RC104 reliability caps AI data trust instead of inventing confidence',()=>{
  assert.match(analysisContext,/const reliabilityCap=reliability/);
  assert.match(analysisContext,/const dataTrustScore=Math\.min\(baseDataTrustScore,reliabilityCap\)/);
  assert.match(analysisContext,/Надёжность входных данных ниже рабочего порога/);
  assert.match(worker,/Неизвестность не преобразуется в нулевые значения/);
});

test('RC104 exposes reliability metadata and current manifest contract',()=>{
  assert.match(worker,/providerReliability,/);
  assert.match(analysis,/featureReliability:analysisFeatureMeta/);
  assert.match(appCapabilities,/providerDataReliability:true/);
  assert.match(providerData,/function providerDataReliabilitySelfTest\(/);
});

test('RC104 match-center feature cache also exposes explicit data states',()=>{
  const start=providerData.indexOf('async function providerFeatureFetch');
  const end=providerData.indexOf('\n  function providerValidationStep',start);
  assert.ok(start>=0 && end>start);
  const block=providerData.slice(start,end);
  assert.match(block,/providerDataState\(/);
  assert.match(block,/state:'stale'/);
  assert.match(block,/source:'error'/);
});



test('RC104 coerced feature flags never promote unsupported confidence or coverage',()=>{
  const service=createProviderDataRuntime({isFootballRateLimitError:()=>false});
  const r=service.providerDataReliabilitySummary({
    odds:{state:'available',available:true,confidenceBearing:'false'},
    predictions:{state:'available',available:'true',confidenceBearing:true},
    lineups:{state:'available',available:true,confidenceBearing:true,stale:'false'},
  },{minutesToKickoff:30});
  assert.equal(r.available,0);
  assert.equal(r.state,'partial');
  assert.equal(r.trustCap,60);
});

test('RC104 stale, degraded and unattributed data never increases provider trust',()=>{
  const service=createProviderDataRuntime({isFootballRateLimitError:()=>false});
  const r=service.providerDataReliabilitySummary({
    odds:{state:'available',available:true,confidenceBearing:true,stale:true,observed:true},
    predictions:{state:'available',available:true,confidenceBearing:true,degraded:true,observed:true},
    lineups:{state:'available',available:true,confidenceBearing:true,provenanceState:'unknown',observed:true},
  },{minutesToKickoff:20});
  assert.equal(r.state,'degraded');
  assert.equal(r.available,0);
  assert.equal(r.trustCap,60);
  assert.ok(r.warnings.some(x=>x.includes('устарели')));
});

test('RC104 missing age metadata is not interpreted as instant freshness',()=>{
  const service=createProviderDataRuntime({isFootballRateLimitError:()=>false});
  const r=service.providerDataReliabilitySummary({
    odds:{state:'available',available:true,count:null,ageSeconds:null,freshnessLimitSeconds:'600'},
    predictions:{state:'available',available:true,count:0,ageSeconds:0,freshnessLimitSeconds:600},
  },{minutesToKickoff:null});
  assert.equal(r.features.odds.ageSeconds,null);
  assert.equal(r.features.odds.freshnessLimitSeconds,null);
  assert.equal(r.features.odds.count,0);
  assert.equal(r.features.predictions.ageSeconds,0);
});

test('RC104 rejects malformed feature containers and unreliable provider states',()=>{
  const service=createProviderDataRuntime({isFootballRateLimitError:()=>false});
  for(const bad of [[],true,'available',null]){
    const r=service.providerDataReliabilitySummary(bad,{});
    assert.equal(r.checked,0);
    assert.equal(r.available,0);
  }
  const r=service.providerDataReliabilitySummary({
    odds:{state:'plan_limited',available:'true',confidenceBearing:true,degraded:'false'},
    predictions:'available',
  });
  assert.equal(r.state,'degraded');
  assert.equal(r.trustCap,60);
  assert.equal(r.available,0);
});

test('RC104 provider reliability drill continues classifying empty, skipped and plan-limited',()=>{
  assert.equal(createProviderDataRuntime({isFootballRateLimitError:()=>false}).providerDataReliabilitySelfTest().pass,true);
});
