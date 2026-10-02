import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  analysisTimelineSnapshotRow,
  buildAiTimeline,
  timelineTriggerFromDelta,
} from '../src/ai-timeline.js';
import {
  normalizeAiTimeline,
  renderAiTimelineCompact,
  renderAiTimelineDetails,
} from '../public/modules/ai-timeline.js';

const match = {
  fixtureId: 42,
  date: '2026-10-01T18:00:00.000Z',
  home: { name: 'Хозяева' },
  away: { name: 'Гости' },
};

function point(at, probabilities, extra = {}) {
  return {
    fixture_id: 42,
    captured_at: at,
    home_prob: probabilities.home,
    draw_prob: probabilities.draw,
    away_prob: probabilities.away,
    trigger_category: extra.category || 'model_update',
    causal_relation: extra.relation || 'model_driven',
    explanation: extra.explanation || 'Модель переоценила матч после обновления входных данных.',
    confidence_score: extra.confidence,
    completeness_score: extra.completenessScore,
    completeness_max: extra.completenessMax,
    match_minute: extra.minute ?? null,
    provenance: extra.provenance || {},
  };
}

test('AI Timeline: no snapshots produces no invented UI', () => {
  const timeline = buildAiTimeline({ match });
  assert.equal(timeline.available, false);
  assert.deepEqual(timeline.points, []);
  assert.equal(renderAiTimelineCompact(timeline, match), '');
  assert.equal(renderAiTimelineDetails(timeline, match), '');
});

test('AI Timeline: one real point is a baseline without fake delta', () => {
  const timeline = buildAiTimeline({
    snapshotRows: [point('2026-10-01T12:00:00Z', { home: 52, draw: 27, away: 21 }, { confidence: 66 })],
    match,
  });
  assert.equal(timeline.points.length, 1);
  assert.equal(timeline.points[0].leader.key, 'home');
  assert.equal(timeline.points[0].delta.value, null);
  const html = renderAiTimelineCompact(timeline, match);
  assert.match(html, /Хозяева · 52\.0%/);
  assert.doesNotMatch(html, /\+0\.0 п\.п\./);
});

test('AI Timeline: multiple points are chronological and show base plus delta', () => {
  const timeline = buildAiTimeline({
    snapshotRows: [
      point('2026-10-01T17:00:00Z', { home: 57, draw: 25, away: 18 }),
      point('2026-10-01T12:00:00Z', { home: 52, draw: 27, away: 21 }),
      point('2026-10-01T17:30:00Z', { home: 61, draw: 23, away: 16 }),
    ],
    match,
  });
  assert.deepEqual(timeline.points.map(x => x.probabilities.home), [52,57,61]);
  assert.equal(timeline.points[1].delta.previousProbability, 52);
  assert.equal(timeline.points[1].delta.value, 5);
  const html = renderAiTimelineCompact(timeline, match);
  assert.match(html, /57\.0% → 61\.0%/);
  assert.match(html, /↑ \+4\.0 п\.п\./);
});

test('AI Timeline: duplicate timestamps are deduplicated deterministically', () => {
  const model = normalizeAiTimeline({
    points: [
      { capturedAt:'2026-10-01T12:00:00Z', probabilities:{home:52,draw:27,away:21}, source:'model_predictions' },
      { capturedAt:'2026-10-01T12:00:00Z', probabilities:{home:53,draw:26,away:21}, source:'analysis_timeline_snapshots' },
    ],
  }, match);
  assert.equal(model.points.length, 1);
  assert.equal(model.points[0].probabilities.home, 53);
  assert.equal(model.points[0].source, 'analysis_timeline_snapshots');
});

test('AI Timeline: near-identical immutable prediction and timeline capture do not double count', () => {
  const timeline = buildAiTimeline({
    snapshotRows: [point('2026-10-01T12:00:30Z', {home:52,draw:27,away:21})],
    modelPrediction: {
      fixture_id:42,
      captured_at:'2026-10-01T12:00:00Z',
      kickoff_at:match.date,
      home_prob:52,draw_prob:27,away_prob:21,
    },
    match,
  });
  assert.equal(timeline.points.length, 1);
  assert.notEqual(timeline.points[0].source, 'model_predictions');
});

test('AI Timeline: confirmed lineup change uses temporal wording, not causal claim', () => {
  const trigger = timelineTriggerFromDelta({ codes:['lineups'] });
  assert.equal(trigger.relation, 'confirmed');
  assert.equal(trigger.category, 'lineup');
  assert.match(trigger.explanation, /После подтверждения состава/);
  assert.doesNotMatch(trigger.explanation, /из-за|привел|вызвал/i);

  const row = analysisTimelineSnapshotRow({
    generatedAt:'2026-10-01T17:05:00Z',
    analysisVersion:'test',
    match:{fixtureId:42,date:match.date,status:'NS'},
    probabilities:{home:57,draw:25,away:18},
    confidence:{score:71},
    completeness:{score:8,max:10},
    dataProvenance:{primaryProvider:'api-football',features:{}},
  }, { delta:{ codes:['lineups'] } });
  assert.equal(row.trigger_category, 'lineup');
  assert.equal(row.causal_relation, 'confirmed');
});

test('AI Timeline: red card is correlation only when a saved model point follows it', () => {
  const timeline = buildAiTimeline({
    snapshotRows: [
      point('2026-10-01T18:10:00Z', {home:55,draw:27,away:18}, {minute:10}),
      point('2026-10-01T18:25:00Z', {home:73,draw:18,away:9}, {minute:25}),
    ],
    events:[{minute:20,type:'Card',detail:'Red Card',teamName:'Гости'}],
    match,
  });
  assert.equal(timeline.points[1].trigger.relation, 'correlated');
  assert.equal(timeline.points[1].trigger.category, 'event');
  assert.match(timeline.points[1].trigger.explanation, /совпало/i);
  assert.match(timeline.points[1].trigger.explanation, /Причинность не подтверждена/i);
  assert.doesNotMatch(timeline.points[1].trigger.explanation, /из-за красной|красная карточка вызвала/i);
});

test('AI Timeline: odds move is explicitly correlated, not claimed as cause', () => {
  const trigger = timelineTriggerFromDelta({ codes:['market'] });
  assert.equal(trigger.relation, 'correlated');
  assert.equal(trigger.category, 'odds_move');
  assert.match(trigger.explanation, /совпало/i);
  assert.match(trigger.explanation, /Причинность не подтверждена/i);
});

test('AI Timeline: market snapshots stay separate from AI probability points', () => {
  const timeline = buildAiTimeline({
    snapshotRows:[point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21})],
    oddsSnapshots:[
      {at:'2026-10-01T11:00:00Z',homeProb:48,drawProb:29,awayProb:23,sources:4},
      {at:'2026-10-01T17:00:00Z',homeProb:55,drawProb:26,awayProb:19,sources:5},
    ],
    match,
  });
  assert.equal(timeline.points.length,1);
  assert.equal(timeline.marketContext.length,2);
  const html=renderAiTimelineDetails(timeline,match);
  assert.match(html,/Это сохранённые рыночные вероятности, а не точки AI-модели/);
});

test('AI Timeline: stale snapshot and missing confidence remain explicit', () => {
  const timeline = buildAiTimeline({
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

test('AI Timeline: incorrect input order is corrected and long Russian text is escaped', () => {
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

test('AI Timeline: no causal evidence stays model-driven', () => {
  const timeline=buildAiTimeline({
    snapshotRows:[
      point('2026-10-01T12:00:00Z',{home:52,draw:27,away:21}),
      point('2026-10-01T13:00:00Z',{home:54,draw:26,away:20}),
    ],
    events:[],
    match,
  });
  assert.equal(timeline.points[1].trigger.relation,'model_driven');
  assert.match(timeline.points[1].trigger.explanation,/Модель переоценила матч/);
});

test('AI Timeline persistence is server-only and append-only for the application', () => {
  const sql=fs.readFileSync(new URL('../supabase/migrations/supabase_migration_v6_22.sql',import.meta.url),'utf8').toLowerCase();
  assert.match(sql,/create table if not exists public\.analysis_timeline_snapshots/);
  assert.match(sql,/alter table public\.analysis_timeline_snapshots enable row level security/);
  assert.match(sql,/revoke all on table public\.analysis_timeline_snapshots from public, anon, authenticated, service_role/);
  assert.match(sql,/grant select, insert on table public\.analysis_timeline_snapshots to service_role/);
  assert.doesNotMatch(sql,/grant[^;]*(update|delete)[^;]*analysis_timeline_snapshots/i);
  assert.match(sql,/table_name not in \('provider_incident_alert_deliveries','analysis_timeline_snapshots'\)/);
});

test('AI Timeline integration does not add provider requests and preserves Match Pulse ordering', () => {
  const worker=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  const helper=worker.slice(worker.indexOf('async function loadFixtureAiTimeline'),worker.indexOf('async function captureModelPrediction'));
  assert.ok(helper.length>0);
  assert.doesNotMatch(helper,/apiFootball\(|providerFeatureFetch\(|loadProviderFixture\(/);
  assert.match(worker,/captureAnalysisTimelineSnapshot\(payload, cfg, \{ delta: effectiveRecheckDelta \}\)/);
  assert.match(worker,/id: 'ai_timeline_snapshots'/);

  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/import\('\.\/modules\/ai-timeline\.js'\)/);
  const pulse=app.indexOf('matchCenterExtras?.renderMatchPulse?.(d)');
  const timeline=app.indexOf('matchCenterExtras?.renderAiTimelineCompact?.(d.aiTimeline || {}, m)');
  assert.ok(pulse>=0 && timeline>pulse,'AI Timeline must be rendered after existing Match Pulse');
});

test('AI Timeline styles cover required narrow mobile widths', () => {
  const css=fs.readFileSync(new URL('../public/styles/public-shell.css',import.meta.url),'utf8');
  const section=css.slice(css.indexOf('/* AI Timeline — Issue #287 */'));
  for (const width of [430,390,360,320]) assert.match(section,new RegExp('@media\\(max-width:'+width+'px\\)'));
});
