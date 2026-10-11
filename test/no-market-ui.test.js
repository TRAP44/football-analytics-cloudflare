import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Решение Сергея (11.10.2026): рынок и коэффициенты не показываются пользователю
// ни в преданализе Mini App, ни в описании уведомлений.
const app = fs.readFileSync('public/app.js', 'utf8');
const notifications = fs.readFileSync('public/modules/smart-notifications.js', 'utf8');
function block(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return app.slice(a, b);
}
const regex = block('const SCENARIO_BETTING_TEXT', '\n');

test('model weights name every visible source and fold the market into «прочие источники»', () => {
  const fn = new Function(`${block('function modelWeightsText(', '\n}\n')}\n}\nreturn modelWeightsText;`)();
  assert.equal(fn({ market: 40, apiPrediction: 20, recentForm: 22, seasonStrength: 13, h2h: 5 }), 'прогноз источника 20% · форма 22% · сила сезона 13% · очные встречи 5% · прочие источники 40%');
  assert.equal(fn({ recentForm: 60, seasonStrength: 40 }), 'форма 60% · сила сезона 40%');
  assert.equal(fn({}), 'Недостаточно сигналов');
});

test('cached market drivers and source rows are recognised and hidden', () => {
  const isMarket = new Function(`${block('function isMarketPrematchItem(', '\n}\n')}\n}\nreturn isMarketPrematchItem;`)();
  for (const item of [{ source: 'market' }, { key: 'market' }, { type: 'signal_market' }, { type: 'market_divergence' }, { type: 'market_strength_gap' }]) {
    assert.equal(isMarket(item), true, JSON.stringify(item));
  }
  for (const item of [{ source: 'model', type: 'signal_recentForm' }, { key: 'h2h' }, {}]) {
    assert.equal(isMarket(item), false, JSON.stringify(item));
  }
  const brief = block('function prematchBriefHtml(', '\nfunction ');
  assert.match(brief, /const drivers = \(Array\.isArray\(pm\.drivers\) \? pm\.drivers : \[\]\)\.filter\(item => !isMarketPrematchItem\(item\)\)/);
  assert.match(brief, /const sourceRows = \(Array\.isArray\(pm\.sourceRows\) \? pm\.sourceRows : \[\]\)\.filter\(item => !isMarketPrematchItem\(item\)\)/);
  assert.match(brief, /filter\(text => text && !SCENARIO_BETTING_TEXT\.test\(text\)\)/);
  assert.doesNotMatch(brief, /pm\.(drivers|sourceRows)\.map/);
});

test('insight and risk bullets drop cached market lines', () => {
  const bullets = new Function('escapeHtml', 'publicText', `${regex}\n${block('function bullets(', '\n}\n')}\n}\nreturn bullets;`)(v => String(v ?? ''), v => String(v ?? ''));
  const html = bullets(['Милан сильнее дома', 'Коэффициенты П1 / Н / П2 сильнее всего оценивают вариант «Милан».', 'Нет доступной линии 1X2 — итог сильнее зависит от статистики.']);
  assert.match(html, /Милан сильнее дома/);
  assert.doesNotMatch(html, /Коэффициент|1X2/);
  assert.match(bullets(['Сверить движение коэффициентов'], 'Пусто'), /Пусто/);
});

test('AI notifications category no longer promises market movement', () => {
  assert.doesNotMatch(notifications, /движени[ея] рынка/);
  assert.match(notifications, /Сильные изменения вероятностей модели без мелкого шума\./);
});
