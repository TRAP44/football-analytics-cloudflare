import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery-runtime.js';

const worker=fs.readFileSync('src/worker.js','utf8');
const recovery=fs.readFileSync('src/news-impact-recovery-runtime.js','utf8');
const botUi=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
const botOrchestration=fs.readFileSync('src/telegram-bot-orchestration-runtime.js','utf8');
const growth=fs.readFileSync('src/growth-analytics-runtime.js','utf8');
const admin=fs.readFileSync('public/modules/admin-launch-funnel.js','utf8');

test('RC72 maps News Impact Delta to explicit user-facing decision states',()=>{
  assert.match(recovery,/function newsImpactDecisionCard\(/);
  for (const code of ['material','stable','detail','guarded','baseline_missing','unavailable']) {
    assert.ok(recovery.includes(`code:'${code}'`), `missing decision ${code}`);
  }
  assert.match(recovery,/Причинность не подтверждается/);
});

test('decision state controls Telegram actions instead of one generic keyboard',()=>{
  assert.match(recovery,/function newsImpactDecisionKeyboard\(/);
  assert.match(recovery,/Открыть обновлённый AI-разбор/);
  assert.match(recovery,/Проверить составы/);
  assert.match(recovery,/Проверить рынок/);
  assert.match(recovery,/Ещё новости/);
  assert.match(botUi,/newsImpactDecisionKeyboard\(/);
});

test('Telegram summary leads with decision and next action',()=>{
  assert.match(botOrchestration,/const newsDecision=plainObject\(optionalCall\(newsImpactDecisionCard/);
  assert.match(botOrchestration,/Что делать:/);
  assert.match(recovery,/Существенное изменение/);
  assert.match(recovery,/Сценарий стабилен/);
});

test('decision analytics stores only categorical outcome',()=>{
  const event=/eventName:'news_impact_delta',[\s\S]{0,500}?metadata:\{([\s\S]*?)\n\s*\},/.exec(botUi);
  assert.ok(event,'news impact decision event missing');
  assert.match(event[1],/decision:safeText\(decision\?\.code,24\)/);
  assert.doesNotMatch(event[1],/headline|title|url|query|content/);

  assert.match(growth,/const newsImpactDecisionSummary=/);
  assert.match(growth,/material:newsImpactRows\.filter/);
  assert.match(growth,/stable:newsImpactRows\.filter/);
  assert.match(admin,/решения:/);
});

test('RC72 deterministic decision contract remains wired through the recovery runtime',()=>{
  assert.match(recovery,/function newsImpactDecisionDrill\(/);
  assert.match(recovery,/material\?\.code==='material'/);
  assert.match(recovery,/stable\?\.code==='stable'/);
  assert.match(recovery,/guarded\?\.code==='guarded'/);
  assert.match(recovery,/malformed\?\.code==='guarded'/);
  assert.match(recovery,/cases:7/);
  assert.match(worker,/function newsImpactDecisionDrill\(\.\.\.args\).*getNewsImpactRecoveryRuntime\(\)\.newsImpactDecisionDrill/s);
  assert.match(worker,/createNewsImpactRecoveryRuntime/);
});

test('RC72 decision states and keyboard fail closed on malformed flags, ids and link generation',()=>{
  let fallbackCalls=0;
  const runtime=createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:new Set(['full_ai','squads','market','recheck','news','share']),
    NEWS_IMPACT_DECISION_CODES:new Set(['material','stable','detail','guarded','baseline_missing','unavailable']),
    NEWS_IMPACT_RECOVERY_CODES:new Set(['retry','open_full_ai']),
    footballBotKeyboard:()=>{
      fallbackCalls+=1;
      return {inline_keyboard:[[{text:'fallback',callback_data:'home'}]]};
    },
    favoriteMatchTeamRow:()=>[],
    telegramAnalysisHandoffParams:(fixtureId,tab)=>({fixtureId,action:'analysis',tab,handoff:'1'}),
    telegramWebAppUrl:()=>{ throw new Error('link failed'); },
  });

  assert.equal(runtime.newsImpactDecisionCard({requested:'true',compared:true,material:true}),null);
  assert.equal(
    runtime.newsImpactDecisionCard({
      requested:true,
      compared:'false',
      material:'true',
      stable:'true',
      reasonCode:'snapshot_not_before_news',
    })?.code,
    'guarded',
  );
  assert.doesNotThrow(()=>runtime.newsImpactDecisionCard({
    requested:true,
    reasonCode:{toString(){throw new Error('must not coerce');}},
  }));
  assert.equal(runtime.newsImpactDecisionCard({
    requested:true,
    reasonCode:{toString(){throw new Error('must not coerce');}},
  })?.code,'unavailable');

  const fallback=runtime.newsImpactDecisionKeyboard({}, {fixtureId:true}, [], {requested:true});
  assert.equal(fallbackCalls,1);
  assert.equal(fallback.inline_keyboard[0][0].callback_data,'home');

  const keyboard=runtime.newsImpactDecisionKeyboard(
    {},
    {fixtureId:'123'},
    [],
    {requested:true,compared:true,material:true,stable:false},
  );
  assert.ok(keyboard.inline_keyboard.length>0);
  assert.ok(keyboard.inline_keyboard.every(row=>Array.isArray(row) && row.length>0));
  assert.equal(
    keyboard.inline_keyboard.flat().some(button=>button?.web_app?.url===''),
    false,
  );
  assert.equal(
    keyboard.inline_keyboard.flat().some(button=>Object.prototype.hasOwnProperty.call(button,'web_app')),
    false,
  );
  assert.ok(
    keyboard.inline_keyboard.flat().some(button=>button.callback_data==='news:impact:material:market:123'),
  );
});
