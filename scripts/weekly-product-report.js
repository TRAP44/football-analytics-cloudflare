// Manual production observation. Personal identifiers exist only in memory;
// artifacts contain fixed-key aggregate counts, never user rows or metadata.
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const DAY=86400000,PAGE=500,MAX_PAGES=10;
const EVENTS=Object.freeze(['bot_start','miniapp_open','search','match_open','quick_ai','full_ai','favorite_add','ai_handoff']);
const ENTRY=new Set(['bot_start','miniapp_open']);
const instant=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;
const moscowDay=ms=>new Date(ms+3*3600000).toISOString().slice(0,10);
function userKey(value){
  const raw=typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
  return /^[1-9]\d{0,15}$/.test(raw)&&Number.isSafeInteger(Number(raw))?String(Number(raw)):null;
}
const percent=(value,total,complete)=>complete && total>0?Math.round(value/total*1000)/10:null;

export function summarizeProductUsage(rows,registrations,{now=new Date(),eventsTruncated=false,registrationsTruncated=false}={}){
  if(!Array.isArray(rows)||!Array.isArray(registrations)||rows.length>PAGE*MAX_PAGES||registrations.length>PAGE*MAX_PAGES||!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Invalid product observation');
  const end=now.getTime(),start=end-7*DAY,previousStart=start-7*DAY;
  const current=[],previous=[],registered=[];let invalidEvents=0,invalidRegistrations=0;
  for(const row of rows){
    const user=userKey(row?.telegram_id),at=instant(row?.created_at),event=row?.event_name;
    if(!user||!EVENTS.includes(event)||!Number.isFinite(at)||at<previousStart||at>=end){invalidEvents++;continue;}
    (at>=start?current:previous).push({user,at,event});
  }
  for(const row of registrations){
    const at=instant(row?.created_at);
    if(!Number.isFinite(at)||at<start||at>=end){invalidRegistrations++;continue;}
    registered.push(at);
  }
  const eventComplete=!eventsTruncated&&invalidEvents===0;
  const registrationComplete=!registrationsTruncated&&invalidRegistrations===0;
  const usersFor=(data,events)=>new Set(data.filter(row=>events.includes(row.event)).map(row=>row.user));
  const entries=usersFor(current,[...ENTRY]),priorEntries=usersFor(previous,[...ENTRY]);
  const both=new Set([...entries].filter(user=>priorEntries.has(user)));
  const daySets=new Map(),firstEntries=new Map();
  for(const row of current){
    if(!ENTRY.has(row.event))continue;
    if(!daySets.has(row.user))daySets.set(row.user,new Set());
    daySets.get(row.user).add(moscowDay(row.at));
    firstEntries.set(row.user,Math.min(firstEntries.get(row.user)??Infinity,row.at));
  }
  const pathCounts={};
  for(const event of ['match_open','quick_ai','full_ai']){
    const users=new Set(current.filter(row=>row.event===event&&firstEntries.has(row.user)&&row.at>=firstEntries.get(row.user)).map(row=>row.user));
    pathCounts[event]={usersAtLeast:users.size,ofEntryPct:percent(users.size,entries.size,eventComplete)};
  }
  const daily=[];
  for(let day=moscowDay(start);day<=moscowDay(end-1);day=moscowDay(Date.parse(day+'T00:00:00+03:00')+DAY)){
    const data=current.filter(row=>moscowDay(row.at)===day);
    daily.push({day,entryUsersAtLeast:usersFor(data,[...ENTRY]).size,miniappUsersAtLeast:usersFor(data,['miniapp_open']).size,fullAiUsersAtLeast:usersFor(data,['full_ai']).size});
  }
  return {
    window:{start:new Date(start).toISOString(),end:now.toISOString(),previousStart:new Date(previousStart).toISOString(),days:7,timeZone:'Europe/Moscow'},
    complete:eventComplete&&registrationComplete,
    coverage:{events:{rows:rows.length,truncated:eventsTruncated,invalidRows:invalidEvents,complete:eventComplete},registrations:{rows:registrations.length,truncated:registrationsTruncated,invalidRows:invalidRegistrations,complete:registrationComplete}},
    registrations:{createdInWeekAtLeast:registered.length,meaning:'new_database_accounts_not_proof_of_new_active_people'},
    activity:{productUsersAtLeast:new Set(current.map(row=>row.user)).size,entryUsersAtLeast:entries.size,
      events:Object.fromEntries(EVENTS.map(event=>[event,{eventsAtLeast:current.filter(row=>row.event===event).length,usersAtLeast:usersFor(current,[event]).size}]))},
    returns:{entryOnMultipleMoscowDaysAtLeast:[...daySets.values()].filter(days=>days.size>=2).length,previousWeekEntryUsersAtLeast:priorEntries.size,entryInBothWeeksAtLeast:both.size,previousWeekReturnPct:percent(both.size,priorEntries.size,eventComplete)},
    afterEntry:pathCounts,daily,
    limitations:[
      'Counts cover recorded events only, including owner/test activity; these are not independently verified audience numbers.',
      'Return means recorded entry on different Moscow calendar days or in both rolling weeks; it is not registration-cohort D1/D7 retention.',
      'Paths are separate actions after entry, not a compulsory search-to-AI funnel. Direct links can skip search and match-open events.',
      'full_ai records analysis delivery, including cached results; it does not prove a new model call, reading, satisfaction or payment.',
      'Only allowlisted product events are counted. No messages, questions, names, campaigns or raw metadata are queried or saved.',
      'Rows use a fixed upper time bound and stable ordering; pagination is best effort, not a transactional snapshot. Delayed or missing telemetry can undercount.',
      'Counts are lower bounds when truncated or invalid; percentages are suppressed for incomplete event data. First/last Moscow day can be partial.',
    ],
  };
}

async function boundedRows(response){
  if(response.status!==200||!response.body)throw Error('Product observation unavailable');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000){await reader.cancel();throw Error('Oversized observation');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const result=JSON.parse(new TextDecoder().decode(bytes));
  if(!Array.isArray(result)||result.length>PAGE||result.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Invalid product observation');
  return result;
}

export async function collectProductUsage({env=process.env,fetchImpl=fetch,now=new Date()}={}){
  try{
    const base=new URL(env.SUPABASE_URL),key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
    if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.pathname!=='/'||base.search||base.hash||typeof key!=='string'||!key.trim()||!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('Configuration unavailable');
    const end=now.toISOString(),start=new Date(now.getTime()-7*DAY).toISOString(),previousStart=new Date(now.getTime()-14*DAY).toISOString();
    const budget=AbortSignal.timeout(45000);
    async function read(table,select,since){
      const rows=[];
      for(let page=0;page<MAX_PAGES;page++){
        const url=new URL(`/rest/v1/${table}`,base);
        const params={select,and:`(created_at.gte.${since},created_at.lt.${end})`,order:table==='growth_events'?'created_at.asc,id.asc':'created_at.asc,telegram_id.asc',limit:String(PAGE),offset:String(page*PAGE)};
        if(table==='growth_events')params.event_name=`in.(${EVENTS.join(',')})`;
        url.search=new URLSearchParams(params);
        const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{apikey:key,Accept:'application/json'},signal:AbortSignal.any([budget,AbortSignal.timeout(10000)])});
        const result=await boundedRows(response);rows.push(...result);
        if(result.length<PAGE)return {rows,pages:page+1,truncated:false};
      }
      return {rows,pages:MAX_PAGES,truncated:true};
    }
    const events=await read('growth_events','telegram_id,event_name,created_at',previousStart);
    const registrations=await read('users','created_at',start);
    const report=summarizeProductUsage(events.rows,registrations.rows,{now,eventsTruncated:events.truncated,registrationsTruncated:registrations.truncated});
    report.coverage.events.pages=events.pages;report.coverage.registrations.pages=registrations.pages;
    return report;
  }catch{throw Error('Product report unavailable; upstream details suppressed.');}
}

export function productMarkdown(report){
  const count=value=>String(value)+(report.coverage.events.complete?'':' (не менее)');
  return ['# Использование MatchRadar за 7 дней','',`UTC: ${report.window.start} — ${report.window.end}. Дни сгруппированы по МСК.`,
    `Полнота: ${report.complete?'лимит не достигнут, строки валидны':'выборка ограничена; числа — нижние границы'}.`,
    `Новых записей пользователей: ${report.registrations.createdInWeekAtLeast}${report.coverage.registrations.complete?'':' (не менее)'}. Это регистрация, не подтверждённая активность.`,
    `Людей с записанным входом: ${count(report.activity.entryUsersAtLeast)}; с продуктовым событием: ${count(report.activity.productUsersAtLeast)}.`,
    `Заходили в разные дни МСК: ${count(report.returns.entryOnMultipleMoscowDaysAtLeast)}.`,
    `Входили в обе недели: ${count(report.returns.entryInBothWeeksAtLeast)} из ${count(report.returns.previousWeekEntryUsersAtLeast)} за предыдущую неделю; доля: ${report.returns.previousWeekReturnPct??'нет данных'}${report.returns.previousWeekReturnPct===null?'':'%'}.`,
    '', '| Действие | Люди | События |','|---|---:|---:|',
    ...EVENTS.map(event=>`| ${event} | ${count(report.activity.events[event].usersAtLeast)} | ${count(report.activity.events[event].eventsAtLeast)} |`),
    '', '| После входа | Люди | Доля вошедших |','|---|---:|---:|',
    ...Object.entries(report.afterEntry).map(([event,row])=>`| ${event} | ${count(row.usersAtLeast)} | ${row.ofEntryPct??'—'}${row.ofEntryPct===null?'':'%'} |`),
    '', '| День МСК | Вход | Mini App | Полный разбор |','|---|---:|---:|---:|',
    ...report.daily.map(row=>`| ${row.day} | ${count(row.entryUsersAtLeast)} | ${count(row.miniappUsersAtLeast)} | ${count(row.fullAiUsersAtLeast)} |`),
    '',...report.limitations.map(note=>'- '+note),''].join('\n');
}

export async function main(){
  const report=await collectProductUsage(),markdown=productMarkdown(report);
  mkdirSync('load-results',{recursive:true});
  writeFileSync('load-results/product-usage.json',JSON.stringify(report,null,2)+'\n');
  writeFileSync('load-results/product-usage.md',markdown);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,markdown);
  process.stdout.write(markdown);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await main();}catch{console.error('Product report unavailable; no personal data or upstream details logged.');process.exitCode=1;}
}
