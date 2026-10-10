import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createBetaPhase5Runtime } from '../src/beta-phase5-runtime.js';
import { createAdminFeedbackInbox } from '../public/modules/admin-feedback-inbox.js';

function harness({ invited = false, send, readFeedback } = {}) {
  const recorded = [];
  const sent = [];
  const runtime = createBetaPhase5Runtime({
    APP_VERSION: 'test', CLOSED_BETA_COHORT: 'closed_beta_v1', PHASE5_VALIDATION_COHORT: 'phase5_public_v2',
    RC_NAME: 'test', RELEASE_CHANNEL: 'test',
    billingWebhookStatus: async () => ({ ready: true }),
    collectDiagnostics: async () => ({}),
    hasSupabase: () => true,
    isClosedBetaUser: () => invited,
    json: (body, status = 200) => ({ body, status }),
    providerSnapshot: () => ({}),
    readOpsEventsRange: async () => ({ items: [] }),
    readFeedbackOpsEvents: readFeedback || (async () => ({ persistent: true, items: [] })),
    recordOpsEvent: async (_cfg, event) => { recorded.push(event); },
    redactOpsString: value => String(value).slice(0, 600),
    sendTelegramMessage: send || (async (chatId, text, _cfg, options) => { sent.push({ chatId, text, options }); return { ok: true }; }),
  });
  return { runtime, recorded, sent };
}

const cfg = { botToken: 'test-token', adminTelegramIds: [111, '111', 222] };
const post = body => ({ method: 'POST', json: async () => body });
const user = id => ({ id, username: `user-${id}`, __telegramValidated: true });

test('each new feedback notifies every admin once, as plain text without user identity', async () => {
  const { runtime, sent } = harness();
  const res = await runtime.apiBetaFeedback(post({ category: 'ai', severity: 'BLOCKER', note: 'AI <b>tab</b> does not open' }), cfg, user(501));
  assert.deepEqual(res, { status: 200, body: { ok: true } });
  assert.deepEqual(sent.map(item => item.chatId).sort(), [111, 222]);
  const text = sent[0].text;
  assert.match(text, /💬 Новый отзыв в MatchRadar/);
  assert.match(text, /AI · Невозможно пользоваться/);
  assert.match(text, /От: пользователь/);
  assert.match(text, /«AI <b>tab<\/b> does not open»/);
  assert.equal(sent[0].options, undefined, 'без parse_mode: текст пользователя не трактуется как HTML');
  assert.doesNotMatch(text, /501|user-501/);
});

test('a repeated identical feedback is neither stored nor notified twice', async () => {
  const { runtime, recorded, sent } = harness({ invited: true });
  const body = { category: 'search', severity: 'MAJOR', note: 'Search returns nothing' };
  await runtime.apiBetaFeedback(post(body), cfg, user(601));
  const again = await runtime.apiBetaFeedback(post({ ...body, note: '  search RETURNS nothing ' }), cfg, user(601));
  assert.deepEqual(again, { status: 200, body: { ok: true } });
  assert.equal(recorded.length, 1);
  assert.equal(sent.length, 2, 'одно уведомление на каждого из двух админов');
  assert.match(sent[0].text, /От: участник закрытой беты/);
  // Тот же текст от другого пользователя — это отдельный отзыв.
  await runtime.apiBetaFeedback(post(body), cfg, user(602));
  assert.equal(recorded.length, 2);
});

test('notifications respect the hourly cap and never break the user response', async () => {
  const { runtime, recorded, sent } = harness();
  for (let i = 0; i < 35; i += 1) {
    await runtime.apiBetaFeedback(post({ category: 'ux', severity: 'MINOR', note: `Small thing number ${i}` }), { ...cfg, adminTelegramIds: [111] }, user(700 + i));
  }
  assert.equal(recorded.length, 35, 'все отзывы сохраняются');
  assert.equal(sent.length, 30, 'уведомлений не больше потолка в час');

  const failing = harness({ send: async () => { throw new Error('telegram down'); } });
  const res = await failing.runtime.apiBetaFeedback(post({ category: 'live', severity: 'MAJOR', note: 'Live score is stuck' }), cfg, user(801));
  assert.deepEqual(res, { status: 200, body: { ok: true } });
  assert.equal(failing.recorded.length, 1);

  const noToken = harness();
  await noToken.runtime.apiBetaFeedback(post({ category: 'live', severity: 'MAJOR', note: 'Live score is stuck' }), { adminTelegramIds: [111] }, user(802));
  assert.equal(noToken.sent.length, 0);
});

test('admin feedback inbox returns only feedback rows, without identities', async () => {
  const rows = [
    { created_at: '2026-10-10T18:00:00Z', event_type: 'user_feedback', message: 'User feedback: Кнопка не работает', metadata: { category: 'ux', betaSeverity: 'MAJOR', userId: 1 } },
    { created_at: '2026-10-10T17:00:00Z', event_type: 'beta_feedback', message: 'Beta feedback: Нет составов', metadata: { category: 'matches', betaSeverity: 'BLOCKER' } },
    { created_at: '2026-10-10T16:00:00Z', event_type: 'client_telemetry', message: 'noise', metadata: {} },
  ];
  let called = null;
  const { runtime } = harness({ readFeedback: async (...args) => { called = args; return { persistent: true, items: rows }; } });
  const res = await runtime.apiAdminFeedback({ url: 'https://x/api/admin/feedback?days=500' }, cfg);
  assert.equal(res.status, 200);
  assert.equal(res.body.days, 90);
  assert.equal(called[3], 100);
  assert.deepEqual(res.body.items, [
    { createdAt: '2026-10-10T18:00:00Z', kind: 'user', category: 'ux', categoryLabel: 'Интерфейс', severity: 'MAJOR', severityLabel: 'Нестабильно или непонятно', note: 'Кнопка не работает' },
    { createdAt: '2026-10-10T17:00:00Z', kind: 'beta', category: 'matches', categoryLabel: 'Матчи', severity: 'BLOCKER', severityLabel: 'Невозможно пользоваться', note: 'Нет составов' },
  ]);
  assert.doesNotMatch(JSON.stringify(res.body), /userId|noise/);
});

test('admin feedback route is admin-only and covered by the admin security prefix', () => {
  const router = fs.readFileSync('src/router.js', 'utf8');
  assert.match(router, /pathname === '\/api\/admin\/feedback'\) \{\s*if \(!adminAllowed\(\)\) return adminForbidden\(\);\s*return await apiAdminFeedback\(request, cfg\);/);
  const registry = fs.readFileSync('src/security-route-registry.js', 'utf8');
  assert.match(registry, /prefixRule\('\/api\/admin\/',true,/);
  const reader = fs.readFileSync('src/release-monitor-api-runtime.js', 'utf8');
  assert.match(reader, /searchParams\.set\('event_type', `in\.\(\$\{FEEDBACK_EVENT_TYPES\.join\(','\)\}\)`\)/);
});

test('admin inbox renders escaped feedback and honest empty state', async () => {
  const nodes = new Map([['adminFeedbackList', { innerHTML: '' }], ['adminFeedbackMeta', { textContent: '' }]]);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  let payload = { available: true, persistent: true, days: 30, items: [{ kind: 'user', categoryLabel: 'AI', severity: 'BLOCKER', severityLabel: 'Невозможно пользоваться', createdAt: '2026-10-10T18:00:00Z', note: '<img src=x onerror=alert(1)>' }] };
  const inbox = createAdminFeedbackInbox({ elementById: id => nodes.get(id), api: async () => payload, escapeHtml, dateTime: () => '10 окт., 21:00', isAdmin: () => true });
  await inbox.load(true);
  const html = nodes.get('adminFeedbackList').innerHTML;
  assert.match(html, /admin-feedback-item blocker/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.match(nodes.get('adminFeedbackMeta').textContent, /За 30 дн\. · 1 отзыв/);
  payload = { ...payload, items: [payload.items[0], payload.items[0]] };
  await inbox.load(true);
  assert.match(nodes.get('adminFeedbackMeta').textContent, /2 отзыва/);
  payload = { available: true, persistent: true, days: 30, items: [] };
  await inbox.load(true);
  assert.match(nodes.get('adminFeedbackList').innerHTML, /Отзывов пока нет/);
});

test('a failed refresh after a successful load is shown as stale, not as current data',async()=>{
  const nodes = new Map([['adminFeedbackList', { innerHTML: '' }], ['adminFeedbackMeta', { textContent: '' }]]);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  let fail = false;
  const inbox = createAdminFeedbackInbox({
    elementById: id => nodes.get(id),
    api: async () => { if (fail) throw new Error('сеть недоступна'); return { available: true, persistent: true, days: 30, items: [{ kind: 'user', categoryLabel: 'AI', severity: 'MAJOR', severityLabel: 'Нестабильно', note: 'Старый отзыв' }] }; },
    escapeHtml, dateTime: () => '', isAdmin: () => true,
  });
  await inbox.load(true);
  assert.doesNotMatch(nodes.get('adminFeedbackList').innerHTML, /data-notice stale/);
  fail = true;
  await inbox.load(true);
  const html = nodes.get('adminFeedbackList').innerHTML;
  assert.match(html, /data-notice stale/);
  assert.match(html, /Не удалось обновить отзывы: сеть недоступна\. Показана последняя загруженная версия\./);
  assert.match(html, /Старый отзыв/);
  fail = false;
  await inbox.load(true);
  assert.doesNotMatch(nodes.get('adminFeedbackList').innerHTML, /data-notice stale/);
});
