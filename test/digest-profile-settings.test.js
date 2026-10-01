import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DIGEST_FIXED_HOUR_UTC,
  createDigestSettingsModule,
  digestDeliverySummary,
  digestLocalDeliveryWindow,
  normalizeDigestSettingsPayload,
} from '../public/modules/digest-settings.js';

test('digest settings normalize the existing fixed UTC delivery contract', () => {
  const settings = normalizeDigestSettingsPayload({
    settings: {
      enabled: true,
      configured: true,
      plan: 'PRO',
      delivery: { hourUtc: 7, label: '07:00 UTC' },
      favoriteTeams: [
        { teamId: 40, teamName: 'Liverpool' },
        { teamId: 40, teamName: '' },
      ],
    },
  });

  assert.equal(DIGEST_FIXED_HOUR_UTC, 7);
  assert.equal(settings.enabled, true);
  assert.equal(settings.delivery.label, '07:00 UTC');
  assert.equal(settings.delivery.editable, false);
  assert.equal(settings.plan, 'PRO');
  assert.equal(settings.capabilities.planSpecificContent, false);
  assert.equal(settings.capabilities.favoritePriority, false);
  assert.deepEqual(settings.favoriteTeams, [{ teamId: 40, teamName: 'Liverpool' }]);
  assert.equal(digestDeliverySummary(settings).status, 'Включена');
  assert.equal(digestLocalDeliveryWindow(7, new Date('2026-10-01T00:00:00Z'), 'Europe/Warsaw'), '09:00–09:55');
});

test('digest settings fail safe for malformed or missing payloads', () => {
  const settings = normalizeDigestSettingsPayload({
    settings: {
      enabled: 'true',
      plan: 'UNKNOWN',
      delivery: { hourUtc: 99 },
      favoriteTeams: [{ teamId: 0, teamName: 'Bad' }],
    },
  });

  assert.equal(settings.enabled, false);
  assert.equal(settings.plan, 'FREE');
  assert.equal(settings.delivery.hourUtc, 7);
  assert.deepEqual(settings.favoriteTeams, []);
});

test('concurrent Mini App toggles are serialized and the last requested state wins', async () => {
  const root = { innerHTML: '' };
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const api = async (path, options = {}) => {
    assert.equal(path, '/api/digest-settings');
    const enabled = JSON.parse(options.body || '{}').enabled;
    calls.push(enabled);
    if (calls.length === 1) await firstGate;
    return {
      settings: {
        enabled,
        configured: true,
        plan: 'FREE',
        delivery: { hourUtc: 7, label: '07:00 UTC' },
        favoriteTeams: [],
      },
    };
  };
  const module = createDigestSettingsModule({
    elementById: id => id === 'digestSettingsRoot' ? root : null,
    api,
    escapeHtml: value => String(value),
    planLabel: plan => plan,
  });

  const first = module.setDigestEnabled(true);
  const second = module.setDigestEnabled(false);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(calls, [true, false]);
  assert.equal(module.snapshot().settings.enabled, false);
  assert.equal(module.saving, false);
});

test('reload keeps last known settings visible when the database read fails', async () => {
  const root = { innerHTML: '' };
  let calls = 0;
  const api = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        settings: {
          enabled: true,
          configured: true,
          plan: 'PREMIUM',
          delivery: { hourUtc: 7, label: '07:00 UTC' },
          capabilities: {
            baseDigest: true,
            morningNews: true,
            favoritePriority: false,
            customDeliveryTime: false,
            planSpecificContent: false,
          },
          favoriteTeams: [{ teamId: 50, teamName: 'Barcelona' }],
        },
      };
    }
    throw new Error('База данных временно недоступна');
  };
  const module = createDigestSettingsModule({
    elementById: id => id === 'digestSettingsRoot' ? root : null,
    api,
    escapeHtml: value => String(value),
    planLabel: plan => plan,
  });

  await module.loadDigestSettings();
  await assert.rejects(() => module.loadDigestSettings(true), /База данных/);

  const snapshot = module.snapshot();
  assert.equal(snapshot.settings.enabled, true);
  assert.equal(snapshot.settings.plan, 'PREMIUM');
  assert.match(snapshot.error, /База данных/);
  assert.match(root.innerHTML, /База данных временно недоступна/);
  assert.match(root.innerHTML, /Barcelona/);
});

test('initial database error renders recovery state instead of a false disabled subscription', async () => {
  const root = { innerHTML: '' };
  const module = createDigestSettingsModule({
    elementById: id => id === 'digestSettingsRoot' ? root : null,
    api: async () => { throw new Error('Хранилище временно недоступно'); },
    escapeHtml: value => String(value),
    planLabel: plan => plan,
  });

  await assert.rejects(() => module.loadDigestSettings(), /Хранилище/);
  assert.equal(module.snapshot().settings, null);
  assert.match(root.innerHTML, /Подборка временно недоступна/);
  assert.match(root.innerHTML, /Повторить/);
});

test('server route is authenticated by the existing user boundary and reuses bot_digest_subscriptions', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');
  const router = fs.readFileSync('src/router.js', 'utf8');

  assert.match(router, /url\.pathname === '\/api\/digest-settings'/);
  assert.match(router, /apiDigestSettings\(request, cfg, user\)/);
  assert.match(worker, /async function apiDigestSettings\(request, cfg, user\)/);
  assert.match(worker, /const telegramId=Number\(user\?\.id \|\| 0\)/);
  assert.match(worker, /getBotDigestSubscription\(telegramId,cfg\)/);
  assert.match(worker, /supaUpsert\(cfg,'bot_digest_subscriptions',row,'telegram_id'\)/);
  assert.match(worker, /hour_utc:DAILY_DIGEST_POLICY\.deliveryHourUtc/);
  assert.match(worker, /customDeliveryTime:false/);
  assert.match(worker, /favoritePriority:false/);
  assert.match(worker, /planSpecificContent:normalizedPlan!==\'FREE\'/);
  assert.match(worker, /filterSmartNotificationRecipients\(plan\.pending \|\| \[],\'ai\.digest_expanded\',cfg\)/);
  assert.match(worker, /expandedDailyDigestText/);
});

test('existing reliable digest delivery pipeline remains the delivery path', () => {
  const worker = fs.readFileSync('src/worker.js', 'utf8');

  assert.match(worker, /async function processDailyDigests/);
  assert.match(worker, /runBoundedDailyDigest/);
  assert.match(worker, /claimDigestDelivery/);
  assert.match(worker, /armDigestDelivery/);
  assert.match(worker, /markDigestSent/);
  assert.match(worker, /releaseDigestDelivery/);
  assert.match(worker, /sendDigest:row=>telegramApi\('sendMessage'/);
});

test('Profile surface exposes Russian Digest controls and narrow mobile layouts', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const app = fs.readFileSync('public/app.js', 'utf8');
  const styles = fs.readFileSync('public/styles.css', 'utf8');
  const moduleSource = fs.readFileSync('public/modules/digest-settings.js', 'utf8');

  assert.match(html, /id="digestSettingsRoot"/);
  assert.match(app, /createDigestSettingsModule/);
  assert.match(app, /loadDigestSettings\(\)/);
  assert.match(moduleSource, /☀️ Утренняя подборка/);
  assert.match(moduleSource, /Получать подборку/);
  assert.match(moduleSource, /По вашему местному времени/);
  assert.doesNotMatch(moduleSource, /07:00–07:55 UTC/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.digest-settings-grid/);
  assert.match(styles, /@media \(max-width: 360px\)[\s\S]*?\.digest-settings-head/);
});
