import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');

function block(start,end){
  const a=app.indexOf(start);
  const b=app.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return app.slice(a,b);
}

// Исполняет настоящий matchScenariosHtml с минимальными зависимостями.
const source=block('const SCENARIO_BETTING_TEXT','\nfunction canonicalLaunchFixtureId');
const escapeHtml=value=>String(value ?? '').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const clampPercent=value=>Math.max(0,Math.min(100,Number(value) || 0));
const render=new Function('escapeHtml','publicText','clampPercent',`${source}\nreturn matchScenariosHtml;`)(escapeHtml,value=>String(value ?? ''),clampPercent);

const match={ home:{name:'Милан'}, away:{name:'Рома'}, referee:'Д. Орсато' };
const ai={
  confidenceScore:66, confidenceLabel:'Средняя',
  betSignal:{ code:'over25', label:'ТБ 2.5', reason:'Ставка на тотал' },
  verdict:{ outcome:'П1 · 48%', total:'ТБ 2.5 · 61%', btts:'Да · 55%' },
  marketNote:'Рынок сдвинулся к П1',
  riskNote:'Проверяйте составы и изменения коэффициентов ближе к старту.',
  factors:['Милан сильнее дома в последних 5 матчах','Рынок даёт П1 1.85'],
  risks:['Рома опасна на контратаках','Сверить движение коэффициентов'],
  matchPlan:{
    checks:['Проверить стартовые составы и ключевые потери ближе к началу матча.','Сверить движение коэффициентов и убедиться, что рынок не ушёл резко против сценария.','Учесть судью: строгий.'],
    cancel:'Рабочего сигнала нет: не форсировать решение до появления новых данных.',
    liveWatch:'В первые 15–20 минут смотреть на темп и опасные удары.',
  },
  dataTrust:{ label:'Хорошее', score:82 },
  qualityGate:{ label:'Анализ готов', reasons:[] },
};

test('scenarios describe outcomes and goals in words, never betting labels or market notes',()=>{
  const html=render({ ai, match, probabilities:{home:48,draw:27,away:25}, goal:{over25:61,btts:55} });
  assert.match(html,/AI · СЦЕНАРИИ МАТЧА/);
  assert.match(html,/Основной сценарий<\/span><strong>Победа Милан<\/strong><b>48%<\/b>/);
  assert.match(html,/Альтернатива<\/span><strong>Ничья<\/strong><b>27%<\/b>/);
  assert.match(html,/Результативная игра: 3\+ гола<\/strong><b>61%<\/b>/);
  assert.match(html,/Забьют обе команды<\/strong><b>55%<\/b>/);
  assert.match(html,/Милан сильнее дома/);
  assert.match(html,/Рома опасна на контратаках/);
  assert.match(html,/Проверить стартовые составы/);
  assert.match(html,/Учесть судью/);
  assert.match(html,/Что смотреть по ходу матча/);
  assert.doesNotMatch(html,/ТБ|П1|П2|1X|тотал|коэффициент|рын(ок|ка)|ставк|форсир|Решение|Главная идея|Условие отмены/i);
});

test('scenarios stay honest when data is missing, malformed or the outcome is open',()=>{
  const none=render({ ai:{}, match, probabilities:{home:48,draw:27}, goal:null });
  assert.match(none,/Сценарии появятся, когда у модели будет достаточно данных/);
  assert.doesNotMatch(none,/scenario-card/);
  const badSum=render({ ai:{}, match, probabilities:{home:80,draw:30,away:20}, goal:null });
  assert.doesNotMatch(badSum,/scenario-card/);
  const open=render({ ai:{}, match, probabilities:{home:36.4,draw:27.2,away:36.4}, goal:{over25:50,btts:'x'} });
  assert.match(open,/Нет явного фаворита/);
  assert.match(open,/3\+ гола — шансы равны/);
  assert.doesNotMatch(open,/Забьют обе команды/);
  const low=render({ ai:{}, match, probabilities:{home:30,draw:30,away:40}, goal:{over25:35} });
  assert.match(low,/Скорее мало голов: до 2<\/strong><b>65%<\/b>/);
});

test('after kickoff the scenarios are archived and pre-match checks disappear',()=>{
  const html=render({ ai, match, probabilities:{home:48,draw:27,away:25}, goal:null, kickoffHandoff:{locked:true} });
  assert.match(html,/ai-instructor-card match-scenarios archived/);
  assert.match(html,/Предматчевый разбор зафиксирован/);
  assert.doesNotMatch(html,/Что уточнить до начала/);
});

test('team names and server texts are escaped',()=>{
  const html=render({ ai:{ factors:['<img src=x onerror=alert(1)>'] }, match:{home:{name:'<b>A</b>'},away:{name:'B'}}, probabilities:{home:50,draw:25,away:25}, goal:null });
  assert.doesNotMatch(html,/<img|<b>A<\/b>/);
  assert.match(html,/&lt;b&gt;A&lt;\/b&gt;/);
});

test('full analysis shows neutral labels and a model tab instead of bookmaker odds',()=>{
  const analysis=block('function renderAnalysis(d) {','\nfunction safeUrl');
  assert.match(analysis,/<span>Хозяева<\/span><strong>\$\{pct\(p\.home\)\}/);
  assert.match(analysis,/<span>3\+ гола в матче<\/span>/);
  assert.match(analysis,/<span>Забьют обе команды<\/span>/);
  assert.match(analysis,/data-tab="model" type="button">Модель</);
  assert.doesNotMatch(analysis,/<span>П1<\/span>|<span>ТБ 2\.5<\/span>|<span>Обе забьют<\/span>|Коэффициенты П1|data-tab="market"/);
  assert.match(analysis,/matchScenariosHtml\(\{ ai: d\.aiInstructor \|\| \{\}, match: m, probabilities: p, goal, kickoffHandoff: d\.kickoffHandoff \|\| \{\} \}\)/);
  const cockpit=block('function matchCockpitHtml','\n}\n');
  assert.doesNotMatch(cockpit,/Коэффициенты|market\.odds/);
  const launch=block('async function openLaunchFixture','\n}\n');
  assert.match(launch,/=== 'market' \? 'model'/);
});

test('the betting filter catches standalone Cyrillic labels but keeps ordinary words',()=>{
  const html=render({
    ai:{ factors:['Подтверждённые составы: поправка к П1 около 3%','Поправка к П2 после потери','ТБ выглядит вероятнее','Хозяева в форме'], risks:['Ставка ТМ 2.5 рискованна','Сыграть 1Х надёжнее','Гости без лидера'] },
    match, probabilities:{home:48,draw:27,away:25}, goal:null,
  });
  assert.doesNotMatch(html,/П1|П2|ТБ|ТМ|1Х/);
  assert.match(html,/Хозяева в форме/);
  assert.match(html,/Гости без лидера/);
  // Обычные слова, содержащие похожие буквы, не отбрасываются.
  const ordinary=render({ ai:{ factors:['ТМК и П1ус — не метки','Тбилиси принимает матч'] }, match, probabilities:{home:48,draw:27,away:25}, goal:null });
  assert.match(ordinary,/ТМК и П1ус/);
  assert.match(ordinary,/Тбилиси принимает матч/);
});

test('public app source avoids regex lookbehind (unsupported by older Telegram iOS webviews)',()=>{
  assert.doesNotMatch(app,/\(\?<[!=]/);
});

test('betting filter catches the full 1X2 token and «рыночная» wording',()=>{
  const regex=new Function(`${block('const SCENARIO_BETTING_TEXT','\n')}\nreturn SCENARIO_BETTING_TEXT;`)();
  for (const text of ['Нет доступной линии 1X2 от источника','Расчётная рыночная вероятность','Рынок заметно сдвинулся']) {
    assert.ok(regex.test(text),text);
  }
  for (const text of ['Милан сильнее дома','Рома опасна на контратаках','3+ гола']) {
    assert.ok(!regex.test(text),text);
  }
});

test('live AI coach hides market-derived watch items, volatility reason and prematch label',()=>{
  const coach=block('function liveAiCoachHtml(','\nfunction postMatchReviewHtml');
  const betting=block('const SCENARIO_BETTING_TEXT','\n');
  const renderCoach=new Function('escapeHtml','publicText','clampPercent',`${betting}\n${coach}\nreturn liveAiCoachHtml;`)(escapeHtml,value=>String(value ?? ''),clampPercent);
  const html=renderCoach({
    available:true,
    state:'holds',
    confidence:61,
    current:{minute:55},
    watchNext:['Рынок заметно сдвинулся в сторону хозяев: +6 п.п.','Следить за заменами хозяев'],
    volatility:{label:'Высокий',reason:'Поздний гол или резкое движение рынка может сломать сценарий.'},
    prematch:{available:true,signal:'ТБ 2.5',outcome:'Победа Милан · 52%',stateLabel:'держится'},
  },{});
  assert.match(html,/Следить за заменами хозяев/);
  assert.match(html,/Победа Милан · 52%/);
  assert.match(html,/Матч может быстро измениться\./);
  assert.doesNotMatch(html,/Рынок|рынка|ТБ 2\.5/);
});
