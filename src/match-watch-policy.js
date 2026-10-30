import {leagueFullMatch,leagueHighlightsMatch} from './match-watch-league-formats.js';
import {KLEAGUE_CHANNEL} from './kleague-watch-policy.js';
import {ISL_CHANNEL,islFullMatch,islStreamStart} from './isl-watch-policy.js';
import {BUNDESLIGA_CHANNEL} from './bundesliga-watch-policy.js';
// Official league/channel relationship and the observed full-match title format
// are reviewed once. New fixtures/video IDs are NOT deployed source approvals.
export const WATCH_POLICIES=Object.freeze([Object.freeze({
  id:'jleague-j1-live',revision:1,publisher:'jleagueinternational',leagueId:98,
  channelId:'UCmQp6ZaAejJKKkXc_Y_lh1A',countries:Object.freeze(['RU','KZ','BY']),
  replayRetentionDays:7,highlights:true,authorityUrl:'https://www.jleague.jp/en/',label:'Трансляция J.LEAGUE',
}),...[
 {id:'aleagues-men',leagueId:188,videoCompetition:'A-League Men'},
 {id:'aleagues-women',leagueId:190,videoCompetition:'Ninja A-League'},
].map(item=>Object.freeze({...item,revision:1,publisher:'aleagues',format:'aleagues',channelId:'UCzRogd_oK3bzKvAW-4aLuPQ',countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,highlights:true,searchIntervalMs:6*3600000,uploadsIntervalMs:300000,authorityUrl:'https://aleagues.com.au/more/where-to-watch-aleagues-overseas/',label:'Трансляция A-Leagues',replayLabel:'Полная запись A-Leagues',highlightsLabel:'Обзор A-Leagues'})),Object.freeze({
 id:'spl-highlights',revision:1,publisher:'sgpremierleague',format:'spl',leagueId:368,channelId:'UCiJTKr-wja_JVM2dVTYCELA',countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,highlights:true,highlightsOnly:true,uploadsIntervalMs:300000,authorityUrl:'https://spl.sg/',highlightsLabel:'Обзор SPL',
}),Object.freeze({
 id:'laliga-highlights',revision:1,publisher:'laliga',format:'laliga',leagueId:140,channelId:'UCTv-XvfzLX3i4IGWAm4sbmA',countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,highlights:true,highlightsOnly:true,uploadsIntervalMs:300000,authorityUrl:'https://www.laliga.com/en-GB',highlightsLabel:'Обзор Ла Лиги',
}),Object.freeze({
 id:'seriea-highlights',revision:1,publisher:'seriea',format:'seriea',leagueId:135,channelId:'UCBJeMCIeLQos7wacox4hmLQ',countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,highlights:true,highlightsOnly:true,uploadsIntervalMs:300000,maxHighlightsSeconds:1800,authorityUrl:'https://en.legaseriea.it/serie-a/broadcasters',highlightsLabel:'Обзор Серии А',
}),...[1,2].map(number=>Object.freeze({id:`kleague-${number}-highlights`,revision:1,publisher:'kleagueintl',format:'kleague',videoLeague:number,leagueId:number===1?292:293,channelId:KLEAGUE_CHANNEL,countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,highlights:true,highlightsOnly:true,uploadsIntervalMs:300000,authorityUrl:'https://tv.kleague.com/en-int/page/home',highlightsLabel:`Расширенный обзор K LEAGUE ${number}`})),Object.freeze({id:'bundesliga-highlights',revision:1,publisher:'bundesliga',format:'bundesliga',leagueId:78,channelId:BUNDESLIGA_CHANNEL,countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,highlights:true,highlightsOnly:true,uploadsIntervalMs:600000,authorityUrl:'https://www.bundesliga.com/en/bundesliga',highlightsLabel:'Обзор Бундеслиги'}),Object.freeze({id:'isl-full',revision:1,publisher:'indiansuperleague',format:'isl',leagueId:323,channelId:ISL_CHANNEL,countries:Object.freeze(['RU','KZ','BY']),replayRetentionDays:7,uploads:true,searchIntervalMs:12*3600000,uploadsIntervalMs:15*60000,searchMaxResults:10,uploadsMaxResults:20,authorityUrl:'https://www.indiansuperleague.com/',label:'Трансляция Indian Super League',replayLabel:'Полная запись Indian Super League'})]);
const normalized=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
// Only exact provider team IDs may gain these observed official-name aliases.
const aliases={287:['Urawa Reds'],290:['Kashima Antlers'],302:['Kyoto Sanga F.C.'],303:['FC Machida Zelvia']};
const names=team=>[team?.name,...aliases[team?.id]||[]].map(normalized).filter(Boolean);
let tokyoDate;
export function automaticWatchValidUntil(policy,match,kind='live'){
  const days=policy?.replayRetentionDays;
  return Date.parse(match?.date)+(['replay','highlights'].includes(kind)?(Number.isInteger(days)&&days>0&&days<=7?days:0)*86400000:4*3600000);
}
export function automaticHighlightsMatch(policy,match,title,publishedAt,now,description=''){
  if(policy?.highlights!==true||match?.leagueId!==policy.leagueId||!Number.isSafeInteger(match.season)||match.season<2000||match.finished!==true||!['FT','AET','PEN'].includes(match.status))return false;
  const kickoff=Date.parse(match.date),published=typeof publishedAt==='string'?Date.parse(publishedAt):NaN;
  // Bundesliga publishes Friday matches with Sunday summaries (observed 52.5h).
  // Upload time alone cannot date the match: require the canonical season AND
  // round below, so a freshly uploaded archive cannot attach to today's meeting.
  if(!Number.isFinite(kickoff)||!Number.isFinite(published)||!Number.isFinite(now)||published>now||published<kickoff+60*60000||published>kickoff+(policy.format==='bundesliga'?72:48)*3600000||now>=automaticWatchValidUntil(policy,match,'highlights'))return false;
  if(typeof title!=='string'||title.length>220)return false;
  if(policy.format)return leagueHighlightsMatch(policy,match,title,description);
  const seasonal=title.match(/^([^|]+) vs\.? ([^|]+) \| (\d{4}(?:\/\d{2})?) J1 League \| Matchweek ([1-9]\d?) \| Highlights$/);
  const scored=title.match(/^([^|]+) (\d{1,2})-(\d{1,2}) ([^|]+) \| MW ([1-9]\d?) \| (\d{4}(?:\/\d{2})?) J1 League Highlights$/);
  const observed=title.match(/^(?:[^|]{1,80} \| )?([^|]+) vs ([^|]+) HIGHLIGHTS \| J\.League$/);
  const parts=seasonal||scored&&[scored[0],scored[1],scored[4],scored[6],scored[5]];
  if(!parts){
    if(/\b(?:archive|throwback|classic|retro|on this day|U-?\d{2}|women|youth)\b|\b20\d{2}\b/i.test(title))return false;
    if(!observed||!names(match.home).includes(normalized(observed[1]))||!names(match.away).includes(normalized(observed[2])))return false;
    return highlightsDescriptionEvidence(match,description);
  }
  const season=String(match.season),split=`${match.season-1}/${season.slice(-2)}`;
  if(![season,split].includes(parts[3]))return false;
  const round=typeof match.round==='string'?match.round.match(/^(?:Regular Season|Matchweek)\s*-?\s*(\d+)$/):null;
  if(!round||Number(round[1])!==Number(parts[4]))return false;
  if(scored&&Number.isInteger(match.score?.home)&&Number.isInteger(match.score?.away)&&(Number(scored[2])!==match.score.home||Number(scored[3])!==match.score.away))return false;
  return names(match.home).includes(normalized(parts[1]))&&names(match.away).includes(normalized(parts[2]));
}
function highlightsDescriptionEvidence(match,description){
  if(typeof description!=='string'||!description||description.length>6000||/\bJ[23] League\b|\bLevain Cup\b|\b(?:archive|throwback|classic match|retro|on this day|U-?\d{2}|women|youth)\b/i.test(description))return false;
  const split=`${match.season-1}/${String(match.season).slice(-2)}`;
  // Observed protected metadata 40136213538. The first sentence independently
  // identifies both clubs, season and round; generic footer advertising cannot.
  const official=description.split(/\r?\n/,1)[0].match(/^Highlights from Matchweek ([1-9]\d?) in the (20\d{2})-(\d{2}) J\.League between ([^|]+) and ([^|]+)\.$/);
  const canonicalRound=typeof match.round==='string'?match.round.match(/^(?:Regular Season|Matchweek)\s*-?\s*(\d+)$/):null;
  if(official){
    if(!canonicalRound||Number(official[1])!==Number(canonicalRound[1])||`${official[2]}/${official[3]}`!==split||!names(match.home).includes(normalized(official[4]))||!names(match.away).includes(normalized(official[5])))return false;
    const seasons=[...new Set((description.match(/\b20\d{2}[-/]\d{2}\b/g)||[]).map(value=>value.replace('-','/')))];
    const rounds=[...new Set([...description.matchAll(/\b(?:Matchweek|MW)\s*([1-9]\d?)\b/gi)].map(item=>Number(item[1])))];
    if(seasons.length!==1||seasons[0]!==split||rounds.length!==1||rounds[0]!==Number(canonicalRound[1]))return false;
    const dates=[...description.matchAll(/\bMatch date:\s*(20\d{2}-\d{2}-\d{2})\b/gi)];
    if(dates.length)return false; // No contradictory additional match-date claims.
    return true;
  }
  if(! /\bJ1 League\b/i.test(description))return false;
  const seasons=[...new Set(description.match(/\b20\d{2}\/\d{2}\b/g)||[])];
  const rounds=[...new Set([...description.matchAll(/\b(?:Matchweek|MW)\s*([1-9]\d?)\b/gi)].map(item=>Number(item[1])))];
  const round=typeof match.round==='string'?match.round.match(/^(?:Regular Season|Matchweek)\s*-?\s*(\d+)$/):null;
  const matchSpecific=/(?:^|\n)(?:Match )?Highlights (?:from|of) (?:the )?Matchweek ([1-9]\d?) (?:of|in) (?:the )?(20\d{2}\/\d{2}) (?:Meiji Yasuda )?J1 League(?:[.!]|\s*$)/im.test(description);
  const seasonRound=matchSpecific&&seasons.length===1&&seasons[0]===split&&rounds.length===1&&round&&rounds[0]===Number(round[1]);
  // An explicit match calendar date in the official description is independent
  // of uploadedAt. Never substitute the upload timestamp for missing evidence.
  const dates=[...new Set([...description.matchAll(/\bMatch date:\s*(20\d{2}-\d{2}-\d{2})\b/gi)].map(item=>item[1]))];
  const kickoff=new Date(Date.parse(match.date));
  tokyoDate ||= new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'});
  const matchDate=tokyoDate.format(kickoff);
  // Reject conflicting season/round evidence even when a date is present.
  if(dates.length>1||dates.length===1&&dates[0]!==matchDate)return false;
  return !!(seasonRound||dates.length===1&&(!seasons.length||seasons.length===1&&seasons[0]===split)&&(!rounds.length||rounds.length===1&&round&&rounds[0]===Number(round[1])));
}
export function automaticHighlightsEvidence(duration,broadcast,stream,maxSeconds=1200){
  // Short summaries only; reject shorts, full recordings, premieres and streams.
  const parts=typeof duration==='string'?duration.match(/^PT(?:(\d{1,2})M)?(?:(\d{1,2})S)?$/):null;
  if(!parts||!parts[1]&&!parts[2])return false;
  const seconds=Number(parts[1]||0)*60+Number(parts[2]||0);
  return seconds>=120&&seconds<=Math.min(maxSeconds,1800)&&broadcast==='none'&&!stream;
}
export function automaticReplayEvidence(match,startedAt,endedAt,now,policy){
  const start=typeof startedAt==='string'?Date.parse(startedAt):NaN,end=typeof endedAt==='string'?Date.parse(endedAt):NaN;
  return Number.isFinite(start)&&Number.isFinite(end)&&end<=now&&(policy?.format==='isl'?islStreamStart(match,startedAt):Math.abs(start-Date.parse(match?.date))<=30*60000)&&end-start>=60*60000&&end-start<=4*3600000;
}
export function youtubeWatchCountries(video,countries){
  if(video?.status?.privacyStatus!=='public'||video?.contentDetails?.contentRating?.ytRating==='ytAgeRestricted')return [];
  const details=video.contentDetails;
  if(!details||typeof details!=='object'||Array.isArray(details))return [];
  const region=details.regionRestriction;
  if(region!==undefined&&(!region||typeof region!=='object'||Array.isArray(region)||Object.hasOwn(region,'allowed')===Object.hasOwn(region,'blocked')))return [];
  if(region&&!['allowed','blocked'].every(key=>region[key]===undefined||Array.isArray(region[key])&&region[key].length<=300&&region[key].every(code=>typeof code==='string'&&/^[A-Z]{2}$/.test(code))))return [];
  return countries.filter(code=>region?.allowed?region.allowed.includes(code):!region?.blocked?.includes(code));
}
// Called only after the original complete metadata passes publisher verification.
// Keep all fields used by the independent consumer proof, discard promotion.
export function watchDescriptionEvidence(policy,description=''){
  if(typeof description!=='string')return '';
  const lines=description.split(/\r?\n/);
  if(policy?.format==='isl')return lines[0].trim();
  if(policy?.format==='aleagues')return '';
  if(policy?.format==='kleague')return '';
  if(policy?.format==='bundesliga')return lines.filter((line,index)=>index===0||line.startsWith('Watch the Bundesliga highlights of ')).join('\n');
  if(policy?.format==='seriea')return lines[0];
  if(policy?.format==='laliga')return lines.filter(line=>/\bLALIGA EA SPORTS 20\d{2}\/\d{2} J[1-9]\d?\b/.test(line)).join('\n');
  if(policy?.format==='spl')return lines.filter(line=>/^(?:Date:|Score:|Watch the latest SPL highlights:)/.test(line)).join('\n');
  return lines.filter((line,index)=>index===0||/\b20\d{2}[-/]\d{2}\b|\bMatch date:|\bJ1 League\b|\b(?:Matchweek|MW)\s*[1-9]\d?\b/i.test(line)).join('\n');
}
export function automaticWatchMatch(policy,match,title,scheduledStart,now,kind='live',description=''){
  if(!policy || match?.leagueId!==policy.leagueId || !Number.isSafeInteger(match?.season) || match.season<2000)return false;
  const replay=kind==='replay';
  if(replay?match.finished!==true||!['FT','AET','PEN'].includes(match.status):kind!=='live'||match.finished===true||!['NS','1H','HT','2H','ET','BT','P','LIVE'].includes(match.status))return false;
  const kickoff=Date.parse(match.date),start=typeof scheduledStart==='string'?Date.parse(scheduledStart):NaN;
  if(!Number.isFinite(kickoff)||!Number.isFinite(start)||!Number.isFinite(now)||now>=automaticWatchValidUntil(policy,match,kind)||kickoff>now+(replay?0:48*3600000)||(policy.format==='isl'?!islStreamStart(match,scheduledStart):start<kickoff-15*60000||start>kickoff+5*60000))return false;
  if(policy.highlightsOnly)return false;
  if(policy.format==='isl')return islFullMatch(match,title,description,kind);
  if(policy.format)return leagueFullMatch(policy,match,title);
  // Only observed official full-match formats; no highlights, archive premieres,
  // youth/women qualifiers, combined streams or substring/fuzzy matching.
  const parts=typeof title==='string'&&title.length<=220?title.match(replay?/^([^|]+) v ([^|]+) - (?:Live|Full) Match \| J\.League$/:/^([^|]+) v ([^|]+) - Live Match \| J\.League$/):null;
  return !!parts && names(match.home).includes(normalized(parts[1])) && names(match.away).includes(normalized(parts[2]));
}
