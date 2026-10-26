// Competition directories are guidance, never evidence of a specific match's
// broadcast or permission to embed a player. No external requests on this path.
const CHECKED_AT='2026-10-26T23:00:00.000Z';
const PROVIDERS_UNTIL='2026-11-26T23:00:00.000Z';
const GUIDES=Object.freeze({
  39:{name:'АПЛ',url:'https://www.premierleague.com/en/watch-live'},
  140:{name:'Ла Лига',url:null,ru:[{name:'Матч ТВ',url:'https://matchtv.ru/tvguide'}]},
  135:{name:'Серия А',url:'https://en.legaseriea.it/serie-a/broadcasters'},
  78:{name:'Бундеслига',url:'https://www.bundesliga.com/en/bundesliga/info/broadcasters'},
  61:{name:'Лига 1',url:'https://ligue1.com/en/international-broadcasters'},
  2:{name:'Лига чемпионов',url:'https://www.uefa.com/uefachampionsleague/news/0253-0d82037aaedd-f371c464f919-1000--where-to-watch-the-champions-league-tv-broadcast-partners-li/',ru:[{name:'Okko',url:'https://okko.tv/'}]},
});
const LALIGA_COUNTRIES=new Set(["SA","DZ","EG","AE","IR","IQ","JO","KW","LB","LY","MA","OM","QA","SY","TN","YE","KH","LA","MY","SG","GP","MQ","YT","NC","PF","RE","MU","MC","PM","WF","BL","MF","TD","SO","BH","PS","SS","VI","PH","MR","SD","DJ","AD","TH","ID","AU","NZ","BN","TL","AR","BO","CL","CO","EC","GF","GY","PY","PE","SR","TT","UY","AI","AG","AW","BS","BB","BZ","BM","CW","DM","GD","KY","VG","TC","GS","FK","VE","US","PR","GR","AO","BJ","BW","BF","BI","CV","CM","CI","ER","ET","GA","GM","GH","GN","GQ","GW","KE","LS","LR","MW","ML","MZ","NA","NE","NG","CF","CD","RW","SN","SL","ZA","TZ","TG","UG","ZM","ZW","MG","SH","ST","SC","KM","SZ","CR","SV","GT","HN","MX","NI","PA","DO","GE","IL","CU","HT","JM","KN","VC","MS","BQ","LC","HK","BE","LU","HR","SI","AL","KZ","KG","MD","TJ","TM","UZ","AZ","EE","LT","LV","AM","NL","DE","AT","JP","IT","TW","PT","FR","CH","CG","RO","RU","HU","PL","UA","MT","BG","GB","IE","VN","MO","GI","NO","ES","CN","BA","MK","ME","RS","CA","XK","CZ","SK","SE","DK","FI","IS","TR","FJ","SB","CK","VU","TV","NU","TK","TO","NR","WS","PG","KR","CY","IN","NP","PK","LK","BD","MV","BY","BR"]);
const COUNTRY_NAMES=Object.freeze({RU:'Россия',KZ:'Казахстан',BY:'Беларусь',UA:'Украина',UZ:'Узбекистан',GE:'Грузия',AM:'Армения',AZ:'Азербайджан',GB:'Великобритания',DE:'Германия',FR:'Франция',ES:'Испания',IT:'Италия',US:'США'});
export function broadcastGuide(match,{country='',now=Date.now()}={}) {
  if(!Number.isSafeInteger(match?.fixtureId)||match.fixtureId<=0||!Number.isSafeInteger(match?.leagueId)||!Number.isFinite(now))return null;
  const source=GUIDES[match.leagueId],kickoff=Date.parse(match.date);
  if(!source||!Number.isFinite(kickoff)||kickoff<now-6*3600000||kickoff>now+14*86400000||match.finished===true||['FT','AET','PEN','PST','CANC','ABD','AWD','WO','TBD'].includes(match.status))return null;
  if(country&&!/^[A-Z]{2}$/.test(country))return null;
  if(match.leagueId===140&&country&&!LALIGA_COUNTRIES.has(country))return null;
  const checked=Date.parse(CHECKED_AT),until=Date.parse(PROVIDERS_UNTIL);
  const verified=now>=checked&&now<until&&kickoff>=Date.parse('2026-07-01')&&kickoff<Date.parse('2027-07-01');
  const countries=Object.entries(COUNTRY_NAMES).map(([code,name])=>({code,name}));
  if(country&&!COUNTRY_NAMES[country])countries.push({code:country,name:new Intl.DisplayNames(['ru'],{type:'region'}).of(country)});
  return {fixtureId:match.fixtureId,leagueId:match.leagueId,leagueName:source.name,country,
    scope:'competition',checkedAt:CHECKED_AT,expiresAt:new Date(now+30*60000).toISOString(),countries,
    directory:match.leagueId===140
      ?country&&LALIGA_COUNTRIES.has(country)?{name:'Вещатели и расписание',url:`https://www.laliga.com/en-${country}/where-to-watch-laliga-easports`}:null
      :{name:'Вещатели и расписание',url:source.url},
    providers:verified&&country==='RU'?(source.ru||[]).map(provider=>({...provider,verifiedUntil:PROVIDERS_UNTIL})):[]};
}
