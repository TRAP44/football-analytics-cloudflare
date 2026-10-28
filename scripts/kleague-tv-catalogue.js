// Public page metadata only: never requests login, manifests or video files.
import {kleagueTvUrl,KLEAGUE_TV_POLICY,validKleagueTvReplay} from '../src/kleague-watch-policy.js';
const STATE='match-watch-kleaguetv:v1',HOME='https://tv.kleague.com/en-int/page/home';
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const positive=value=>Number.isSafeInteger(value)&&value>0;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function parseKleagueTvPage(html){
 if(typeof html!=='string'||html.length>2_000_000)fail('WATCH_KLEAGUE_PAGE_INVALID');
 const marker='id="__NUXT_DATA__"',at=html.indexOf(marker),start=html.indexOf('>',at),end=html.indexOf('</script>',start);
 if(at<0||start<at||end<start||html.indexOf(marker,at+marker.length)>=0)fail('WATCH_KLEAGUE_PAGE_INVALID');
 let data;try{data=JSON.parse(html.slice(start+1,end));}catch{fail('WATCH_KLEAGUE_PAGE_INVALID');}
 if(!Array.isArray(data)||!data.length||data.length>15000)fail('WATCH_KLEAGUE_PAGE_INVALID');
 const ref=i=>Number.isInteger(i)&&i>=0&&i<data.length?data[i]:undefined;
 const obj=i=>{const value=ref(i);return value&&typeof value==='object'&&!Array.isArray(value)?value:{};};
 const str=i=>typeof ref(i)==='string'?ref(i):'';
 const array=i=>Array.isArray(ref(i))?ref(i):[];
 const name=i=>str(obj(obj(i).translations).en)||str(obj(i).name),entries=new Map();
 for(const raw of data){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.hasOwn(raw,'geoRestrictions')||name(raw.contentType)!=='Fullmatch')continue;
  const event=obj(raw.event),editorial=obj(obj(obj(raw.editorial).translations).en),payment=obj(raw.payment);
  const home=obj(event.homeCompetitor),away=obj(event.awayCompetitor);
  const rounds=array(event.metadata).map(obj).filter(item=>name(item.field)==='Round').map(item=>str(item.name).match(/^Round ([1-9]\d?)$/)?.[1]);
  const devices=new Map();let malformed=false;
  for(const i of array(raw.geoRestrictions)){
   const rule=obj(i),device=obj(rule.deviceCategory),label=str(device.name),codes=str(rule.isolist).split(',');
   if(!['Desktop','Mobile'].includes(label))continue;
   if(devices.has(label)||ref(device.id)!==(label==='Desktop'?1:2)||codes.length>300||codes.some(code=>! /^[A-Z]{2}$/.test(code))){malformed=true;break;}
   devices.set(label,new Set(codes));
  }
  const source={id:ref(raw.id),slug:str(editorial.slug),title:str(editorial.title),startTime:str(raw.startTime),updatedAt:str(raw.lastUpdatedAt),distribution:name(raw.distributionType),contentType:name(raw.contentType),publication:name(raw.status),durationSeconds:ref(raw.length),payment:str(payment.name),entitlementsEmpty:Array.isArray(ref(payment.entitlements))&&array(payment.entitlements).length===0,freeForEmbed:ref(raw.freeForEmbed),round:rounds.length===1?Number(rounds[0]):null,
   countries:malformed?[]:KLEAGUE_TV_POLICY.countries.filter(code=>devices.get('Desktop')?.has(code)&&devices.get('Mobile')?.has(code)),
   event:{id:ref(event.id),sport:name(event.category1),league:name(event.category2),category:name(event.category3),startTime:str(event.startTime),homeId:ref(home.id),awayId:ref(away.id),home:str(home.name),away:str(away.name)}};
  source.eventUrl=kleagueTvUrl(`https://tv.kleague.com/en-int/video/${source.slug}/${source.id}`);
  if(!positive(source.id)||!source.eventUrl||source.title.length>220||source.event.home.length>120||source.event.away.length>120)continue;
  const previous=entries.get(source.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(source))fail('WATCH_KLEAGUE_DUPLICATE_CONFLICT');
  entries.set(source.id,source);if(entries.size>100)fail('WATCH_KLEAGUE_PAGE_INVALID');
 }
 return [...entries.values()];
}
export async function loadKleagueTv({fetchImpl,readCache,writeCache,now,signal,report}){
 const rows=await readCache({cache_key:`eq.${STATE}`,limit:'1'}),previous=rows[0]?.payload;
 if(rows.length>1||previous&&(rows[0].cache_key!==STATE||previous.version!==1||!Array.isArray(previous.entries)||previous.entries.length>100||!Array.isArray(previous.seeds)||previous.seeds.length>2||!Number.isFinite(time(previous.attemptedAt))||time(previous.attemptedAt)>now||previous.entries.some(e=>!e||!Number.isFinite(time(e.observedAt))||time(e.observedAt)>now)||previous.seeds.some(e=>![292,293].includes(e?.leagueId)||!kleagueTvUrl(e.url)||!Number.isFinite(time(e.date))||time(e.date)>now)))fail('WATCH_KLEAGUE_STATE_INVALID');
 const fresh=entries=>entries.filter(e=>now-time(e.observedAt)<30*60000&&now-time(e.source?.event?.startTime)<7*86400000);
 if(previous&&now-time(previous.attemptedAt)<(previous.failed?5:15)*60000){report.kleagueTvSource='cached';return fresh(previous.entries);}
 let seeds=(previous?.seeds||[]).filter(e=>now-time(e.date)<7*86400000),entries=[],failed=false;
 // The global atomic refresh claim bounds this producer too. Persist the source
 // attempt before public I/O; uncertain DB writes stop the run.
 const state={version:1,attemptedAt:new Date(now).toISOString(),seeds,entries:previous?.entries||[],failed:true};
 await writeCache(STATE,0,state,now+7*86400000);
 const sourceSignal=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
 async function page(url){
  if(url!==HOME&&!kleagueTvUrl(url))fail('WATCH_KLEAGUE_URL_INVALID');
  report.kleagueTvRequests=(report.kleagueTvRequests||0)+1;if(report.kleagueTvRequests>3)fail('WATCH_KLEAGUE_BUDGET');
  const response=await fetchImpl(url,{redirect:'error',headers:{Accept:'text/html'},signal:AbortSignal.any([sourceSignal,AbortSignal.timeout(5000)])});
  if(response.status!==200){await response.body?.cancel().catch(()=>{});fail('WATCH_KLEAGUE_SOURCE_UNAVAILABLE');}
  if(Number(response.headers.get('content-length'))>2_000_000){await response.body?.cancel().catch(()=>{});fail('WATCH_KLEAGUE_PAGE_INVALID');}
  const reader=response.body?.getReader();if(!reader)fail('WATCH_KLEAGUE_PAGE_INVALID');let size=0;const chunks=[];
  const cancel=()=>{void reader.cancel().catch(()=>{});};sourceSignal.addEventListener('abort',cancel,{once:true});
  try{for(;;){sourceSignal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();fail('WATCH_KLEAGUE_PAGE_INVALID');}chunks.push(value);}sourceSignal.throwIfAborted();}finally{sourceSignal.removeEventListener('abort',cancel);reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return parseKleagueTvPage(new TextDecoder().decode(bytes));
 }
 try{
  const home=await page(HOME);entries.push(...home);
  const latest=new Map(seeds.map(seed=>[seed.leagueId,seed]));
  for(const source of home){const leagueId=source.event.league==='K LEAGUE 1'?292:source.event.league==='K LEAGUE 2'?293:0;if(!leagueId||source.distribution!=='VOD'||source.payment!=='Registration'||!source.countries.length||!Number.isFinite(time(source.startTime))||time(source.startTime)>now||now-time(source.startTime)>=7*86400000)continue;const prior=latest.get(leagueId);if(!prior||time(source.startTime)>time(prior.date))latest.set(leagueId,{leagueId,url:source.eventUrl,date:source.startTime});}
  seeds=[...latest.values()].slice(0,2);
 }catch{failed=true;}
 for(const seed of seeds){try{entries.push(...await page(seed.url));}catch{failed=true;}}
 const merged=new Map(),conflicts=new Set();for(const source of entries){if(conflicts.has(source.id))continue;const prior=merged.get(source.id);if(prior&&JSON.stringify(prior.source)!==JSON.stringify(source)){failed=true;conflicts.add(source.id);merged.delete(source.id);continue;}merged.set(source.id,{source,observedAt:new Date(now).toISOString()});}
 entries=[...merged.values()];if(failed)for(const prior of fresh(previous?.entries||[]))if(!merged.has(prior.source?.id)&&!conflicts.has(prior.source?.id))entries.push(prior);
 entries=entries.filter(e=>Number.isFinite(time(e.source.startTime))&&now-time(e.source.startTime)<7*86400000).slice(0,100);
 await writeCache(STATE,0,{...state,seeds,entries,failed},now+7*86400000);
 report.kleagueTvSource=failed?'partial_or_deferred':'fetched';return fresh(entries);
}
export function kleagueTvApprovals(entries,fixtures,now,identity){
 return entries.flatMap(({source,observedAt})=>{
  if(now-time(observedAt)>=30*60000||time(observedAt)>now)return [];
  const candidates=fixtures.filter(({match})=>validKleagueTvReplay(match,source,now));if(candidates.length!==1)return [];
  const {match,observedAt:fixtureAt}=candidates[0];return [{match,provider:'kleaguetv',publisher:'kleaguetv',kind:'replay',access:'registration',eventUrl:source.eventUrl,label:'Полная запись K LEAGUE TV',countries:source.countries,embeddable:false,sourceMetadata:source,sourceObservedAt:observedAt,policyId:KLEAGUE_TV_POLICY.id,policyRevision:KLEAGUE_TV_POLICY.revision,confirmed:true,confirmedAt:new Date(now).toISOString(),validUntil:new Date(Math.min(time(match.date)+7*86400000,time(observedAt)+30*60000)).toISOString(),fixtureEvidence:{provider:'api-football',observedAt:fixtureAt,fixtureIdentity:identity(match)}}];
 });
}
