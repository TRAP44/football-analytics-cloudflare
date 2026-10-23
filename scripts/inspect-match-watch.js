// Main-only, read-only source validation. Never publishes watch options or video streams.
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const WATCH_SOURCE = Object.freeze({
  handle:'fifa',channelId:'UCpcTrCXblq78GZrTUTLWeBw',
  authorityUrl:'https://inside.fifa.com/',channelUrl:'https://www.youtube.com/fifa',
});
const COUNTRIES=['RU','KZ','BY','UA','GB','US','DE','FR','ES','IT','BR','AR'];
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const text=(value,max=180)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const safeTime=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const normalized=value=>text(value,400).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
class SourceFailure extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new SourceFailure(code);};

export async function boundedSourceJson(response,maxBytes=1_500_000){
  if(!response.body)fail('SOURCE_INVALID_RESPONSE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maxBytes){await reader.cancel();fail('SOURCE_RESPONSE_TOO_LARGE');}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('SOURCE_INVALID_JSON');}
}

function countryAllowed(details,country){
  if(!details || typeof details!=='object' || Array.isArray(details))return null;
  const restrictions=details?.regionRestriction;
  if(restrictions===undefined)return true;
  if(!restrictions || typeof restrictions!=='object' || Array.isArray(restrictions))return null;
  const valid=value=>Array.isArray(value) && value.length<=300 && value.every(item=>typeof item==='string' && /^[A-Z]{2}$/.test(item));
  const hasAllowed=Object.hasOwn(restrictions,'allowed'),hasBlocked=Object.hasOwn(restrictions,'blocked');
  if(hasAllowed && hasBlocked || !hasAllowed && !hasBlocked)return null;
  if(hasAllowed)return valid(restrictions.allowed)?restrictions.allowed.includes(country):null;
  return valid(restrictions.blocked)?!restrictions.blocked.includes(country):null;
}

export function describeWatchVideo(item,now=new Date()){
  if(!VIDEO_ID.test(item?.id || '') || item?.snippet?.channelId!==WATCH_SOURCE.channelId)return null;
  const details=item.liveStreamingDetails || {},status=item.status || {};
  const started=safeTime(details.actualStartTime),ended=safeTime(details.actualEndTime),scheduled=safeTime(details.scheduledStartTime);
  const publicVideo=status.privacyStatus==='public';
  const kind=ended && (!started || Date.parse(ended)>=Date.parse(started)) && Date.parse(ended)<=now.getTime()?'ended':!ended && started && Date.parse(started)<=now.getTime() && item.snippet.liveBroadcastContent==='live'?'live':!started && !ended && item.snippet.liveBroadcastContent==='upcoming' && scheduled && Date.parse(scheduled)>now.getTime()?'upcoming':'unconfirmed';
  return {videoId:item.id,channelId:WATCH_SOURCE.channelId,title:text(item.snippet.title),
    kind,scheduledStartTime:scheduled,actualStartTime:started,actualEndTime:ended,
    publicVideo,embeddable:status.embeddable===true,
    ageRestricted:item.contentDetails?.contentRating?.ytRating==='ytAgeRestricted',
    regionMetadata:COUNTRIES.map(country=>({country,allowedByMetadata:countryAllowed(item.contentDetails,country)})),
    eventUrl:`https://www.youtube.com/watch?v=${item.id}`,
    playbackVerified:false,fixtureVerified:false};
}

// Candidate hints only. Exact title/time is insufficient to establish competition,
// gender/age category, live rights, or actual Telegram playback. Never auto-publish.
export function watchMatchHints(videos,rows){
  const hints=[];
  for(const row of rows){
    const payload=row?.payload;
    if(!payload || row.cache_key!==`provider-fixtures:${payload.date}:v1` || !Array.isArray(payload.fixtures) || payload.fixtures.length>2000)continue;
    for(const fixture of payload.fixtures){
      const id=fixture?.fixture?.id,kickoff=safeTime(fixture?.fixture?.date);
      if(!Number.isSafeInteger(id)||id<=0||!kickoff||['PST','CANC','ABD','AWD','WO','TBD'].includes(fixture.fixture.status?.short))continue;
      const home=text(fixture.teams?.home?.name),away=text(fixture.teams?.away?.name),league=text(fixture.league?.name);
      if(home.length<4||away.length<4||!league||!Number.isSafeInteger(fixture.league?.id)||!Number.isSafeInteger(fixture.teams?.home?.id)||!Number.isSafeInteger(fixture.teams?.away?.id))continue;
      for(const video of videos){
        if(!['live','upcoming'].includes(video.kind) || !video.scheduledStartTime)continue;
        const title=' '+normalized(video.title)+' ';
        if(!title.includes(' '+normalized(home)+' ')||!title.includes(' '+normalized(away)+' ')||Math.abs(Date.parse(video.scheduledStartTime)-Date.parse(kickoff))>300000)continue;
        hints.push({fixtureId:id,home,away,league,kickoff,videoId:video.videoId,scope:'title_time_candidate_not_approved'});
        if(hints.length>=10)return hints;
      }
    }
  }
  return hints;
}

export async function inspectMatchWatch({env=process.env,fetchImpl=fetch,now=new Date()}={}){
  let calls=0,searchCalls=0;
  const report={scope:'read_only_official_youtube_metadata_not_playback_or_published_catalogue',observedAt:now.toISOString(),
    keyAccepted:false,channelVerified:false,source:WATCH_SOURCE,requestCounts:{youtube:0,search:0,supabase:0},videos:[],matchHints:[],matchCacheStatus:'not_requested',featureReady:false};
  const key=typeof env.YOUTUBE_DATA_API_KEY==='string'?env.YOUTUBE_DATA_API_KEY.trim():'';
  if(!key || key.length>512) return {...report,errorCode:'YOUTUBE_KEY_NOT_CONFIGURED'};
  const deadline=AbortSignal.timeout(55000);
  async function youtube(path,params){
    if(++calls>4)fail('YOUTUBE_REQUEST_BUDGET');
    if(path==='search')searchCalls++;
    report.requestCounts.youtube=calls;report.requestCounts.search=searchCalls;
    const url=new URL('https://www.googleapis.com/youtube/v3/'+path);url.search=new URLSearchParams(params);
    let response;
    try{response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{'X-Goog-Api-Key':key,Accept:'application/json'},signal:AbortSignal.any([deadline,AbortSignal.timeout(8000)])});}
    catch{fail('YOUTUBE_TRANSPORT_FAILED');}
    if(response.status!==200){
      await response.body?.cancel().catch(()=>{});
      fail(response.status===403?'YOUTUBE_ACCESS_OR_QUOTA_DENIED':response.status===400?'YOUTUBE_REQUEST_REJECTED':'YOUTUBE_HTTP_FAILED');
    }
    const data=await boundedSourceJson(response,256000);
    if(!Array.isArray(data.items)||data.items.length>50)fail('YOUTUBE_INVALID_ITEMS');
    report.keyAccepted=true;return data.items;
  }
  try{
    const channels=await youtube('channels',{part:'id,snippet',forHandle:WATCH_SOURCE.handle,maxResults:'1'});
    if(channels.length!==1 || channels[0].id!==WATCH_SOURCE.channelId || String(channels[0].snippet?.customUrl || '').toLowerCase()!=='@'+WATCH_SOURCE.handle)fail('YOUTUBE_CHANNEL_IDENTITY_MISMATCH');
    report.channelVerified=true;
    const ids=new Set();
    for(const eventType of ['live','upcoming']){
      const results=await youtube('search',{part:'id',channelId:WATCH_SOURCE.channelId,type:'video',eventType,maxResults:'10'});
      for(const result of results){const id=result?.id?.videoId;if(VIDEO_ID.test(id || ''))ids.add(id);}
    }
    if(ids.size){
      const videos=await youtube('videos',{part:'snippet,status,contentDetails,liveStreamingDetails',id:[...ids].join(',')});
      const seen=new Set();
      report.videos=videos.filter(item=>{if(!ids.has(item?.id)||seen.has(item.id))return false;seen.add(item.id);return true;}).map(item=>describeWatchVideo(item,now)).filter(Boolean);
    }
  }catch(error){return {...report,errorCode:error instanceof SourceFailure?error.code:'YOUTUBE_CHECK_FAILED'};}
  // Only existing shared public sports cache. No users, Telegram messages,
  // provider quota, arbitrary SQL/URL inputs, or writes to production.
  const dbKey=env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if(!dbKey){report.matchCacheStatus='not_configured';return report;}
  try{
    const base=new URL(env.SUPABASE_URL);
    if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.username||base.password||base.pathname!=='/'||base.search||base.hash)fail('MATCH_CACHE_CONFIGURATION');
    const dates=[now.toISOString().slice(0,10),new Date(now.getTime()+86400000).toISOString().slice(0,10)];
    const url=new URL('/rest/v1/analysis_cache',base);
    url.search=new URLSearchParams({select:'cache_key,payload',cache_key:`in.(${dates.map(date=>`provider-fixtures:${date}:v1`).join(',')})`,expires_at:`gt.${now.toISOString()}`,limit:'2'});
    report.requestCounts.supabase=1;
    const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{apikey:dbKey,Accept:'application/json'},signal:AbortSignal.any([deadline,AbortSignal.timeout(8000)])});
    if(response.status!==200){await response.body?.cancel().catch(()=>{});fail('MATCH_CACHE_UNAVAILABLE');}
    const rows=await boundedSourceJson(response);
    if(!Array.isArray(rows)||rows.length>2)fail('MATCH_CACHE_INVALID_RESPONSE');
    report.matchCacheStatus=rows.length?'read':'empty';report.matchHints=watchMatchHints(report.videos,rows);
  }catch{report.matchCacheStatus='unavailable';}
  return report;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  let report;
  try{report=await inspectMatchWatch();}
  catch{report={featureReady:false,errorCode:'SOURCE_CHECK_FAILED'};}
  mkdirSync('load-results',{recursive:true});writeFileSync('load-results/match-watch-source-check.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({keyAccepted:report.keyAccepted===true,channelVerified:report.channelVerified===true,requestCounts:report.requestCounts,videoCount:report.videos?.length || 0,matchHintCount:report.matchHints?.length || 0,featureReady:false,errorCode:report.errorCode || null}));
  if(report.errorCode)process.exitCode=1;
}
