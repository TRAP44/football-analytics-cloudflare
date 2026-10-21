import {createMatchQuestionRuntime} from '../../src/match-question-runtime.js';
import {issueMatchQuestionAccess} from '../../src/match-question-access.js';
import {readMatchChatEvents} from '../../public/modules/client-core.js';
import {MATCH_CHAT_FAILURE_CODES} from '../../src/match-chat-runtime.js';

// Fixed sports fixtures + in-memory admission; real Workers AI inference only.
// No production users, Telegram identities, DB reads or provider requests.
export async function probeMatchConversation(env){
  const fixtureId=77,trust={confidenceBearing:true,stale:false,provenanceState:'verified',fetchedAt:new Date().toISOString()};
  let center={mode:'live',generatedAt:trust.fetchedAt,match:{fixtureId,home:{name:'Home FC'},away:{name:'Away FC'},score:{home:1,away:0},elapsed:65,statusLabel:'Второй тайм'},dataFreshness:{match:trust,statistics:trust},availability:{statistics:true},statistics:{items:[{label:'Удары в створ',home:6,away:2}]}};
  const analysis={match:center.match,probabilities:{home:54,draw:25,away:21},recentForm:{home:{overall:{sample:5,wins:4,draws:1,losses:0}},away:{overall:{sample:5,wins:1,draws:1,losses:3}}}};
  let modelCalls=0,historySeen=false,snapshotSeen=false;
  const protocol={jsonResults:0,streamResults:0,otherResults:0,firstFailure:'none',resultShape:'none',frameShape:'none',frames:0,doneSeen:false,paragraphsAccepted:0};
  const cfg={botToken:env.PROBE_NONCE,matchQuestionsEnabled:true,matchQuestionsDailyLimit:500,matchQuestionsUserHourlyLimit:10,workersAi:{run:async(model,input)=>{
    modelCalls++;
    historySeen ||= input.messages.some(message=>message.role==='assistant');
    snapshotSeen ||= input.messages.some(message=>message.content.includes('Home FC 2:0 Away FC'));
    const result=await env.AI.run(model,input);
    if(result && typeof result.getReader==='function')protocol.streamResults++;
    else if(result && (typeof result.response==='string' || typeof result.response==='object'))protocol.jsonResults++;
    else protocol.otherResults++;
    return result;
  }}};
  const rt=createMatchQuestionRuntime({json:(value,status=200)=>Response.json(value,{status}),getCache:async()=>analysis,getCacheEntry:async()=>({payload:analysis}),getStaleCache:async()=>null,setCache:async()=>true,getHistory:async()=>[],userHasAnalyzedFixture:async()=>false,hasSupabase:()=>true,supaSelectMany:async()=>[],supaRpc:async()=>({allowed:true,count:1}),loadRuntimeControls:async()=>({value:{analysisEnabled:true,aiEnabled:true}}),loadMatchContext:async()=>structuredClone(center),recordOpsEvent:async(_cfg,event)=>{
    const [code,shape,frame,frames,done,accepted]=String(event.message).split('|');
    if(MATCH_CHAT_FAILURE_CODES.includes(code) && protocol.firstFailure==='none')Object.assign(protocol,{firstFailure:code,resultShape:['json','readable','other'].includes(shape)?shape:'none',frameShape:['none','response','delta','metadata'].includes(frame)?frame:'none',frames:Math.min(10000,Math.max(0,Number(frames)||0)),doneSeen:done==='1',paragraphsAccepted:Math.min(3,Math.max(0,Number(accepted)||0))});
  }});
  const receipt=await issueMatchQuestionAccess(env.PROBE_NONCE,1,fixtureId);
  const timings=[];
  const ask=async(question,context=null)=>{
    const started=performance.now(),events=[];
    const response=await rt.apiMatchQuestion(new Request('https://fixture.invalid/api/match-question',{method:'POST',body:JSON.stringify({fixtureId,mode:'conversation',question,context,accessReceipt:receipt})}),cfg,{id:1});
    const data=response.headers.get('content-type')?.includes('text/event-stream') ? await readMatchChatEvents(response,event=>events.push(event)) : await response.json();
    timings.push(Math.round(performance.now()-started));
    const paragraphs=events.filter(event=>event.type==='paragraph').map(event=>event.data);
    return {data,paragraphs,ok:data.answer==='conversation'};
  };
  const score=await ask('Кто сейчас ведёт и какой счёт?');
  const followup=await ask('А что видно по ударам в створ у этих команд?',score.data.context);
  center={...center,match:{...center.match,score:{home:2,away:0},elapsed:70}};
  const refresh=await ask('А теперь какой счёт?',followup.data.context || score.data.context);
  const missing=await ask('Кто в стартовом составе?');
  center={...center,mode:'upcoming',match:{...center.match,score:null,elapsed:null,statusLabel:'Предстоит'}};
  const explanation=await ask('Почему предматчевая оценка выше у Home FC? Объясни смысл формы команд и возможные риски.');
  const has=(result,id)=>result.paragraphs.some(paragraph=>paragraph.factIds.includes(id));
  const checks={
    liveScore:score.ok && has(score,'score'),
    liveStatistics:followup.ok && has(followup,'stat_0'),
    followupContext:historySeen,
    refreshedScore:refresh.ok && snapshotSeen && refresh.paragraphs.some(paragraph=>paragraph.text.includes('2:0')),
    missingLineups:missing.ok && missing.paragraphs.some(paragraph=>paragraph.kind==='missing'),
    generatedExplanation:explanation.ok && explanation.paragraphs.some(paragraph=>['analysis','scenario'].includes(paragraph.kind)),
  };
  return {checks,modelCalls,timings,protocol,success:Object.values(checks).every(Boolean)};
}
