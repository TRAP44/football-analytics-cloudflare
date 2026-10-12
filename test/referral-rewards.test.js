import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReferralRewardsRuntime, inviteStartParam, REFERRAL_MONTHLY_CAP } from '../src/referral-rewards-runtime.js';
import { inviteShareUrl, referralInviteHtml } from '../public/modules/referral-invite.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const json = (body, status = 200) => ({ status, body });
const CODE = '0123456789abcdef';

function harness({ rpc = {}, rows = {}, code = CODE } = {}) {
  const calls = [];
  const messages = [];
  const events = [];
  const rt = createReferralRewardsRuntime({
    ensureReferralCode: async () => code,
    hasSupabase: () => true,
    json,
    memory: {},
    recordGrowthEvent: async (_cfg, event) => { events.push(event); },
    recordOpsEvent: async () => {},
    supaRpc: async (_cfg, name, params) => {
      calls.push({ name, params });
      const handler = rpc[name];
      if (handler instanceof Error) throw handler;
      return typeof handler === 'function' ? handler(params) : handler;
    },
    supaSelectMany: async (_cfg, table, filters) => (rows[filters.status ? 'available' : 'invited'] || []),
    telegramApi: async (method, _cfg, body) => { messages.push({ method, body }); },
    telegramBotUsername: async () => 'MatchRadarBot',
  });
  return { rt, calls, messages, events };
}

test('invite link uses the existing referral code format and opens the bot', async () => {
  assert.equal(inviteStartParam(CODE), `ref__invite__profile__r${CODE}`);
  assert.equal(inviteStartParam('nope'), '');
  const { rt } = harness({ rows: { available: [{ id: 1 }, { id: 2 }], invited: [{ id: 3 }] } });
  const res = await rt.apiReferral(new Request('https://x.test/api/referral'), {}, { id: 5 });
  assert.deepEqual(res.body, {
    available: true,
    url: `https://t.me/MatchRadarBot?start=ref__invite__profile__r${CODE}`,
    bonusAvailable: 2,
    invitedThisMonth: 1,
    monthlyCap: REFERRAL_MONTHLY_CAP,
  });
  assert.equal((await rt.apiReferral(new Request('https://x.test'), {}, null)).status, 401);
  const noCode = harness({ code: '' });
  assert.equal((await noCode.rt.apiReferral(new Request('https://x.test'), {}, { id: 5 })).body.reason, 'code_unavailable');
});

test('the start parameter is parsed back as a referral launch', async () => {
  const { createGrowthReferralRuntime } = await import('../src/growth-referral.js');
  const { normalizeReferralCode, opaqueReferralCode, referralAttributionDecision, splitLaunchReferralParts } = await import('../src/referral-attribution.js');
  const growth = createGrowthReferralRuntime({
    memory: { users: new Map() },
    getUserRecord: async () => null,
    hasSupabase: () => false,
    supaPatch: async () => {},
    supaUpsert: async () => {},
    supaSelectOne: async () => null,
    supaDelete: async () => {},
    safeOpsMetadata: value => value,
    redactOpsString: value => String(value),
    normalizeReferralCode,
    opaqueReferralCode,
    referralAttributionDecision,
    splitLaunchReferralParts,
  });
  const parsed = growth.parseLaunchStartParam(inviteStartParam(CODE));
  assert.equal(parsed.referralCode, CODE);
  assert.equal(parsed.source, 'referral');
  assert.equal(parsed.campaign, 'invite');
});

test('grant: one database decision per user; the referrer gets a bot message only when rewarded', async () => {
  const { rt, calls, messages, events } = harness({ rpc: { grant_referral_rewards: { granted: true, referredGranted: true, referrerGranted: true, referrerId: 77 } } });
  assert.deepEqual(await rt.grantReferralRewards(5, {}), { granted: true, referrerGranted: true });
  assert.deepEqual(calls[0], { name: 'grant_referral_rewards', params: { p_referred_telegram_id: 5, p_monthly_cap: 10 } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body.chat_id, 77);
  assert.match(messages[0].body.text, /\+1 бонусный разбор/);
  assert.equal(events[0].eventKey, 'referral_reward:5');
  assert.equal((await rt.grantReferralRewards(5, {})).reason, 'already_checked');
  assert.equal(calls.length, 1, 'no second database call from the same isolate');

  const capped = harness({ rpc: { grant_referral_rewards: { granted: true, referrerGranted: false, referrerId: 77, reason: 'referrer_cap_reached' } } });
  await capped.rt.grantReferralRewards(6, {});
  assert.equal(capped.messages.length, 0);

  const notReferred = harness({ rpc: { grant_referral_rewards: { granted: false, reason: 'not_new_user' } } });
  assert.deepEqual(await notReferred.rt.grantReferralRewards(7, {}), { granted: false, reason: 'not_new_user' });

  const failing = harness({ rpc: { grant_referral_rewards: new Error('network') } });
  assert.equal((await failing.rt.grantReferralRewards(8, {})).reason, 'rpc_failed');
  assert.equal((await failing.rt.grantReferralRewards(8, {})).reason, 'rpc_failed', 'a failed call is retried later');
});

test('bonus reservation and refund carry the same operation id', async () => {
  const { rt, calls } = harness({ rpc: {
    reserve_referral_bonus: { allowed: true, rewardId: 12, remaining: 1 },
    refund_referral_bonus: params => ({ refunded: params.p_reward_id === 12, reason: 'refunded' }),
  } });
  const reservation = await rt.reserveReferralBonus(5, {});
  assert.equal(reservation.allowed, true);
  assert.equal(reservation.kind, 'bonus');
  assert.equal(reservation.rewardId, 12);
  assert.match(reservation.operationId, /^[0-9a-f-]{36}$/);
  assert.equal(calls[0].params.p_operation_id, reservation.operationId);
  assert.deepEqual(await rt.refundReferralBonus(5, reservation, {}), { refunded: true, reason: 'refunded' });
  assert.equal(calls[1].params.p_operation_id, reservation.operationId);

  const none = harness({ rpc: { reserve_referral_bonus: { allowed: false, reason: 'no_bonus' } } });
  const empty = await none.rt.reserveReferralBonus(5, {});
  assert.equal(empty.allowed, false);
  assert.equal(empty.rewardId, null);
});

test('analysis: the bonus is used only after the daily limit and returned if the analysis fails', () => {
  const source = fs.readFileSync('src/analysis-runtime.js', 'utf8');
  const quota = source.indexOf('usageReservation=objectValue(await reserveAnalysisQuota(userId,cfg));');
  const bonus = source.indexOf('bonusReservation=objectValue(await reserveReferralBonus(userId,cfg));');
  assert.ok(quota > 0 && bonus > quota, 'bonus is tried after the daily quota');
  assert.match(source, /if \(usageReservation\.allowed !== true && typeof reserveReferralBonus === 'function'\)/);
  assert.match(source, /if \(usageReservation\.allowed !== true && bonusReservation\?\.allowed !== true\) \{/);
  assert.match(source, /if \(bonusReservation\?\.reserved && !usageCommitted && typeof refundReferralBonus === 'function'\)/);
  assert.equal(source.match(/scheduleReferralReward\(\);/g)?.length, 3, 'reward check after cached, shared and fresh analysis');
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  assert.match(worker, /reserveReferralBonus: \(\.\.\.args\) => reserveReferralBonus\(\.\.\.args\),/);
});

test('profile panel: share via Telegram composer, numbers only from the server, no money words', () => {
  const data = { available: true, url: `https://t.me/MatchRadarBot?start=ref__invite__profile__r${CODE}`, bonusAvailable: 2, invitedThisMonth: 3, monthlyCap: 10 };
  const html = referralInviteHtml(data, escapeHtml);
  assert.match(html, /Бонусных разборов: <b>2<\/b> · приглашено за 30 дней: <b>3<\/b> из 10/);
  assert.match(html, /data-referral-share/);
  assert.doesNotMatch(html, /ставк|коэф|букмекер|выигрыш/i);
  assert.match(inviteShareUrl(data.url), /^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Ft\.me%2FMatchRadarBot%3Fstart%3Dref__invite__profile__r0123456789abcdef&text=/);
  assert.equal(inviteShareUrl('https://evil.example/?start=x'), '');
  assert.match(referralInviteHtml({ available: false }, escapeHtml), /временно недоступны/);
  assert.match(referralInviteHtml({ ...data, url: 'javascript:alert(1)' }, escapeHtml), /временно недоступны/);
  const index = fs.readFileSync('public/index.html', 'utf8');
  assert.match(index, /<section id="referralInvite" class="panel match-explanation referral-invite" aria-live="polite" hidden><\/section>/);
  assert.match(fs.readFileSync('public/app.js', 'utf8'), /void loadReferralInvitePanel\(\);/);
});

test('migration: private table, atomic grant with new-user check and monthly cap, service-only functions', () => {
  const sql = fs.readFileSync('supabase/migrations/supabase_migration_v6_29_17.sql', 'utf8');
  assert.match(sql, /create table if not exists public\.referral_rewards/);
  assert.match(sql, /unique \(referred_telegram_id, role\)/);
  assert.match(sql, /alter table public\.referral_rewards enable row level security;/);
  assert.match(sql, /revoke all on table public\.referral_rewards from public, anon, authenticated, service_role;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.referral_rewards to service_role;/);
  assert.match(sql, /v_user_created < v_attribution\.created_at - interval '1 hour'/, 'only new users');
  assert.match(sql, /'self_referral'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /granted_at > now\(\) - interval '30 days'/);
  assert.match(sql, /for update skip locked/);
  for (const fn of ['grant_referral_rewards(bigint, integer)', 'reserve_referral_bonus(bigint, uuid)', 'refund_referral_bonus(bigint, bigint, uuid)']) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), fn);
    assert.ok(sql.includes(`grant execute on function public.${fn} to service_role;`), fn);
  }
  assert.equal(sql.match(/'match_picks',\n {6}'referral_rewards'\n {4}\)/g)?.length, 3, 'legacy fingerprint excludes the table');
  assert.match(sql, /'grant_referral_rewards',\n {6}'reserve_referral_bonus',\n {6}'refund_referral_bonus'\n {4}\)/);
  assert.doesNotMatch(sql, /\bdrop /i);
  const rewardsPart = sql.slice(0, sql.indexOf('create or replace function public.backend_schema_fingerprint()'));
  assert.doesNotMatch(rewardsPart, /stars_amount|user_entitlements|billing_payments/, 'rewards are not purchases');
});
