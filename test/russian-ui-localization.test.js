import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8') + '\n' + fs.readFileSync('public/modules/admin-provider.js', 'utf8') + '\n' + fs.readFileSync('public/modules/admin-model-quality.js', 'utf8') + '\n' + fs.readFileSync('public/modules/admin-model-remediation.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

test('provider skipped counter uses the same stable DOM id as the client', () => {
  assert.match(adminHtml, /id="quotaFeatureSkipped"/);
  assert.match(app, /\$\('quotaFeatureSkipped'\)/);
  assert.equal(html.includes('quotaFeatureПропущено'), false);
});

test('common user-facing mixed English labels are removed from the Mini App', () => {
  const forbiddenHtml = [
    'Сегодня, LIVE',
    '>🔴 LIVE<',
    '>FREE<',
    'Обновление LIVE',
    'Коэффициенты LIVE',
    'provider correction',
    'с проверкой revision',
    'placeholder="ID матча"',
  ];
  for (const phrase of forbiddenHtml) assert.equal(html.includes(phrase), false, phrase);

  const forbiddenApp = [
    '<span>VS</span>',
    'LIVE-центр',
    'LIVE-счёт',
    'Holdout температуры',
    'Holdout весов',
    'settled + pending',
    'actor ID скрыт',
    'admin ID скрыт',
    'Recovery UX',
    'Mini App v5.1',
    'manifest OK',
    'manifest fail',
    'API contract',
    'Daily cost',
    'Теневой challenger',
  ];
  for (const phrase of forbiddenApp) assert.equal(app.includes(phrase), false, phrase);
  const russianCopyForbidden = [
    'MATCH BRIEF',
    'Вес в blend',
    'signal-level данные',
    "embedded: 'fixture'",
    "cache: 'cache'",
    "stale: 'stale'",
    "skipped: 'skip'",
    "error: 'error'",
    "liveOdds:'LIVE odds'",
    ' · TTL ',
    ' LIVE</',
    'LIVE-рынок',
    'LIVE сейчас',
    'Tavily не подключён',
    'расширенный API-план',
    'Football Manager',
    'Стартовые XI',
    'Голы, карточки, замены и VAR',
    'Предматчевый бриф',
    'ПРЕДМАТЧЕВЫЙ БРИФ',
    'Устаревший кэш',
    '⚡ Кэш',
    'Рынок 1X2',
    'Защита RC30',
    '1X2',
    '<span>X</span>',
    "row('X','draw')",
    "key === 'draw' ? 'X'",
    "badge.textContent = 'SQL'",
  ];
  for (const phrase of russianCopyForbidden) assert.equal(app.includes(phrase), false, phrase);
  assert.match(app, /function publicText\(value\)/);
  assert.match(app, /function dataPolicyModeLabel\(value\)/);
  assert.match(app, /function predictionAdviceLabel\(value\)/);
  assert.match(app, /Защитная проверка/);
  assert.match(app, /подтверждено ·/);
  assert.match(app, /первый ответ/);
  assert.match(app, /Преданализ матча/);
  assert.match(app, /Сохранённые данные/);
});

test('admin panels have a display-only technical vocabulary translator', () => {
  assert.match(app, /function humanizeTechnicalText\(value\)/);
  assert.match(app, /holdout/);
  assert.match(app, /отложенная выборка/);
  assert.match(app, /champion/);
  assert.match(app, /активная модель/);
  assert.match(app, /settlement/);
  assert.match(app, /фиксация результата/);
});

test('release regression checks are current instead of pinned to old RC22 metadata', () => {
  assert.equal(app.includes('6.14.0-rc22'), false);
  assert.equal(worker.includes('6.14.0-rc22'), false);
  assert.equal(worker.includes('ожидается 6.14.0-rc22'), false);
  assert.match(app, /const assetVersion = CLIENT_VERSION\.split\('-'\)\[0\]/);
  assert.match(app, /CLIENT_VERSION\.endsWith\(\x60-\$\{CLIENT_RELEASE_CHANNEL\}\x60\)/);
  assert.match(worker, /const releaseMetadataOk = APP_VERSION\.endsWith/);
});

test('obsolete release/admin copy is not exposed by the current worker', () => {
  const forbidden = [
    'RC13 добавляет',
    'v6.2 RC10 прошёл',
    'Core release candidate готов',
    'Provider status недоступен.',
    'Coverage Audit не вернул результат.',
    'Production-ready с ожидаемыми ограничениями',
  ];
  for (const phrase of forbidden) assert.equal(worker.includes(phrase), false, phrase);
  assert.doesNotMatch(worker, /\bRC(?:[0-9]|1[0-9]|2[0-9])\b/);
  for (const phrase of [
    'Snapshot timestamps',
    'Pre-match snapshot timing',
    'Predicted outcome',
    'Correct flag',
    'Fixture identity',
    'Fixture uniqueness',
    'Signal snapshots',
    'Lifecycle persistence failed',
    'Settlement watchdog skipped',
    'Reminder cron:',
    'Bot token missing.',
    'Football Manager',
  ]) assert.equal(worker.includes(phrase), false, phrase);
});

test('RC34 health publishes all localization contracts', () => {
  assert.match(worker, /russianUiLocalization:\s*'enabled'/);
  assert.match(worker, /adminRussianLocalization:\s*'enabled'/);
  assert.match(worker, /prematchRussianLocalization:\s*'enabled'/);
  assert.match(worker, /dynamicRussianLocalization:\s*'enabled'/);
  assert.match(worker, /adminTextHumanization:\s*'enabled'/);
  assert.match(worker, /matchCenterRussianLocalization:\s*'enabled'/);
});

test('Russian counters use grammatical forms for user-facing quantities', () => {
  assert.match(app, /function russianCountLabel\(/);
  assert.match(app, /'матч', 'матча', 'матчей'/);
  assert.match(app, /'команда', 'команды', 'команд'/);
  assert.match(app, /'лига', 'лиги', 'лиг'/);
});
