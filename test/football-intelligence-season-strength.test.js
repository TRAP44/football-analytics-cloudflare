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

function sumProbabilities(p) {
  return Number(p.home)+Number(p.draw)+Number(p.away);
}

test('season strength turns strong season fundamentals into a home edge',()=>{
  const model=runtime();
  const probabilities=model.seasonStrengthProbabilities(
    {rank:2},
    {rank:14},
    {derived:{
      homePpg:2.55,
      goalsForPerMatch:2.15,
      goalsAgainstPerMatch:0.78,
      cleanSheetRate:48,
    }},
    {derived:{
      awayPpg:0.85,
      goalsForPerMatch:1.08,
      goalsAgainstPerMatch:1.62,
      cleanSheetRate:21,
    }},
  );

  assert.ok(probabilities);
  assert.ok(probabilities.home>probabilities.draw);
  assert.ok(probabilities.home>probabilities.away);
  assert.ok(probabilities.home>=50);
  assert.ok(Math.abs(sumProbabilities(probabilities)-100)<0.0001);
});

test('season strength refuses to guess from a single structural metric',()=>{
  const model=runtime();
  assert.equal(
    model.seasonStrengthProbabilities(
      {rank:1},
      {rank:12},
      null,
      null,
    ),
    null,
  );
});

test('five-signal blend exposes season strength with its configured weight',()=>{
  const model=runtime();
  const seasonStrength={home:58,draw:24,away:18};
  const blended=model.blendProbabilitySignals({
    market:{probabilities:{home:52,draw:27,away:21}},
    model:{probabilities:{home:55,draw:25,away:20}},
    form:{home:57,draw:24,away:19},
    seasonStrength,
    h2h:{home:48,draw:28,away:24},
  });

  assert.ok(blended.probabilities);
  assert.equal(blended.signals.length,5);
  assert.ok(blended.signals.some(signal=>signal.name==='seasonStrength'));
  assert.equal(blended.weights.seasonStrength,13);
  assert.ok(Math.abs(sumProbabilities(blended.probabilities)-100)<0.0001);
});

test('legacy four-signal blend still works when season data is unavailable',()=>{
  const model=runtime();
  const blended=model.blendProbabilitySignals({
    market:{probabilities:{home:44,draw:29,away:27}},
    model:{probabilities:{home:46,draw:28,away:26}},
    form:{home:47,draw:27,away:26},
    h2h:{home:40,draw:30,away:30},
  });

  assert.ok(blended.probabilities);
  assert.equal(blended.signals.length,4);
  assert.equal(blended.signals.some(signal=>signal.name==='seasonStrength'),false);
  assert.ok(Math.abs(sumProbabilities(blended.probabilities)-100)<0.0001);
});

test('confidence coverage recognizes the new fifth signal',()=>{
  const model=runtime();
  const signals=[
    ['market',{home:50,draw:28,away:22}],
    ['apiPrediction',{home:52,draw:27,away:21}],
    ['recentForm',{home:54,draw:26,away:20}],
    ['seasonStrength',{home:56,draw:25,away:19}],
    ['h2h',{home:48,draw:29,away:23}],
  ].map(([name,probabilities])=>({
    name,
    probabilities,
    weight:MODEL_BASE_WEIGHTS[name]*100,
  }));
  const final={home:52.8,draw:26.6,away:20.6};
  const confidence=model.confidenceModel(
    signals,
    final,
    {overall:{sample:5}},
    {overall:{sample:5}},
  );

  assert.equal(confidence.coverage,100);
  assert.equal(confidence.signalCount,5);
  assert.ok(confidence.score>=55);
});
