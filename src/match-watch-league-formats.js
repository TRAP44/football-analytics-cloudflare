// Reviewed official channel formats. Discovery hints never supply identities.
import {kleagueHighlightsMatch} from './kleague-watch-policy.js';
const normalize=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
const aliases={4200:['FC Jurong'],4204:['Lion City Sailors'],10077:['Tanjong Pagar United'],538:['RC Celta']};
let singaporeDate;
function name(value,format){
 let result=normalize(value);
 if(format==='aleagues')result=result.replace(/\bw\b$/,'').trim();
 if(['aleagues','laliga','seriea'].includes(format))result=result.split(' ').filter(word=>!['fc','cf','ud','rc','rcd','ca',...(format==='seriea'?['ac','as']:[])].includes(word)).join(' ');
 return result;
}
function teamMatches(team,label,format){return [team?.name,...aliases[team?.id]||[]].some(value=>name(value,format)===name(label,format));}
function pair(policy,match,home,away){return teamMatches(match.home,home,policy.format)&&teamMatches(match.away,away,policy.format);}
const round=match=>Number(typeof match?.round==='string'?match.round.match(/^(?:Regular Season|Matchweek)\s*-?\s*([1-9]\d?)$/)?.[1]:NaN);
const season=(match,start,end)=>Number(start)===match.season&&Number(end)===(match.season+1)%100;
function aleagueParts(policy,match,title,highlight=false){
 const parts=typeof title==='string'&&title.length<=220?title.match(highlight?/^([^|]+?) v ([^|]+?)(?: - Shark Highlights| \| SHARK HIGHLIGHTS) \| (A-League Men|Ninja A-League) (20\d{2})-(\d{2}) \| Matchweek ([1-9]\d?)$/i:/^([^|]+?) v ([^|]+?) - (A-League Men|Ninja A-League) (20\d{2})\/(\d{2}) - Matchweek ([1-9]\d?)$/):null;
 return !!parts&&parts[3].toLowerCase()===policy.videoCompetition.toLowerCase()&&season(match,parts[4],parts[5])&&round(match)===Number(parts[6])&&pair(policy,match,parts[1],parts[2]);
}
export function leagueFullMatch(policy,match,title){return policy.format==='aleagues'&&aleagueParts(policy,match,title);}
export function leagueHighlightsMatch(policy,match,title,description){
 if(policy.format==='aleagues')return aleagueParts(policy,match,title,true);
 if(policy.format==='kleague')return typeof title==='string'&&title.length<=220&&kleagueHighlightsMatch(policy,match,title);
 if(typeof title!=='string'||title.length>220||typeof description!=='string'||description.length>6000)return false;
 if(policy.format==='spl'){
  const parts=title.match(/^[^|]{1,100} \| (20\d{2})\/(\d{2}) SPL: ([^|]+) vs ([^|]+)$/);
  const date=description.match(/^Date: ([1-9]\d?) ([A-Za-z]+) (20\d{2})\r?\n/);
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  if(!parts||!date||!months.includes(date[2])||!season(match,parts[1],parts[2])||!pair(policy,match,parts[3],parts[4]))return false;
  const day=`${date[3]}-${String(months.indexOf(date[2])+1).padStart(2,'0')}-${date[1].padStart(2,'0')}`;
  singaporeDate ||= new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'});
  const matchDay=singaporeDate.format(new Date(match.date));
  const score=description.match(/(?:^|\n)Score: (\d{1,2})-(\d{1,2})(?: |\r?\n|$)/);
  return day===matchDay&&!!score&&Number.isInteger(match.score?.home)&&Number.isInteger(match.score?.away)&&Number(score[1])===match.score.home&&Number(score[2])===match.score.away&&/\nWatch the latest SPL highlights: https:\/\/www\.youtube\.com\/@sgpremierleague\b/.test(description);
 }
 if(policy.format==='laliga'){
  const parts=title.match(/^([^|]+?) (\d{1,2}) - (\d{1,2}) ([^|]+?) \| RESUMEN LALIGA EA SPORTS$/);
  const evidence=[...description.matchAll(/\bLALIGA EA SPORTS (20\d{2})\/(\d{2}) J([1-9]\d?)\b/g)];
  return !!parts&&evidence.length===1&&season(match,evidence[0][1],evidence[0][2])&&round(match)===Number(evidence[0][3])&&pair(policy,match,parts[1],parts[4])&&Number.isInteger(match.score?.home)&&Number.isInteger(match.score?.away)&&Number(parts[2])===match.score.home&&Number(parts[3])===match.score.away;
 }
 if(policy.format==='seriea'){
  const parts=title.match(/^(?:MAXI SINTESI )?([^|]+?)-([^|]+?) (\d{1,2})-(\d{1,2}) \| (?:EXTENDED )?HIGHLIGHTS \| SERIE A(?: ENILIVE)? (20\d{2})\/(\d{2})$/);
  if(!parts||!season(match,parts[5],parts[6])||!pair(policy,match,parts[1],parts[2])||!Number.isInteger(match.score?.home)||!Number.isInteger(match.score?.away)||Number(parts[3])!==match.score.home||Number(parts[4])!==match.score.away)return false;
  const first=description.split(/\r?\n/,1)[0],line=' '+name(first,'seriea')+' ';
  if(/\b(?:women|primavera|youth|U-?\d{2}|archive|throwback|classic|retro)\b|on this day/i.test(first))return false;
  const seasons=[...new Set(description.match(/\b20\d{2}\/\d{2}\b/g)||[])];
  // Independent first-line description must name both clubs and confirm the
  // result/season; reject observed publisher copy/paste contradictions.
  return line.includes(' '+name(parts[1],'seriea')+' ')&&line.includes(' '+name(parts[2],'seriea')+' ')&&new RegExp(`\\b${match.score.home}-${match.score.away}\\b`).test(first)&&seasons.length===1&&seasons[0]===`${match.season}/${String(match.season+1).slice(-2)}`&&first.includes(seasons[0]);
 }
 return false;
}
