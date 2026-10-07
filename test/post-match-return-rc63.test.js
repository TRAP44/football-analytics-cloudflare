import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const returns=fs.readFileSync('src/post-match-return-runtime.js','utf8');
const telegram=fs.readFileSync('src/telegram-update-orchestration.js','utf8');
const scheduled=fs.readFileSync('src/scheduled-jobs.js','utf8');

test('RC63 selects only analyzed matches old enough to be finished',()=> {
  assert.match(returns,/function postMatchReturnEligibility\(/);
  assert.match(returns,/POST_MATCH_RETURN_MIN_DELAY_MINUTES = 105/);
  assert.match(returns,/POST_MATCH_RETURN_MAX_AGE_HOURS = 18/);
  assert.match(returns,/status \|\| ''\)==='settled'/);
});

test('return message compares pre-match model with final fact',()=> {
  assert.match(returns,/function postMatchReturnMessage\(/);
  assert.match(returns,/Матч завершён · MatchRadar AI/);
  assert.match(returns,/Исход модели/);
  assert.match(returns,/Открыть итог AI/);
  assert.match(returns,/match:return_review:/);
});

test('delivery is persistent, deduped and can recover stale claims',()=> {
  assert.match(returns,/function postMatchReturnDeliveryKey\(/);
  assert.match(returns,/async function claimPostMatchReturnDelivery\(/);
  assert.match(returns,/resolution=ignore-duplicates,return=representation/);
  assert.match(returns,/prior\?\.payload\?\.state==='claimed'/);
  assert.match(returns,/async function finishPostMatchReturnClaim\(/);
});

test('return loop protects provider quota and user attention',()=> {
  assert.match(returns,/POST_MATCH_RETURN_COOLDOWN_MINUTES = 30/);
  assert.match(returns,/freeQuotaHealthy\(15,2\)/);
  assert.match(returns,/postmatch:return:disabled/);
  assert.match(returns,/postmatch:return:cooldown/);
  assert.match(returns,/sentUsers\.has\(userId\)/);
});

test('Telegram supports return open and reversible opt-out',()=> {
  assert.match(telegram,/postmatch:return:off/);
  assert.match(telegram,/postmatch:return:on/);
  assert.match(telegram,/match:return_review/);
  assert.match(telegram,/post_match_return_open/);
  assert.match(returns,/post_match_return_sent/);
});

test('cron chains return loop after settlement task',()=> {
  assert.match(scheduled,/const postMatchPrerequisite = dailyDigestTask/);
  assert.match(scheduled,/\['post_match_return', postMatchPrerequisite\.then\(\(\) => run\('post_match_return', \(\) => processPostMatchReturns\(cfg\)\)\)\]/);
});

test('RC63 deterministic drill and health contract are present',()=> {
  assert.match(returns,/function postMatchReturnDrill\(/);
  assert.match(worker,/postMatchReturnSelfTest: postMatchReturnDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['postMatchReturnLoop','analyzedMatchReturn','postMatchReturnDedupe','postMatchReturnOptOut','postMatchReturnQuotaGuard']) {
    assert.ok(worker.includes(flag + ": 'enabled'"), 'missing ' + flag);
  }
});