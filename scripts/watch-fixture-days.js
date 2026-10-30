// Public sports evidence only. One date query replaces per-match provider fanout.
import {readFileSync} from 'node:fs';
import {watchFixtureRelay,boundedSourceJson} from './inspect-match-watch.js';
import {watchFixtureIdentity} from '../src/match-watch.js';
import {automaticWatchMatch,automaticReplayEvidence} from '../src/match-watch-policy.js';
const RELAY=watchFixtureRelay(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const STATE='match-watch-fixture-days:v1';
const key=date=>`match-watch-fixtures:${date}:v1`;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const validDay=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const text=(value,max=160)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').trim().slice(0,max):'';
function normalize(raw){
 const status=text(raw?.fixture?.status?.short,12),date=time(raw?.fixture?.date);
 return {fixtureId:raw?.fixture?.id,date:Number.isFinite(date)?new Date(date).toISOString():null,status,home:{id:raw?.teams?.home?.id,name:text(raw?.teams?.home?.name,120)},away:{id:raw?.teams?.away?.id,name:text(raw?.teams?.away?.name,120)},leagueId:raw?.league?.id,league:text(raw?.league?.name),season:raw?.league?.season,round:text(raw?.league?.round,120),score:{home:Number.isInteger(raw?.goals?.home)&&raw.goals.home>=0&&raw.goals.home<=99?raw.goals.home:null,away:Number.isInteger(raw?.goals?.away)&&raw.goals.away>=0&&raw.goals.away<=99?raw.goals.away:null},finished:['FT','AET','PEN'].includes(status),live:['1H','HT','2H','ET','BT','P','LIVE'].includes(status)};
}
export async function loadWatchFixtureDays({videos,policies,env,fetchImpl,now,readCache,writeCache,report,signal,fixtureHints=[],broadcastHints=[]}){
 if(!env.API_FOOTBALL_KEY){report.fixtureSource='not_configured';return [];}
 const base=new URL(env.SUPABASE_URL),dbKey=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 if(!RELAY||base.href!==RELAY.origin+'/'||!dbKey||typeof env.API_FOOTBALL_KEY!=='string'||env.API_FOOTBALL_KEY.length>512)fail('WATCH_FIXTURE_CONFIGURATION');
 const leagueIds=[...new Set(policies.map(policy=>policy.leagueId))].sort((a,b)=>a-b),coverage=leagueIds.join(',');
 const today=Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z'),dates=Array.from({length:10},(_,i)=>new Date(today+(i-7)*86400000).toISOString().slice(0,10));
 const votes=new Map(),vote=(value,weight)=>{const ms=time(value);if(!Number.isFinite(ms))return;const day=new Date(ms).toISOString().slice(0,10);if(dates.includes(day))votes.set(day,(votes.get(day)||0)+weight);};
 for(const hint of fixtureHints.slice(0,100))vote(hint,20);
 for(const video of videos){
  const title=video.snippet?.title||'';
  const summaryOrLeague=/highlights|resumen|SPL:| - (?:A-League Men|Ninja A-League) /i.test(title);
  const fullJleague=/(?:Live|Full) Match \| J\.League$/i.test(title);
  if(!policies.some(policy=>policy.channelId===video.snippet?.channelId)||!summaryOrLeague&&!fullJleague)continue;
  vote(video.liveStreamingDetails?.scheduledStartTime,20);
  const published=time(video.snippet?.publishedAt);
  if(Number.isFinite(published)){vote(new Date(published).toISOString(),3);vote(new Date(published-86400000).toISOString(),2);vote(new Date(published-2*86400000).toISOString(),1);}
 }
 const rows=await readCache({cache_key:`in.(${dates.map(key).join(',')})`,limit:'10'}),snapshots=new Map();
 for(const row of rows){
  const p=row?.payload;if(!dates.includes(p?.date)||row.cache_key!==key(p.date)||p.version!==1||!Array.isArray(p.leagueIds)||!Array.isArray(p.matches)||p.matches.length>200||!Number.isFinite(time(p.checkedAt))||time(p.checkedAt)>now||now-time(p.checkedAt)>8*86400000)fail('WATCH_FIXTURE_CACHE_INVALID');
  const seen=new Set();for(const match of p.matches){if(!watchFixtureIdentity(match)||match.date.slice(0,10)!==p.date||!p.leagueIds.includes(match.leagueId)||seen.has(match.fixtureId))fail('WATCH_FIXTURE_CACHE_INVALID');seen.add(match.fixtureId);}
  if(leagueIds.every(id=>p.leagueIds.includes(id)))snapshots.set(p.date,p);
 }
 const stateRows=await readCache({cache_key:`eq.${STATE}`,limit:'1'});if(stateRows.length>1)fail('WATCH_FIXTURE_STATE_INVALID');
 const previous=stateRows[0]?.payload;
 if(previous&&(stateRows[0].cache_key!==STATE||previous.version!==1||typeof previous.coverage!=='string'||!previous.attempts||typeof previous.attempts!=='object'||Array.isArray(previous.attempts)||Object.keys(previous.attempts).length>9||Object.entries(previous.attempts).some(([date,at])=>!validDay(date)||!Number.isFinite(time(at))||time(at)>now||now-time(at)>8*86400000)||previous.usage!==undefined&&(!validDay(previous.usage?.day)||Date.parse(previous.usage.day+'T00:00:00Z')>today||!Number.isInteger(previous.usage?.requests)||previous.usage.requests<0||previous.usage.requests>16)))fail('WATCH_FIXTURE_STATE_INVALID');
 const attempts=Object.fromEntries(Object.entries(previous?.coverage===coverage?previous.attempts:{}).filter(([date])=>dates.includes(date)));
 const day=new Date(now).toISOString().slice(0,10),usage={day,requests:previous?.usage?.day===day?previous.usage.requests:0};
 const candidates=[...votes].sort((a,b)=>b[1]-a[1]||b[0].localeCompare(a[0])).map(([date])=>date).filter(date=>{
  const snapshot=snapshots.get(date),unfinished=snapshot?.matches.filter(match=>['NS','1H','HT','2H','ET','BT','P','LIVE'].includes(match.status))||[];
  // Ended-video evidence schedules a canonical re-read; it never turns a cached
  // match into FT. Only the provider response below may change sporting state.
  const ended=unfinished.some(match=>videos.some(video=>policies.some(policy=>policy.channelId===video.snippet?.channelId&&policy.leagueId===match.leagueId&&!policy.highlightsOnly&&automaticReplayEvidence(match,video.liveStreamingDetails?.actualStartTime,video.liveStreamingDetails?.actualEndTime,now)&&automaticWatchMatch(policy,{...match,finished:true,status:'FT'},video.snippet.title,video.liveStreamingDetails?.scheduledStartTime,now,'replay'))));
  const published=unfinished.length&&videos.some(video=>policies.some(policy=>policy.channelId===video.snippet?.channelId&&unfinished.some(match=>match.leagueId===policy.leagueId))&&/highlights|resumen|SPL:/i.test(video.snippet?.title||'')&&time(video.snippet?.publishedAt)>time(snapshot.checkedAt)&&time(video.snippet?.publishedAt)<=now&&time(video.snippet?.publishedAt)>=Date.parse(date+'T00:00:00Z')+60*60000&&time(video.snippet?.publishedAt)<Date.parse(date+'T00:00:00Z')+3*86400000);
  const nearBroadcast=unfinished.some(match=>broadcastHints.some(value=>Math.abs(time(value)-time(match.date))<=60000&&now>=time(value)-15*60000&&now<time(value)+4*3600000));
  const interval=nearBroadcast?30*60000:ended||published?15*60000:2*3600000;
  const refresh=snapshot&&now-time(snapshot.checkedAt)>=interval&&(nearBroadcast||ended||published||unfinished.some(match=>time(match.date)+6*3600000<now));
  return (!snapshot||refresh)&&(!attempts[date]||now-time(attempts[date])>=interval);
 }).slice(0,2);
 async function request(url,headers,body,maxBytes=64000){
  let response;try{response=await fetchImpl(url,{method:body?'POST':'GET',redirect:'error',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});}catch{fail(body?'WATCH_FIXTURE_CLAIM_UNCONFIRMED':'WATCH_FIXTURE_UNAVAILABLE');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});fail('WATCH_FIXTURE_UNAVAILABLE');}return boundedSourceJson(response,maxBytes);
 }
 for(const date of candidates){
  if(usage.requests>=16){report.fixtureSource='daily_budget';break;}
  if(!Object.hasOwn(attempts,date)&&Object.keys(attempts).length>=9){
   // Preserve the rollback schema and every unresolved attempt interval. Only
   // discard a marker for a positively completed, nonempty past-day snapshot.
   const completed=Object.keys(attempts).sort().find(day=>Date.parse(day+'T00:00:00Z')<today&&snapshots.get(day)?.matches.length>0&&snapshots.get(day).matches.every(match=>match.finished===true&&['FT','AET','PEN'].includes(match.status)));
   if(!completed){report.fixtureSource='marker_capacity';break;}
   delete attempts[completed];
  }
  attempts[date]=new Date(now).toISOString();
  usage.requests++;
  await writeCache(STATE,0,{version:1,coverage,attempts,usage},now+7*86400000);
  let payload;
  try{
   const headers={apikey:dbKey,Accept:'application/json','Content-Type':'application/json'};
   const stateUrl=new URL('/rest/v1/analysis_cache',base);stateUrl.search=new URLSearchParams({select:'cache_key,payload',cache_key:'in.(provider-state:api-football:quota:v1,provider-state:api-football:cooldown:v1)',expires_at:`gt.${new Date(now).toISOString()}`,limit:'2'});
   report.fixtureGuards=(report.fixtureGuards||0)+1;const states=await request(stateUrl,headers);
   if(!Array.isArray(states)||states.length>2)fail('WATCH_FIXTURE_GUARD_UNAVAILABLE');
   const quota=states.find(row=>row.cache_key==='provider-state:api-football:quota:v1')?.payload,cooldown=states.find(row=>row.cache_key==='provider-state:api-football:cooldown:v1')?.payload,age=now-time(quota?.updatedAt);
   if(time(cooldown?.cooldownUntil)>now||age>=0&&age<60000&&Number(quota.minuteRemaining)===0||String(quota?.plan).toUpperCase()==='FREE'&&age>=0&&age<=1800000&&(!Number.isFinite(Number(quota.dailyRemaining))||Number(quota.dailyRemaining)<=20))fail('WATCH_FIXTURE_GUARD_BLOCKED');
   report.fixtureGuards++;const claim=await request(new URL('/rest/v1/rpc/claim_provider_request',base),headers,{p_bucket_key:'api-football:minute',p_limit:4,p_window_seconds:60});
   if(claim?.allowed!==true)fail('WATCH_FIXTURE_GUARD_BLOCKED');
   const url=new URL(RELAY.href+'/fixtures');url.search=new URLSearchParams({date,timezone:'UTC'});report.fixtureRequests=(report.fixtureRequests||0)+1;
   const data=await request(url,{'x-apisports-key':env.API_FOOTBALL_KEY,Accept:'application/json'},undefined,8_000_000);
   if(!data||!Array.isArray(data.response)||data.response.length>5000||!data.errors||typeof data.errors!=='object'||Object.keys(data.errors).length)fail('WATCH_FIXTURE_RESPONSE_INVALID');
   const matches=[],seen=new Set();
   for(const raw of data.response){const match=normalize(raw);if(!watchFixtureIdentity(match))continue;if(match.date.slice(0,10)!==date||seen.has(match.fixtureId))fail('WATCH_FIXTURE_RESPONSE_INVALID');seen.add(match.fixtureId);if(leagueIds.includes(match.leagueId)&&match.home.name&&match.away.name&&match.league&&match.status)matches.push(match);}
   if(matches.length>200)fail('WATCH_FIXTURE_RESPONSE_INVALID');
   payload={version:1,date,leagueIds,checkedAt:new Date(now).toISOString(),matches};
  }catch(error){report.fixtureSource='deferred';report.fixtureSourceError=/^WATCH_FIXTURE_[A-Z_]+$/.test(error.code||'')?error.code:'WATCH_FIXTURE_UNAVAILABLE';break;}
  // Unknown cache writes abort; never silently retry an uncertain operation.
  await writeCache(key(date),0,payload,Math.min(now+7*86400000,Date.parse(date+'T00:00:00Z')+8*86400000));snapshots.set(date,payload);
 }
 report.fixtureSource ||= candidates.length?'fetched':'cached';report.fixtureDays=snapshots.size;
 report.fixtureDailyBudgetRemaining=16-usage.requests;
 return [...snapshots.values()].flatMap(snapshot=>snapshot.matches.map(match=>({match,observedAt:snapshot.checkedAt})));
}
