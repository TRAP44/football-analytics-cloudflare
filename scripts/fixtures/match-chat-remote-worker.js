import {issueMatchQuestionAccess} from '../../src/match-question-access.js';
import {probeMatchConversation,probeChatBindingCompatibility} from './match-conversation-remote.js';
// Isolated local verification Worker. Not deployed or routed in production.
import {createMatchQuestionRuntime} from '../../src/match-question-runtime.js';
import {EXPLANATION_MODEL,EXPLANATION_ANALYSIS_CACHE_KEY} from '../../src/match-explanation-runtime.js';
const fixtureId=77;
const analysis={
  analysisVersion:'remote-verification',
  match:{fixtureId,referee:'Fixture Official',venue:'Fixture Stadium',home:{name:'Home FC'},away:{name:'Away FC'}},
  probabilities:{home:54,draw:25,away:21},
  h2h:{homeWins:1,draws:1,awayWins:1},
  confidence:{score:72},goalModel:{over25:65},absences:{home:[{name:'Home Player'}],away:[]},
  recentForm:{home:{overall:{sample:5,wins:4,draws:1,losses:0,gfAvg:1.8,gaAvg:0.6}},away:{overall:{sample:5,wins:1,draws:1,losses:3}}},
};
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='GET' && url.pathname==='/ready')return Response.json({ready:true});
    if(request.method!=='POST' || url.pathname!=='/probe' || !env.PROBE_NONCE || request.headers.get('x-probe-key')!==env.PROBE_NONCE){
      return Response.json({error:'not_found'},{status:404});
    }
    const input=await request.json().catch(()=>null);
    if(input?.variant==='conversation')return Response.json(await probeMatchConversation(env));
    if(input?.variant==='compatibility')return Response.json(await probeChatBindingCompatibility(env));
    if(!['previous','current'].includes(input?.variant))return Response.json({error:'invalid_variant'},{status:400});
    const model=input.variant==='previous' ? '@cf/meta/llama-3.1-8b-instruct-fp8' : EXPLANATION_MODEL;
    let modelFailure=null;
    let modelCalls=0;
    const rt=createMatchQuestionRuntime({
      json:(body,status=200)=>Response.json(body,{status}),
      getCache:async key=>key===EXPLANATION_ANALYSIS_CACHE_KEY(fixtureId) ? analysis : null,
      getCacheEntry:async()=>({payload:analysis,expired:false}),
      getStaleCache:async()=>null,setCache:async()=>true,
      getHistory:async()=>[],userHasAnalyzedFixture:async()=>{throw Error('Isolated history unavailable fixture');},
      hasSupabase:()=>true,supaSelectMany:async()=>[],
      supaRpc:async()=>({allowed:true,count:1}),
      loadRuntimeControls:async()=>({value:{analysisEnabled:true,aiEnabled:true}}),
      // A fixed fixture and in-memory admission exercise the actual handler;
      // they do not impersonate a Telegram session or touch a user's quota.
      clock:()=>Date.parse('2026-10-18T12:30:00Z'),memory:{},
    });
    const accessReceipt=await issueMatchQuestionAccess(env.PROBE_NONCE,1,fixtureId,Date.parse('2026-10-18T12:30:00Z'));
    const start=performance.now();
    const response=await rt.apiMatchQuestion(new Request('https://fixture.invalid/api/match-question',{
      method:'POST',body:JSON.stringify({fixtureId,accessReceipt,question:'У какой команды лучше результаты последних матчей?'}),
    }),{
      botToken:env.PROBE_NONCE,matchQuestionsEnabled:true,matchQuestionsDailyLimit:500,matchQuestionsUserHourlyLimit:10,
      workersAi:{run:async(_requestedModel,payload)=>{
        modelCalls++;
        try{return await env.AI.run(model,payload);}catch(error){
          const message=String(error?.message || '');
          modelFailure=/not found|not available|no such|model.*not|could not find/i.test(message) ? 'model_unavailable' : 'binding_error';
          throw error;
        }
      }},
    },{id:1});
    const body=await response.json();
    const checks={referee:false,missingReferee:false,goals:false,h2h:false,attack:false};
    if(input.variant==='current'){
      const ask=async question=>{
        const result=await rt.apiMatchQuestion(new Request('https://fixture.invalid/api/match-question',{
          method:'POST',body:JSON.stringify({fixtureId,accessReceipt,question}),
        }),{
          botToken:env.PROBE_NONCE,matchQuestionsEnabled:true,matchQuestionsDailyLimit:500,matchQuestionsUserHourlyLimit:10,
          workersAi:{run:async(_model,payload)=>{modelCalls++;return env.AI.run(model,payload);}},
        },{id:1});
        return result.json();
      };
      const known=await ask('Кто главный судья ?');
      checks.referee=known.source==='data' && known.items?.[0]?.text==='Главный судья — Fixture Official.';
      // A new payload object avoids mutating the shared fixture under parallel requests.
      const missingRuntime=createMatchQuestionRuntime({
        json:(value,status=200)=>Response.json(value,{status}),
        getCache:async()=>({...analysis,match:{...analysis.match,referee:''}}),getStaleCache:async()=>null,setCache:async()=>true,
        getHistory:async()=>[{fixture_id:fixtureId}],hasSupabase:()=>true,supaSelectMany:async()=>[],supaRpc:async()=>({allowed:true,count:1}),
        loadRuntimeControls:async()=>({value:{analysisEnabled:true,aiEnabled:true}}),memory:{},
      });
      const missingResponse=await missingRuntime.apiMatchQuestion(new Request('https://fixture.invalid/api/match-question',{
        method:'POST',body:JSON.stringify({fixtureId,question:'Кто главный судья ?'}),
      }),{matchQuestionsEnabled:true,workersAi:{run:async()=>{throw Error('direct question must not call AI');}}},{id:1});
      const missing=await missingResponse.json();
      checks.missingReferee=missing.source==='data' && missing.items?.[0]?.text==='В этом разборе главный судья пока не указан.';
      const goals=await ask('Что модель говорит о результативности матча?');
      checks.goals=goals.source==='data' && goals.items?.length===1 && goals.items[0].id==='goals_high';
      const h2h=await ask('Как команды играли друг с другом раньше?');
      checks.h2h=h2h.source==='ai' && h2h.items?.length===1 && h2h.items[0].id==='h2h';
      const attack=await ask('Сколько в среднем забивает Home FC за последние матчи?');
      checks.attack=attack.source==='ai' && attack.items?.length===1 && attack.items[0].id==='attack_home';
    }

    return Response.json({
      variant:input.variant,model,checks,httpStatus:response.status,modelCalls,modelFailure,
      durationMs:Math.round(performance.now()-start),available:body.available===true,
      answer:body.answer || null,source:body.source || null,reason:body.reason || null,
      items:Array.isArray(body.items) ? body.items.map(({id,role,connector,text})=>({id,role,connector,text})) : [],
    });
  },
};
