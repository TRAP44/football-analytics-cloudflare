// Official league/channel relationship and the observed full-match title format
// are reviewed once. New fixtures/video IDs are NOT deployed source approvals.
export const WATCH_POLICIES=Object.freeze([Object.freeze({
  id:'jleague-j1-live',revision:1,publisher:'jleagueinternational',leagueId:98,
  channelId:'UCmQp6ZaAejJKKkXc_Y_lh1A',countries:Object.freeze(['RU','KZ','BY']),
  authorityUrl:'https://www.jleague.jp/en/',label:'Трансляция J.LEAGUE',
})]);
const normalized=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
// Only exact provider team IDs may gain these observed official-name aliases.
const aliases={290:['Kashima Antlers'],303:['FC Machida Zelvia']};
const names=team=>[team?.name,...aliases[team?.id]||[]].map(normalized).filter(Boolean);
export function automaticWatchMatch(policy,match,title,scheduledStart,now){
  if(!policy || match?.leagueId!==policy.leagueId || !Number.isSafeInteger(match?.season) || match.season<2000 || match.finished===true || !['NS','1H','HT','2H','ET','BT','P','LIVE'].includes(match.status))return false;
  const kickoff=Date.parse(match.date),start=typeof scheduledStart==='string'?Date.parse(scheduledStart):NaN;
  if(!Number.isFinite(kickoff)||!Number.isFinite(start)||!Number.isFinite(now)||kickoff<now-4*3600000||kickoff>now+48*3600000||start<kickoff-15*60000||start>kickoff+5*60000)return false;
  // Exact observed format excludes archives, highlights, youth/women qualifiers,
  // combined streams and ambiguous substring/fuzzy matches. Unknown formats wait.
  const parts=typeof title==='string'&&title.length<=220?title.match(/^([^|]+) v ([^|]+) - Live Match \| J\.League$/):null;
  return !!parts && names(match.home).includes(normalized(parts[1])) && names(match.away).includes(normalized(parts[2]));
}
