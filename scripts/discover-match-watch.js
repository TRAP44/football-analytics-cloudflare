// Main-only bounded discovery. No football-provider requests and no user data.
import {WATCH_POLICIES,automaticWatchMatch} from '../src/match-watch-policy.js';
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
  if(previous && (stateRows[0].cache_key!==WATCH_DISCOVERY_KEY || previous.version!==1 || !validTime(previous.attemptedAt,now,72*3600000) || !Array.isArray(previous.videoIds)||previous.videoIds.length>30||previous.videoIds.some(id=>!videoId(id))||!Array.isArray(previous.bindings)||previous.bindings.length>20))fail('WATCH_DISCOVERY_STATE_INVALID');
  const state=previous?structuredClone(previous):{version:1,attemptedAt:new Date(0).toISOString(),videoIds:[],bindings:[]};
  let discoveryFailed=false;
  if(!previous || now-Date.parse(previous.attemptedAt)>=WATCH_DISCOVERY_INTERVAL){
    // Persist the attempt BEFORE spending search quota. Shared workflow concurrency
    // serializes manual/clock jobs; an unknown write is never retried or searched.
    state.attemptedAt=new Date(now).toISOString();
    await writeCache(WATCH_DISCOVERY_KEY,0,state,now+72*3600000);
    const found=new Set();
    try{
      for(const policy of policies){
        for(const eventType of ['live','upcoming']){
          const items=await youtube('search',{part:'id',channelId:policy.channelId,type:'video',eventType,regionCode:'RU',maxResults:'20'});
          if(items.length>20)fail('WATCH_DISCOVERY_RESPONSE_INVALID');
          for(const item of items){if(!videoId(item?.id?.videoId))fail('WATCH_DISCOVERY_RESPONSE_INVALID');found.add(item.id.videoId);}
        }
      }
      state.videoIds=[...found].slice(0,30);
      state.discoveredAt=new Date(now).toISOString();report.discovery='searched';
    }catch{discoveryFailed=true;report.discovery='failed_retaining_previous';}
  }else report.discovery='cached';
  // Fresh per-video metadata is checked every tick, including deleted/private IDs.
  const ids=[...new Set([...state.videoIds,...approvals.filter(item=>item.provider==='youtube').map(item=>item.videoId)])];
  const videos=ids.length?await youtube('videos',{part:'snippet,status,contentDetails,liveStreamingDetails',id:ids.join(',')}):[];
  if(videos.length>ids.length)fail('WATCH_VIDEO_RESPONSE_INVALID');
  const seen=new Set();
  for(const video of videos){if(!ids.includes(video?.id)||seen.has(video.id))fail('WATCH_VIDEO_RESPONSE_INVALID');seen.add(video.id);}
  const dates=[0,86400000].map(offset=>new Date(now+offset).toISOString().slice(0,10));
  const rows=await readCache({cache_key:`in.(${dates.map(date=>`provider-fixtures:${date}:v1`).join(',')})`,limit:'2'});
  const matches=new Map();
  const put=(match,observedAt)=>{if(watchFixtureIdentity(match)&&validTime(observedAt,now,48*3600000))matches.set(match.fixtureId,{match,observedAt});};
  for(const binding of state.bindings)put(binding?.match,binding?.observedAt);
  for(const approval of approvals){const e=approval.fixtureEvidence;if(e?.provider==='api-football'&&e.fixtureIdentity===watchFixtureIdentity(approval.match))put(approval.match,e.observedAt);}
  for(const row of rows){
    const payload=row?.payload;
    if(!dates.includes(payload?.date)||row.cache_key!==`provider-fixtures:${payload.date}:v1`||!validTime(payload.fetchedAt,now,48*3600000)||!Array.isArray(payload.fixtures)||payload.fixtures.length>2000)continue;
    for(const raw of payload.fixtures){
      const status=raw.fixture?.status?.short;
      put({fixtureId:raw.fixture?.id,date:raw.fixture?.date,status,home:raw.teams?.home,away:raw.teams?.away,leagueId:raw.league?.id,league:raw.league?.name,season:raw.league?.season,finished:['FT','AET','PEN'].includes(status)},payload.fetchedAt);
    }
  }
  // A directly opened centre is also canonical even when the broad day feed is absent.
  const centers=policies.length?await readCache({cache_key:'like.match-center:*:v17-event-evidence-rc144','payload->match->>leagueId':`in.(${policies.map(policy=>policy.leagueId).join(',')})`,order:'updated_at.desc',limit:'100'}):[];
  for(const row of centers)if(row.cache_key===matchCenterCacheKey(row.payload?.match?.fixtureId))put(row.payload.match,new Date(now).toISOString());
  const automatic=[];
  for(const video of videos){
    const policy=policies.find(item=>item.channelId===video.snippet?.channelId);
    if(!policy)continue;
    const candidates=[...matches.values()].filter(({match})=>automaticWatchMatch(policy,match,video.snippet.title,video.liveStreamingDetails?.scheduledStartTime,now));
    if(candidates.length!==1){report.ambiguousOrUnmatched=(report.ambiguousOrUnmatched||0)+1;continue;}
    if(automatic.length>=20)break;
    if(automatic.filter(item=>item.match.fixtureId===candidates[0].match.fixtureId).length>=5)continue;
    const {match,observedAt}=candidates[0];
    automatic.push({match,provider:'youtube',publisher:policy.publisher,videoId:video.id,eventUrl:`https://www.youtube.com/watch?v=${video.id}`,kind:'live',access:'free',label:policy.label,countries:[...policy.countries],confirmed:true,confirmedAt:new Date(now).toISOString(),validUntil:new Date(Date.parse(match.date)+4*3600000).toISOString(),videoTitle:video.snippet.title,policyId:policy.id,policyRevision:policy.revision,fixtureEvidence:{provider:'api-football',observedAt,fixtureIdentity:watchFixtureIdentity(match)}});
  }
  report.automaticMatched=automatic.length;
  // Keep the old bindings for one final empty-catalogue write on removal or mismatch.
  const cleanup=state.bindings.filter(binding=>watchFixtureIdentity(binding?.match)&&validTime(binding.observedAt,now,48*3600000)).map(binding=>binding.match);
  state.bindings=[...new Map(automatic.map(item=>[item.match.fixtureId,{match:item.match,observedAt:item.fixtureEvidence.observedAt}])).values()];
  await writeCache(WATCH_DISCOVERY_KEY,0,state,now+72*3600000);
  if(discoveryFailed)report.discoveryError='WATCH_DISCOVERY_SEARCH_FAILED';
  return {automatic,videos,cleanup};
}
