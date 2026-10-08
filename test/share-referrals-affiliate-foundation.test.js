import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeReferralCode,
  opaqueReferralCode,
  referralAttributionDecision,
  splitLaunchReferralParts,
} from '../src/referral-attribution.js';
import { createTelegramLinksRuntime } from '../src/telegram-links.js';

const growthReferral=fs.readFileSync('src/growth-referral.js','utf8');
const backendSource=(fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/telegram-update-orchestration.js','utf8'))+'\n'+growthReferral;

function cleanLaunchPart(value, maxLength = 24) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,maxLength);
}

function linksRuntime() {
  return createTelegramLinksRuntime({
    cleanLaunchPart,
    getCache:async()=>null,
    setCache:async()=>{},
    telegramApi:async()=>({id:202,username:'MatchRadarAIBot'}),
  });
}

test('referral code normalization rejects non-string coercion and preserves canonical strings', () => {
  assert.equal(normalizeReferralCode(' A1B2C3D4E5F60708 '),'a1b2c3d4e5f60708');
  assert.equal(normalizeReferralCode(true),'');
  assert.equal(normalizeReferralCode(['a1b2c3d4e5f60708']),'');
  assert.equal(normalizeReferralCode({toString:()=> 'a1b2c3d4e5f60708'}),'');
});

test('opaque referral code requires strict positive user identity and bounded string secret', async () => {
  assert.equal(await opaqueReferralCode(true,'test-bot-secret'),'');
  assert.equal(await opaqueReferralCode([123],'test-bot-secret'),'');
  assert.match(await opaqueReferralCode('123','test-bot-secret'),/^[a-f0-9]{16}$/);
  assert.equal(await opaqueReferralCode(123,true),'');
  assert.equal(await opaqueReferralCode(123,' test-bot-secret'),'');
  assert.equal(await opaqueReferralCode(123,'x'.repeat(513)),'');
});

test('launch referral parser does not stringify hostile non-string parts', () => {
  const code='a1b2c3d4e5f60708';
  const parsed=splitLaunchReferralParts(['fx123',{toString:()=>`r${code}`}]);
  assert.equal(parsed.referralCode,'');
  assert.deepEqual(parsed.parts,['fx123','']);

  const canonical=splitLaunchReferralParts([' FX123 ',` R${code.toUpperCase()} `]);
  assert.equal(canonical.referralCode,code);
  assert.deepEqual(canonical.parts,['fx123']);
});

test('opaque referral code is deterministic, compact and never exposes raw Telegram ID', async () => {
  const code=await opaqueReferralCode(123456789,'test-bot-secret');
  assert.match(code,/^[a-f0-9]{16}$/);
  assert.equal(code,await opaqueReferralCode(123456789,'test-bot-secret'));
  assert.notEqual(code,'123456789');
  assert.ok(!code.includes('123456789'));
});

test('fixture deep link carries attribution and intact referral within Telegram start_param limit', async () => {
  const api=linksRuntime();
  const code=await opaqueReferralCode(123456789,'test-bot-secret');
  const startParam=api.fixtureShareStartParam(123456789012,{
    source:'social',
    campaign:'match_share',
    content:'miniapp',
    referralCode:code,
  });
  assert.ok(startParam.length<=64);
  assert.match(startParam,new RegExp(`__r${code}$`));
  const parsed=splitLaunchReferralParts(startParam.toLowerCase().split('__').filter(Boolean));
  assert.equal(parsed.referralCode,code);
  assert.equal(parsed.parts[0],'fx123456789012');
  const deep=await api.fixtureTelegramDeepLink({botToken:'test'},12345,{referralCode:code});
  assert.match(deep.url,/^https:\/\/t\.me\/MatchRadarAIBot\?start=/);
});

test('invalid referral parameter cannot generate a corrupted Telegram link', () => {
  const api=linksRuntime();
  assert.equal(normalizeReferralCode('123456789'),'');
  assert.equal(api.fixtureShareStartParam(12345,{referralCode:'123456789'}),'');
  assert.equal(api.fixtureShareStartParam(0,{referralCode:'a'.repeat(16)}),'');
});

test('referral attribution blocks forged, self and duplicate attribution', () => {
  const code='a1b2c3d4e5f60708';
  assert.equal(referralAttributionDecision({referredUserId:2,referrerUserId:0,referralCode:code}).status,'forged_ref');
  assert.equal(referralAttributionDecision({referredUserId:2,referrerUserId:2,referralCode:code}).status,'self_referral');
  assert.equal(referralAttributionDecision({referredUserId:2,referrerUserId:1,referralCode:code,existingReferralCode:'1111111111111111'}).status,'duplicate_attribution');
  assert.equal(referralAttributionDecision({referredUserId:2,referrerUserId:1,referralCode:code,existingReferralCode:'corrupted'}).status,'duplicate_attribution');
  assert.equal(referralAttributionDecision({referredUserId:true,referrerUserId:1,referralCode:code}).status,'invalid_user');
  assert.equal(referralAttributionDecision({referredUserId:2,referrerUserId:[1],referralCode:code}).status,'forged_ref');
  assert.equal(referralAttributionDecision({referredUserId:'2',referrerUserId:'1',referralCode:code}).status,'accepted');
  assert.equal(referralAttributionDecision({referredUserId:2,referrerUserId:1,referralCode:code}).status,'accepted');
});

test('backend growth/referral domain uses idempotent growth events for share and referral lifecycle', () => {
  for (const event of ['share_created','share_open','referral_open','referred_first_open','referred_payment']) {
    assert.ok(backendSource.includes(`eventName:'${event}'`) || backendSource.includes(`event_name:'${event}'`), `missing ${event}`);
  }
  assert.match(growthReferral,/supaSelectOne/);
  assert.match(growthReferral,/eventRowMatches/);
  assert.match(backendSource,/eventKey:\`share_open:\$\{userId\}:\$\{startParam\}\`/);
  assert.match(growthReferral,/referralAttributionDecision/);
  assert.match(growthReferral,/referral_code:referral\.referralCode/);
});

test('share UX stays single-action and omits invented AI signal when signal is unavailable', () => {
  const app=fs.readFileSync('public/app.js','utf8');
  const start=app.indexOf('async function shareAnalysis');
  const end=app.indexOf('function bindRovingTabKeyboard',start);
  const share=app.slice(start,end);
  assert.match(share,/if \(signal\.label\)/);
  assert.doesNotMatch(share,/Наиболее вероятно:/);
  assert.match(share,/tg\?\.openTelegramLink/);
  assert.match(share,/navigator\.share/);
  assert.equal((app.match(/id="shareAnalysisBtn"/g) || []).length,1);
});

test('affiliate foundation is documentation-only and does not add bookmaker integrations or payout ledger', () => {
  const doc=fs.readFileSync('docs/SHARE_REFERRALS_AFFILIATE_FOUNDATION_RU.md','utf8');
  assert.match(doc,/Telegram.*source of truth/is);
  assert.match(doc,/не создаёт финансовый ledger/i);
  assert.match(doc,/1win/i);
  assert.match(doc,/не подключаются/i);
});

test('referral tokens separate users and signing secrets without disclosing account IDs',async()=>{
  const base=await opaqueReferralCode(123456789,'test-bot-secret');
  const differentUser=await opaqueReferralCode(123456790,'test-bot-secret');
  const differentSecret=await opaqueReferralCode(123456789,'different-test-secret');
  assert.match(base,/^[0-9a-f]{16}$/);
  assert.match(differentUser,/^[0-9a-f]{16}$/);
  assert.match(differentSecret,/^[0-9a-f]{16}$/);
  assert.notEqual(base,differentUser);
  assert.notEqual(base,differentSecret);
  assert.equal(await opaqueReferralCode(0,'test-bot-secret'),'');
});
test('launch parser only extracts a canonical referral from the final component',()=>{
  const code='a1b2c3d4e5f60708';
  const early=splitLaunchReferralParts(['r'+code,'fx12345']);
  assert.equal(early.referralCode,'');
  assert.deepEqual(early.parts,['r'+code,'fx12345']);
  const final=splitLaunchReferralParts(['fx12345','social','r'+code.toUpperCase()]);
  assert.equal(final.referralCode,code);
  assert.deepEqual(final.parts,['fx12345','social']);
});
