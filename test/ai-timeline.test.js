import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  analysisTimelineSnapshotRow,
  buildAiTimeline,
  timelineTriggerFromDelta,
} from '../src/ai-timeline.js';
import { createAiTimelineRuntime } from '../src/ai-timeline-runtime.js';
import {
  normalizeAiTimeline,
  renderAiTimelineCompact,
  renderAiTimelineDetails,
  renderAiProbabilityChart,
} from '../public/modules/ai-timeline.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

const match = {
  fixtureId:42,
  date:'2026-10-01T18:00:00.000Z',
  home:{name:'Хозяева'},
  away:{name:'Гости'},
};

function point(at, probabilities, extra = {}) {
  return {
    fixture_id:42,
    captured_at:at,
    home_prob:probabilities.home,
    draw_prob:probabilities.draw,
    away_prob:probabilities.away,
    trigger_category:extra.category || 'model_update',
    causal_relation:extra.relation || 'model_driven',
    explanation:extra.explanation || 'Модель переоценила матч после обновления входных данных.',
    confidence_score:extra.confidence,
    completeness_score:extra.completenessScore,
    completeness_max:extra.completenessMax,
    match_minute:extra.minute ?? null,
    provenance:extra.provenance || {},
  };
}

function createTimelineRuntime({
  hasSupabase = () => false,
  memory = {analysisTimelineSnapshots:new Map()},
  supaInsertIgnore = async () => true,
  supaSelectMany = async () => [],
  loadModelPredictionForFixture = async () => null,
  getOddsSnapshots = async () => [],
} = {}) {
  return {
    memory,
    runtime:createAiTimelineRuntime({
      analysisTimelineSnapshotRow,
      buildAiTimeline,
      getOddsSnapshots,
      hasSupabase,
      loadModelPredictionForFixture,
      memory,
      supaInsertIgnore,
      supaSelectMany,
    }),
  };
}

const analysisRuntimeSource=readRepoFile('src/analysis-runtime.js');
const matchCenterSource=readRepoFile('src/match-center-runtime.js');
const workerSource=readRepoFile('src/worker.js');
const appSource=readRepoFile('public/app.js')+'\n'+readRepoFile('public/modules/match-center-view.js');
const migration=readRepoFile('supabase/migrations/supabase_migration_v6_22.sql').toLowerCase();
const shellCss=readRepoFile('public/styles/public-shell.css');


test('Intelligence 2.0 chart draws only genuine chronological 1X2 snapshots',()=>{
  const html=renderAiProbabilityChart({points:[
    {capturedAt:'2026-10-01T17:00:00Z',probabilities:{home:61,draw:23,away:16}},
    {capturedAt:'2026-10-01T12:00:00Z',probabilities:{home:52,draw:27,away:21}},
    {capturedAt:'2026-10-01T15:00:00Z',probabilities:{home:57,draw:25,away:18}},
  ]},match);
  assert.match(html,/class="ai-prob-chart"/);
  assert.match(html,/3 сохранённых снимков/);
  assert.match(html,/Хозяева/);
  assert.match(html,/61\.0%/);
  assert.match(html,/23\.0%/);
  assert.match(html,/16\.0%/);
  assert.match(html,/class="ai-prob-line home"/);
  assert.match(html,/class="ai-prob-line draw"/);
  assert.match(html,/class="ai-prob-line away"/);
  assert.match(html,/M38\.00 [\d.]+ L[\d.]+ [\d.]+ L625\.00/);
  assert.match(html,/между ними измерений нет/);
});

test('Intelligence 2.0 does not invent chart points for missing, invalid or stale history',()=>{
  const t=(points)=>renderAiProbabilityChart({points},match);
  const valid={capturedAt:'2026-10-01T12:00:00Z',
    probabilities:{home:52,draw:27,away:21}};
  const later={capturedAt:'2026-10-01T17:00:00Z',
    probabilities:{home:57,draw:25,away:18}};
  assert.match(t([]),/нужны минимум два/);
  assert.match(t([valid]),/нужны минимум два/);
  assert.match(t([valid,{...later,stale:true}]),/нужны минимум два/);
  assert.match(t([valid,{...later,probabilities:{home:110,draw:-20,away:10}}]),/нужны минимум два/);
  assert.match(t([valid,{...later,probabilities:{home:57,draw:25,away:70}}]),/нужны минимум два/);
  assert.doesNotMatch(t([valid,{...later,stale:true}]),/class="ai-prob-line home"/);
});

test('Intelligence 2.0 escapes team labels and explains non-causal market timing',()=>{
  const poisoned={...match,home:{name:'<img src=x onerror=alert(1)>'}};
  const timeline={points:[
    {capturedAt:'2026-10-01T12:00:00Z',probabilities:{home:52,draw:27,away:21}},
    {capturedAt:'2026-10-01T17:00:00Z',probabilities:{home:57,draw:25,away:18},
      trigger:{relation:'correlated',label:'Гол соперника',
        explanation:'Совпадение по времени, причинность не доказана'}},
  ]};
  const html=renderAiTimelineCompact(timeline,poisoned);
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/&lt;img src=x/);
  assert.match(html,/Совпало по времени/);
  assert.match(html,/причинность не доказана/);
  assert.match(html,/class="ai-prob-chart"/);
});

test('AI Timeline: no snapshots produces no invented UI', () => {
  const timeline=buildAiTimeline({match});
  assert.equal(timeline.available,false);
  assert.deepEqual(timeline.points,[]);
  assert.equal(renderAiTimelineCompact(timeline,match),'');
  assert.equal(renderAiTimelineDetails(timeline,match),'');
});

test('AI Timeline: one real point is a baseline without fake delta', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21},{confidence:66})],
    match,
  });
  assert.equal(timeline.points.length,1);
  assert.equal(timeline.points[0].leader.key,'home');
  assert.equal(timeline.points[0].delta.value,null);
  const html=renderAiTimelineCompact(timeline,match);
  assert.match(html,/Хозяева · 52\.0%/);
  assert.doesNotMatch(html,/\+0\.0 п\.п\./);
});

test('AI Timeline: multiple points are chronological and show base plus delta', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[
      point('2026-10-01T17:00:00Z',{home:57,draw:25,away:18}),
      point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21}),
      point('2026-10-01T17:30:00Z',{home:61,draw:23,away:16}),
    ],
    match,
  });

  assert.deepEqual(timeline.points.map(item=>item.probabilities.home),[52,57,61]);
  assert.equal(timeline.points[1].delta.previousProbability,52);
  assert.equal(timeline.points[1].delta.value,5);
  assert.equal(timeline.points[2].delta.value,4);

  const html=renderAiTimelineCompact(timeline,match);
  assert.match(html,/57\.0% → 61\.0%/);
  assert.match(html,/↑ \+4\.0 п\.п\./);
});

test('AI Timeline: duplicate and near-identical baseline snapshots are deduplicated deterministically', () => {
  const model=normalizeAiTimeline({
    points:[
      {capturedAt:'2026-10-01T12:00:00Z',probabilities:{home:52,draw:27,away:21},source:'model_predictions'},
      {capturedAt:'2026-10-01T12:00:00Z',probabilities:{home:53,draw:26,away:21},source:'analysis_timeline_snapshots'},
    ],
  },match);
  assert.equal(model.points.length,1);
  assert.equal(model.points[0].probabilities.home,53);
  assert.equal(model.points[0].source,'analysis_timeline_snapshots');

  const timeline=buildAiTimeline({
    snapshotRows:[point('2026-10-01T12:00:30Z',{home:52,draw:27,away:21})],
    modelPrediction:{
      fixture_id:42,
      captured_at:'2026-10-01T12:00:00Z',
      kickoff_at:match.date,
      home_prob:52,
      draw_prob:27,
      away_prob:21,
    },
    match,
  });
  assert.equal(timeline.points.length,1);
  assert.notEqual(timeline.points[0].source,'model_predictions');
});

test('AI Timeline: rejects cross-fixture and malformed probability snapshots', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[
      point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21}),
      {...point('2026-10-01T12:05:00Z',{home:53,draw:26,away:21}),fixture_id:99},
      point('2026-10-01T12:10:00Z',{home:90,draw:90,away:90}),
    ],
    modelPrediction:{
      fixture_id:99,
      captured_at:'2026-10-01T11:00:00Z',
      home_prob:52,
      draw_prob:27,
      away_prob:21,
    },
    match,
  });

  assert.equal(timeline.points.length,1);
  assert.equal(timeline.points[0].fixtureId,42);
  assert.equal(timeline.generatedFrom.immutableModelPrediction,false);
});

test('AI Timeline: snapshot rows validate identity, time and supported minute range', () => {
  assert.equal(
    analysisTimelineSnapshotRow({
      generatedAt:'invalid',
      match:{fixtureId:42},
      probabilities:{home:50,draw:30,away:20},
    }),
    null,
  );
  assert.equal(
    analysisTimelineSnapshotRow({
      generatedAt:'2026-10-01T20:00:00Z',
      match:{fixtureId:-42},
      probabilities:{home:50,draw:30,away:20},
    }),
    null,
  );

  const row=analysisTimelineSnapshotRow({
    generatedAt:'2026-10-01T20:00:00Z',
    match:{fixtureId:42,date:match.date,status:'ET',elapsed:999},
    probabilities:{home:50,draw:30,away:20},
  });
  assert.equal(row.match_minute,180);

  const timeline=buildAiTimeline({
    snapshotRows:[point('2026-10-01T20:00:00Z',{home:50,draw:30,away:20},{minute:999})],
    match,
  });
  assert.equal(timeline.points[0].minute,180);
});

test('AI Timeline: trigger wording separates confirmed chronology from correlation and causality', () => {
  const lineup=timelineTriggerFromDelta({codes:['lineups']});
  assert.equal(lineup.relation,'confirmed');
  assert.equal(lineup.category,'lineup');
  assert.match(lineup.explanation,/После подтверждения состава/);
  assert.doesNotMatch(lineup.explanation,/из-за|привел|вызвал/i);

  const market=timelineTriggerFromDelta({codes:['market']});
  assert.equal(market.relation,'correlated');
  assert.equal(market.category,'odds_move');
  assert.match(market.explanation,/совпало/i);
  assert.match(market.explanation,/Причинность не подтверждена/i);

  const row=analysisTimelineSnapshotRow({
    generatedAt:'2026-10-01T17:05:00Z',
    analysisVersion:'test',
    match:{fixtureId:42,date:match.date,status:'NS'},
    probabilities:{home:57,draw:25,away:18},
    confidence:{score:71},
    completeness:{score:8,max:10},
    dataProvenance:{primaryProvider:'api-football',features:{}},
  },{delta:{codes:['lineups']}});
  assert.equal(row.trigger_category,'lineup');
  assert.equal(row.causal_relation,'confirmed');
});

test('AI Timeline: live event correlation never claims event causality', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[
      point('2026-10-01T18:10:00Z',{home:55,draw:27,away:18},{minute:10}),
      point('2026-10-01T18:25:00Z',{home:73,draw:18,away:9},{minute:25}),
    ],
    events:[{minute:20,type:'Card',detail:'Red Card',teamName:'Гости'}],
    match,
  });

  assert.equal(timeline.points[1].trigger.relation,'correlated');
  assert.equal(timeline.points[1].trigger.category,'event');
  assert.match(timeline.points[1].trigger.explanation,/совпало/i);
  assert.match(timeline.points[1].trigger.explanation,/Причинность не подтверждена/i);
  assert.doesNotMatch(timeline.points[1].trigger.explanation,/из-за красной|красная карточка вызвала/i);
});

test('AI Timeline: market snapshots remain separate from AI probability points', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21})],
    oddsSnapshots:[
      {at:'2026-10-01T11:00:00Z',homeProb:48,drawProb:29,awayProb:23,sources:4},
      {at:'2026-10-01T17:00:00Z',homeProb:55,drawProb:26,awayProb:19,sources:5},
    ],
    match,
  });

  assert.equal(timeline.points.length,1);
  assert.equal(timeline.marketContext.length,2);
  assert.equal(timeline.generatedFrom.marketSnapshots,2);

  // Mini App не выводит рыночные данные: рыночный контекст в деталях не рисуется.
  const html=renderAiTimelineDetails(timeline,match);
  assert.doesNotMatch(html,/Рыночный контекст|рыночн|ai-timeline-market-context/i);
});

test('AI Timeline: stored market-move trigger renders as a neutral data update', () => {
  const timeline={
    available:true,
    points:[
      point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21}),
      {
        ...point('2026-10-01T15:00:00Z',{home:57,draw:24,away:19}),
        trigger:{category:'odds_move',relation:'correlated',label:'Движение рынка',explanation:'Изменение оценки по времени совпало с заметным движением рынка.'},
      },
    ],
  };
  const html=renderAiTimelineDetails(timeline,match);
  assert.match(html,/Обновление внешних данных/);
  assert.doesNotMatch(html,/Движение рынка|движением рынка/);
});

test('AI Timeline: stale provenance and missing confidence stay explicit', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21},{
      provenance:{stale:true,staleFeatures:['market']},
      completenessScore:5,
      completenessMax:10,
    })],
    match,
  });

  const normalized=normalizeAiTimeline(timeline,match);
  assert.equal(normalized.points[0].stale,true);
  assert.equal(normalized.points[0].confidence,null);
  assert.equal(normalized.points[0].completeness.percent,50);

  const html=renderAiTimelineCompact(timeline,match);
  assert.match(html,/Есть устаревший источник/);
  assert.doesNotMatch(html,/Уверенность 0%/);
});

test('AI Timeline renderer sorts points and escapes long untrusted explanations', () => {
  const long='Очень длинное объяснение '.repeat(30)+'<script>alert(1)</script>';
  const model=normalizeAiTimeline({
    points:[
      {capturedAt:'2026-10-01T17:00:00Z',probabilities:{home:57,draw:25,away:18},trigger:{relation:'model_driven',explanation:long}},
      {capturedAt:'2026-10-01T12:00:00Z',probabilities:{home:52,draw:27,away:21},trigger:{relation:'model_driven',explanation:'База'}},
    ],
  },match);

  assert.equal(model.points[0].capturedAt,'2026-10-01T12:00:00.000Z');
  const html=renderAiTimelineDetails(model,match);
  assert.doesNotMatch(html,/<script>/i);
  assert.match(html,/&lt;script&gt;/);
});

test('AI Timeline runtime rejects invalid fixture ids without storage or model lookups', async () => {
  let selects=0;
  let modelLoads=0;
  let oddsLoads=0;

  const {runtime}=createTimelineRuntime({
    hasSupabase:()=>true,
    supaSelectMany:async()=>{
      selects+=1;
      return [];
    },
    loadModelPredictionForFixture:async()=>{
      modelLoads+=1;
      return null;
    },
    getOddsSnapshots:async()=>{
      oddsLoads+=1;
      return [];
    },
  });

  for (const fixtureId of [0,-1,1.5,Number.NaN,'not-an-id']) {
    assert.deepEqual(await runtime.getAnalysisTimelineSnapshots(fixtureId,{}),[]);
    const timeline=await runtime.loadFixtureAiTimeline({fixtureId,match:{fixtureId},events:[],cfg:{}});
    assert.equal(timeline.available,false);
  }

  assert.equal(selects,0);
  assert.equal(modelLoads,0);
  assert.equal(oddsLoads,0);
});

test('AI Timeline runtime loads only stored snapshots, immutable prediction and stored odds context', async () => {
  const calls=[];
  const {runtime}=createTimelineRuntime({
    hasSupabase:()=>true,
    supaSelectMany:async (_cfg,table,filters,options)=>{
      calls.push({kind:'snapshots',table,filters,options});
      return [point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21})];
    },
    loadModelPredictionForFixture:async fixtureId=>{
      calls.push({kind:'prediction',fixtureId});
      return null;
    },
    getOddsSnapshots:async (fixtureId,_cfg,limit)=>{
      calls.push({kind:'odds',fixtureId,limit});
      return [];
    },
  });

  const timeline=await runtime.loadFixtureAiTimeline({
    fixtureId:42,
    match,
    events:[],
    cfg:{},
  });

  assert.equal(timeline.available,true);
  assert.deepEqual(calls,[
    {
      kind:'snapshots',
      table:'analysis_timeline_snapshots',
      filters:{fixture_id:'eq.42'},
      options:{limit:80,order:'captured_at.asc'},
    },
    {kind:'prediction',fixtureId:42},
    {kind:'odds',fixtureId:42,limit:20},
  ]);
});

test('AI Timeline runtime capture is append-only locally and idempotent in Supabase', async () => {
  const inserts=[];
  const memory={analysisTimelineSnapshots:new Map()};
  const {runtime}=createTimelineRuntime({
    hasSupabase:()=>true,
    memory,
    supaInsertIgnore:async (_cfg,table,row,conflictKey)=>{
      inserts.push({table,row,conflictKey});
      return true;
    },
  });
  const payload={
    generatedAt:'2026-10-01T12:00:00Z',
    analysisVersion:'test',
    match:{fixtureId:42,date:match.date,status:'NS'},
    probabilities:{home:52,draw:27,away:21},
    confidence:{score:66},
    completeness:{score:8,max:10},
  };

  assert.equal(await runtime.captureAnalysisTimelineSnapshot(payload,{}),true);
  assert.equal(await runtime.captureAnalysisTimelineSnapshot(payload,{}),true);

  assert.equal(memory.analysisTimelineSnapshots.get(42).length,1);
  assert.equal(inserts.length,2);
  assert.equal(inserts[0].table,'analysis_timeline_snapshots');
  assert.equal(inserts[0].conflictKey,'snapshot_key');
  assert.equal(inserts[0].row.snapshot_key,'42:2026-10-01T12:00:00.000Z');
});

test('AI Timeline persistence is server-only and append-only for the application', () => {
  assert.match(migration,/create table if not exists public\.analysis_timeline_snapshots/);
  assert.match(migration,/alter table public\.analysis_timeline_snapshots enable row level security/);
  assert.match(migration,/revoke all on table public\.analysis_timeline_snapshots from public, anon, authenticated, service_role/);
  assert.match(migration,/grant select, insert on table public\.analysis_timeline_snapshots to service_role/);
  assert.doesNotMatch(migration,/grant[^;]*(update|delete)[^;]*analysis_timeline_snapshots/i);
  assert.match(migration,/table_name not in \('provider_incident_alert_deliveries','analysis_timeline_snapshots'\)/);
});

test('AI Timeline wiring captures fresh analyses and loads timeline into Match Center without provider calls', () => {
  assert.match(
    analysisRuntimeSource,
    /captureAnalysisTimelineSnapshot,\s*payload,\s*cfg,\s*\{delta:effectiveRecheckDelta\}/,
  );
  assert.match(
    matchCenterSource,
    /optionalAsync\(loadFixtureAiTimeline,\{[\s\S]*?fixtureId,[\s\S]*?events:[\s\S]*?cfg/,
  );
  assert.match(
    workerSource,
    /createAiTimelineRuntime\(\{[\s\S]*?getOddsSnapshots,[\s\S]*?loadModelPredictionForFixture,[\s\S]*?supaInsertIgnore,[\s\S]*?supaSelectMany/,
  );
  assert.doesNotMatch(
    readRepoFile('src/ai-timeline-runtime.js'),
    /apiFootball\(|providerFeatureFetch\(|loadProviderFixture\(/,
  );
});

test('AI Timeline UI remains lazy-loaded after Match Pulse and supports narrow mobile widths', () => {
  assert.match(appSource,/import\('\.\/modules\/ai-timeline\.js\?v=6\.120\.0-launch89'\)/);
  const pulse=appSource.indexOf("matchCenterExtraHtml('renderMatchPulse'");
  const timeline=appSource.indexOf("'renderAiTimelineCompact',",appSource.indexOf('const matchPulseHtml'));
  assert.ok(pulse>=0 && timeline>pulse,'AI Timeline must be rendered after existing Match Pulse');

  const section=shellCss.slice(shellCss.indexOf('/* AI Timeline */'));
  assert.ok(section.length>0);
  for (const width of [430,390,360,320]) {
    assert.match(section,new RegExp('@media\\(max-width:'+width+'px\\)'));
  }
});
