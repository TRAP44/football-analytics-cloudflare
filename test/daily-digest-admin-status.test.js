import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  summarizeDailyDigestOperationalStatus,
} from '../src/daily-digest-incidents.js';
import { createReleaseMonitorApiRuntime } from '../src/release-monitor-api-runtime.js';

const DATE='2026-09-29';

function digestEvent(at, code, metadata = {}, severity = 'info') {
  return {
    created_at:at,
    severity,
    source:'telegram',
    event_type:'daily_digest',
    code,
    metadata:{date:DATE,...metadata},
  };
}

function releaseMonitorHarness({
  hasSupabase=()=>false,
  fetchWithTimeout=async()=>{ throw new Error('unexpected fetch'); },
  memoryOps=[],
}={}) {
  const memory={opsEvents:[...memoryOps],releaseMonitor:null};
  const runtime=createReleaseMonitorApiRuntime({
    APP_VERSION:'6.120.0',
    RC_NAME:'RC144',
    assessDailyDigestReliabilitySlo:()=>({state:'collecting'}),
    buildPostDeployRegressionSloDashboard:()=>({}),
    currentReleaseIdentity:()=>({deploySha:'a'.repeat(40)}),
    fetchWithTimeout,
    hasSupabase,
    json:(body,status=200)=>({body,status}),
    memory,
    planPostDeployRegressionResponseTransition:()=>({action:'none'}),
    readProviderIncidentAlertDeliveries:async()=>({items:[],persistent:false}),
    recordOpsEvent:async()=>null,
    redactOpsString:value=>String(value ?? ''),
    releaseMonitorHealth:()=>({state:'healthy'}),
    summarizeDailyDigestOperationalStatus,
    summarizeDailyDigestReliability:()=>({}),
    summarizePostDeployRegressionResponse:()=>({}),
    summarizeReleaseWindow:()=>({
      errorLike:0,
      warningLike:0,
      client:{clientErrors:0,bootRecovery:0},
    }),
    supaHeaders:()=>({}),
    telemetrySnapshot:()=>({}),
  });
  return {runtime,memory};
}

test('daily digest operational status summarizes the latest run without user identifiers',()=>{
  const rows=[
    digestEvent(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{
      scanned:5000,eligible:1200,claimed:1000,sent:990,failed:2,
      rateLimited:3,deferred:210,remaining:210,backlog:210,
      sealedClaims:1,expiredClaims:2,recoveredClaims:2,
      completionRate:0.99,oldestActiveClaimAgeMs:420000,duration:103000,
      telegram_id:123456789,
      chat_id:987654321,
    },'warning'),
  ];
  const ledger=[{
    incident_id:'digest-'+DATE,
    alert_key:'digest-'+DATE+':incident',
    destination_key:'digest-admin-private-key',
    status:'sent',
    attempts:1,
    created_at:`${DATE}T07:51:00Z`,
    updated_at:`${DATE}T07:51:05Z`,
  }];

  const status=summarizeDailyDigestOperationalStatus(
    rows,
    ledger,
    {nowMs:Date.parse(`${DATE}T07:52:00Z`)},
  );

  assert.equal(status.available,true);
  assert.equal(status.state,'incident');
  assert.equal(status.latestRun.sent,990);
  assert.equal(status.latestRun.remaining,210);
  assert.equal(status.latestRun.sealedClaims,1);
  assert.equal(status.latestRun.completionRate,0.99);
  assert.equal(status.incident.active,true);
  assert.equal(status.incident.incidentId,'digest-'+DATE);
  assert.equal(status.alertDelivery.states.sent,1);
  assert.equal(status.alertDelivery.rows,1);

  const serialized=JSON.stringify(status);
  assert.doesNotMatch(serialized,/123456789|987654321|digest-admin-private-key/);
  assert.equal('telegram_id' in status.latestRun,false);
  assert.equal('chat_id' in status.latestRun,false);
});

test('healthy follow-up exposes recovery and clears active incident state',()=>{
  const rows=[
    digestEvent(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:8},'warning'),
    digestEvent(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{
      scanned:100,eligible:8,claimed:8,sent:8,remaining:0,
      completionRate:1,duration:1200,
    }),
  ];

  const status=summarizeDailyDigestOperationalStatus(
    rows,
    [],
    {nowMs:Date.parse(`${DATE}T08:00:00Z`)},
  );

  assert.equal(status.state,'healthy');
  assert.equal(status.incident.active,false);
  assert.equal(status.incident.lastRecoveryAt,`${DATE}T07:55:00.000Z`);
  assert.equal(status.latestRun.remaining,0);
  assert.equal(status.latestRun.completionRate,1);
});

test('future, impossible and non-digest rows cannot overwrite current digest status',()=>{
  const now=Date.parse(`${DATE}T08:00:00Z`);
  const rows=[
    digestEvent(`${DATE}T07:50:00Z`,'DAILY_DIGEST_BACKLOG_LATE',{remaining:8},'warning'),
    digestEvent(`${DATE}T08:30:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0,completionRate:1}),
    {
      ...digestEvent(`${DATE}T07:59:00Z`,'DAILY_DIGEST_RUN_OK',{remaining:0,completionRate:1}),
      source:'monitor',
      event_type:'production_monitor',
    },
    digestEvent('2026-02-30T07:59:00Z','DAILY_DIGEST_RUN_OK',{remaining:0,completionRate:1}),
  ];

  const status=summarizeDailyDigestOperationalStatus(rows,[],{nowMs:now});

  assert.equal(status.state,'incident');
  assert.equal(status.latestRun.code,'DAILY_DIGEST_BACKLOG_LATE');
  assert.equal(status.latestRun.at,`${DATE}T07:50:00.000Z`);
  assert.equal(status.incident.active,true);
});

test('boolean and out-of-range metadata cannot fabricate healthy delivery metrics',()=>{
  const status=summarizeDailyDigestOperationalStatus([
    digestEvent(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{
      scanned:true,
      eligible:false,
      claimed:true,
      sent:true,
      failed:false,
      remaining:false,
      sealedClaims:true,
      completionRate:true,
      oldestActiveClaimAgeMs:true,
      duration:true,
    }),
  ],[],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});

  assert.equal(status.state,'healthy');
  assert.equal(status.latestRun.scanned,0);
  assert.equal(status.latestRun.eligible,0);
  assert.equal(status.latestRun.claimed,0);
  assert.equal(status.latestRun.sent,0);
  assert.equal(status.latestRun.sealedClaims,0);
  assert.equal(status.latestRun.completionRate,null);
  assert.equal(status.latestRun.oldestActiveClaimAgeMs,0);
  assert.equal(status.latestRun.durationMs,0);

  const invalidRate=summarizeDailyDigestOperationalStatus([
    digestEvent(`${DATE}T07:55:00Z`,'DAILY_DIGEST_RUN_OK',{
      completionRate:1.5,
    }),
  ],[],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});
  assert.equal(invalidRate.latestRun.completionRate,null);
});

test('no digest events returns an explicit collecting snapshot',()=>{
  const status=summarizeDailyDigestOperationalStatus(
    [],
    [],
    {nowMs:Date.parse(`${DATE}T08:00:00Z`)},
  );
  assert.equal(status.available,false);
  assert.equal(status.state,'collecting');
  assert.equal(status.latestRun,null);
  assert.equal(status.alertDelivery.rows,0);
});

test('malformed Supabase digest history fails back to local evidence instead of claiming persistence',async()=>{
  const local=digestEvent(
    `${DATE}T07:50:00Z`,
    'DAILY_DIGEST_BACKLOG_LATE',
    {remaining:5},
    'warning',
  );
  const {runtime}=releaseMonitorHarness({
    hasSupabase:()=>true,
    memoryOps:[local],
    fetchWithTimeout:async()=>({
      ok:true,
      json:async()=>({unexpected:'object'}),
    }),
  });

  const result=await runtime.readDailyDigestOpsEvents(
    {supabaseUrl:'https://example.supabase.co'},
    `${DATE}T00:00:00.000Z`,
    '2026-09-30T00:00:00.000Z',
    'garbage',
  );

  assert.equal(result.persistent,false);
  assert.equal(result.migrationReady,false);
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].code,'DAILY_DIGEST_BACKLOG_LATE');
  assert.equal(result.truncated,false);
});

test('release monitor defaults malformed query windows instead of producing invalid dates',async()=>{
  const {runtime}=releaseMonitorHarness();

  const response=await runtime.apiReleaseMonitor(
    new Request('https://example.test/api/release-monitor?hours=garbage&digestDays=garbage'),
    {},
  );

  assert.equal(response.status,200);
  assert.equal(response.body.hours,24);
  assert.equal(response.body.digestDays,7);
  assert.equal(response.body.dailyDigest.available,false);
});

test('admin release monitor keeps the Daily Digest block aggregate-only',()=>{
  const html=fs.readFileSync('public/admin.html','utf8');
  const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');
  const start=releaseMonitor.indexOf("const dd = r.dailyDigest || {};");
  const end=releaseMonitor.indexOf("const codes = c.topCodes || [];",start);

  assert.match(html,/id="releaseMonitorDigest"/);
  assert.ok(start>=0 && end>start);

  const block=releaseMonitor.slice(start,end);
  assert.match(block,/📨 Daily Digest/);
  assert.match(block,/Sealed claims/);
  assert.match(block,/Alert delivery/);
  assert.match(block,/completion/);
  assert.match(block,/remaining/);
  assert.match(block,/sealedClaims/);
  assert.doesNotMatch(block,/telegram_id|chat_id|user_id|destination_key/i);
});
