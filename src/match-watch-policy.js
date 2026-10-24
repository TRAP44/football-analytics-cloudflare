// Official league/channel relationship and the observed full-match title format
// are reviewed once. New fixtures/video IDs are NOT deployed source approvals.
export const WATCH_POLICIES=Object.freeze([Object.freeze({
  id:'jleague-j1-live',revision:1,publisher:'jleagueinternational',leagueId:98,
  channelId:'UCmQp6ZaAejJKKkXc_Y_lh1A',countries:Object.freeze(['RU','KZ','BY']),
  replayRetentionDays:7,authorityUrl:'https://www.jleague.jp/en/',label:'Трансляция J.LEAGUE',
})]);
const normalized=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
// Only exact provider team IDs may gain these observed official-name aliases.
const aliases={290:['Kashima Antlers'],303:['FC Machida Zelvia']};
const names=team=>[team?.name,...aliases[team?.id]||[]].map(normalized).filter(Boolean);
export function automaticWatchValidUntil(policy,match,kind='live'){
  const days=policy?.replayRetentionDays;
  return Date.parse(match?.date)+(kind==='replay'?(Number.isInteger(days)&&days>0&&days<=7?days:0)*86400000:4*3600000);
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
