import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
