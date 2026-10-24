// Official league/channel relationship and the observed full-match title format
// are reviewed once. New fixtures/video IDs are NOT deployed source approvals.
export const WATCH_POLICIES=Object.freeze([Object.freeze({
  id:'jleague-j1-live',revision:1,publisher:'jleagueinternational',leagueId:98,
  channelId:'UCmQp6ZaAejJKKkXc_Y_lh1A',countries:Object.freeze(['RU','KZ','BY']),
  replayRetentionDays:7,highlights:true,authorityUrl:'https://www.jleague.jp/en/',label:'Трансляция J.LEAGUE',
})]);
const normalized=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
// Only exact provider team IDs may gain these observed official-name aliases.
const aliases={290:['Kashima Antlers'],303:['FC Machida Zelvia']};
const names=team=>[team?.name,...aliases[team?.id]||[]].map(normalized).filter(Boolean);
export function automaticWatchValidUntil(policy,match,kind='live'){
  const days=policy?.replayRetentionDays;
  return Date.parse(match?.date)+(['replay','highlights'].includes(kind)?(Number.isInteger(days)&&days>0&&days<=7?days:0)*86400000:4*3600000);
}
export function automaticHighlightsMatch(policy,match,title,publishedAt,now){
  if(policy?.highlights!==true||match?.leagueId!==policy.leagueId||!Number.isSafeInteger(match.season)||match.season<2000||match.finished!==true||!['FT','AET','PEN'].includes(match.status))return false;
  const kickoff=Date.parse(match.date),published=typeof publishedAt==='string'?Date.parse(publishedAt):NaN;
  // Upload time alone cannot date the match: require the canonical season AND
  // round below, so a freshly uploaded archive cannot attach to today's meeting.
  if(!Number.isFinite(kickoff)||!Number.isFinite(published)||!Number.isFinite(now)||published>now||published<kickoff+60*60000||published>kickoff+48*3600000||now>=automaticWatchValidUntil(policy,match,'highlights'))return false;
  if(typeof title!=='string'||title.length>220)return false;
  const seasonal=title.match(/^([^|]+) vs\.? ([^|]+) \| (\d{4}(?:\/\d{2})?) J1 League \| Matchweek ([1-9]\d?) \| Highlights$/);
  const scored=title.match(/^([^|]+) (\d{1,2})-(\d{1,2}) ([^|]+) \| MW ([1-9]\d?) \| (\d{4}(?:\/\d{2})?) J1 League Highlights$/);
  const parts=seasonal||scored&&[scored[0],scored[1],scored[4],scored[6],scored[5]];if(!parts)return false;
  const season=String(match.season),split=`${match.season-1}/${season.slice(-2)}`;
  if(![season,split].includes(parts[3]))return false;
  const round=typeof match.round==='string'?match.round.match(/^(?:Regular Season|Matchweek)\s*-?\s*(\d+)$/):null;
  if(!round||Number(round[1])!==Number(parts[4]))return false;
  if(scored&&Number.isInteger(match.score?.home)&&Number.isInteger(match.score?.away)&&(Number(scored[2])!==match.score.home||Number(scored[3])!==match.score.away))return false;
  return names(match.home).includes(normalized(parts[1]))&&names(match.away).includes(normalized(parts[2]));
}
export function automaticHighlightsEvidence(duration,broadcast,stream){
  // Short summaries only; reject shorts, full recordings, premieres and streams.
  const parts=typeof duration==='string'?duration.match(/^PT(?:(\d{1,2})M)?(?:(\d{1,2})S)?$/):null;
  if(!parts||!parts[1]&&!parts[2])return false;
  const seconds=Number(parts[1]||0)*60+Number(parts[2]||0);
  return seconds>=120&&seconds<=20*60&&broadcast==='none'&&!stream;
}
export function automaticReplayEvidence(match,startedAt,endedAt,now){
  const start=typeof startedAt==='string'?Date.parse(startedAt):NaN,end=typeof endedAt==='string'?Date.parse(endedAt):NaN;
  return Number.isFinite(start)&&Number.isFinite(end)&&end<=now&&Math.abs(start-Date.parse(match?.date))<=30*60000&&end-start>=60*60000&&end-start<=4*3600000;
}
export function automaticWatchMatch(policy,match,title,scheduledStart,now,kind='live'){
  if(!policy || match?.leagueId!==policy.leagueId || !Number.isSafeInteger(match?.season) || match.season<2000)return false;
  const replay=kind==='replay';
  if(replay?match.finished!==true||!['FT','AET','PEN'].includes(match.status):kind!=='live'||match.finished===true||!['NS','1H','HT','2H','ET','BT','P','LIVE'].includes(match.status))return false;
  const kickoff=Date.parse(match.date),start=typeof scheduledStart==='string'?Date.parse(scheduledStart):NaN;
  if(!Number.isFinite(kickoff)||!Number.isFinite(start)||!Number.isFinite(now)||now>=automaticWatchValidUntil(policy,match,kind)||kickoff>now+(replay?0:48*3600000)||start<kickoff-15*60000||start>kickoff+5*60000)return false;
  // Only observed official full-match formats; no highlights, archive premieres,
  // youth/women qualifiers, combined streams or substring/fuzzy matching.
  const parts=typeof title==='string'&&title.length<=220?title.match(replay?/^([^|]+) v ([^|]+) - (?:Live|Full) Match \| J\.League$/:/^([^|]+) v ([^|]+) - Live Match \| J\.League$/):null;
  return !!parts && names(match.home).includes(normalized(parts[1])) && names(match.away).includes(normalized(parts[2]));
}
