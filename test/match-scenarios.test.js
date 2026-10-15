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

const escapeHtml=value=>String(value ?? '').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const clampPercent=value=>Math.max(0,Math.min(100,Number(value) || 0));
// Сергей 15.10: блока «Сценарии матча» в штабе больше нет; ставочный фильтр
// по-прежнему чистит факторы и риски во вкладке «Главное».
const neutralTextList=new Function('publicText',`${block('const SCENARIO_BETTING_TEXT','\n')}\n${block('function neutralTextList(','\n}\n')}\n}\nreturn neutralTextList;`)(value=>String(value ?? ''));

test('full analysis shows neutral labels and three tabs instead of bookmaker odds',()=>{
  const analysis=block('function renderAnalysis(d) {','\nfunction safeUrl');
  assert.match(analysis,/<span>Хозяева<\/span><strong>\$\{pct\(p\.home\)\}/);
  assert.deepEqual([...analysis.matchAll(/data-tab="(\w+)" type="button">([^<]+)</g)].map(x=>`${x[1]}:${x[2]}`),['brief:Главное','squads:Составы','form:Форма']);
  assert.doesNotMatch(analysis,/<span>П1<\/span>|<span>ТБ 2\.5<\/span>|<span>Обе забьют<\/span>|Коэффициенты П1|data-tab="market"|data-tab="model"/);
  assert.doesNotMatch(app,/function matchScenariosHtml\(|Сценарии матча/);
  const goals=block('function analysisGoalsHtml','\n}\n');
  assert.match(goals,/3\+ гола в матче/);
  assert.match(goals,/Забьют обе команды/);
  const launch=block('async function openLaunchFixture','\n}\n');
  assert.match(launch,/normalizeAnalysisTab\(tab\)/);
});

test('the betting filter catches standalone Cyrillic labels but keeps ordinary words',()=>{
  const rows=neutralTextList(['Подтверждённые составы: поправка к П1 около 3%','Поправка к П2 после потери','ТБ выглядит вероятнее','Хозяева в форме','Ставка ТМ 2.5 рискованна','Сыграть 1Х надёжнее','Гости без лидера']);
  assert.deepEqual(rows,['Хозяева в форме','Гости без лидера']);
  // Обычные слова, содержащие похожие буквы, не отбрасываются.
  assert.deepEqual(neutralTextList(['ТМК и П1ус — не метки','Тбилиси принимает матч']),['ТМК и П1ус — не метки','Тбилиси принимает матч']);
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
    summary:'Сценарий держится: оцениваю матч по счёту, событиям, статистике и рынку.',
    watchNext:['Рынок заметно сдвинулся в сторону хозяев: +6 п.п.','Следить за заменами хозяев'],
    volatility:{label:'Высокий',reason:'Поздний гол или резкое движение рынка может сломать сценарий.'},
    prematch:{available:true,signal:'ТБ 2.5',outcome:'Победа Милан · 52%',stateLabel:'держится'},
  },{});
  assert.doesNotMatch(html,/Следить за заменами хозяев|Что смотреть дальше/);
  assert.match(html,/Победа Милан · 52%/);
  assert.match(html,/Матч может быстро измениться\./);
  assert.match(html,/Оцениваю матч по счёту, событиям и статистике\./);
  assert.doesNotMatch(html,/Рынок|рынка|ТБ 2\.5/);
});
