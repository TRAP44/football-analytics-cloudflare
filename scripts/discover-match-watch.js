// Bounded official discovery: cheap uploads feeds, independent source checks.
import {ISL_CHANNEL} from '../src/isl-watch-policy.js';
import {WATCH_POLICIES,automaticWatchMatch,automaticWatchValidUntil,automaticHighlightsMatch,automaticHighlightsEvidence,automaticReplayEvidence,youtubeWatchCountries} from '../src/match-watch-policy.js';
import {watchFixtureIdentity} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
export const WATCH_DISCOVERY_KEY='match-watch-discovery:v5';
export const WATCH_V4_DISCOVERY_KEY='match-watch-discovery:v4';
export const WATCH_PREVIOUS_DISCOVERY_KEY='match-watch-discovery:v3';
export const WATCH_V2_DISCOVERY_KEY='match-watch-discovery:v2';
export const WATCH_LEGACY_DISCOVERY_KEY='match-watch-discovery:v1';
export const WATCH_DISCOVERY_INTERVAL=2*3600000;
const JLEAGUE='UCmQp6ZaAejJKKkXc_Y_lh1A';
const videoId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{11}$/.test(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validTime=(value,now,maxAge)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<=maxAge;
const idsValid=(ids,max)=>Array.isArray(ids)&&ids.length<=max&&ids.every(videoId);
function feedMapValid(value,max,now,channelsMax=7){
 if(value===undefined)return true;
 return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=channelsMax&&Object.entries(value).every(([key,item])=>/^UC[A-Za-z0-9_-]{22}$/.test(key)&&item&&idsValid(item.ids,key===ISL_CHANNEL?Math.min(max,20):max)&&validTime(item.attemptedAt,now,72*3600000));
}
export async function discoverMatchWatch({readCache,writeCache,youtube,approvals,now,report,policies=WATCH_POLICIES,loadFixtureDays,additionalApprovals}={}){
 let stateRows=[],stateKey=WATCH_DISCOVERY_KEY,stateVersion=5;
 for(const [key,version] of [[WATCH_DISCOVERY_KEY,5],[WATCH_V4_DISCOVERY_KEY,4],[WATCH_PREVIOUS_DISCOVERY_KEY,3],[WATCH_V2_DISCOVERY_KEY,2],[WATCH_LEGACY_DISCOVERY_KEY,1]]){stateKey=key;stateVersion=version;stateRows=await readCache({cache_key:`eq.${key}`,limit:'1'});if(stateRows.length)break;}
 if(!stateRows.length){stateKey=WATCH_DISCOVERY_KEY;stateVersion=5;}
 const legacy=stateVersion===1;
 if(stateRows.length>1)fail('WATCH_DISCOVERY_STATE_INVALID');
 const previous=stateRows[0]?.payload;
 if(previous&&(stateRows[0].cache_key!==stateKey||previous.version!==stateVersion||!validTime(previous.attemptedAt,now,72*3600000)||!idsValid(previous.videoIds,legacy?30:stateVersion===2?330:stateVersion===3?380:stateVersion===4?430:470)||!Array.isArray(previous.bindings)||previous.bindings.length>(legacy?20:100)||previous.bindings.some(binding=>!binding||!watchFixtureIdentity(binding.match)||binding.videoIds!==undefined&&!idsValid(binding.videoIds,legacy?5:2))))fail('WATCH_DISCOVERY_STATE_INVALID');
 const state=previous?structuredClone(previous):{attemptedAt:new Date(now).toISOString(),videoIds:[],bindings:[]};state.version=5;
 if(state.uploadsAttemptedAt!==undefined&&!validTime(state.uploadsAttemptedAt,now,72*3600000)||state.uploadIds!==undefined&&!idsValid(state.uploadIds,legacy?15:stateVersion===2?250:stateVersion===3?300:stateVersion===4?350:370)||!feedMapValid(state.liveFeeds,40,now,stateVersion<3?5:stateVersion===3?6:stateVersion===4?7:8)||!feedMapValid(state.uploadFeeds,50,now,stateVersion<3?5:stateVersion===3?6:stateVersion===4?7:8))fail('WATCH_DISCOVERY_STATE_INVALID');
 if(previous&&stateVersion<5)report.discoveryMigration=`v${stateVersion}_to_v5`;
 if(legacy)state.bindings=state.bindings.map(binding=>({...binding,videoIds:(binding.videoIds||[]).slice(0,2)}));
 state.liveFeeds||={};state.uploadFeeds||={};
 if(previous&&!state.liveFeeds[JLEAGUE])state.liveFeeds[JLEAGUE]={attemptedAt:state.attemptedAt,ids:state.videoIds.filter(id=>!state.uploadIds?.includes(id)).slice(0,40)};
 if(state.uploadsAttemptedAt&&!state.uploadFeeds[JLEAGUE])state.uploadFeeds[JLEAGUE]={attemptedAt:state.uploadsAttemptedAt,ids:state.uploadIds||[]};
 const channelMap=new Map();for(const policy of policies){if(!channelMap.has(policy.channelId))channelMap.set(policy.channelId,[]);channelMap.get(policy.channelId).push(policy);}
 const channels=[...channelMap.entries()];
 if(channels.length>8||channels.filter(([,items])=>items.some(item=>!item.highlightsOnly)).length>3)fail('WATCH_POLICY_LIMIT');
 for(const map of [state.liveFeeds,state.uploadFeeds])for(const id of Object.keys(map))if(!channelMap.has(id))delete map[id];
 const retained=state.bindings.filter(binding=>validTime(binding.observedAt,now,7*86400000)&&Date.parse(binding.match.date)+7*86400000>now);
 const searches=channels.filter(([id,items])=>items.some(item=>!item.highlightsOnly)&&(!previous||!state.liveFeeds[id]||now-Date.parse(id===JLEAGUE?state.attemptedAt:state.liveFeeds[id].attemptedAt)>=Math.min(...items.filter(item=>!item.highlightsOnly).map(item=>item.searchIntervalMs||WATCH_DISCOVERY_INTERVAL))));
 const uploads=channels.filter(([id,items])=>items.some(item=>item.highlights||item.uploads)&&(!state.uploadFeeds[id]||items.some(item=>(item.highlights||item.uploads)&&item.uploadsIntervalMs===300000)||id===JLEAGUE&&!state.uploadsAttemptedAt||now-Date.parse(id===JLEAGUE?state.uploadsAttemptedAt:state.uploadFeeds[id].attemptedAt)>=Math.min(...items.filter(item=>item.highlights||item.uploads).map(item=>item.uploadsIntervalMs||WATCH_DISCOVERY_INTERVAL))));
 let discoveryFailed=false,searched=false,uploaded=false;
 if(searches.length||uploads.length){
  const at=new Date(now).toISOString();
  for(const [id] of searches){state.liveFeeds[id]={...state.liveFeeds[id],ids:state.liveFeeds[id]?.ids||[],attemptedAt:at};if(id===JLEAGUE)state.attemptedAt=at;}
  for(const [id] of uploads){state.uploadFeeds[id]={...state.uploadFeeds[id],ids:state.uploadFeeds[id]?.ids||[],attemptedAt:at};if(id===JLEAGUE)state.uploadsAttemptedAt=at;}
  await writeCache(WATCH_DISCOVERY_KEY,0,state,now+72*3600000);
  for(const [id,itemsForChannel] of searches){
   const cap=Math.min(...itemsForChannel.filter(p=>!p.highlightsOnly).map(p=>p.searchMaxResults||20));
   const fresh=new Set();let complete=true,success=false;
   for(const eventType of ['live','upcoming']){
    try{const items=await youtube('search',{part:'id',channelId:id,type:'video',eventType,regionCode:'RU',maxResults:String(cap)});
     if(items.length>cap||items.some(item=>!videoId(item?.id?.videoId)))fail('WATCH_DISCOVERY_RESPONSE_INVALID');
     for(const item of items)fresh.add(item.id.videoId);success=true;searched=true;
    }catch{complete=false;discoveryFailed=true;if(!(report.failedFeeds||=[]).includes('live_search'))report.failedFeeds.push('live_search');}
   }
   if(success)state.liveFeeds[id].ids=[...new Set([...fresh,...(complete?[]:state.liveFeeds[id].ids)])].slice(0,cap*2);
  }
  for(const [id,itemsForChannel] of uploads){
   const cap=Math.min(...itemsForChannel.map(p=>p.uploadsMaxResults||50));
   try{const items=await youtube('playlistItems',{part:'contentDetails',playlistId:'UU'+id.slice(2),maxResults:String(cap)});
    if(items.length>cap||items.some(item=>!videoId(item?.contentDetails?.videoId)))fail('WATCH_DISCOVERY_RESPONSE_INVALID');
    state.uploadFeeds[id].ids=[...new Set(items.map(item=>item.contentDetails.videoId))];uploaded=true;
   }catch{discoveryFailed=true;(report.failedFeeds||=[]).push('uploads');}
  }
  state.uploadIds=[...new Set(Object.values(state.uploadFeeds).flatMap(feed=>feed.ids))];
  state.videoIds=[...new Set([...Object.values(state.liveFeeds).flatMap(feed=>feed.ids),...state.uploadIds])];
  if(state.videoIds.length>470||state.uploadIds.length>370)fail('WATCH_DISCOVERY_STATE_INVALID');
  if(searched||uploaded)state.discoveredAt=at;
  report.discovery=discoveryFailed?(searched||uploaded?'partial':'failed_retaining_previous'):searched?'searched':'uploads_searched';
 }else report.discovery='cached';
 const ids=[...new Set([...state.videoIds,...approvals.filter(item=>item.provider==='youtube').map(item=>item.videoId),...retained.flatMap(binding=>binding.videoIds||[])])];
 if(ids.length>690)fail('WATCH_VIDEO_BUDGET');
 const videos=[];
 for(let index=0;index<ids.length;index+=50)videos.push(...await youtube('videos',{part:'snippet,status,contentDetails,liveStreamingDetails',id:ids.slice(index,index+50).join(',')}));
 if(videos.length>ids.length)fail('WATCH_VIDEO_RESPONSE_INVALID');
 const seen=new Set();for(const video of videos){if(!ids.includes(video?.id)||seen.has(video.id))fail('WATCH_VIDEO_RESPONSE_INVALID');seen.add(video.id);}
 const external=typeof loadFixtureDays==='function'?await loadFixtureDays(videos,policies):[];
  const dates=Array.from({length:9},(_,index)=>new Date(now+(index-7)*86400000).toISOString().slice(0,10));
  const rows=await readCache({cache_key:`in.(${dates.map(date=>`provider-fixtures:${date}:v1`).join(',')})`,limit:'9'});
  const matches=new Map();
  const put=(match,observedAt,maxAge=48*3600000)=>{if(watchFixtureIdentity(match)&&validTime(observedAt,now,maxAge)&&(!matches.has(match.fixtureId)||Date.parse(observedAt)>=Date.parse(matches.get(match.fixtureId).observedAt)))matches.set(match.fixtureId,{match,observedAt});};
  for(const binding of retained)put(binding.match,binding.observedAt,7*86400000);
  for(const approval of approvals){const e=approval.fixtureEvidence;if(e?.provider==='api-football'&&e.fixtureIdentity===watchFixtureIdentity(approval.match))put(approval.match,e.observedAt,['replay','highlights'].includes(approval.kind)?7*86400000:48*3600000);}
  for(const item of external)put(item.match,item.observedAt,7*86400000);
  for(const row of rows){
    const payload=row?.payload;
    if(!dates.includes(payload?.date)||row.cache_key!==`provider-fixtures:${payload.date}:v1`||!validTime(payload.fetchedAt,now,48*3600000)||!Array.isArray(payload.fixtures)||payload.fixtures.length>2000)continue;
    for(const raw of payload.fixtures){
      const status=raw.fixture?.status?.short;
      put({fixtureId:raw.fixture?.id,date:raw.fixture?.date,status,home:raw.teams?.home,away:raw.teams?.away,leagueId:raw.league?.id,league:raw.league?.name,season:raw.league?.season,round:raw.league?.round,score:raw.goals,finished:['FT','AET','PEN'].includes(status)},payload.fetchedAt);
    }
  }
  // A directly opened centre is also canonical even when the broad day feed is absent.
  const centers=policies.length?await readCache({select:'cache_key,payload,source_updated_at,updated_at',cache_key:'like.match-center:*:v17-event-evidence-rc144','payload->match->>leagueId':`in.(${policies.map(policy=>policy.leagueId).join(',')})`,order:'updated_at.desc',limit:'100'}):[];
  for(const row of centers)if(row.cache_key===matchCenterCacheKey(row.payload?.match?.fixtureId))put(row.payload.match,row.source_updated_at??row.updated_at);
 const chosen=new Map();
 for(const video of videos){
  const candidates=policies.filter(policy=>policy.channelId===video.snippet?.channelId&&youtubeWatchCountries(video,policy.countries).length).flatMap(policy=>[...matches.values()].flatMap(({match,observedAt})=>{
   const highlight=automaticHighlightsMatch(policy,match,video.snippet.title,video.snippet.publishedAt,now,video.snippet.description)&&automaticHighlightsEvidence(video.contentDetails?.duration,video.snippet.liveBroadcastContent,video.liveStreamingDetails,policy.maxHighlightsSeconds);
   const kind=highlight?'highlights':match.finished?'replay':'live';
   return highlight||automaticWatchMatch(policy,match,video.snippet.title,video.liveStreamingDetails?.scheduledStartTime,now,kind,video.snippet.description)&&(kind!=='replay'||automaticReplayEvidence(match,video.liveStreamingDetails?.actualStartTime,video.liveStreamingDetails?.actualEndTime,now,policy))?[{policy,match,observedAt,kind}]:[];
  }));
  if(candidates.length!==1){
   report.ambiguousOrUnmatched=(report.ambiguousOrUnmatched||0)+1;
   if(/highlights|resumen|SPL:/i.test(video.snippet?.title||'')&&(report.unmatchedHighlights||=[]).length<10)report.unmatchedHighlights.push({videoId:video.id,title:String(video.snippet.title).slice(0,220),publishedAt:video.snippet.publishedAt||null,description:String(video.snippet.description||'').slice(0,2000),duration:video.contentDetails?.duration||null});
   continue;
  }
  const candidate=candidates[0],key=candidate.match.fixtureId;
  if(!chosen.has(key)&&chosen.size>=100)continue;
  if(!chosen.has(key))chosen.set(key,new Map());
  const type=candidate.kind==='highlights'?'highlights':'record',previous=chosen.get(key).get(type);
  const countries=youtubeWatchCountries(video,candidate.policy.countries),rank=Number(countries.includes('RU'))*100+Number(video.status?.embeddable===true)*10+countries.length;
  if(!previous||rank>previous.rank||rank===previous.rank&&Date.parse(video.snippet.publishedAt)>Date.parse(previous.video.snippet.publishedAt))chosen.get(key).set(type,{...candidate,video,rank});
 }
 const automatic=[...chosen.values()].flatMap(group=>[...group.values()].map(({policy,match,observedAt,kind,video})=>({match,provider:'youtube',publisher:policy.publisher,videoId:video.id,eventUrl:`https://www.youtube.com/watch?v=${video.id}`,kind,access:'free',label:kind==='highlights'?policy.highlightsLabel||'Обзор J.LEAGUE':kind==='replay'?policy.replayLabel||'Полная запись J.LEAGUE':policy.label,countries:[...policy.countries],confirmed:true,confirmedAt:new Date(now).toISOString(),validUntil:new Date(automaticWatchValidUntil(policy,match,kind)).toISOString(),videoTitle:video.snippet.title,policyId:policy.id,policyRevision:policy.revision,fixtureEvidence:{provider:'api-football',observedAt,fixtureIdentity:watchFixtureIdentity(match)}})));
 const extra=typeof additionalApprovals==='function'?additionalApprovals([...matches.values()]):[],matchedIds=new Set(automatic.map(item=>item.match.fixtureId));
 if(!Array.isArray(extra)||extra.length>100)fail('WATCH_ADDITIONAL_SOURCE_INVALID');
 for(const item of extra){if(matchedIds.has(item.match.fixtureId)||matchedIds.size<100){automatic.push(item);matchedIds.add(item.match.fixtureId);}}
 report.automaticMatched=automatic.length;
 const cleanup=retained.map(binding=>binding.match),bindings=new Map(retained.map(binding=>[binding.match.fixtureId,binding]));
 for(const [id,group] of chosen){const items=[...group.values()];bindings.set(id,{match:items[0].match,observedAt:items[0].observedAt,videoIds:items.map(item=>item.video.id)});}
 for(const item of automatic.filter(item=>item.provider==='kleaguetv')){const previous=bindings.get(item.match.fixtureId);bindings.set(item.match.fixtureId,{match:item.match,observedAt:item.fixtureEvidence.observedAt,videoIds:previous?.videoIds||[]});}
 state.bindings=[...bindings.values()].sort((a,b)=>Date.parse(b.match.date)-Date.parse(a.match.date)).slice(0,100);
 await writeCache(WATCH_DISCOVERY_KEY,0,state,now+72*3600000);
 if(discoveryFailed)report.discoveryError='WATCH_DISCOVERY_SEARCH_FAILED';
 return {automatic,videos,cleanup,fixtures:[...matches.values()]};
}
