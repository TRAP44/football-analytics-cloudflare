import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLiveSummary,summarizeLiveSnapshots} from '../scripts/inspect-live-summary.js';
const now=new Date('2026-10-19T15:00:00Z');
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture-key'};
const sample=()=>({cache_key:'match-center:7:v17-event-evidence-rc144',mode:'live',generated_at:'2026-10-19T14:59:30Z',match:{fixtureId:7,home:{name:'Chelsea'},away:{name:'Everton'},elapsed:60,score:{home:1,away:0}},availability:{statistics:true,xg:true,events:true},insights:{available:true,headline:'Сигнал',summary:'Подтверждённый факт.',insights:[{type:'discipline',side:'home',text:'Подтверждённый факт.'}]}});
test('one bounded fixed public-cache GET uses existing secrets only on configured host',async()=>{
  let calls=0;
  const result=await inspectLiveSummary({env,now,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url.origin,'https://fixture.supabase.co');assert.equal(url.pathname,'/rest/v1/analysis_cache');
    assert.equal(url.searchParams.get('limit'),'6');assert.equal(url.searchParams.get('payload->>mode'),'eq.live');
    assert.equal(url.searchParams.get('cache_key'),'like.match-center:*:v17-event-evidence-rc144');
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers.apikey,'fixture-key');
    assert.equal(url.searchParams.get('select').includes('user_id'),false);
    return Response.json([sample()]);
  }});
  assert.equal(calls,1);assert.equal(result.recentSamples,1);assert.equal(result.cases.statisticsAndXg,1);assert.equal(result.cases.redCard,1);assert.equal(result.samples[0].matchesCurrentComposer,true);
});
test('invalid identity/mode are rejected, stale/future snapshots are never counted as current evidence',()=>{
  const old={...sample(),generated_at:'2026-10-18T15:00:00Z'};
  const future={...sample(),generated_at:'2026-10-20T15:00:00Z'};
  const result=summarizeLiveSnapshots([old,future,{...sample(),cache_key:'user:7'},{...sample(),mode:'finished'}],now);
  assert.equal(result.rejected,2);assert.equal(result.recentSamples,0);assert.equal(result.cases.redCard,0);
  assert.equal(result.samples.length,2);
});
test('missing cases and unavailable insight are honest; raw private fields never leave projection reducer',()=>{
  const row=sample();row.user_id=123;row.metadata={token:'DO_NOT_OUTPUT'};row.match.userId=456;row.insights={available:false,summary:'Недостаточно данных',insights:[]};
  const result=summarizeLiveSnapshots([row],now);
  assert.equal(result.samples[0].matchesCurrentComposer,null);assert.equal(result.cases.redCard,0);
  assert.equal(JSON.stringify(result).includes('DO_NOT_OUTPUT'),false);assert.equal(JSON.stringify(result).includes('userId'),false);
  assert.equal(summarizeLiveSnapshots([],now).recentSamples,0);
});
test('invalid host/config, oversized response, redirect/error and excess rows fail closed',async()=>{
  let calls=0;
  await assert.rejects(inspectLiveSummary({env:{...env,SUPABASE_URL:'https://other.example'},fetchImpl:()=>{calls++;}}));
  assert.equal(calls,0);
  await assert.rejects(inspectLiveSummary({env,now,fetchImpl:async()=>new Response('x'.repeat(512001))}));
  await assert.rejects(inspectLiveSummary({env,now,fetchImpl:async()=>new Response('private upstream error',{status:403})}));
  assert.throws(()=>summarizeLiveSnapshots(Array.from({length:7},sample),now));
});
