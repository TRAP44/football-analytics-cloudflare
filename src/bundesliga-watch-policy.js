export const BUNDESLIGA_CHANNEL='UC6UL29enLNe4mqwTfAyeNuw';
const normalize=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim():'';
// Observed official labels are scoped to independent API-Football club IDs.
const aliases={
 157:['FC Bayern','FC Bayern München'],162:['SV Werder Bremen'],
 163:["Borussia M'gladbach"],164:['Mainz 05','1. FSV Mainz 05'],
 174:['Schalke 04'],167:['Hoffenheim','TSG 1899 Hoffenheim'],168:['Bayer 04 Leverkusen'],
 182:['1. FC Union Berlin'],185:['SC Paderborn'],
};
const team=(canonical,label)=>!!normalize(label)&&[canonical?.name,...aliases[canonical?.id]||[]].some(name=>normalize(name)===normalize(label));
export function bundesligaHighlightsMatch(match,title,description){
 if(typeof title!=='string'||title.length>220||typeof description!=='string'||description.length>6000)return false;
 if(/\b(?:archive|throwback|classic|retro|women|youth|U-?\d{2})\b|on this day/i.test(title))return false;
 const parts=title.match(/^(?:[^|]{1,100} \| )?([^|]+?) - ([^|]+?) \| Highlights \| (?:Matchday |MD ?)([1-9]\d?)(?: –)? Bundesliga(?: ((?:20)?\d{2})\/(\d{2}))?$/);
 const canonical=typeof match?.round==='string'?match.round.match(/^Regular Season - ([1-9]\d?)$/):null;
 if(!parts||!canonical||Number(parts[3])!==Number(canonical[1])||!team(match.home,parts[1])||!team(match.away,parts[2]))return false;
 const season=`${match.season}/${String(match.season+1).slice(-2)}`;
 if(parts[4]&&`${parts[4].length===2?'20':''}${parts[4]}/${parts[5]}`!==season)return false;
 const lines=description.split(/\r?\n/),first=lines[0].match(/^(.+?) vs\. (.+?) – Highlights from Matchday ([1-9]\d?)!$/);
 if(!first||!team(match.home,first[1])||!team(match.away,first[2])||Number(first[3])!==Number(canonical[1]))return false;
 const evidence=lines.filter(line=>line.startsWith('Watch the Bundesliga highlights of '));
 if(evidence.length!==1)return false;
 const proof=evidence[0].match(/^Watch the Bundesliga highlights of (.+?) vs\. (.+?) from Matchday ([1-9]\d?) of the (20\d{2})\/(\d{2}) season!$/);
 if(!proof||!team(match.home,proof[1])||!team(match.away,proof[2])||Number(proof[3])!==Number(canonical[1])||`${proof[4]}/${proof[5]}`!==season)return false;
 // Reject conflicting metadata instead of allowing a promotional footer to win.
 const seasons=[...new Set(description.match(/\b20\d{2}\/\d{2}\b/g)||[])];
 const rounds=[...description.matchAll(/\bMatchday ([1-9]\d?)\b/g)].map(item=>Number(item[1]));
 return seasons.length===1&&seasons[0]===season&&rounds.every(value=>value===Number(canonical[1]));
}
