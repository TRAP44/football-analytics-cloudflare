// Source names observed with independent API-Football team IDs. In particular,
// Suwon FC and Suwon Samsung must never collapse into the same short name.
const aliases={2748:['Anyang'],2762:['Jeonbuk'],2745:['Bucheon'],2759:['Gwangju'],2768:['Gimcheon'],2750:['Daejeon'],2763:['Incheon'],2761:['Jeju'],2766:['Seoul'],2746:['Gangwon'],2767:['Ulsan','Ulsan HD'],2764:['Pohang'],2760:['Jeonnam'],2747:['Daegu'],7078:['Gimpo','Gimpo FC'],7076:['Gimhae','Gimhae FC'],2756:['SuwonFC','Suwon FC'],2753:['Chungnam Asan','Chungnam Asan FC'],2752:['Busan'],2751:['Gyeongnam'],2757:['Seongnam'],2765:['Suwon','Suwon Samsung'],7060:['Cheonan','Cheonan City FC'],2758:['Ansan','Ansan Greeners FC'],7061:['Chungbuk Cheongju','Cheongju FC'],9171:['Yongin','Yongin FC'],7098:['Paju','Paju Citizen FC'],7087:['Hwaseong FC']};
const normalized=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,''):'';
const time=value=>typeof value==='string'?Date.parse(value):NaN;
const positive=value=>Number.isSafeInteger(value)&&value>0;
export const KLEAGUE_CHANNEL='UCrfu1VaYOZ_-FBGQMzKFfMA';
export const KLEAGUE_TV_POLICY=Object.freeze({id:'kleaguetv-replays',revision:1,publisher:'kleaguetv',countries:Object.freeze(['RU','KZ','BY'])});
export function kleagueTeamMatches(team,label){return !!normalized(label)&&[team?.name,...aliases[team?.id]||[]].some(value=>normalized(value)===normalized(label));}
export function kleagueRound(match){return Number(typeof match?.round==='string'?match.round.match(/^Regular Season - ([1-9]\d?)$/)?.[1]:NaN);}
export function kleagueHighlightsMatch(policy,match,title){
 const p=title.match(/^\[(?:AMBIENT SOUND|Full ENG)\] (20\d{2}) K LEAGUE ([12]) I R([1-9]\d?) I ([^|]+?) vs ([^|]+?) I 15-Min Extended Highlights$/);
 return !!p&&Number(p[1])===match.season&&Number(p[2])===policy.videoLeague&&kleagueRound(match)===Number(p[3])&&kleagueTeamMatches(match.home,p[4])&&kleagueTeamMatches(match.away,p[5]);
}
export function kleagueTvUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='tv.kleague.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/en-int\/video\/[a-z0-9]+(?:-[a-z0-9]+)*\/[1-9]\d{0,9}$/.test(u.pathname)?u.href:'';}catch{return '';}
}
export function validKleagueTvReplay(match,source,now){
 const p=typeof source?.title==='string'&&source.title.length<=220?source.title.match(/^\[R([1-9]\d?)\]([^|]+?)\s+-\s+([^|]+)$/):null;
 const event=source?.event,league=event?.league==='K LEAGUE 1'?292:event?.league==='K LEAGUE 2'?293:0;
 const url=kleagueTvUrl(source?.eventUrl),parts=url?new URL(url).pathname.split('/'):[];
 return !!p&&positive(source.id)&&String(source.id)===parts.at(-1)&&source.slug===parts.at(-2)&&source.distribution==='VOD'&&source.contentType==='Fullmatch'&&source.payment==='Registration'&&source.entitlementsEmpty===true&&source.publication==='Live'&&source.freeForEmbed===false&&Number.isSafeInteger(source.durationSeconds)&&source.durationSeconds>=3600&&source.durationSeconds<=14400
  &&positive(event?.id)&&positive(event?.homeId)&&positive(event?.awayId)&&event.homeId!==event.awayId&&event.sport==='Soccer'&&league===match?.leagueId&&event.category===event.league&&match.finished===true&&['FT','AET','PEN'].includes(match.status)&&Number.isSafeInteger(match.season)&&new Date(match.date).getUTCFullYear()===match.season
  &&kleagueRound(match)===source.round&&source.round===Number(p[1])&&kleagueTeamMatches(match.home,p[2])&&kleagueTeamMatches(match.away,p[3])&&kleagueTeamMatches(match.home,event.home)&&kleagueTeamMatches(match.away,event.away)
  &&Math.abs(time(event.startTime)-time(match.date))<=60000&&Math.abs(time(source.startTime)-time(event.startTime))<=30*60000&&Number.isFinite(time(source.updatedAt))&&time(source.updatedAt)>=time(match.date)+60*60000&&time(source.updatedAt)<=now+5000&&now>=time(match.date)+60*60000&&now<time(match.date)+7*86400000
  &&Array.isArray(source.countries)&&source.countries.length>0&&source.countries.length<=3&&new Set(source.countries).size===source.countries.length&&source.countries.every(code=>KLEAGUE_TV_POLICY.countries.includes(code));
}
