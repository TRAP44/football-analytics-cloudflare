// Official ISL English streams, observed through the league site and Google API.
export const ISL_CHANNEL='UCJk-aQ7NZtqYtpcqKDt_vZg';
const aliases={3473:['Chennaiyin FC'],3477:['Kerala Blasters FC'],15516:['Mohun Bagan Super Giant'],3466:['Punjab FC'],3479:['NorthEast United FC'],3472:['Bengaluru FC'],3475:['FC Goa'],26963:['Sporting Club Delhi'],3478:['Mumbai City FC'],22595:['Inter Kashi FC']};
const normalized=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,''):'';
const team=(canonical,label)=>[canonical?.name,...aliases[canonical?.id]||[]].some(name=>normalized(name)&&normalized(name)===normalized(label));
let indiaDate;
export function islStreamStart(match,value){
 const start=typeof value==='string'?Date.parse(value):NaN,kickoff=Date.parse(match?.date);
 return Number.isFinite(start)&&Number.isFinite(kickoff)&&start>=kickoff-45*60000&&start<=kickoff+5*60000;
}
// Cached upcoming metadata stays scheduled until independently observed live.
export function islPhaseEvidence(match,kind,broadcast,stream,now){
 if(!stream||typeof stream!=='object'||Array.isArray(stream)||!Number.isFinite(now))return false;
 const start=typeof stream.actualStartTime==='string'?Date.parse(stream.actualStartTime):NaN,end=typeof stream.actualEndTime==='string'?Date.parse(stream.actualEndTime):NaN;
 if(kind==='replay')return broadcast==='none'&&islStreamStart(match,stream.actualStartTime)&&Number.isFinite(end)&&end<=now&&end-start>=60*60000&&end-start<=4*3600000;
 if(kind!=='live'||stream.actualEndTime)return false;
 if(broadcast==='upcoming')return !stream.actualStartTime&&islStreamStart(match,stream.scheduledStartTime);
 return broadcast==='live'&&islStreamStart(match,stream.actualStartTime)&&start<=now;
}
export function islFullMatch(match,title,description,kind){return fullMatchEvidence(match,title,description,kind,true);}
// Only schedules an independent canonical refresh; never supplies an FT/score.
export function islEndedMatchHint(match,title,description){return fullMatchEvidence(match,title,description,'replay',false);}
function openingParagraph(description){
 const lines=description.split(/\r?\n/).slice(1);while(lines.length&&!lines[0].trim())lines.shift();
 const end=lines.findIndex(line=>!line.trim()),paragraph=lines.slice(0,end<0?lines.length:end).map(line=>line.trim()).join(' ');
 return paragraph.length<=600?paragraph:'';
}
// Preserve the dated header and only the match-specific opening paragraph.
// A later promotional/footer mention cannot supply missing round evidence.
export function islDescriptionEvidence(description){
 const header=description.split(/\r?\n/,1)[0].trim(),paragraph=header.includes(' || LIVE || ')?openingParagraph(description):'';
 return header+(paragraph?'\n\n'+paragraph:'');
}
function openingRound(match,parts,description,round){
 const paragraph=openingParagraph(description),proof=paragraph.match(/\bGameweek ([1-9]\d?) of the MG ISL (20\d{2})-(\d{2})\b/);
 const rounds=[...paragraph.matchAll(/\bGameweek\s+([1-9]\d?)\b/gi)],seasons=[...new Set(paragraph.match(/\b20\d{2}[-/]\d{2}\b/g)||[])];
 return !!proof&&rounds.length===1&&Number(proof[1])===round&&Number(proof[2])===match.season&&Number(proof[3])===(match.season+1)%100&&seasons.length===1&&seasons[0]===`${proof[2]}-${proof[3]}`&&[parts[1],parts[2]].every(label=>normalized(paragraph).includes(normalized(label)));
}
function fullMatchEvidence(match,title,description,kind,requireScore){
 if(match?.leagueId!==323||!Number.isSafeInteger(match.season)||typeof title!=='string'||title.length>220||typeof description!=='string'||description.length>6000)return false;
 if(!['live','replay'].includes(kind))return false;
 const replay=kind==='replay'&&title.startsWith('FULL REPLAY');
 const parts=title.match(replay?/^FULL REPLAY(?: \(English\))?\s*: ([^|]+?) vs ([^|]+?) \((\d{1,2})-(\d{1,2})\) \| MG ISL (20\d{2})-(\d{2})$/:/^LIVE(?: \(English\))?: ([^|]+?) vs ([^|]+?) \| MG ISL (20\d{2})-(\d{2})(?: \| Gameweek ([1-9]\d?))?$/);
 if(!parts||!team(match.home,parts[1])||!team(match.away,parts[2]))return false;
 const year=Number(parts[replay?5:3]),suffix=Number(parts[replay?6:4]);
 if(year!==match.season||suffix!==(year+1)%100)return false;
 const round=Number(typeof match.round==='string'?match.round.match(/^Regular Season - ([1-9]\d?)$/)?.[1]:NaN);
 if(replay?requireScore&&(!Number.isInteger(match.score?.home)||!Number.isInteger(match.score?.away)||Number(parts[3])!==match.score.home||Number(parts[4])!==match.score.away):!Number.isFinite(round)||(parts[5]?round!==Number(parts[5]):!openingRound(match,parts,description,round)))return false;
 const lines=description.split(/\r?\n/),first=lines[0].trim();
 if(lines.filter(line=>line.trim().startsWith('#MGISLonYT')).length!==1)return false;
 const header=first.match(replay?/^#MGISLonYT \|\| (.+?) vs (.+?) \|\| Match Content \|\| Full Match Replay \|\| Match ([1-9]\d{0,2}) \|\| (\d{2})-([A-Z][a-z]{2})-(20\d{2}) \|\| English \|\| #(?:YTIndia|ytindia)$/:/^#MGISLonYT \|\| (.+?) vs (.+?) \|\| LIVE \|\| Match ([1-9]\d{0,2}) \|\| (\d{2})-([A-Z][a-z]{2})-(20\d{2}) \|\| English \|\| #(?:YTIndia|ytindia)$/);
 if(!header||!team(match.home,header[1])||!team(match.away,header[2]))return false;
 const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(header[5])+1;
 if(!month)return false;
 const date=`${header[6]}-${String(month).padStart(2,'0')}-${header[4]}`;
 indiaDate ||= new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
 return Number.isFinite(Date.parse(match.date))&&date===indiaDate.format(new Date(match.date));
}
