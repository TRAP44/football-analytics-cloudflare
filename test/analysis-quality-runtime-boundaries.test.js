import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createAnalysisQualityRuntime } from '../src/analysis-quality-runtime.js';

function deps(overrides = {}) {
  return {
    absenceAdjustmentUnits:rows=>(Array.isArray(rows) ? rows : []).reduce(
      (sum,row)=>sum+(Number(row?.seasonRole?.weight) || 1),
      0,
    ),
    assessMatchLineups:lineups=>({
      home:{confirmed:lineups?.home?.confirmed === true},
      away:{confirmed:lineups?.away?.confirmed === true},
      bothConfirmed:lineups?.home?.confirmed === true && lineups?.away?.confirmed === true,
      partialSides:Number(lineups?.home?.partial === true)+Number(lineups?.away?.partial === true),
    }),
    probabilityLeaderMargin:probabilities=>{
      const values=[probabilities.home,probabilities.draw,probabilities.away]
        .sort((a,b)=>b-a);
      return Math.round((values[0]-values[1])*10)/10;
    },
    ...overrides,
  };
}

test('analysis quality runtime validates dependencies and freezes its public surface', () => {
  const broken=deps();
  delete broken.probabilityLeaderMargin;
  assert.throws(
    () => createAnalysisQualityRuntime(broken),
    /probabilityLeaderMargin is required/,
  );

  const runtime=createAnalysisQualityRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('lineup impact fails soft on malformed quality and does not trust stale lineup provenance', () => {
  const runtime=createAnalysisQualityRuntime(deps({
    assessMatchLineups:()=>({
      home:{confirmed:true},
      away:{confirmed:true},
      bothConfirmed:true,
      partialSides:0,
    }),
  }));

  const impact=runtime.buildLineupImpact({
    absences:{home:[],away:[],summary:{}},
    lineups:{},
    reliability:{
      features:{
        lineups:{
          state:'available',
          confirmed:true,
          confidenceBearing:false,
          stale:true,
        },
        injuries:{
          state:'empty_response',
          confidenceBearing:false,
          stale:false,
        },
      },
    },
  });

  assert.equal(impact.structuralHomeConfirmed,true);
  assert.equal(impact.structuralAwayConfirmed,true);
  assert.equal(impact.homeConfirmed,false);
  assert.equal(impact.awayConfirmed,false);
  assert.equal(impact.lineupsTrusted,false);
  assert.equal(impact.availabilityTrusted,false);
  assert.match(impact.note,/не прошёл проверку свежести|не прошёл проверку/i);
});

test('trusted lineup and injury evidence keep bounded impact metrics', () => {
  const runtime=createAnalysisQualityRuntime(deps());
  const impact=runtime.buildLineupImpact({
    absences:{
      home:[
        {status:'reported_out',seasonRole:{matched:true,weight:1.6}},
        {status:'doubtful',seasonRole:{matched:true,weight:1.2}},
        {status:'reported_out'},
      ],
      away:[{status:'reported_out',seasonRole:{matched:false}}],
      summary:{
        home:{injury:2,illness:1,suspension:1,doubtful:1},
        away:{injury:1,illness:0,suspension:0,doubtful:0},
        resolvedByLineup:2,
      },
    },
    lineups:{
      home:{confirmed:true},
      away:{confirmed:true},
    },
    homeName:'Home',
    awayName:'Away',
    reliability:{
      features:{
        injuries:{state:'available',confidenceBearing:true,stale:false},
        lineups:{state:'available',confirmed:true,confidenceBearing:true,stale:false},
      },
    },
  });

  assert.equal(impact.homeConfirmed,true);
  assert.equal(impact.awayConfirmed,true);
  assert.equal(impact.availabilityTrusted,true);
  assert.deepEqual(impact.seasonRoleCoverage,{
    home:{matched:2,total:3},
    away:{matched:0,total:1},
  });
  assert.equal(impact.categories.home.injuryOrIllness,3);
  assert.equal(impact.categories.home.suspension,1);
  assert.equal(impact.categories.home.doubtful,1);
  assert.equal(impact.resolvedByLineup,2);
  assert.equal(impact.availabilityUnits.home,3.8);
});

test('lineup impact sanitizes hostile summaries and dependency failures', () => {
  const runtime=createAnalysisQualityRuntime(deps({
    absenceAdjustmentUnits:()=>{ throw new Error('bad dependency'); },
    assessMatchLineups:()=>{ throw new Error('bad lineup'); },
  }));

  const impact=runtime.buildLineupImpact({
    absences:{
      home:[{}],
      away:[],
      summary:{
        home:{injury:Infinity,illness:-10,suspension:'9999',doubtful:'bad'},
        away:{},
        resolvedByLineup:Infinity,
      },
    },
    reliability:{
      features:{
        injuries:{state:'available',confidenceBearing:true,stale:false},
      },
    },
  });

  assert.equal(impact.homeConfirmed,false);
  assert.equal(impact.awayConfirmed,false);
  assert.equal(impact.availabilityUnits.home,0);
  assert.equal(impact.categories.home.injuryOrIllness,0);
  assert.equal(impact.categories.home.suspension,0);
  assert.equal(impact.resolvedByLineup,0);
});

test('market movement note rejects malformed deltas and formats verified movement', () => {
  const runtime=createAnalysisQualityRuntime(deps());

  assert.equal(
    runtime.marketMovementNote({sample:2,probabilityChange:{home:Infinity,draw:0,away:0}}),
    'Данные движения рынка не прошли проверку.',
  );
  assert.equal(
    runtime.marketMovementNote({sample:2,probabilityChange:{home:0.4,draw:-0.2,away:-0.2}}),
    'Существенного движения рынка по 1X2 пока нет.',
  );
  assert.equal(
    runtime.marketMovementNote({sample:3,probabilityChange:{home:3.2,draw:-1.1,away:-2.1}}),
    'Рынок сместился к П1: +3.2 п.п. по подразумеваемой вероятности.',
  );
});

test('analysis quality gate blocks malformed probabilities and hostile numeric metrics', () => {
  const runtime=createAnalysisQualityRuntime(deps());
  const result=runtime.analysisQualityGate({
    probabilities:{home:Infinity,draw:0,away:0},
    confidence:{
      score:Infinity,
      signalCount:99,
      disagreement:NaN,
      agreement:100,
    },
    dataTrustScore:Infinity,
    providerReliability:{state:'healthy',trustCap:100},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
    minutesToKickoff:120,
  });

  assert.equal(result.state,'blocked');
  assert.equal(result.allowSignal,false);
  assert.ok(result.reasons.some(reason=>reason.code==='probabilities_invalid'));
  assert.ok(result.reasons.some(reason=>reason.code==='signal_count'));
  assert.ok(result.reasons.some(reason=>reason.code==='confidence'));
  assert.ok(result.reasons.some(reason=>reason.code==='data_trust'));
});

test('zero leader agreement is a hold when multiple signals exist', () => {
  const runtime=createAnalysisQualityRuntime(deps());
  const result=runtime.analysisQualityGate({
    probabilities:{home:60,draw:25,away:15},
    confidence:{score:75,signalCount:3,disagreement:4,agreement:0},
    dataTrustScore:90,
    providerReliability:{state:'healthy',trustCap:100},
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
    minutesToKickoff:120,
  });

  assert.equal(result.state,'hold');
  assert.equal(result.allowSignal,false);
  assert.ok(result.reasons.some(reason=>reason.code==='leader_agreement'));
});

test('final lineup window holds unconfirmed sources but old live timestamps do not create lineup warnings', () => {
  const runtime=createAnalysisQualityRuntime(deps());
  const base={
    probabilities:{home:60,draw:25,away:15},
    confidence:{score:75,signalCount:3,disagreement:4,agreement:80},
    dataTrustScore:90,
    providerReliability:{state:'healthy',trustCap:100},
    lineupImpact:{homeConfirmed:false,awayConfirmed:false},
  };

  const near=runtime.analysisQualityGate({...base,minutesToKickoff:10});
  assert.equal(near.state,'hold');
  assert.ok(near.reasons.some(reason=>reason.code==='lineups_final_window'));

  const oldLive=runtime.analysisQualityGate({...base,minutesToKickoff:-60});
  assert.equal(
    oldLive.reasons.some(reason=>reason.code==='lineups_final_window' || reason.code==='lineups_pending'),
    false,
  );
});

test('partial/degraded provider reliability participates in the gate', () => {
  const runtime=createAnalysisQualityRuntime(deps());
  const base={
    probabilities:{home:60,draw:25,away:15},
    confidence:{score:75,signalCount:3,disagreement:4,agreement:80},
    dataTrustScore:90,
    lineupImpact:{homeConfirmed:true,awayConfirmed:true},
    minutesToKickoff:120,
  };

  const partial=runtime.analysisQualityGate({
    ...base,
    providerReliability:{state:'partial',trustCap:65},
  });
  assert.equal(partial.state,'hold');
  assert.ok(partial.reasons.some(reason=>reason.code==='provider_partial'));

  const degraded=runtime.analysisQualityGate({
    ...base,
    providerReliability:{state:'degraded',trustCap:85},
  });
  assert.equal(degraded.state,'caution');
  assert.equal(degraded.allowSignal,true);
  assert.ok(degraded.reasons.some(reason=>reason.code==='provider_degraded'));
});

test('analysis quality self-test covers ready, hold and malformed fail-closed states', () => {
  const runtime=createAnalysisQualityRuntime(deps());
  const result=runtime.analysisQualityGateSelfTest();

  assert.equal(result.pass,true);
  assert.equal(result.ready,'ready');
  assert.equal(result.hold,'hold');
  assert.equal(result.malformed,'blocked');
});

test('worker keeps analysis quality wiring explicit', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const source=fs.readFileSync('src/analysis-quality-runtime.js','utf8');

  assert.match(
    worker,
    /createAnalysisQualityRuntime\(\{[\s\S]*?absenceAdjustmentUnits,[\s\S]*?assessMatchLineups,[\s\S]*?probabilityLeaderMargin,[\s\S]*?\}\);/,
  );
  assert.match(source,/const requiredFunctions=\{/);
  assert.match(source,/safeProbabilityVector/);
  assert.match(source,/lineupSourceTrusted/);
  assert.match(source,/return Object\.freeze\(\{/);
});
