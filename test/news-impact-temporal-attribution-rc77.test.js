import { workerRuntime } from '../test-support/worker-root.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

function runtime() {
  return createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:new Set(['full_ai','market','share']),
    NEWS_IMPACT_ACTION_LABELS:{full_ai:'Полный AI',market:'Рынок',share:'Поделиться'},
    NEWS_IMPACT_ACTION_WINDOW_MINUTES:30,
    NEWS_IMPACT_DECISION_CODES:new Set(['material','stable']),
    NEWS_IMPACT_FUNNEL_DECISIONS:[['material','Существенное изменение'],['stable','Стабильно']],
    NEWS_IMPACT_FUNNEL_MIN_USERS:10,
    NEWS_IMPACT_FUNNEL_STABLE_USERS:30,
  });
}

test('RC77 uses a 30-minute post-decision attribution window and rejects coercive overrides',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const rows=r.buildNewsImpactActionFunnel([
    {telegram_id:'1',fixture_id:'101',created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
  ],[
    {telegram_id:'1',fixture_id:'101',created_at:'2026-09-23T10:30:00Z',metadata:{decision:'material',action:'market'}},
  ],{asOfMs,actionWindowMinutes:true});
  const material=rows.find(row=>row.code==='material');
  assert.equal(material.actionWindowMinutes,30);
  assert.equal(material.actedUsers,1);
  assert.match(recovery,/const actionWindowMs=actionWindowMinutes\*60_000/);
});

test('RC77 excludes immature decisions and actions outside the as-of boundary',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const material=r.buildNewsImpactActionFunnel([
    {telegram_id:1,fixture_id:101,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
    {telegram_id:2,fixture_id:202,created_at:'2026-09-23T11:50:00Z',metadata:{decision:'material'}},
  ],[
    {telegram_id:1,fixture_id:101,created_at:'2026-09-23T12:01:00Z',metadata:{decision:'material',action:'market'}},
    {telegram_id:2,fixture_id:202,created_at:'2026-09-23T11:55:00Z',metadata:{decision:'material',action:'share'}},
  ],{asOfMs}).find(row=>row.code==='material');

  assert.equal(material.observedUsers,2);
  assert.equal(material.users,1);
  assert.equal(material.immatureUsers,1);
  assert.equal(material.actedUsers,0);
});

test('RC77 attribution is fixture-scoped and rejects pre-decision or late actions',()=>{
  const r=runtime();
  const asOfMs=Date.parse('2026-09-23T12:00:00Z');
  const material=r.buildNewsImpactActionFunnel([
    {telegram_id:1,fixture_id:101,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
    {telegram_id:2,fixture_id:202,created_at:'2026-09-23T10:00:00Z',metadata:{decision:'material'}},
  ],[
    {telegram_id:1,fixture_id:101,created_at:'2026-09-23T09:59:00Z',metadata:{decision:'material',action:'market'}},
    {telegram_id:1,fixture_id:999,created_at:'2026-09-23T10:10:00Z',metadata:{decision:'material',action:'share'}},
    {telegram_id:1,fixture_id:101,created_at:'2026-09-23T10:10:00Z',metadata:{decision:'material',action:'market'}},
    {telegram_id:2,fixture_id:202,created_at:'2026-09-23T10:45:00Z',metadata:{decision:'material',action:'full_ai'}},
  ],{asOfMs}).find(row=>row.code==='material');

  assert.equal(material.users,2);
  assert.equal(material.actedUsers,1);
  assert.equal(material.topAction?.action,'market');
  assert.equal(material.actions.some(row=>row.action==='share'),false);
  assert.equal(material.actions.some(row=>row.action==='full_ai'),false);
});

test('RC77 previous-period cohort keeps follow-up actions that cross the period boundary',()=>{
  const r=runtime();
  const periodEndMs=Date.parse('2026-09-23T11:00:00Z');
  const previousAttributionAsOfMs=periodEndMs+30*60_000;
  const material=r.buildNewsImpactActionFunnel([
    {telegram_id:7,fixture_id:700,created_at:'2026-09-23T10:59:50Z',metadata:{decision:'material'}},
  ],[
    {telegram_id:7,fixture_id:700,created_at:'2026-09-23T11:00:10Z',metadata:{decision:'material',action:'market'}},
  ],{asOfMs:previousAttributionAsOfMs}).find(row=>row.code==='material');

  assert.equal(material.users,1);
  assert.equal(material.actedUsers,1);

  assert.match(growth,/previousNewsImpactRows=previousWindowRows\.filter/);
  assert.match(growth,/previousNewsImpactActionRows=comparisonRows\.filter/);
  assert.match(growth,/previousPeriodEndMs\+NEWS_IMPACT_ACTION_WINDOW_MINUTES\*60_000/);
  assert.match(growth,/asOfMs:previousAttributionAsOfMs/);
});

test('RC77 admin UI explains maturity and attribution',()=>{
  assert.match(app,/impactAttributionGuard=d\.newsImpactActionAttributionGuard/);
  assert.match(app,/Атрибуция действий/);
  assert.match(app,/решения младше/);
  assert.match(app,/свежих решений ещё не вошли/);
});

test('RC77 deterministic runtime drill covers pre-decision, late and cross-fixture actions',()=>{
  const r=runtime();
  const result=r.newsImpactTemporalAttributionDrill();
  assert.equal(result.pass,true);
  assert.ok(result.cases>=7);
  assert.match(recovery,/2026-09-23T09:59:00Z/);
  assert.match(recovery,/2026-09-23T10:45:00Z/);
  assert.match(recovery,/fixture_id:999/);
  assert.match(worker,/function newsImpactTemporalAttributionDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactTemporalAttributionDrill/s);
  assert.equal(workerRuntime.getNewsImpactRecoveryRuntime().newsImpactTemporalAttributionDrill().pass,true);
});

test('RC77 needs no new Supabase migration',()=>{
  const files=fs.readdirSync('supabase/migrations').filter(x=>/^supabase_migration_v6_\d/.test(x));
  assert.ok(files.includes('supabase_migration_v6_15.sql'));
  assert.ok(!files.some(x=>/rc77/i.test(x)));
});
