import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelIntelligenceRuntime } from '../src/model-intelligence-runtime.js';

const MODEL_BASE_WEIGHTS=Object.freeze({
  market:0.40,
  apiPrediction:0.20,
  recentForm:0.22,
  seasonStrength:0.13,
  h2h:0.05,
});

function normalizeThree(home,draw,away) {
  const values=[Number(home),Number(draw),Number(away)];
  if (values.some(value=>!Number.isFinite(value) || value<0)) return null;
  const total=values.reduce((sum,value)=>sum+value,0);
  if (!(total>0)) return null;
  return {
    home:values[0]/total*100,
    draw:values[1]/total*100,
    away:values[2]/total*100,
  };
}

function runtime() {
  return createModelIntelligenceRuntime({
    MODEL_BASE_WEIGHTS,
    apiFootball:async()=>[],
    getCache:async()=>null,
    isFinishedStatus:()=>true,
    normalizeThree,
    parsePercent:value=>Number(String(value ?? '').replace('%','')),
    round1:value=>Math.round(Number(value)*10)/10,
    setCache:async()=>true,
    todayUtc:()=> '2026-10-07',
  });
}

function player(id,strong=true) {
  return {
    id,
    providerId:id,
    name:`Player ${id}`,
    games:{
      appearances:strong ? 20 : 8,
      lineups:strong ? 19 : 2,
      minutes:strong ? 1650 : 260,
      rating:strong ? 7.35 : 5.95,
      position:id%5===0 ? 'Defender' : 'Midfielder',
    },
    goals:{
      total:strong ? 4 : 0,
      assists:strong ? 3 : 0,
      saves:0,
    },
    tackles:{
      total:strong ? 45 : 5,
      blocks:strong ? 8 : 1,
      interceptions:strong ? 24 : 3,
    },
  };
}

function playerStats({complete=true,count=22}={}) {
  const rows=[
    ...Array.from({length:11},(_,i)=>player(i+1,true)),
    ...Array.from({length:11},(_,i)=>player(i+12,false)),
  ].slice(0,count);
  return {
    available:true,
    complete,
    partial:!complete,
    scope:'team-season',
    players:rows,
    sourceMeta:{provider:'api-football'},
  };
}

function lineup(ids,{confirmed=true}={}) {
  return {
    quality:{confirmed},
    startXI:ids.map(id=>({id,name:`Player ${id}`})),
  };
}

test('confirmed XI penalizes a heavily rotated away lineup within the hard cap',()=>{
  const model=runtime();
  const stats=playerStats();
  const strength=model.buildStartingXiStrength({
    lineups:{
      home:lineup(Array.from({length:11},(_,i)=>i+1)),
      away:lineup(Array.from({length:11},(_,i)=>i+12)),
    },
    homePlayerStats:stats,
    awayPlayerStats:stats,
  });

  assert.equal(strength.available,true);
  assert.equal(strength.trusted,true);
  assert.equal(strength.home.matched,11);
  assert.equal(strength.away.matched,11);
  assert.ok(strength.away.rotationPenaltyPct>strength.home.rotationPenaltyPct);
  assert.equal(strength.probabilityShift,2.8);

  const adjusted=model.applyLineupStrengthAdjustment(
    {home:45,draw:28,away:27},
    strength,
  );
  assert.ok(adjusted.home>45);
  assert.ok(adjusted.away<27);
  assert.ok(Math.abs(adjusted.home+adjusted.draw+adjusted.away-100)<0.0001);
});

test('partial or unconfirmed XI never changes probabilities',()=>{
  const model=runtime();
  const stats=playerStats();
  const strength=model.buildStartingXiStrength({
    lineups:{
      home:lineup(Array.from({length:10},(_,i)=>i+1),{confirmed:false}),
      away:lineup(Array.from({length:11},(_,i)=>i+12)),
    },
    homePlayerStats:stats,
    awayPlayerStats:stats,
  });

  assert.equal(strength.trusted,false);
  const base={home:41,draw:30,away:29};
  const adjusted=model.applyLineupStrengthAdjustment(base,strength);
  assert.ok(Math.abs(adjusted.home-base.home)<0.0001);
  assert.ok(Math.abs(adjusted.draw-base.draw)<0.0001);
  assert.ok(Math.abs(adjusted.away-base.away)<0.0001);
});

test('insufficient seasonal player coverage blocks lineup strength',()=>{
  const model=runtime();
  const sparse=playerStats({complete:false,count:12});
  const strength=model.buildStartingXiStrength({
    lineups:{
      home:lineup(Array.from({length:11},(_,i)=>i+1)),
      away:lineup(Array.from({length:11},(_,i)=>i+1)),
    },
    homePlayerStats:sparse,
    awayPlayerStats:sparse,
  });

  assert.equal(strength.trusted,false);
  assert.equal(strength.probabilityShift,0);
});

test('trusted XI raises confidence diagnostics without becoming a sixth blend signal',()=>{
  const model=runtime();
  const stats=playerStats();
  const strength=model.buildStartingXiStrength({
    lineups:{
      home:lineup(Array.from({length:11},(_,i)=>i+1)),
      away:lineup(Array.from({length:11},(_,i)=>i+12)),
    },
    homePlayerStats:stats,
    awayPlayerStats:stats,
  });
  const signals=[
    ['market',{home:45,draw:28,away:27}],
    ['apiPrediction',{home:46,draw:27,away:27}],
    ['recentForm',{home:48,draw:27,away:25}],
    ['seasonStrength',{home:47,draw:27,away:26}],
    ['h2h',{home:43,draw:29,away:28}],
  ].map(([name,probabilities])=>({
    name,
    probabilities,
    weight:MODEL_BASE_WEIGHTS[name]*100,
  }));

  const confidence=model.confidenceModel(
    signals,
    {home:47.8,draw:28,away:24.2},
    {overall:{sample:5}},
    {overall:{sample:5}},
    strength,
  );

  assert.equal(confidence.signalCount,5);
  assert.equal(confidence.diagnostics.startingXiConfirmed,true);
  assert.equal(confidence.diagnostics.startingXiConfidencePct,100);
  assert.ok(confidence.score>=72);
});


test('balanced confirmed XIs do not create a synthetic probability edge',()=>{
  const model=runtime();
  const stats=playerStats();
  const sameIds=Array.from({length:11},(_,i)=>i+1);
  const strength=model.buildStartingXiStrength({
    lineups:{
      home:lineup(sameIds),
      away:lineup(sameIds),
    },
    homePlayerStats:stats,
    awayPlayerStats:stats,
  });

  assert.equal(strength.trusted,true);
  assert.equal(strength.probabilityShift,0);

  const base={home:42,draw:29,away:29};
  const adjusted=model.applyLineupStrengthAdjustment(base,strength);
  assert.ok(Math.abs(adjusted.home-base.home)<0.0001);
  assert.ok(Math.abs(adjusted.draw-base.draw)<0.0001);
  assert.ok(Math.abs(adjusted.away-base.away)<0.0001);
});
