import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewsImpactRecoveryRuntime } from '../src/news-impact-recovery.js';

function runtime() {
  const actionCodes=new Set(['full_ai','squads','market','recheck','news','share']);
  const decisionCodes=new Set(['material','detail','stable','guarded','baseline_missing','unavailable']);
  const cleanAction=value=>{
    const code=String(value || '').toLowerCase().trim();
    return actionCodes.has(code) ? code : '';
  };
  const cleanDecision=value=>{
    const code=String(value || '').toLowerCase().trim();
    return decisionCodes.has(code) ? code : '';
  };
  return createNewsImpactRecoveryRuntime({
    NEWS_IMPACT_ACTION_CODES:actionCodes,
    cleanNewsImpactActionCode:cleanAction,
    cleanNewsImpactDecisionCode:cleanDecision,
    hasSupabase:()=>false,
    isFootballRateLimitError:()=>false,
    memory:{newsImpactRecoveryStrategy:{value:null,loadedAt:0}},
    newsImpactActionCallback:()=>'', 
    recordGrowthEvent:async()=>true,
    supaSelectPaged:async()=>[],
    telegramAnalysisHandoffParams:(fixtureId,mode)=>({fixtureId,mode}),
    telegramApi:async()=>({ok:true}),
    telegramWebAppUrl:(_request,params)=>'https://example.test/?'+new URLSearchParams(params).toString(),
  });
}

test('recovery codes and callbacks preserve validation semantics',()=>{
  const r=runtime();
  assert.equal(r.cleanNewsImpactRecoveryCode('RETRY_SOON'),'retry_soon');
  assert.equal(r.cleanNewsImpactRecoveryCode('other'),'');
  assert.equal(r.newsImpactRecoveryCallback('material','market','retry',12345),'ni:r:material:market:retry:12345');
  assert.equal(r.newsImpactRecoveryCallback('material','bad','retry',12345),'');
});

test('failure recovery mapping preserves user-safe fallback actions',()=>{
  const r=runtime();
  assert.deepEqual(r.newsImpactRecoveryForFailure('quota_exhausted','full_ai'),{
    code:'wait_quota_reset',
    action:'wait',
    message:'Дневной лимит AI исчерпан. Повторите после обновления лимита.',
  });
  assert.equal(r.newsImpactRecoveryForFailure('provider_rate_limit','market').code,'retry_later');
  assert.equal(r.newsImpactRecoveryForFailure('match_missing','market').code,'open_search');
  assert.equal(r.newsImpactRecoveryForFailure('telegram_delivery','full_ai').code,'open_full_ai');
});

test('recovery keyboard keeps retry and full-AI escape paths',()=>{
  const r=runtime();
  const keyboard=r.newsImpactRecoveryKeyboard({},'material','market',42,'retry_soon');
  assert.equal(keyboard.inline_keyboard[0][0].callback_data,'ni:r:material:market:retry_soon:42');
  assert.equal(keyboard.inline_keyboard[1][0].text,'📊 Открыть полный AI');
});
