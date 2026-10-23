// Main-only curated catalogue. No title-based matching, scraping or public writes.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {boundedSourceJson} from './inspect-match-watch.js';
import {WATCH_COUNTRIES,WATCH_PUBLISHERS,WATCH_TTL_MS,watchFixtureIdentity,watchCacheKey,validatedWatchOptions,officialWatchUrl} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const timestamp=value=>typeof value==='string'?Date.parse(value):NaN;
export function validateWatchApprovals(manifest,now=Date.now()){
  if(manifest?.version!==1 || !Array.isArray(manifest.items) || manifest.items.length>20)fail('WATCH_MANIFEST_INVALID');
  const seen=new Set();
  for(const item of manifest.items){
    const identity=watchFixtureIdentity(item?.match),approved=timestamp(item?.confirmedAt),until=timestamp(item?.validUntil);
    if(!identity || item.confirmed!==true || !Number.isFinite(approved)||approved>now||!Number.isFinite(until)||until<=approved||until-approved>7*86400000)fail('WATCH_APPROVAL_INVALID');
    if(!['live','replay','highlights'].includes(item.kind)||!['free','subscription','ppv','unknown'].includes(item.access))fail('WATCH_APPROVAL_INVALID');
    if(!Array.isArray(item.countries)||!item.countries.length||item.countries.length>249||item.countries.some(code=>!Object.hasOwn(WATCH_COUNTRIES,code)))fail('WATCH_COUNTRIES_INVALID');
    if(!officialWatchUrl(item.provider,item.eventUrl))fail('WATCH_URL_INVALID');
    if(item.provider==='youtube' && (!Object.hasOwn(WATCH_PUBLISHERS,item.publisher)||new URL(item.eventUrl).searchParams.get('v')!==item.videoId))fail('WATCH_PUBLISHER_INVALID');
    const key=item.match.fixtureId+':'+item.eventUrl;
    if(seen.has(key))fail('WATCH_APPROVAL_DUPLICATE');seen.add(key);
  }
  return manifest.items.filter(item=>timestamp(item.validUntil)>now);
}
export function approvedYoutubeItem(approval,video,match,now){
  if(!video || video.id!==approval.videoId || video.snippet?.channelId!==WATCH_PUBLISHERS[approval.publisher] || video.status?.privacyStatus!=='public' || video.contentDetails?.contentRating?.ytRating==='ytAgeRestricted')return null;
  const details=video.contentDetails;
  if(!details||typeof details!=='object'||Array.isArray(details))return null;
  const region=details.regionRestriction;
  if(region!==undefined && (!region||typeof region!=='object'||Array.isArray(region)||Object.hasOwn(region,'allowed')===Object.hasOwn(region,'blocked')))return null;
  if(region && !['allowed','blocked'].every(key=>region[key]===undefined||Array.isArray(region[key])&&region[key].length<=300&&region[key].every(code=>typeof code==='string'&&/^[A-Z]{2}$/.test(code))))return null;
  const countries=approval.countries.filter(code=>region?.allowed?region.allowed.includes(code):!region?.blocked?.includes(code));
  if(!countries.length)return null;
  const stream=video.liveStreamingDetails || {},start=timestamp(stream.actualStartTime),end=timestamp(stream.actualEndTime),scheduled=timestamp(stream.scheduledStartTime);
  if(approval.kind==='live'){
    if(match.finished || now>Date.parse(match.date)+4*3600000)return null;
    const live=video.snippet.liveBroadcastContent==='live'&&Number.isFinite(start)&&start<=now&&!stream.actualEndTime;
    const upcoming=video.snippet.liveBroadcastContent==='upcoming'&&!stream.actualStartTime&&!stream.actualEndTime&&Number.isFinite(scheduled)&&scheduled>now;
    // A human must confirm tournament/category/date; this is an additional mismatch guard.
    if(!live&&!upcoming || Math.abs((Number.isFinite(scheduled)?scheduled:start)-Date.parse(match.date))>30*60000)return null;
  }else if(!match.finished || video.snippet.liveBroadcastContent!=='none' || stream.actualEndTime && (!Number.isFinite(end)||end>now))return null;
  return {...approval,channelId:video.snippet.channelId,countries,publicVideo:true,regionVerified:true,ageRestricted:false,embeddable:video.status.embeddable===true,
    availableFrom:Number.isFinite(scheduled)?new Date(scheduled).toISOString():null};
}
export async function refreshMatchWatch({env=process.env,manifest,fetchImpl=fetch,now=Date.now()}={}){
  const report={scope:'curated_watch_catalogue',checkedAt:new Date(now).toISOString(),approvals:0,published:0,rejected:0,missingFixture:0,youtubeRequests:0,cacheReads:0,cacheWrites:0};
  const approvals=validateWatchApprovals(manifest,now);report.approvals=approvals.length;
  if(!approvals.length)return report;
  const dbKey=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  let base;try{base=new URL(env.SUPABASE_URL);}catch{fail('WATCH_DB_CONFIGURATION');}
  if(!dbKey||base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.pathname!=='/'||base.username||base.password||base.search||base.hash)fail('WATCH_DB_CONFIGURATION');
  const deadline=AbortSignal.timeout(55000);
  async function request(url,headers,body){
    let response;
    try{response=await fetchImpl(url,{method:body?'POST':'GET',redirect:'error',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([deadline,AbortSignal.timeout(6000)])});}
    catch{fail(body?'WATCH_WRITE_UNCONFIRMED':'WATCH_SOURCE_UNAVAILABLE');}
    if(!response.ok){await response.body?.cancel().catch(()=>{});fail(body?'WATCH_WRITE_REJECTED':'WATCH_SOURCE_REJECTED');}
    return boundedSourceJson(response,3_000_000);
  }
  const dbHeaders={apikey:dbKey,Accept:'application/json','Content-Type':'application/json'};
  const ids=[...new Set(approvals.map(item=>item.match.fixtureId))];
  const cacheUrl=new URL('/rest/v1/analysis_cache',base);
  cacheUrl.search=new URLSearchParams({select:'cache_key,payload',cache_key:`in.(${ids.map(matchCenterCacheKey).join(',')})`,expires_at:`gt.${new Date(now).toISOString()}`,limit:String(ids.length)});
  report.cacheReads++;const rows=await request(cacheUrl,dbHeaders);
  if(!Array.isArray(rows)||rows.length>ids.length)fail('WATCH_CACHE_INVALID');
  const matches=new Map(rows.filter(row=>row.cache_key===matchCenterCacheKey(row.payload?.match?.fixtureId)).map(row=>[row.payload.match.fixtureId,row.payload.match]));
  const candidates=approvals.filter(item=>{
    const match=matches.get(item.match.fixtureId);
    if(!match){report.missingFixture++;return false;}
    if(watchFixtureIdentity(match)!==watchFixtureIdentity(item.match)){report.rejected++;return false;}
    return true;
  });
  const youtubeIds=[...new Set(candidates.filter(item=>item.provider==='youtube').map(item=>item.videoId))],videos=new Map();
  if(youtubeIds.length){
    const key=env.YOUTUBE_DATA_API_KEY;if(!key||key.length>512)fail('WATCH_YOUTUBE_KEY_MISSING');
    const headers={'X-Goog-Api-Key':key,Accept:'application/json'};
    const url=new URL('https://www.googleapis.com/youtube/v3/videos');url.search=new URLSearchParams({part:'snippet,status,contentDetails,liveStreamingDetails',id:youtubeIds.join(',')});
    report.youtubeRequests++;const data=await request(url,headers);
    if(!Array.isArray(data.items)||data.items.length>youtubeIds.length)fail('WATCH_VIDEO_RESPONSE_INVALID');
    for(const video of data.items)if(youtubeIds.includes(video.id))videos.set(video.id,video);
  }
  const catalogues=new Map(candidates.map(item=>{const match=matches.get(item.match.fixtureId);return [match.fixtureId,{version:1,fixtureIdentity:watchFixtureIdentity(match),items:[]}];}));
  for(const approval of candidates){
    const match=matches.get(approval.match.fixtureId),identity=watchFixtureIdentity(match);
    const source=approval.provider==='youtube'?approvedYoutubeItem(approval,videos.get(approval.videoId),match,now):approval;
    if(!source){report.rejected++;continue;}
    const expiresAt=new Date(Math.min(now+WATCH_TTL_MS,timestamp(approval.validUntil))).toISOString();
    const item={...source,approval:{version:1,confirmed:true,confirmedAt:approval.confirmedAt,fixtureIdentity:identity},checkedAt:new Date(now).toISOString(),expiresAt};
    const catalogue={version:1,fixtureIdentity:identity,items:[item]};
    if(!validatedWatchOptions(match,catalogue,{now,approvals}).length){report.rejected++;continue;}
    if(!catalogues.has(match.fixtureId))catalogues.set(match.fixtureId,{version:1,fixtureIdentity:identity,items:[]});
    catalogues.get(match.fixtureId).items.push(item);
  }
  for(const [fixtureId,payload] of catalogues){
    const fields={cache_key:watchCacheKey(fixtureId),fixture_id:fixtureId,payload,expires_at:new Date(Math.min(now+WATCH_TTL_MS,...payload.items.map(item=>timestamp(item.expiresAt)))).toISOString(),provider:'official-watch',source_updated_at:new Date(now).toISOString(),freshness_status:'fresh',updated_at:new Date(now).toISOString()};
    const body=Object.fromEntries(Object.entries(fields).map(([key,value])=>['p_'+key,value]));
    report.cacheWrites++;
    // No retry after unknown POST: the existing versioned RPC prevents overwriting newer data.
    const result=await request(new URL('/rest/v1/rpc/write_analysis_cache_versioned',base),dbHeaders,body);
    if(!result||typeof result.stored!=='boolean'||!['stored','same','superseded'].includes(result.reason))fail('WATCH_WRITE_UNCONFIRMED');
    if(result.stored)report.published+=payload.items.length;
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let report;try{report=await refreshMatchWatch({manifest:JSON.parse(readFileSync('src/match-watch-approvals.json','utf8'))});}
  catch(error){report={scope:'curated_watch_catalogue',errorCode:/^WATCH_[A-Z_]+$/.test(error.code||'')?error.code:'WATCH_REFRESH_FAILED'};process.exitCode=1;}
  mkdirSync('load-results',{recursive:true});writeFileSync('load-results/match-watch-refresh.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
