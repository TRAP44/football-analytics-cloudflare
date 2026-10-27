// Exact, reviewed navigation destinations. They are not playable stream URLs.
const URLS=new Set([
  'https://www.premierleague.com/en/watch-live',
  'https://en.legaseriea.it/serie-a/broadcasters',
  'https://www.bundesliga.com/en/bundesliga/info/broadcasters',
  'https://ligue1.com/en/international-broadcasters',
  'https://www.uefa.com/uefachampionsleague/news/0253-0d82037aaedd-f371c464f919-1000--where-to-watch-the-champions-league-tv-broadcast-partners-li/',
  'https://matchtv.ru/tvguide',
  'https://okko.tv/',
]);
const LALIGA_COUNTRIES=new Set(["SA","DZ","EG","AE","IR","IQ","JO","KW","LB","LY","MA","OM","QA","SY","TN","YE","KH","LA","MY","SG","GP","MQ","YT","NC","PF","RE","MU","MC","PM","WF","BL","MF","TD","SO","BH","PS","SS","VI","PH","MR","SD","DJ","AD","TH","ID","AU","NZ","BN","TL","AR","BO","CL","CO","EC","GF","GY","PY","PE","SR","TT","UY","AI","AG","AW","BS","BB","BZ","BM","CW","DM","GD","KY","VG","TC","GS","FK","VE","US","PR","GR","AO","BJ","BW","BF","BI","CV","CM","CI","ER","ET","GA","GM","GH","GN","GQ","GW","KE","LS","LR","MW","ML","MZ","NA","NE","NG","CF","CD","RW","SN","SL","ZA","TZ","TG","UG","ZM","ZW","MG","SH","ST","SC","KM","SZ","CR","SV","GT","HN","MX","NI","PA","DO","GE","IL","CU","HT","JM","KN","VC","MS","BQ","LC","HK","BE","LU","HR","SI","AL","KZ","KG","MD","TJ","TM","UZ","AZ","EE","LT","LV","AM","NL","DE","AT","JP","IT","TW","PT","FR","CH","CG","RO","RU","HU","PL","UA","MT","BG","GB","IE","VN","MO","GI","NO","ES","CN","BA","MK","ME","RS","CA","XK","CZ","SK","SE","DK","FI","IS","TR","FJ","SB","CK","VU","TV","NU","TK","TO","NR","WS","PG","KR","CY","IN","NP","PK","LK","BD","MV","BY","BR"]);
export function broadcastGuideUrl(value){
  if(typeof value!=='string')return '';
  const country=/^https:\/\/www\.laliga\.com\/en-([A-Z]{2})\/where-to-watch-laliga-easports$/.exec(value);
  return URLS.has(value)||country&&LALIGA_COUNTRIES.has(country[1])?value:'';
}
export function validBroadcastGuide(value,fixtureId,country,now=Date.now()) {
  if(!value||value.fixtureId!==fixtureId||value.country!==country||value.scope!=='competition'||!Number.isSafeInteger(value.leagueId)||typeof value.leagueName!=='string'||value.leagueName.length>80)return null;
  if(value.directory!==null&&!broadcastGuideUrl(value.directory?.url))return null;
  if(value.leagueId===140&&value.directory&&!value.directory.url.includes(`/en-${country}/`))return null;
  const expiry=Date.parse(value.expiresAt);
  if(!Number.isFinite(expiry)||expiry<=now||expiry>now+30*60000+5000)return null;
  const countries=Array.isArray(value.countries)?value.countries.filter(item=>/^[A-Z]{2}$/.test(item?.code)&&typeof item.name==='string'&&item.name.length<=80).slice(0,40):[];
  return {...value,countries,providers:Array.isArray(value.providers)?value.providers.filter(item=>broadcastGuideUrl(item?.url)&&typeof item.name==='string'&&item.name.length<=80&&Date.parse(item.verifiedUntil)>now).slice(0,3):[]};
}
