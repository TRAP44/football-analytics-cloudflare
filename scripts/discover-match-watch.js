// Main-only bounded discovery. No football-provider requests and no user data.
import {WATCH_POLICIES,automaticWatchMatch,automaticWatchValidUntil,automaticHighlightsMatch,automaticHighlightsEvidence} from '../src/match-watch-policy.js';
import {watchFixtureIdentity} from '../src/match-watch.js';
import {matchCenterCacheKey} from '../src/match-center-cache-key.js';
export const WATCH_DISCOVERY_KEY='match-watch-discovery:v1';
export const WATCH_DISCOVERY_INTERVAL=2*3600000;
const videoId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{11}$/.test(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const validTime=(value,now,maxAge)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=now&&now-Date.parse(value)<=maxAge;
export async function discoverMatchWatch({readCache,writeCache,youtube,approvals,now,report,policies=WATCH_POLICIES}){
  const stateRows=await readCache({cache_key:`eq.${WATCH_DISCOVERY_KEY}`,limit:'1'});
  if(stateRows.length>1)fail('WATCH_DISCOVERY_STATE_INVALID');
  const previous=stateRows[0]?.payload;
  if(previous && (stateRows[0].cache_key!==WATCH_DISCOVERY_KEY || previous.version!==1 || !validTime(previous.attemptedAt,now,72*3600000) || !Array.isArray(previous.videoIds)||previous.videoIds.length>30||previous.videoIds.some(id=>!videoId(id))||!Array.isArray(previous.bindings)||previous.bindings.length>20||previous.bindings.some(binding=>!binding||!watchFixtureIdentity(binding.match)||binding.videoIds!==undefined&&(!Array.isArray(binding.videoIds)||binding.videoIds.length>5||binding.videoIds.some(id=>!videoId(id))))))fail('WATCH_DISCOVERY_STATE_INVALID');
  const state=previous?structuredClone(previous):{version:1,attemptedAt:new Date(0).toISOString(),videoIds:[],bindings:[]};
  if(state.uploadsAttemptedAt!==undefined&&!validTime(state.uploadsAttemptedAt,now,72*3600000))fail('WATCH_DISCOVERY_STATE_INVALID');
  if(state.uploadIds!==undefined&&(!Array.isArray(state.uploadIds)||state.uploadIds.length>15||state.uploadIds.some(id=>!videoId(id))))fail('WATCH_DISCOVERY_STATE_INVALID');
  const retained=state.bindings.filter(binding=>validTime(binding.observedAt,now,7*86400000)&&Date.parse(binding.match.date)+7*86400000>now);
  let discoveryFailed=false;
  const searchDue=!previous||now-Date.parse(previous.attemptedAt)>=WATCH_DISCOVERY_INTERVAL;
  const uploadsDue=policies.some(policy=>policy.highlights)&&(!state.uploadsAttemptedAt||now-Date.parse(state.uploadsAttemptedAt)>=WATCH_DISCOVERY_INTERVAL);
  if(searchDue||uploadsDue){
    // Persist the attempt BEFORE spending search quota. Shared workflow concurrency
    // serializes manual/clock jobs; an unknown write is never retried or searched.
    if(searchDue)state.attemptedAt=new Date(now).toISOString();
    if(uploadsDue)state.uploadsAttemptedAt=new Date(now).toISOString();
    await writeCache(WATCH_DISCOVERY_KEY,0,state,now+72*3600000);
    let found=new Set(state.videoIds.filter(id=>!state.uploadIds?.includes(id))),uploads=new Set(state.uploadIds||[]);
    let searched=false,uploaded=false;
    if(searchDue){
      try{
        const fresh=new Set();
        for(const policy of policies)for(const eventType of ['live','upcoming']){
          const items=await youtube('search',{part:'id',channelId:policy.channelId,type:'video',eventType,regionCode:'RU',maxResults:'20'});
          if(items.length>20)fail('WATCH_DISCOVERY_RESPONSE_INVALID');
          for(const item of items){if(!videoId(item?.id?.videoId))fail('WATCH_DISCOVERY_RESPONSE_INVALID');fresh.add(item.id.videoId);}
        }
        found=fresh;searched=true;
      }catch{discoveryFailed=true;(report.failedFeeds||=[]).push('live_search');}
    }
    if(uploadsDue){
      try{
        const fresh=new Set();
        for(const policy of policies.filter(item=>item.highlights)){
          // The pinned official channel uploads playlist, one bounded page.
          // One quota unit rather than a new 100-unit text search.
          const items=await youtube('playlistItems',{part:'contentDetails',playlistId:'UU'+policy.channelId.slice(2),maxResults:'20'});
          if(items.length>20)fail('WATCH_DISCOVERY_RESPONSE_INVALID');
          for(const item of items){const id=item?.contentDetails?.videoId;if(!videoId(id))fail('WATCH_DISCOVERY_RESPONSE_INVALID');fresh.add(id);}
        }
        uploads=fresh;uploaded=true;
      }catch{discoveryFailed=true;(report.failedFeeds||=[]).push('uploads');}
    }
    if(searched||uploaded){
      state.uploadIds=[...uploads].slice(0,15);
      state.videoIds=[...new Set([...found].slice(0,15).concat(state.uploadIds))].slice(0,30);
      state.discoveredAt=new Date(now).toISOString();
    }
    report.discovery=discoveryFailed?(searched||uploaded?'partial':'failed_retaining_previous'):searched?'searched':'uploads_searched';
  }else report.discovery='cached';
  // Fresh per-video metadata is checked every tick, including deleted/private IDs.
  const ids=[...new Set([...state.videoIds,...approvals.filter(item=>item.provider==='youtube').map(item=>item.videoId),...retained.flatMap(binding=>binding.videoIds||[])])].slice(0,50);
  const videos=ids.length?await youtube('videos',{part:'snippet,status,contentDetails,liveStreamingDetails',id:ids.join(',')}):[];
  if(videos.length>ids.length)fail('WATCH_VIDEO_RESPONSE_INVALID');
  const seen=new Set();
  for(const video of videos){if(!ids.includes(video?.id)||seen.has(video.id))fail('WATCH_VIDEO_RESPONSE_INVALID');seen.add(video.id);}
  const dates=Array.from({length:9},(_,index)=>new Date(now+(index-7)*86400000).toISOString().slice(0,10));
  const rows=await readCache({cache_key:`in.(${dates.map(date=>`provider-fixtures:${date}:v1`).join(',')})`,limit:'9'});
  const matches=new Map();
  const put=(match,observedAt,maxAge=48*3600000)=>{if(watchFixtureIdentity(match)&&validTime(observedAt,now,maxAge))matches.set(match.fixtureId,{match,observedAt});};
  for(const binding of retained)put(binding.match,binding.observedAt,7*86400000);
  for(const approval of approvals){const e=approval.fixtureEvidence;if(e?.provider==='api-football'&&e.fixtureIdentity===watchFixtureIdentity(approval.match))put(approval.match,e.observedAt,['replay','highlights'].includes(approval.kind)?7*86400000:48*3600000);}
  for(const row of rows){
    const payload=row?.payload;
    if(!dates.includes(payload?.date)||row.cache_key!==`provider-fixtures:${payload.date}:v1`||!validTime(payload.fetchedAt,now,48*3600000)||!Array.isArray(payload.fixtures)||payload.fixtures.length>2000)continue;
    for(const raw of payload.fixtures){
      const status=raw.fixture?.status?.short;
      put({fixtureId:raw.fixture?.id,date:raw.fixture?.date,status,home:raw.teams?.home,away:raw.teams?.away,leagueId:raw.league?.id,league:raw.league?.name,season:raw.league?.season,round:raw.league?.round,finished:['FT','AET','PEN'].includes(status)},payload.fetchedAt);
    }
  }
  // A directly opened centre is also canonical even when the broad day feed is absent.
  const centers=policies.length?await readCache({cache_key:'like.match-center:*:v17-event-evidence-rc144','payload->match->>leagueId':`in.(${policies.map(policy=>policy.leagueId).join(',')})`,order:'updated_at.desc',limit:'100'}):[];
  for(const row of centers)if(row.cache_key===matchCenterCacheKey(row.payload?.match?.fixtureId))put(row.payload.match,new Date(now).toISOString());
  const automatic=[];
  for(const video of videos){
    const policy=policies.find(item=>item.channelId===video.snippet?.channelId);
    if(!policy)continue;
    const candidates=[...matches.values()].flatMap(({match,observedAt})=>{
      const highlight=automaticHighlightsMatch(policy,match,video.snippet.title,video.snippet.publishedAt,now)&&automaticHighlightsEvidence(video.contentDetails?.duration,video.snippet.liveBroadcastContent,video.liveStreamingDetails);
      const kind=highlight?'highlights':match.finished?'replay':'live';
      return highlight||automaticWatchMatch(policy,match,video.snippet.title,video.liveStreamingDetails?.scheduledStartTime,now,kind)?[{match,observedAt,kind}]:[];
    });
    if(candidates.length!==1){
      report.ambiguousOrUnmatched=(report.ambiguousOrUnmatched||0)+1;
      // Bounded public research evidence; never an approval or a published link.
      if(/highlights/i.test(video.snippet?.title||'')&&(report.unmatchedHighlights||=[]).length<6)report.unmatchedHighlights.push({videoId:video.id,title:String(video.snippet.title).slice(0,220),publishedAt:video.snippet.publishedAt||null});
      continue;
    }
    if(automatic.length>=20)break;
    if(automatic.filter(item=>item.match.fixtureId===candidates[0].match.fixtureId).length>=5)continue;
    const {match,observedAt,kind}=candidates[0];
    automatic.push({match,provider:'youtube',publisher:policy.publisher,videoId:video.id,eventUrl:`https://www.youtube.com/watch?v=${video.id}`,kind,access:'free',label:kind==='highlights'?'Обзор J.LEAGUE':kind==='replay'?'Полная запись J.LEAGUE':policy.label,countries:[...policy.countries],confirmed:true,confirmedAt:new Date(now).toISOString(),validUntil:new Date(automaticWatchValidUntil(policy,match,kind)).toISOString(),videoTitle:video.snippet.title,policyId:policy.id,policyRevision:policy.revision,fixtureEvidence:{provider:'api-football',observedAt,fixtureIdentity:watchFixtureIdentity(match)}});
  }
  report.automaticMatched=automatic.length;
  // Retain bound video IDs even after search stops returning ended streams.
  // Public/private/deleted metadata is still checked on every normal tick.
  const cleanup=retained.map(binding=>binding.match);
  const bindings=new Map(retained.map(binding=>[binding.match.fixtureId,{...binding,videoIds:binding.videoIds||[]}]));
  for(const item of automatic){
    const prior=bindings.get(item.match.fixtureId);
    bindings.set(item.match.fixtureId,{match:item.match,observedAt:item.fixtureEvidence.observedAt,videoIds:[...new Set([item.videoId,...prior?.videoIds||[]])].slice(0,5)});
  }
  state.bindings=[...bindings.values()].sort((a,b)=>Date.parse(b.match.date)-Date.parse(a.match.date)).slice(0,20);
  await writeCache(WATCH_DISCOVERY_KEY,0,state,now+72*3600000);
  if(discoveryFailed)report.discoveryError='WATCH_DISCOVERY_SEARCH_FAILED';
  return {automatic,videos,cleanup};
}
