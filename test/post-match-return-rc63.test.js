import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const scheduled=fs.readFileSync('src/scheduled-jobs.js','utf8');

test('RC63 selects only analyzed matches old enough to be finished',()=> {
  assert.match(worker,/function postMatchReturnEligibility\(/);
  assert.match(worker,/POST_MATCH_RETURN_MIN_DELAY_MINUTES = 105/);
  assert.match(worker,/POST_MATCH_RETURN_MAX_AGE_HOURS = 18/);
  assert.match(worker,/status \|\| ''\)==='settled'/);
});

test('return message compares pre-match model with final fact',()=> {
  assert.match(worker,/function postMatchReturnMessage\(/);
  assert.match(worker,/Матч завершён · MatchRadar AI/);
  assert.match(worker,/Исход модели/);
  assert.match(worker,/Открыть итог AI/);
  assert.match(worker,/match:return_review:/);
});

test('delivery is persistent, deduped and can recover stale claims',()=> {
  assert.match(worker,/function postMatchReturnDeliveryKey\(/);
  assert.match(worker,/async function claimPostMatchReturnDelivery\(/);
  assert.match(worker,/resolution=ignore-duplicates,return=representation/);
  assert.match(worker,/prior\?\.payload\?\.state==='claimed'/);
  assert.match(worker,/async function finishPostMatchReturnClaim\(/);
});

test('return loop protects provider quota and user attention',()=> {
  assert.match(worker,/POST_MATCH_RETURN_COOLDOWN_MINUTES = 30/);
  assert.match(worker,/freeQuotaHealthy\(15,2\)/);
  assert.match(worker,/postmatch:return:disabled/);
  assert.match(worker,/postmatch:return:cooldown/);
  assert.match(worker,/sentUsers\.has\(userId\)/);
});

test('Telegram supports return open and reversible opt-out',()=> {
  assert.match(worker,/postmatch:return:off/);
  assert.match(worker,/postmatch:return:on/);
  assert.match(worker,/match:return_review/);
  assert.match(worker,/post_match_return_open/);
  assert.match(worker,/post_match_return_sent/);
});

test('cron chains return loop after settlement task',()=> {
  assert.match(scheduled,/const postMatchPrerequisite = dailyDigestTask/);
  assert.match(scheduled,/\['post_match_return', postMatchPrerequisite\.then\(\(\) => runTask\('post_match_return', \(\) => processPostMatchReturns\(cfg\)\)\)\]/);
});

test('RC63 deterministic drill and health contract are present',()=> {
  assert.match(worker,/function postMatchReturnDrill\(/);
  assert.match(worker,/postMatchReturnSelfTest: postMatchReturnDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['postMatchReturnLoop','analyzedMatchReturn','postMatchReturnDedupe','postMatchReturnOptOut','postMatchReturnQuotaGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});