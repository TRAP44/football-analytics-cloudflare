import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeDailyDigestOperationalStatus } from '../src/daily-digest-incidents.js';

const DATE='2026-09-29';

function digestEvent(at, code, metadata = {}, severity = 'info') {
  return {
    created_at: at,
    severity,
    source: 'telegram',
    event_type: 'daily_digest',
    code,
    metadata: { date: DATE, ...metadata },
  };
}

test('daily digest operational status summarizes the latest run without user identifiers', () => {
  const rows = [
    digestEvent(`${DATE}T07:50:00Z`, 'DAILY_DIGEST_BACKLOG_LATE', {
      scanned:5000, eligible:1200, claimed:1000, sent:990, failed:2,
      rateLimited:3, deferred:210, remaining:210, backlog:210,
      sealedClaims:1, expiredClaims:2, recoveredClaims:2,
      completionRate:0.99, oldestActiveClaimAgeMs:420000, duration:103000,
    }, 'warning'),
  ];
  const ledger = [{
    incident_id:'digest-'+DATE,
    alert_key:'digest-'+DATE+':incident',
    destination_key:'digest-admin-1',
    status:'sent',
    attempts:1,
    created_at:`${DATE}T07:51:00Z`,
    updated_at:`${DATE}T07:51:05Z`,
  }];

  const status=summarizeDailyDigestOperationalStatus(rows,ledger,{nowMs:Date.parse(`${DATE}T07:52:00Z`)});

  assert.equal(status.available,true);
  assert.equal(status.state,'incident');
  assert.equal(status.latestRun.sent,990);
  assert.equal(status.latestRun.remaining,210);
  assert.equal(status.latestRun.sealedClaims,1);
  assert.equal(status.latestRun.completionRate,0.99);
  assert.equal(status.incident.active,true);
  assert.equal(status.incident.incidentId,'digest-'+DATE);
  assert.equal(status.alertDelivery.states.sent,1);
  assert.equal('telegram_id' in status.latestRun,false);
  assert.equal('chat_id' in status.latestRun,false);
});

test('healthy follow-up exposes recovery and clears active incident state', () => {
  const rows = [
    digestEvent(`${DATE}T07:50:00Z`, 'DAILY_DIGEST_BACKLOG_LATE', { remaining:8 }, 'warning'),
    digestEvent(`${DATE}T07:55:00Z`, 'DAILY_DIGEST_RUN_OK', {
      scanned:100, eligible:8, claimed:8, sent:8, remaining:0,
      completionRate:1, duration:1200,
    }, 'info'),
  ];

  const status=summarizeDailyDigestOperationalStatus(rows,[],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});
  assert.equal(status.state,'healthy');
  assert.equal(status.incident.active,false);
  assert.equal(status.incident.lastRecoveryAt,`${DATE}T07:55:00.000Z`);
  assert.equal(status.latestRun.remaining,0);
  assert.equal(status.latestRun.completionRate,1);
});

test('no digest events returns an explicit collecting snapshot', () => {
  const status=summarizeDailyDigestOperationalStatus([],[],{nowMs:Date.parse(`${DATE}T08:00:00Z`)});
  assert.equal(status.available,false);
  assert.equal(status.state,'collecting');
  assert.equal(status.latestRun,null);
  assert.equal(status.alertDelivery.rows,0);
});

test('admin release monitor contract includes Daily Digest block and backend payload', () => {
  const html=fs.readFileSync('public/admin.html','utf8');
  const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');
  const worker=fs.readFileSync('src/worker.js','utf8');

  assert.match(html,/id="releaseMonitorDigest"/);
  assert.match(releaseMonitor,/const digest = \$\('releaseMonitorDigest'\)/);
  assert.match(releaseMonitor,/📨 Daily Digest/);
  assert.match(releaseMonitor,/Sealed claims/);
  assert.match(releaseMonitor,/Alert delivery/);
  assert.match(worker,/summarizeDailyDigestOperationalStatus/);
  assert.match(worker,/dailyDigest,/);
});

test('admin digest status rendering stays aggregate-only', () => {
  const releaseMonitor=fs.readFileSync('public/modules/admin-release-monitor.js','utf8');
  const start=releaseMonitor.indexOf("const dd = r.dailyDigest || {};");
  const end=releaseMonitor.indexOf("const codes = c.topCodes || [];",start);
  assert.ok(start>=0 && end>start);
  const block=releaseMonitor.slice(start,end);
  assert.doesNotMatch(block,/telegram_id|chat_id|user_id/i);
  assert.match(block,/completion/);
  assert.match(block,/remaining/);
  assert.match(block,/sealedClaims/);
});
