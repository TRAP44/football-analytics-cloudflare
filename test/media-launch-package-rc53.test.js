import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const migration=fs.readFileSync('supabase_migration_v6_15.sql','utf8');
const privacy=fs.readFileSync('public/privacy.html','utf8');
const media=fs.readFileSync('MEDIA_LAUNCH_RU.md','utf8');

test('RC53 parses Telegram media deep-link attribution without storing arbitrary text',()=> {
  assert.match(worker,/function telegramStartPayload/);
  assert.match(worker,/function parseLaunchStartParam/);
  assert.match(worker,/media','press','partner','social/);
  assert.match(worker,/source:'referral'/);
  assert.match(worker,/replace\(\/\[\^A-Za-z0-9_-\]\//);
  assert.match(worker,/acquisition_first_touch_at:'is\.null'/);
});

test('growth analytics is backend-only and RLS protected',()=> {
  assert.match(migration,/create table if not exists public\.growth_events/);
  assert.match(migration,/alter table public\.growth_events enable row level security/);
  assert.match(migration,/revoke all on table public\.growth_events from anon, authenticated/);
  assert.match(migration,/grant select, insert, delete on table public\.growth_events to service_role/);
  assert.match(migration,/growth_events_campaign_created_idx/);
});

test('funnel separates Telegram quick AI from a full Mini App analysis',()=> {
  assert.match(worker,/origin:'telegram_quick'/);
  assert.match(app,/origin:'miniapp'/);
  assert.match(worker,/trackFullAi=analysisOrigin !== 'telegram_quick'/);
  assert.match(worker,/eventName:'quick_ai'/);
  assert.match(worker,/eventName:'full_ai'/);
});

test('core media funnel events are first party and avoid storing the search query',()=> {
  for (const name of ['bot_start','search','match_open','quick_ai','miniapp_open','full_ai','news_open','favorite_add','digest_opt_in']) {
    assert.ok(worker.includes(`eventName:'${name}'`), `missing event ${name}`);
  }
  const searchEvent=/recordGrowthEvent\(cfg,\{userId,eventName:'search',channel:'telegram',metadata:\{([^}]*)\}\}\)/.exec(worker);
  assert.ok(searchEvent, 'search growth event payload is missing');
  assert.match(searchEvent[1],/intent:parts\.intent/);
  assert.doesNotMatch(searchEvent[1],/query|rawText|parts\.query/);
});

test('admin funnel returns aggregates and Mini App keeps it admin-only',()=> {
  assert.match(worker,/async function apiLaunchFunnel/);
  assert.match(worker,/privacy:'Ответ содержит только агрегаты; Telegram ID и текст поисковых запросов пользователей не возвращаются\.'/);
  assert.match(worker,/url\.pathname === '\/api\/launch-funnel'/);
  assert.match(worker,/if \(!isAdminUser\(user, cfg\)\) return adminForbidden\(\)/);
  assert.match(html,/class="panel launch-funnel-panel" data-admin-only hidden/);
  assert.match(app,/function renderLaunchFunnel/);
});

test('launch privacy and media kit document attribution boundaries',()=> {
  assert.match(privacy,/не использует сторонние рекламные SDK/);
  assert.match(privacy,/до 90 дней/);
  assert.match(media,/media__источник__кампания__материал/);
  assert.match(media,/не помещать туда имя, телефон, email, Telegram ID/);
  assert.match(media,/доля уникальных входов, дошедших до полного AI-разбора/);
});

test('RC53 health exposes launch package contracts',()=> {
  assert.match(worker,/mediaLaunchPackage:\s*'enabled'/);
  assert.match(worker,/mediaDeepLinkAttribution:\s*'enabled'/);
  assert.match(worker,/firstPartyGrowthAnalytics:\s*'enabled'/);
  assert.match(worker,/launchFunnelAnalytics:\s*'enabled'/);
  assert.match(worker,/launchPrivacyGuard:\s*'enabled'/);
});
