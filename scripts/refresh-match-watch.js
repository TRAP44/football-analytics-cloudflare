// Main-only reviewed sources: manual approvals and strict official league policies.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {boundedSourceJson} from './inspect-match-watch.js';
import {WATCH_COUNTRIES,WATCH_PUBLISHERS,WATCH_TTL_MS,WATCH_LIBRARY_KEY,watchFixtureIdentity,watchCacheKey,validatedWatchOptions,officialWatchUrl} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
import {automaticReplayEvidence,automaticHighlightsMatch,automaticHighlightsEvidence,WATCH_POLICIES} from '../src/match-watch-policy.js';
import {discoverMatchWatch} from './discover-match-watch.js';

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
    // Manual approval or strict league policy already checks category and fixture.
    if(!live&&!upcoming || Math.abs((Number.isFinite(scheduled)?scheduled:start)-Date.parse(match.date))>30*60000 || approval.policyId && live && Math.abs(start-Date.parse(match.date))>30*60000)return null;
  }else if(approval.kind==='highlights'&&approval.policyId){
    const policy=WATCH_POLICIES.find(item=>item.id===approval.policyId&&item.revision===approval.policyRevision);
    if(!automaticHighlightsMatch(policy,match,video.snippet.title,video.snippet.publishedAt,now,video.snippet.description)||!automaticHighlightsEvidence(details.duration,video.snippet.liveBroadcastContent,video.liveStreamingDetails))return null;
  }else if(!match.finished || video.snippet.liveBroadcastContent!=='none' || stream.actualEndTime && (!Number.isFinite(end)||end>now) || approval.policyId && !automaticReplayEvidence(match,stream.actualStartTime,stream.actualEndTime,now))return null;
  return {...approval,channelId:video.snippet.channelId,countries,publicVideo:true,regionVerified:true,ageRestricted:false,embeddable:video.status.embeddable===true,
    ...(approval.kind==='highlights'?{publishedAt:video.snippet.publishedAt,videoDescription:video.snippet.description||'',videoDuration:details.duration,broadcastKind:video.snippet.liveBroadcastContent,videoStream:video.liveStreamingDetails||null}:{}),
    availableFrom:Number.isFinite(scheduled)?new Date(scheduled).toISOString():null,
    replayStartedAt:approval.kind==='replay'&&Number.isFinite(start)?new Date(start).toISOString():null,replayEndedAt:approval.kind==='replay'&&Number.isFinite(end)?new Date(end).toISOString():null};
}
export async function refreshMatchWatch({env=process.env,manifest,fetchImpl=fetch,now=Date.now(),automatic=false}={}){
  const report={scope:automatic?'automatic_official_watch_catalogue':'curated_watch_catalogue',checkedAt:new Date(now).toISOString(),approvals:0,published:0,rejected:0,missingFixture:0,youtubeRequests:0,cacheReads:0,cacheWrites:0};
  let approvals=validateWatchApprovals(manifest,now);report.approvals=approvals.length;
  if(!approvals.length&&!automatic)return report;
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
  const youtube=async(path,params)=>{
    const key=env.YOUTUBE_DATA_API_KEY;if(!key||key.length>512)fail('WATCH_YOUTUBE_KEY_MISSING');
    if(++report.youtubeRequests>5)fail('WATCH_YOUTUBE_BUDGET');
    const url=new URL('https://www.googleapis.com/youtube/v3/'+path);url.search=new URLSearchParams(params);
    const data=await request(url,{'X-Goog-Api-Key':key,Accept:'application/json'});
    if(!Array.isArray(data.items)||data.items.length>50)fail('WATCH_VIDEO_RESPONSE_INVALID');return data.items;
  };
  const readCache=async(params)=>{
    const url=new URL('/rest/v1/analysis_cache',base);
    url.search=new URLSearchParams({select:'cache_key,payload',expires_at:`gt.${new Date(now).toISOString()}`,...params});
    report.cacheReads++;const rows=await request(url,dbHeaders);
    if(!Array.isArray(rows)||rows.length>Number(params.limit))fail('WATCH_CACHE_INVALID');return rows;
  };
  let sequence=0;
  const writeCache=async(cacheKey,fixtureId,payload,expiry)=>{
    const updatedAt=new Date(now+sequence++).toISOString();
    const fields={cache_key:cacheKey,fixture_id:fixtureId,payload,expires_at:new Date(expiry).toISOString(),provider:'official-watch',source_updated_at:updatedAt,freshness_status:'fresh',updated_at:updatedAt};
    const body=Object.fromEntries(Object.entries(fields).map(([key,value])=>['p_'+key,value]));
    report.cacheWrites++;
    const result=await request(new URL('/rest/v1/rpc/write_analysis_cache_versioned',base),dbHeaders,body);
    if(!result||typeof result.stored!=='boolean'||!['stored','same','superseded'].includes(result.reason))fail('WATCH_WRITE_UNCONFIRMED');
    if(!result.stored && fixtureId===0)fail('WATCH_DISCOVERY_WRITE_UNCONFIRMED');
    return result.stored;
  };
  let discovery;
  if(automatic){
    discovery=await discoverMatchWatch({readCache,writeCache,youtube,approvals,now,report});
    // Prefer policy verification over a matching legacy per-video approval.
    approvals=approvals.filter(item=>!discovery.automatic.some(auto=>auto.eventUrl===item.eventUrl&&auto.match.fixtureId===item.match.fixtureId)).concat(discovery.automatic);
  }
  const ids=[...new Set(approvals.map(item=>item.match.fixtureId))];
  const cacheUrl=new URL('/rest/v1/analysis_cache',base);
  cacheUrl.search=new URLSearchParams({select:'cache_key,payload',cache_key:`in.(${ids.map(matchCenterCacheKey).join(',')})`,expires_at:`gt.${new Date(now).toISOString()}`,limit:String(ids.length)});
  if(ids.length)report.cacheReads++;const rows=ids.length?await request(cacheUrl,dbHeaders):[];
  if(!Array.isArray(rows)||rows.length>ids.length)fail('WATCH_CACHE_INVALID');
  const matches=new Map(rows.filter(row=>row.cache_key===matchCenterCacheKey(row.payload?.match?.fixtureId)).map(row=>[row.payload.match.fixtureId,row.payload.match]));
  const candidates=approvals.filter(item=>{
    let match=matches.get(item.match.fixtureId);
    if(!match){
      report.missingFixture++;
      const evidence=item.fixtureEvidence,observed=timestamp(evidence?.observedAt);
      if(evidence?.provider!=='api-football' || evidence.fixtureIdentity!==watchFixtureIdentity(item.match) || !Number.isFinite(observed) || observed>now || now-observed>(item.policyId&&['replay','highlights'].includes(item.kind)?7*86400000:48*3600000))return false;
      // Reviewed provider identity can prepare a catalogue before the first visitor.
      // The public API still requires the independent fresh Match Center identity.
      match=item.match;matches.set(match.fixtureId,match);report.approvedFixtureFallbacks=(report.approvedFixtureFallbacks||0)+1;
    }
    if(watchFixtureIdentity(match)!==watchFixtureIdentity(item.match)){report.rejected++;return false;}
    return true;
  });
  const youtubeIds=[...new Set(candidates.filter(item=>item.provider==='youtube').map(item=>item.videoId))],videos=new Map();
  if(discovery){for(const video of discovery.videos)videos.set(video.id,video);}
  else if(youtubeIds.length){for(const video of await youtube('videos',{part:'snippet,status,contentDetails,liveStreamingDetails',id:youtubeIds.join(',')}))if(youtubeIds.includes(video.id))videos.set(video.id,video);}
  const catalogues=new Map(candidates.map(item=>{const match=matches.get(item.match.fixtureId);return [match.fixtureId,{version:1,fixtureIdentity:watchFixtureIdentity(match),items:[]}];}));
  for(const match of discovery?.cleanup||[])if(!catalogues.has(match.fixtureId))catalogues.set(match.fixtureId,{version:1,fixtureIdentity:watchFixtureIdentity(match),items:[]});
  for(const approval of candidates){
    const match=matches.get(approval.match.fixtureId),identity=watchFixtureIdentity(match);
    const source=approval.provider==='youtube'?approvedYoutubeItem(approval,videos.get(approval.videoId),match,now):approval;
    if(!source){report.rejected++;continue;}
    const expiresAt=new Date(Math.min(now+WATCH_TTL_MS,timestamp(approval.validUntil))).toISOString();
    const item={...source,approval:{version:approval.policyId?2:1,policyId:approval.policyId,policyRevision:approval.policyRevision,confirmed:true,confirmedAt:approval.confirmedAt,fixtureIdentity:identity},checkedAt:new Date(now).toISOString(),expiresAt};
    const catalogue={version:1,fixtureIdentity:identity,items:[item]};
    if(!validatedWatchOptions(match,catalogue,{now,approvals}).length){report.rejected++;continue;}
    if(!catalogues.has(match.fixtureId))catalogues.set(match.fixtureId,{version:1,fixtureIdentity:identity,items:[]});
    catalogues.get(match.fixtureId).items.push(item);
  }
  const library=[];
  for(const [fixtureId,payload] of catalogues){
    const stored=await writeCache(watchCacheKey(fixtureId),fixtureId,payload,Math.min(now+WATCH_TTL_MS,...payload.items.map(item=>timestamp(item.expiresAt))));
    if(stored){
      if(payload.items.length)library.push({match:matches.get(fixtureId),catalogue:payload});
      report.published+=payload.items.length;
      const automaticItems=payload.items.filter(item=>item.approval.version===2);
      report.automaticPublished=(report.automaticPublished||0)+automaticItems.length;
      if(automatic)(report.automaticItems||=[]).push(...automaticItems.map(item=>({fixtureId,videoId:item.videoId,kind:item.kind})));
    }
  }
  // A single bounded cache read serves the library; no per-card provider/DB
  // fan-out on the home screen. Only successfully stored catalogues enter it.
  const entries=library.sort((a,b)=>Number(b.catalogue.items.some(item=>item.kind==='live'))-Number(a.catalogue.items.some(item=>item.kind==='live'))||timestamp(b.match.date)-timestamp(a.match.date)).slice(0,20);
  await writeCache(WATCH_LIBRARY_KEY,0,{version:1,checkedAt:new Date(now).toISOString(),entries},now+WATCH_TTL_MS);
  report.libraryMatches=entries.length;
  report.libraryFixtureIds=entries.map(entry=>entry.match.fixtureId);
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let report;try{report=await refreshMatchWatch({manifest:JSON.parse(readFileSync('src/match-watch-approvals.json','utf8')),automatic:true});}
  catch(error){report={scope:'curated_watch_catalogue',errorCode:/^WATCH_[A-Z_]+$/.test(error.code||'')?error.code:'WATCH_REFRESH_FAILED'};process.exitCode=1;}
  if(report.discoveryError)process.exitCode=1;
  mkdirSync('load-results',{recursive:true});writeFileSync('load-results/match-watch-refresh.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
