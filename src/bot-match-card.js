export const BOT_CARD_VERSION = 2;
export const BOT_CARD_MAX_BYTES = 250000;
export const BOT_CARD_MAX_AGE_MS = 6 * 60 * 1000;

const text = (value, limit = 120) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit) : '';
const metric = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 300 ? value : null;
const id = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function botCardRows(matches = []) {
  return (Array.isArray(matches) ? matches : []).slice(0,8).map(m=>({
    fixtureId:id(m.fixtureId), homeId:id(m.home?.id), awayId:id(m.away?.id),
    homeName:text(m.homeName), awayName:text(m.awayName), league:text(m.league,80),
    live:m.live===true, finished:m.finished===true, status:text(m.status,24),
    date:text(m.date,80), elapsed:metric(m.elapsed),
    goalsHome:metric(m.goalsHome), goalsAway:metric(m.goalsAway),
  }));
}

// Match only what is actually drawn. LIVE minutes and tail matches are shown
// in current buttons/caption, not baked into the PNG. Never attach an old score.
export function botCardSignature(matches, liveOnly = false) {
  return JSON.stringify({v:BOT_CARD_VERSION,liveOnly:liveOnly===true,rows:botCardRows(matches).slice(0,4).map(row=>({
    ...row,elapsed:null,status:row.live ? row.status==='HT' ? 'HT' : 'LIVE' : row.finished ? 'FT' : 'NS',
  }))});
}

export function validCachedBotCard(card, signature, now = Date.now()) {
  if (!card || card.signature!==signature || !Number.isFinite(card.generatedAt) || !Number.isFinite(now)) return false;
  if (now-card.generatedAt<0 || now-card.generatedAt>BOT_CARD_MAX_AGE_MS) return false;
  return typeof card.png==='string' && card.png.startsWith('iVBORw0KGgo')
    && card.png.length<=Math.ceil(BOT_CARD_MAX_BYTES/3)*4 && /^[A-Za-z0-9+/]+={0,2}$/.test(card.png);
}

function time(iso) {
  const date=new Date(iso);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU',{
    hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow',
  }).format(date) : '—';
}

function nameLines(name) {
  const words=name.split(/\s+/);
  const lines=[''];
  for (const word of words) {
    const last=lines.length-1;
    if ((lines[last]+' '+word).trim().length>16 && lines[last] && lines.length<2) lines.push(word);
    else lines[last]=(lines[last]+' '+word).trim();
  }
  return lines.map(line=>line.length>16 ? line.slice(0,21)+'…' : line);
}

function crest(teamId,x,y,logos) {
  const image=logos?.get(teamId);
  if (typeof image==='string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image)) {
    return `<image x="${x}" y="${y}" width="48" height="48" href="${image}"/>`;
  }
  // Neutral football, never a fabricated club crest.
  return `<circle cx="${x+24}" cy="${y+24}" r="22" fill="#263442" stroke="#56616c"/><path d="M${x+24} ${y+13}l10 7-4 12h-12l-4-12z" fill="#b8c2cd"/>`;
}

export function buildBotMatchCardSvg(matches, {liveOnly=false,logos=new Map(),generatedAt=Date.now()} = {}) {
  const rows=botCardRows(matches).slice(0,4);
  const height=145+rows.length*112;
  const stamp=time(new Date(generatedAt).toISOString());
  const body=rows.map((m,index)=>{
    const y=126+index*112;
    const score=(m.live || m.finished) && m.goalsHome!==null && m.goalsAway!==null
      ? `${m.goalsHome} : ${m.goalsAway}` : '—';
    const status=m.live ? m.status==='HT' ? 'ПЕРЕРЫВ' : 'LIVE'
      : m.finished ? 'ЗАВЕРШЁН' : `${time(m.date)} МСК`;
    const names=(name,x,anchor)=>nameLines(name).map((line,j)=>
      `<text x="${x}" y="${y+53+j*23}" text-anchor="${anchor}" font-size="20" font-weight="bold" fill="#f3f6fa">${xml(line)}</text>`).join('');
    return `<rect x="24" y="${y}" width="592" height="100" rx="16" fill="#131e29" stroke="#293642"/>
      <text x="42" y="${y+21}" font-size="11" fill="#b2bdc9">${xml(m.league.length>32 ? m.league.slice(0,31)+'…' : m.league)}</text>
      ${crest(m.homeId,42,y+35,logos)}${names(m.homeName,104,'start')}
      <text x="320" y="${y+30}" text-anchor="middle" font-size="11" fill="${m.live?'#ff7e87':'#f8c332'}">${xml(status)}</text>
      <text x="320" y="${y+66}" text-anchor="middle" font-size="30" font-weight="bold" fill="#f8c332">${score}</text>
      ${names(m.awayName,536,'end')}${crest(m.awayId,550,y+35,logos)}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="640" height="${height}" viewBox="0 0 640 ${height}">
    <rect width="640" height="${height}" fill="#09121b"/>
    <rect x="24" y="28" width="5" height="63" rx="2" fill="#f8c332"/>
    <g font-family="DejaVu Sans">
      <text x="44" y="49" font-size="12" letter-spacing="2" fill="#f8c332">MATCHRADAR AI</text>
      <text x="44" y="84" font-size="25" font-weight="bold" fill="#f3f6fa">${liveOnly?'LIVE · Сейчас на поле':'Матчи сегодня'}</text>
      <text x="596" y="48" text-anchor="end" font-size="12" fill="#b2bdc9">${xml(stamp)} МСК</text>
      <text x="596" y="78" text-anchor="end" font-size="12" fill="#b2bdc9">Главные матчи</text>
      ${body}
    </g></svg>`;
}
