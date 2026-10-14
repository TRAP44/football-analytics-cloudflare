// Compact Telegram morning news. Team symbols are colours, not invented club crests.
const teams=[
  [/\bliverpool\b|ливерпуль/iu,'🔴 Liverpool'],
  [/\bmanchester city\b|манчестер сити/iu,'🔵 Manchester City'],
  [/\bmanchester united\b|манчестер юнайтед/iu,'🔴 Manchester United'],
  [/\barsenal\b|арсенал/iu,'🔴 Arsenal'],
  [/\bchelsea\b|челси/iu,'🔵 Chelsea'],
  [/\breal madrid\b|реал мадрид/iu,'⚪ Real Madrid'],
  [/\bbarcelona\b|барселона/iu,'🔵🔴 Barcelona'],
  [/\bjuventus\b|ювентус/iu,'⚪⚫ Juventus'],
  [/\binter milan\b|интер(?: милан)?/iu,'🔵⚫ Inter'],
  [/\bac milan\b|(?<!интер )милан(?![а-я])/iu,'🔴⚫ Milan'],
  [/\bbayern\b|бавария/iu,'🔴 Bayern'],
  [/\bparis saint.germain\b|\bpsg\b|псж/iu,'🔵🔴 PSG'],
];
const preview=/\b(?:predictions?|preview|betting|bets?|odds|tips|picks|parlay)\b|прогноз|ставк|коэффициент/iu;
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function morningNewsCompact(items=[]) {
  const seen=new Set();
  const rows=[];
  for (const item of Array.isArray(items)?items:[]) {
    if (!item || typeof item.title!=='string' || typeof item.url!=='string' || preview.test(item.title)) continue;
    let url;
    try {url=new URL(item.url);} catch {continue;}
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || seen.has(url.href)) continue;
    const title=item.title.replace(/\s+[|–—]\s+[^|–—]{2,40}$/u,'').trim().slice(0,180);
    if (!title) continue;
    seen.add(url.href);
    const labels=teams.filter(([re])=>re.test(item.title)).map(([,name])=>name).slice(0,2);
    rows.push([labels.length?escape(labels.join(' · ')):'📰 Футбол',`<a href="${escape(url.href)}"><b>${escape(title)}</b></a>`,escape(url.hostname.replace(/^www\./u,''))].join('\n'));
    if (rows.length===3) break;
  }
  return rows.length?['☀️ <b>Футбольное утро</b>','',rows.join('\n\n')].join('\n'):'';
}
