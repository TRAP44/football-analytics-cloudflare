// Manual/main-only observation of shared public sports cache. One bounded GET.
import {mkdirSync,writeFileSync} from 'node:fs';
import {composeLiveMatchSummary} from '../src/live-match-summary.js';
const TYPES=new Set(['score_mismatch','discipline','chance_quality','pressure','chance_volume','goalkeeper','recent_phase','finishing','possession','territory','player','availability','tempo']);
const text=(value,max=1200)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
async function boundedJson(response){
  if(!response.body)throw Error('Missing response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>512000){await reader.cancel();throw Error('Oversized observation');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export function summarizeLiveSnapshots(rows,now=new Date()){
  if(!Array.isArray(rows)||rows.length>6||!Number.isFinite(now.getTime()))throw Error('Invalid observation');
  const samples=[];let rejected=0;
  for(const row of rows){
    const id=integer(row?.match?.fixtureId,2_000_000_000);
    if(!id||row?.mode!=='live'||row?.cache_key!==`match-center:${id}:v17-event-evidence-rc144`){rejected++;continue;}
    const generated=Date.parse(row.generated_at),age=now.getTime()-generated;
    const recent=Number.isFinite(generated)&&age>=-5000&&age<=600000;
    const rawFacts=row?.insights?.insights;
    const facts=(Array.isArray(rawFacts)?rawFacts:[]).slice(0,7).filter(fact=>TYPES.has(fact?.type)&&['home','away','balanced','neutral'].includes(fact?.side)&&typeof fact?.text==='string'&&fact.text.length<=1000);
    const summary=text(row?.insights?.summary,4000),expected=text(composeLiveMatchSummary(facts),4000);
    const comparable=row?.insights?.available===true&&facts.length>0&&facts.length===rawFacts?.length;
    const has=type=>facts.some(fact=>fact.type===type);
    samples.push({fixtureId:id,home:text(row.match.home?.name,120),away:text(row.match.away?.name,120),minute:integer(row.match.elapsed,180),
      score:{home:integer(row.match.score?.home,30),away:integer(row.match.score?.away,30)},
      generatedAt:Number.isFinite(generated)?new Date(generated).toISOString():null,ageSeconds:Number.isFinite(generated)?Math.round(age/1000):null,recentSnapshot:recent,
      availability:{statistics:row.availability?.statistics===true,xg:row.availability?.xg===true,events:row.availability?.events===true},
      signalTypes:facts.map(fact=>fact.type),headline:text(row.insights?.headline,160),summary,expectedSummary:expected,
      available:row.insights?.available===true,hasSummary:Boolean(summary),matchesCurrentComposer:comparable?Boolean(summary&&expected&&summary===expected):null,catalogMayBeTruncated:rawFacts?.length===7,
      redCardSignal:has('discipline'),recentGoalsSignal:facts.some(fact=>fact.type==='recent_phase'&&fact.text.startsWith('Голы за последние 15 минут'))});
  }
  const recent=samples.filter(sample=>sample.recentSnapshot);
  return {scope:'read_only_shared_live_match_cache_not_Telegram_session',observedAt:now.toISOString(),rows:rows.length,rejected,
    recentSamples:recent.length,cases:{statisticsAndXg:recent.filter(x=>x.availability.statistics&&x.availability.xg).length,redCard:recent.filter(x=>x.redCardSignal).length,recentGoals:recent.filter(x=>x.recentGoalsSignal).length,eventsWithoutStatistics:recent.filter(x=>x.availability.events&&!x.availability.statistics).length},
    samples,note:'Snapshots are public sports data. Recent means generated within 10 minutes, not source freshness or evidence of a before/after transition. Missing cases are unverified. Comparison uses the delivered fact catalogue, which may be truncated at seven; a difference alone is not proof of an incorrect assessment. No API-Football or Telegram calls are made.'};
}
export async function inspectLiveSummary({env=process.env,fetchImpl=fetch,now=new Date()}={}){
  const base=new URL(env.SUPABASE_URL),key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.pathname!=='/'||base.search||base.hash||typeof key!=='string'||!key.trim()||!Number.isFinite(now.getTime()))throw Error('Invalid configuration');
  const url=new URL('/rest/v1/analysis_cache',base);
  url.search=new URLSearchParams({select:'cache_key,generated_at:payload->>generatedAt,mode:payload->>mode,match:payload->match,insights:payload->smartInsights,availability:payload->availability',cache_key:'like.match-center:*:v17-event-evidence-rc144','payload->>mode':'eq.live',updated_at:`gte.${new Date(now.getTime()-86400000).toISOString()}`,order:'updated_at.desc',limit:'6'});
  const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(response.status!==200)throw Error('Observation unavailable');
  return summarizeLiveSnapshots(await boundedJson(response),now);
}
if(process.argv[1]?.endsWith('/inspect-live-summary.js')){
  try{const report=await inspectLiveSummary();mkdirSync('load-results',{recursive:true});writeFileSync('load-results/live-summary-inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify({rows:report.rows,recentSamples:report.recentSamples,cases:report.cases}));}
  catch{console.error('Live summary observation unavailable; details suppressed.');process.exitCode=1;}
}
