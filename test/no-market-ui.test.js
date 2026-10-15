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

test('match HQ has no model/source-vote blocks where market could leak (Сергей 15.10)', () => {
  for (const name of ['modelWeightsText', 'isMarketPrematchItem', 'prematchBriefHtml', 'modelMethodText', 'bullets']) {
    assert.doesNotMatch(app, new RegExp(`function ${name}\\(`), name);
  }
  assert.doesNotMatch(app, /Как голосуют источники|Почему модель пришла к этим процентам/);
});

test('insight and risk lines in «Главное» drop cached market lines', () => {
  const publicText = v => String(v ?? '');
  const neutralTextList = new Function('publicText', `${regex}\n${block('function neutralTextList(', '\n}\n')}\n}\nreturn neutralTextList;`)(publicText);
  const rows = neutralTextList(['Милан сильнее дома', 'Коэффициенты П1 / Н / П2 сильнее всего оценивают вариант «Милан».', 'Нет доступной линии 1X2 — итог сильнее зависит от статистики.']);
  assert.deepEqual(rows, ['Милан сильнее дома']);
  assert.match(block('function analysisGlanceHtml(', '\n}\n'), /neutralTextList\(d\.insights\)[\s\S]*neutralTextList\(d\.risks\)/);
});

test('AI notifications category no longer promises market movement', () => {
  assert.doesNotMatch(notifications, /движени[ея] рынка/);
  assert.match(notifications, /Сильные изменения вероятностей модели без мелкого шума\./);
});
