import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Решение Сергея (11.10.2026): рынок не упоминается в текстах для пользователя —
// ни в боте, ни в Mini App. Внутренние метки (админка, служебные коды) не трогаем.
const read = path => fs.readFileSync(path, 'utf8');
const MARKET = /[Рр]ын(ок|к|оч)|оэффициент/;

const userFacing = {
  'src/news-impact-recovery-runtime.js': [
    "action:'Срочного действия нет; продолжайте следить за составами и новостями.'",
    "actionLabel:'Риски матча',",
    "tracked('market','⚠️ Риски матча')",
  ],
  'src/news-impact-contract.js': ["  market:'Риски матча',"],
  'src/analysis-lifecycle-runtime.js': [
    "reason='До старта мало времени: составы и вероятности могли заметно измениться.';",
    "reason:'До матча осталось мало времени: финально проверьте составы и потери.',",
  ],
  'src/football-news-runtime.js': ["return 'состав · форма · AI-оценка';"],
  'src/analysis-runtime.js': ["method:'Прогноз источника данных, недавняя форма, сила сезона, очные встречи и другие источники объединяются динамически."],
  'src/analysis-context-runtime.js': ["'Проверить последние новости о составах и потерях ближе к началу матча.'", "'Проверяйте составы и новости ближе к старту.'"],
  'src/telegram-search-runtime.js': ['риски, составы и судья.'],
  'src/publisher-runtime.js': ["'MatchRadar AI: составы, судья, риски и AI-разбор матча.'"],
};

test('user-facing server texts use neutral wording instead of the market', () => {
  for (const [file, expected] of Object.entries(userFacing)) {
    const source = read(file);
    for (const text of expected) {
      assert.ok(source.includes(text), `${file}: ${text}`);
      assert.doesNotMatch(text, MARKET, `${file}: ${text}`);
    }
  }
  const news = read('src/football-news-runtime.js');
  assert.doesNotMatch(news, /· рынок|, рынок/);
  const recovery = read('src/news-impact-recovery-runtime.js');
  assert.doesNotMatch(recovery, /Проверить рынок|следить за составами и рынком/);
  assert.doesNotMatch(read('src/analysis-runtime.js'), /сдвинуть 1X2/);
});

test('Mini App hides odds in data coverage and old market wording in the model method', () => {
  const app = read('public/app.js');
  assert.doesNotMatch(app, /odds:'Коэффициенты'/);
  const regex = app.slice(app.indexOf('const SCENARIO_BETTING_TEXT'), app.indexOf('\n', app.indexOf('const SCENARIO_BETTING_TEXT')));
  const start = app.indexOf('function modelMethodText(');
  const fn = new Function(`${regex}\n${app.slice(start, app.indexOf('\n}\n', start))}\n}\nreturn modelMethodText;`)();
  const old = 'Рынок, прогноз источника данных, недавняя форма, сила сезона и очные встречи объединяются динамически. XI не может сдвинуть 1X2 более чем на 2.8 п.п.';
  const shown = fn(old);
  assert.match(shown, /^Прогноз источника данных, недавняя форма, сила сезона, очные встречи и другие источники объединяются динамически\./);
  assert.match(shown, /сдвинуть вероятности исходов более чем на 2\.8 п\.п\./);
  assert.doesNotMatch(shown, MARKET);
  assert.equal(fn(''), 'Модель объединяет доступные статистические сигналы.');
  assert.equal(fn('Ставка на коэффициент'), 'Модель объединяет доступные статистические сигналы.');
});
