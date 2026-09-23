import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');

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
  assert.match(block,/analysisProviderFetch\(\{ feature:'injuries'/);
  assert.match(block,/analysisProviderFetch\(\{ feature:'predictions'/);
  assert.match(block,/analysisProviderFetch\(\{ feature:'odds'/);
  assert.match(block,/analysisProviderFetch\(\{ feature:'h2h'/);
  assert.match(block,/feature:'lineups'/);
  assert.doesNotMatch(block,/catch\(\(\) => \[\]\)/);
});

test('RC104 never describes unknown injury data as zero confirmed absences',()=>{
  assert.match(worker,/Данные о потерях требуют проверки/);
  assert.match(worker,/это не считается подтверждением полного состава/);
  assert.match(worker,/нулевые потери не предполагаются/);
  assert.match(worker,/injuryUsable&&diff>=2/);
});

test('RC104 reliability caps AI data trust instead of inventing confidence',()=>{
  assert.match(worker,/const reliabilityCap = Math\.max/);
  assert.match(worker,/const dataTrustScore = Math\.min\(baseDataTrustScore, reliabilityCap\)/);
  assert.match(worker,/Надёжность входных данных ниже рабочего порога/);
  assert.match(worker,/Неизвестность не преобразуется в нулевые значения/);
});

test('RC104 exposes reliability metadata and release health contracts',()=>{
  assert.match(worker,/providerReliability,/);
  assert.match(worker,/featureReliability: analysisFeatureMeta/);
  assert.match(worker,/providerDataReliability: 'enabled'/);
  assert.match(worker,/providerDataReliabilitySelfTest: providerDataReliabilitySelfTest\(\)\.pass \? 'enabled' : 'failed'/);
  assert.match(worker,/releaseCheck\('provider_data_reliability_selftest'/);
});

test('RC104 match-center feature cache also exposes explicit data states',()=>{
  const start=worker.indexOf('async function providerFeatureFetch');
  const end=worker.indexOf('\nfunction providerValidationStep',start);
  assert.ok(start>=0 && end>start);
  const block=worker.slice(start,end);
  assert.match(block,/providerDataState\(/);
  assert.match(block,/state: 'stale'/);
  assert.match(block,/source: 'error'/);
});
