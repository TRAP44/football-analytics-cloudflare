import {buildMatchQuestionFacts} from './match-question-facts.js';

const clean=(value,max=120)=>typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max) : '';
const number=(value,max=200)=>typeof value==='number' && Number.isFinite(value) && value>=0 && value<=max ? value : null;
const trusted=meta=>meta?.confidenceBearing===true && meta.stale!==true && meta.provenanceState==='verified';

// Only the sanitized Match Center response enters here, never raw provider or
// shared premium cache data. Missing coverage is not evidence of zero events.
export function buildMatchChatContext(center,analysis=null){
  const match=center?.match || {},mode=center?.mode;
  if(!Number.isSafeInteger(match.fixtureId) || !['live','upcoming','finished'].includes(mode))return null;
  const home=clean(match.home?.name),away=clean(match.away?.name);
  if(!home || !away)return null;
  const facts=[];
  const add=(id,text,source='current')=>facts.push({id,text,source});
  add('match',`${home} — ${away}${clean(match.league) ? `. Турнир: ${clean(match.league)}` : ''}.`);
  // Match Center already revalidates fixture freshness and score integrity.
  const fixtureTrusted=trusted(center.dataFreshness?.match);
  add('phase',fixtureTrusted ? mode==='live' ? 'Матч идёт.' : mode==='finished' ? 'Матч завершён.' : 'Матч ещё не начался.' : 'Текущее состояние матча не удалось подтвердить.');
  if(mode!=='upcoming' && fixtureTrusted){
    if(number(match.score?.home,50)!==null && number(match.score?.away,50)!==null)add('score',`Счёт: ${home} ${match.score.home}:${match.score.away} ${away}.`);
    if(Number.isInteger(match.elapsed) && number(match.elapsed,180)!==null)add('minute',`Минута матча: ${match.elapsed}. Статус: ${clean(match.statusLabel || match.statusLong)}.`);
  }
  const basics=buildMatchQuestionFacts({match});
  for(const fact of basics)if(['kickoff','referee','venue'].includes(fact.id))add(fact.id,fact.text);
  if(center.availability?.statistics===true && trusted(center.dataFreshness?.statistics)){
    for(const [index,row] of (center.statistics?.items || []).slice(0,18).entries()){
      if(!clean(row.label))continue;
      const value=v=>typeof v==='number' && number(v,10000)!==null ? String(v) : typeof v==='string' && /^\d{1,5}(?:[.,]\d{1,3})?%?$/.test(v) ? v : null;
      const h=value(row.home),a=value(row.away);
      if(h!==null && a!==null)add(`stat_${index}`,`${clean(row.label)}: ${home} — ${h}; ${away} — ${a}.`);
    }
  }
  if(center.availability?.events===true && trusted(center.dataFreshness?.events)){
    for(const [index,event] of (center.events || []).slice(-12).entries()){
      if(!['home','away'].includes(event.side) || !Number.isInteger(event.minute) || number(event.minute,180)===null)continue;
      add(`event_${index}`,`${event.minute}′${number(event.extra,30)>0 ? ` +${event.extra}` : ''}: ${event.side==='home'?home:away} — ${clean(event.label)}${clean(event.player) ? `, ${clean(event.player)}` : ''}.`);
    }
  }
  if(center.availability?.lineupsTrusted===true && trusted(center.dataFreshness?.lineups)){
    for(const fact of buildMatchQuestionFacts({match,lineups:center.lineups,lineupQuality:center.lineupQuality})){
      if(/^(starters|lineups)_/.test(fact.id))add(fact.id,fact.text);
    }
  }
  if(center.availability?.injuries===true && trusted(center.dataFreshness?.injuries)){
    for(const fact of buildMatchQuestionFacts({match,absences:center.absences}))if(fact.id.startsWith('absences_'))add(fact.id,fact.text);
  }
  if(analysis?.match?.fixtureId===match.fixtureId){
    for(const fact of buildMatchQuestionFacts(analysis).slice(0,30)){
      // Current lineups/referee/availability always win over a historic analysis.
      if(/^(starters|lineups|absences)_/.test(fact.id) || ['kickoff','referee','venue'].includes(fact.id))continue;
      add(`pre_${fact.id}`,`До матча: ${fact.text}`,'prematch');
    }
  }
  const observedAt=clean(center.dataFreshness?.match?.fetchedAt || center.generatedAt,40);
  return {fixtureId:match.fixtureId,mode,home,away,observedAt,facts:facts.slice(0,60),currentVerified:fixtureTrusted};
}

const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
const key=(secret,usage)=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[usage]);
const TTL=1800;
const MAX_TOKEN=14000;
export async function issueChatContext(secret,userId,fixtureId,turns,now=Date.now()){
  if(typeof secret!=='string' || !secret)return null;
  const payload=JSON.stringify({u:userId,f:fixtureId,e:Math.floor(now/1000)+TTL,t:turns.slice(-4)});
  const bytes=encoder.encode(payload);
  const data=btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  const signature=hex(await crypto.subtle.sign('HMAC',await key(secret,'sign'),encoder.encode(`match-chat:v1:${data}`)));
  const token=`mc1.${data}.${signature}`;
  return token.length<=MAX_TOKEN ? token : null;
}
export async function readChatContext(token,secret,userId,fixtureId,now=Date.now()){
  if(!token)return [];
  if(typeof token!=='string' || token.length>MAX_TOKEN || typeof secret!=='string' || !secret)return null;
  const match=/^mc1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if(!match)return null;
  try{
    const valid=await crypto.subtle.verify('HMAC',await key(secret,'verify'),Uint8Array.from(match[2].match(/../g),pair=>parseInt(pair,16)),encoder.encode(`match-chat:v1:${match[1]}`));
    if(!valid)return null;
    const data=match[1].replace(/-/g,'+').replace(/_/g,'/');
    const parsed=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data),ch=>ch.charCodeAt(0))));
    const seconds=Math.floor(now/1000);
    if(parsed.u!==userId || parsed.f!==fixtureId || parsed.e<=seconds || parsed.e>seconds+TTL+5 || !Array.isArray(parsed.t) || parsed.t.length>4)return null;
    if(!parsed.t.every(turn=>['user','assistant'].includes(turn.role) && typeof turn.content==='string' && turn.content.length<=2400))return null;
    return parsed.t;
  }catch{return null;}
}
