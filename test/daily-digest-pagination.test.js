import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  assert.notEqual(a,-1,start);
  const b=source.indexOf(end,a+start.length);
  assert.notEqual(b,-1,end);
  return source.slice(a,b);
}

test('daily digest reads active subscriptions through bounded pagination instead of a 1000-row single page',()=>{
  const load=block(worker,'async function loadBotDigestSubscriptions','async function claimDigestDelivery');
  assert.match(load,/supaSelectPaged\(cfg,'bot_digest_subscriptions'/);
  assert.match(load,/pageSize:500/);
  assert.match(load,/maxRows:10000/);
  assert.match(load,/order:'telegram_id\.asc'/);
  assert.doesNotMatch(load,/supaSelectMany\(cfg,'bot_digest_subscriptions'.*limit:1000/);
});

test('daily digest surfaces scan truncation instead of silently dropping subscribers',()=>{
  const process=block(worker,'async function processDailyDigests','function telegramHtmlEscape');
  assert.match(process,/DIGEST_SUBSCRIPTIONS_TRUNCATED/);
  assert.match(process,/subscriptionPage\.truncated/);
  assert.match(process,/cap:DAILY_DIGEST_POLICY\.scanCap/);
  assert.match(process,/truncated:Boolean\(subscriptionPage\.truncated\)/);\n  assert.match(process,/runBoundedDailyDigest/);\n  assert.match(process,/maxRecipients:DAILY_DIGEST_POLICY\.maxRecipientsPerRun/);\n  assert.match(process,/concurrency:DAILY_DIGEST_POLICY\.concurrency/);
});
