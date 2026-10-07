import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createGrowthReferralRuntime } from '../src/growth-referral.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const analysisRuntime=fs.readFileSync('src/analysis-runtime.js','utf8');
const telegramBotUi=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
const telegramSearch=fs.readFileSync('src/telegram-search-runtime.js','utf8');
const analysisController=fs.readFileSync('public/modules/analysis-controller.js','utf8');
const adminFunnel=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');
const html=fs.readFileSync('public/admin.html','utf8');
const migration=fs.readFileSync('supabase/migrations/supabase_migration_v6_15.sql','utf8');
const privacy=fs.readFileSync('public/privacy.html','utf8');
const media=fs.readFileSync('MEDIA_LAUNCH_RU.md','utf8');
const growthAnalytics=fs.readFileSync('src/growth-analytics-runtime.js','utf8');

const growthRuntime=createGrowthReferralRuntime({
  memory:{users:new Map()},
  async getUserRecord(){ return null; },
  hasSupabase(){ return false; },
  async supaPatch(){ return null; },
  async supaUpsert(){ return null; },
  async supaSelectOne(){ return null; },
  async supaDelete(){ return null; },
  safeOpsMetadata(value){ return value && typeof value==='object' ? value : {}; },
  redactOpsString(value,limit=180){ return String(value ?? '').slice(0,limit); },
  normalizeReferralCode(value){ return String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,40); },
  opaqueReferralCode(){ return 'ref-test'; },
  referralAttributionDecision(){ return {accepted:false,status:'not_applicable'}; },
  splitLaunchReferralParts(parts){ return {parts:Array.isArray(parts) ? [...parts] : [],referralCode:''}; },
  clock(){ return Date.parse('2026-10-07T00:00:00Z'); },
});

test('RC53 parses Telegram media deep-link attribution with a bounded sanitized contract',()=> {
  const parsed=growthRuntime.parseLaunchStartParam('media__telegram_channel__soft_launch__post1');
  assert.equal(parsed.source,'telegram_channel');
  assert.equal(parsed.campaign,'soft_launch');
  assert.equal(parsed.content,'post1');
  assert.equal(parsed.referralCode,'');

  const sanitized=growthRuntime.parseLaunchStartParam('media__press__launch__article1!!!@@@');
  assert.match(sanitized.startParam,/^[A-Za-z0-9_-]{1,64}$/);
  assert.doesNotMatch(sanitized.startParam,/[!@]/);

  const referral=growthRuntime.parseLaunchStartParam('ref__invite');
  assert.equal(referral.source,'referral');

  assert.match(worker,/createGrowthReferralRuntime/);
});

test('growth analytics is backend-only and RLS protected',()=> {
  assert.match(migration,/create table if not exists public\.growth_events/);
  assert.match(migration,/alter table public\.growth_events enable row level security/);
  assert.match(migration,/revoke all on table public\.growth_events from anon, authenticated/);
  assert.match(migration,/grant select, insert, delete on table public\.growth_events to service_role/);
  assert.match(migration,/growth_events_campaign_created_idx/);
});

test('funnel separates Telegram quick AI from a full Mini App analysis',()=> {
  assert.match(telegramBotUi,/origin:'telegram_quick'/);
  assert.match(telegramBotUi,/eventName:'quick_ai'/);
  assert.match(analysisController,/origin:'miniapp'/);
  assert.match(analysisRuntime,/trackFullAi=analysisOrigin!=='telegram_quick'/);
  assert.match(analysisRuntime,/eventName:'full_ai'/);
});

test('Telegram search growth analytics stays first party and does not store the search query',()=> {
  const event=/recordGrowthEvent\(cfg,\{[\s\S]*?eventName:'search',[\s\S]*?metadata:\{([^}]*)\}[\s\S]*?\}\)/.exec(telegramSearch);
  assert.ok(event,'search growth event payload is missing');
  assert.match(event[1],/intent:parts\.intent/);
  assert.doesNotMatch(event[1],/query|rawText|parts\.query/);

  for(const [source,eventName] of [
    [telegramBotUi,'match_open'],
    [telegramBotUi,'quick_ai'],
    [analysisRuntime,'full_ai'],
  ]) {
    assert.ok(source.includes(`eventName:'${eventName}'`),`missing event ${eventName}`);
  }
});

test('admin funnel returns aggregates and remains admin-only',()=> {
  assert.match(growthAnalytics,/async function apiLaunchFunnel/);
  assert.match(growthAnalytics,/privacy:'Ответ содержит только агрегаты; Telegram ID и текст поисковых запросов пользователей не возвращаются\.'/);
  assert.match(router,/pathname === '\/api\/launch-funnel'/);
  assert.match(router,/if \(!adminAllowed\(\)\) return adminForbidden\(\)/);
  assert.match(html,/class="panel launch-funnel-panel" data-admin-only hidden/);
  assert.match(adminFunnel,/function renderLaunchFunnel/);
});

test('launch privacy and media kit document attribution boundaries',()=> {
  assert.match(privacy,/не использует сторонние рекламные SDK/);
  assert.match(privacy,/до 90 дней/);
  assert.match(media,/media__источник__кампания__материал/);
  assert.match(media,/не помещать туда имя, телефон, email, Telegram ID/);
  assert.match(media,/доля уникальных входов, дошедших до полного AI-разбора/);
});

test('RC53 launch package remains wired through current production modules',()=> {
  assert.match(worker,/createGrowthReferralRuntime/);
  assert.match(worker,/createGrowthAnalyticsRuntime/);
  assert.match(worker,/createTelegramCampaignRuntime/);
  assert.match(router,/apiLaunchFunnel/);
  assert.match(router,/apiMediaPublisherLink/);
});
