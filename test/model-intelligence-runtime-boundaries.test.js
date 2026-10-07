import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createMarketParsingRuntime } from '../src/market-parsing-runtime.js';
import { createModelIntelligenceRuntime } from '../src/model-intelligence-runtime.js';

const marketParsing=createMarketParsingRuntime();

function deps(overrides={}) {
  return {
    MODEL_BASE_WEIGHTS:{
      market:0.40,
      apiPrediction:0.20,
      recentForm:0.22,
      seasonStrength:0.13,
      h2h:0.05,
    },
    apiFootball:async()=>[],
    getCache:async()=>null,
    isFinishedStatus:status=>['FT','AET','PEN'].includes(String(status || '').toUpperCase()),
    normalizeThree:marketParsing.normalizeThree,
    parsePercent:marketParsing.parsePercent,
    round1:marketParsing.round1,
    setCache:async()=>{},
    todayUtc:()=> '2026-10-06',
    ...overrides,
  };
}

function finishedFixture({
  id=1,
  teamId=10,
  opponentId=11,
  homeGoals=1,
  awayGoals=0,
  date='2026-10-01T18:00:00.000Z',
}={}) {
  return {
    fixture:{
      id,
      date,
      status:{short:'FT'},
    },
    teams:{
      home:{id:teamId,name:'Home',logo:''},
      away:{id:opponentId,name:'Away',logo:''},
    },
    league:{name:'League'},
    goals:{home:homeGoals,away:awayGoals},
  };
}

test('model intelligence requires explicit base model weights and returns a frozen surface', () => {
  const broken=deps();
  delete broken.MODEL_BASE_WEIGHTS;

  assert.throws(
    () => createModelIntelligenceRuntime(broken),
    /MODEL_BASE_WEIGHTS is required/,
  );

  const runtime=createModelIntelligenceRuntime(deps());
  assert.equal(Object.isFrozen(runtime),true);
});

test('prediction extraction never converts a missing percentage into zero probability', () => {
  const runtime=createModelIntelligenceRuntime(deps());

  const missing=runtime.extractPrediction([{
    predictions:{
      percent:{home:'55%',draw:'',away:'45%'},
    },
  }]);
  assert.equal(missing.probabilities,null);

  const malformed=runtime.extractPrediction([{
    predictions:{
      percent:{home:'150%',draw:'-20%',away:'-30%'},
    },
  }]);
  assert.equal(malformed.probabilities,null);

  const valid=runtime.extractPrediction([{
    predictions:{
      percent:{home:'50%',draw:'30%',away:'20%'},
      winner:{name:'Home'},
    },
  }]);
  assert.deepEqual(valid.probabilities,{home:50,draw:30,away:20});
  assert.equal(valid.winner,'Home');
});

test('recent form rejects unsafe ids, malformed provider rows and missing final scores', async () => {
  const runtime=createModelIntelligenceRuntime(deps());

  assert.equal(
    runtime.teamResult(
      finishedFixture({homeGoals:null,awayGoals:null}),
      10,
    ),
    null,
  );

  assert.equal(
    await runtime.getRecentTeamForm(
      1.5,
      'home',
      '2026-10-06T18:00:00.000Z',
      100,
      {},
    ),
    null,
  );

  const malformed=createModelIntelligenceRuntime(deps({
    apiFootball:async()=>({unexpected:true}),
  }));
  await assert.rejects(
    () => malformed.getRecentTeamForm(
      10,
      'home',
      '2026-10-06T18:00:00.000Z',
      100,
      {},
    ),
    error=>error?.code==='FOOTBALL_INVALID_RESPONSE',
  );
});

test('form cache writes are fail-soft and only valid finished scores enter the summary', async () => {
  let writes=0;
  const runtime=createModelIntelligenceRuntime(deps({
    apiFootball:async()=>[
      finishedFixture({id:1,homeGoals:2,awayGoals:1}),
      finishedFixture({id:2,homeGoals:null,awayGoals:null}),
      finishedFixture({id:3,homeGoals:0,awayGoals:0}),
    ],
    setCache:async()=>{
      writes+=1;
      throw new Error('cache unavailable');
    },
  }));

  const summary=await runtime.getRecentTeamForm(
    10,
    'home',
    '2026-10-06T18:00:00.000Z',
    100,
    {},
  );

  assert.equal(summary.overall.sample,2);
  assert.equal(summary.overall.wins,1);
  assert.equal(summary.overall.draws,1);
  assert.equal(summary.overall.losses,0);
  assert.equal(writes,1);
});

test('probability blending rejects malformed signals and corrupted calibration weights', () => {
  const runtime=createModelIntelligenceRuntime(deps());

  const blend=runtime.blendProbabilitySignals({
    market:{probabilities:{home:50,draw:30,away:20}},
    model:{probabilities:{home:-10,draw:60,away:50}},
    form:{home:45,draw:30,away:25},
    h2h:{home:40,draw:30,away:30},
  });

  assert.deepEqual(
    blend.signals.map(signal=>signal.name),
    ['market','recentForm','h2h'],
  );
  assert.ok(blend.probabilities);
  assert.ok(Math.abs(
    blend.probabilities.home
      + blend.probabilities.draw
      + blend.probabilities.away
      - 100
  )<=0.2);

  const corrupted=runtime.blendProbabilitySignals({
    market:{probabilities:{home:50,draw:30,away:20}},
    form:{home:45,draw:30,away:25},
    weightOverrides:{
      market:1000,
      recentForm:0.2,
    },
  });

  assert.ok(corrupted.weights.market<80);
  assert.ok(corrupted.weights.recentForm>20);
});

test('ranking, H2H and Poisson calculations fail closed on malformed numeric inputs', () => {
  const runtime=createModelIntelligenceRuntime(deps());

  assert.deepEqual(
    runtime.probabilityRanking({home:80,draw:30},'Home','Away'),
    [],
  );
  assert.equal(
    runtime.h2hProbabilities({homeWins:-1,draws:2,awayWins:1}),
    null,
  );
  assert.equal(
    runtime.poissonGoalModel(
      {overall:{sample:5,ppg:2,gfAvg:'bad',gaAvg:1,gdAvg:1}},
      {overall:{sample:5,ppg:1,gfAvg:1,gaAvg:1,gdAvg:0}},
    ),
    null,
  );
});

test('pre-match intelligence drops malformed market, H2H and signal context', () => {
  const runtime=createModelIntelligenceRuntime(deps());

  const brief=runtime.buildPreMatchIntelligence({
    probabilities:{home:60,draw:25,away:15},
    market:{probabilities:{home:-10,draw:60,away:50}},
    h2h:{homeWins:-1,draws:0,awayWins:5},
    modelBreakdown:{
      signals:[
        {name:'market',probabilities:{home:-10,draw:60,away:50},weight:90},
        {name:'recentForm',probabilities:{home:45,draw:30,away:25},weight:10},
      ],
    },
    homeForm:null,
    awayForm:null,
    absences:null,
    lineups:null,
    goalModel:null,
    comparison:null,
    confidence:{score:70,disagreement:5},
    homeName:'Home',
    awayName:'Away',
    minutesToKickoff:30,
    news:null,
    completeness:{score:5,max:10},
  });

  assert.deepEqual(
    brief.sourceRows.map(row=>row.key),
    ['recentForm'],
  );
  assert.equal(
    brief.drivers.some(driver=>driver.type==='market_divergence'),
    false,
  );
  assert.equal(
    brief.drivers.some(driver=>driver.type==='h2h_context'),
    false,
  );
  assert.ok(
    brief.watch.some(item=>item.includes('Линия 1X2 отсутствует')),
  );
});

test('worker passes MODEL_BASE_WEIGHTS into model intelligence runtime', () => {
  const worker=fs.readFileSync('src/worker.js','utf8');
  const runtime=fs.readFileSync('src/model-intelligence-runtime.js','utf8');

  assert.match(
    worker,
    /createModelIntelligenceRuntime\(\{[\s\S]*?MODEL_BASE_WEIGHTS[\s\S]*?\}\);/,
  );
  assert.match(runtime,/const baseWeights=Object\.freeze/);
  assert.match(runtime,/FOOTBALL_INVALID_RESPONSE/);
  assert.match(runtime,/return Object\.freeze\(\{/);
});
