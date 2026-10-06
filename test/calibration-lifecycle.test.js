import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calibrationFingerprintPayload,
  calibrationProfileFingerprint,
  evaluatePostPromotionRollback,
  evaluatePromotionWindows,
  splitRollingValidation,
} from '../src/calibration-lifecycle.js';

const passingWindow = (from, to) => ({
  sample: 20,
  from,
  to,
  baselineBrier: 0.205,
  candidateBrier: 0.202,
  baselineLogLoss: 0.91,
  candidateLogLoss: 0.90,
});

test('fingerprint depends on production parameters, not object key order', async () => {
  const a = await calibrationProfileFingerprint({ version: '4.0', temperature: 1.1, temperatureActive: true, weightsActive: true, signalWeights: { market: 0.5, form: 0.5 } });
  const b = await calibrationProfileFingerprint({ signalWeights: { form: 0.5, market: 0.5 }, weightsActive: true, temperatureActive: true, temperature: 1.1, version: '4.0' });
  assert.equal(a, b);
});

test('fingerprint booleans require actual booleans instead of truthy strings', () => {
  const payload = calibrationFingerprintPayload({
    version:'4.0',
    temperatureActive:'false',
    weightsActive:'true',
    signalWeights:[],
  });
  assert.equal(payload.temperatureActive,false);
  assert.equal(payload.weightsActive,false);
  assert.deepEqual(payload.signalWeights,{});
});

test('fingerprint payload rejects ambiguous numeric temperature and malformed profile shapes', () => {
  for (const temperature of [false, true, '', '   ', Infinity, NaN]) {
    const payload = calibrationFingerprintPayload({ version:'4.0', temperature });
    assert.equal(payload.temperature, 1, String(temperature));
  }
  assert.doesNotThrow(() => calibrationFingerprintPayload(null));
  assert.doesNotThrow(() => calibrationFingerprintPayload([]));
  assert.deepEqual(calibrationFingerprintPayload(null), {
    algorithm:'',
    temperature:1,
    temperatureActive:false,
    signalWeights:{},
    weightsActive:false,
  });
});

test('promotion requires two passing non-overlapping windows', () => {
  const result = evaluatePromotionWindows([
    passingWindow('2026-01-01', '2026-01-20'),
    passingWindow('2026-01-21', '2026-02-09'),
  ]);
  assert.equal(result.pass, true);
  assert.equal(result.status, 'eligible');
});

test('promotion rejects overlapping, reversed and malformed windows', () => {
  const overlapping=evaluatePromotionWindows([
    passingWindow('2026-01-01','2026-01-20'),
    passingWindow('2026-01-20','2026-02-09'),
  ]);
  assert.equal(overlapping.pass,false);
  assert.equal(overlapping.nonOverlapping,false);

  const reversed=evaluatePromotionWindows([
    passingWindow('2026-01-20','2026-01-01'),
    passingWindow('2026-01-21','2026-02-09'),
  ]);
  assert.equal(reversed.pass,false);
  assert.equal(reversed.windows[0].rangeValid,false);

  const malformed=evaluatePromotionWindows([
    {...passingWindow('2026-01-01','2026-01-20'),candidateBrier:-1},
    passingWindow('2026-01-21','2026-02-09'),
  ]);
  assert.equal(malformed.pass,false);
  assert.equal(malformed.windows[0].candidateBrier,null);

  const impossibleCalendar=evaluatePromotionWindows([
    passingWindow('2026-02-30','2026-03-20'),
    passingWindow('2026-03-21','2026-04-09'),
  ]);
  assert.equal(impossibleCalendar.pass,false);
  assert.equal(impossibleCalendar.windows[0].rangeValid,false);
});

test('promotion cannot be fabricated from boolean metrics, samples or rule overrides', () => {
  const malformedWindow = (from, to) => ({
    sample:true,
    from,
    to,
    baselineBrier:0.2,
    candidateBrier:false,
    baselineLogLoss:0.9,
    candidateLogLoss:false,
  });
  const result=evaluatePromotionWindows([
    malformedWindow('2026-01-01','2026-01-20'),
    malformedWindow('2026-01-21','2026-02-09'),
  ],{
    minWindowSample:true,
    minBrierGain:false,
  });

  assert.equal(result.pass,false);
  assert.equal(result.windows[0].sample,0);
  assert.equal(result.windows[0].candidateBrier,null);
  assert.equal(result.windows[0].candidateLogLoss,null);
});

test('promotion is held when the newest window regresses log loss', () => {
  const result = evaluatePromotionWindows([
    passingWindow('2026-01-01', '2026-01-20'),
    { ...passingWindow('2026-01-21', '2026-02-09'), candidateLogLoss: 0.93 },
  ]);
  assert.equal(result.pass, false);
  assert.equal(result.status, 'held');
});

test('post-promotion guard rolls back material regression', () => {
  const result = evaluatePostPromotionRollback({
    sample: 24,
    activeBrier: 0.214,
    championBrier: 0.210,
    activeLogLoss: 0.94,
    championLogLoss: 0.92,
  });
  assert.equal(result.rollback, true);
});

test('post-promotion guard sanitizes malformed samples and impossible negative metrics', () => {
  const result=evaluatePostPromotionRollback({
    sample:'NaN',
    activeBrier:-1,
    championBrier:0.2,
    activeLogLoss:'Infinity',
    championLogLoss:0.9,
  });
  assert.equal(result.sample,0);
  assert.equal(result.enoughData,false);
  assert.equal(result.metricsValid,false);
  assert.equal(result.decisionReady,false);
  assert.equal(result.activeBrier,null);
  assert.equal(result.activeLogLoss,null);
  assert.equal(result.rollback,false);
});

test('post-promotion guard never reports safe bounds when required metrics are incomplete', () => {
  const result=evaluatePostPromotionRollback({
    sample:24,
    activeBrier:false,
    championBrier:0.2,
    activeLogLoss:0.9,
    championLogLoss:0.9,
  });

  assert.equal(result.enoughData,true);
  assert.equal(result.metricsValid,false);
  assert.equal(result.decisionReady,false);
  assert.equal(result.activeBrier,null);
  assert.equal(result.rollback,false);
  assert.match(result.reason,/неполны/);
});

test('post-promotion guard waits for enough trusted rows', () => {
  const result = evaluatePostPromotionRollback({
    sample: 12,
    activeBrier: 0.25,
    championBrier: 0.20,
    activeLogLoss: 1.1,
    championLogLoss: 0.9,
  });
  assert.equal(result.rollback, false);
  assert.equal(result.enoughData, false);
});

test('rolling split excludes rows with invalid kickoff timestamps from trusted sample', () => {
  const rows=[
    ...Array.from({ length:80 },(_,index)=>({
      kickoff_at:new Date(Date.UTC(2026,0,index+1)).toISOString(),
      id:index,
    })),
    {kickoff_at:'not-a-date',id:'bad'},
    {kickoff_at:'2026-02-30T12:00:00.000Z',id:'impossible-calendar'},
    {kickoff_at:true,id:'boolean-date'},
  ];
  const split=splitRollingValidation(rows);
  assert.equal(split.ready,true);
  assert.equal(split.sample,80);
  assert.equal(split.train.some(row=>['bad','impossible-calendar','boolean-date'].includes(row.id)),false);
  assert.equal(split.windows.flat().some(row=>['bad','impossible-calendar','boolean-date'].includes(row.id)),false);
});

test('rolling split handles malformed input and malformed rule overrides safely', () => {
  assert.deepEqual(splitRollingValidation({not:'an array'}),{
    train:[],
    windows:[],
    ready:false,
    sample:0,
  });
  const rows=Array.from({ length:80 },(_,index)=>({
    kickoff_at:new Date(Date.UTC(2026,0,index+1)).toISOString(),
    id:index,
  }));
  const split=splitRollingValidation(rows,{
    minTrustedSample:-1,
    minTrainSample:'NaN',
    minWindowSample:0,
  });
  assert.equal(split.ready,true);
  assert.equal(split.sample,80);

  const booleanRules=splitRollingValidation(rows,{
    minTrustedSample:true,
    minTrainSample:true,
    minWindowSample:true,
  });
  assert.equal(booleanRules.ready,true);
  assert.equal(booleanRules.train.length,40);
  assert.equal(booleanRules.windows[0].length,20);

  const oversizedWindow=splitRollingValidation(
    Array.from({length:220},(_,index)=>({
      kickoff_at:new Date(Date.UTC(2026,0,index+1)).toISOString(),
      id:index,
    })),
    {
      minTrustedSample:80,
      minTrainSample:40,
      minWindowSample:60,
    },
  );
  assert.equal(oversizedWindow.ready,false);
  assert.equal(oversizedWindow.sample,220);
});

test('rolling split creates train plus two chronological windows', () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({ kickoff_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), id: index }));
  const split = splitRollingValidation(rows);
  assert.equal(split.ready, true);
  assert.equal(split.train.length, 40);
  assert.equal(split.windows[0].length, 20);
  assert.equal(split.windows[1].length, 20);
  assert.ok(Date.parse(split.windows[0][19].kickoff_at) < Date.parse(split.windows[1][0].kickoff_at));
});
