import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hideProviderName, neutralReasonText } from '../src/signal-wording.js';

// Сергей 15.10: название поставщика данных («API-Football», «Прогноз API»)
// пользователю нигде не показываем.

test('user-facing texts do not name the data provider', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /function hideProviderName\(value\)/);
  assert.match(app, /const raw = hideProviderName\(value\);/, 'publicText прячет название');
  assert.equal(app.includes("'Прогноз API'"), false);
  assert.equal(app.includes('Источник API-Football'), false);
  assert.equal(app.includes("'API-Football FREE не предоставляет"), false);
  const model = fs.readFileSync('src/model-intelligence-runtime.js', 'utf8');
  assert.equal(model.includes('Прогноз API-Football указывает'), false);
  assert.equal(model.includes("'API Prediction'"), false);
});

test('provider name is hidden in Russian phrases and in bot reasons (ревью Codex #907)', () => {
  assert.equal(hideProviderName('Прогноз API'), 'Внешний прогноз');
  assert.equal(hideProviderName('API прогноз расходится с итогом'), 'внешний прогноз расходится с итогом');
  assert.equal(hideProviderName('API-прогноз'), 'внешний прогноз');
  assert.equal(hideProviderName('Прогноз API-Football указывает: X.'), 'Прогноз источник данных указывает: X.');
  assert.equal(hideProviderName('APIпрогнозы'), 'APIпрогнозы', 'внутри слова не трогаем');
  assert.equal(neutralReasonText('API-Football не вернул процентный прогноз для этого матча.'), 'источник данных не вернул процентный прогноз для этого матча.');
  // Тот же код в Mini App (public/app.js) — проверяем, что регулярки совпадают.
  const app = fs.readFileSync('public/app.js', 'utf8');
  for (const pattern of ["/API[\\s-]?Football(?:\\s+FREE)?/giu", "(^|[^\\p{L}\\p{N}])API[\\s-]?прогноз(?![\\p{L}\\p{N}])"]) {
    assert.ok(app.includes(pattern), pattern);
  }
  assert.equal(/\(\?<[!=]/.test(app), false, 'без lookbehind: старые WebView не разберут app.js');
  const model = fs.readFileSync('src/model-intelligence-runtime.js', 'utf8');
  assert.equal(model.includes('API-Football не вернул процентный прогноз'), false);
});
