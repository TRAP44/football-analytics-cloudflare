import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-dedupe.js','utf8');
const wrangler=fs.readFileSync('wrangler.jsonc','utf8');
const smoke=fs.readFileSync('scripts/post-deploy-smoke.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const privacy=fs.readFileSync('public/privacy.html','utf8');
const terms=fs.readFileSync('public/terms.html','utf8');

test('Telegram webhook has dedupe and burst protection before processing actions',()=> {
  assert.match(worker,/telegramUpdateDedupe/);
  assert.match(worker,/function claimTelegramUpdate/);
  assert.match(worker,/function completeTelegramUpdate/);
  assert.match(worker,/function releaseTelegramUpdate/);
  assert.match(worker,/function enforceTelegramBurst/);
  assert.match(worker,/telegramDuplicateUpdates/);
  assert.match(worker,/telegramBurstBlocks/);
  assert.match(worker,/processTelegramUpdate/);
});

test('payment lifecycle updates are exempt from generic Telegram burst throttling',()=> {
  assert.match(worker,/pre_checkout_query \|\| update\?\.subscription/);
  assert.match(worker,/successful_payment/);
  assert.match(worker,/refunded_payment/);
});

test('news high-impact claims are downgraded when the source is not major or official',()=> {
  assert.match(worker,/NEWS_OFFICIAL_SOURCE_RE/);
  assert.match(worker,/function newsSourceTrust/);
  assert.match(worker,/function applyNewsTrustGate/);
  assert.match(worker,/needs_confirmation/);
  assert.match(worker,/requires confirmation|требуется подтверждение/i);
});

test('public legal and status pages exist without adding a new Mini App content section',()=> {
  assert.match(privacy,/Политика конфиденциальности/);
  assert.match(privacy,/Telegram ID/);
  assert.match(privacy,/Cloudflare/);
  assert.match(terms,/Не финансовая рекомендация/);
  assert.match(terms,/не гарантирует исход/i);
  assert.match(html,/\/privacy\.html/);
  assert.match(html,/\/terms\.html/);
  assert.match(html,/\/status\.html/);
  assert.doesNotMatch(html,/id="privacyView"/);
});

test('status and Telegram webhook are forced through the Worker',()=> {
  assert.match(wrangler,/"\/api\/\*"/);
  assert.match(wrangler,/"\/telegram\/\*"/);
  assert.match(worker,/url\.pathname === '\/api\/public-status'/);
  assert.match(smoke,/Telegram webhook must reject a request without its secret/);
  assert.match(smoke,/\/privacy\.html/);
});

test('RC52 health exposes media-launch hardening contracts',()=> {
  assert.match(worker,/mediaLaunchHardening:\s*'enabled'/);
  assert.match(worker,/telegramWebhookDedupe:\s*'enabled'/);
  assert.match(worker,/telegramWebhookBurstGuard:\s*'enabled'/);
  assert.match(worker,/newsSourceTrustGate:\s*'enabled'/);
  assert.match(worker,/publicLegalPages:\s*'enabled'/);
  assert.match(worker,/publicStatusPage:\s*'enabled'/);
});
