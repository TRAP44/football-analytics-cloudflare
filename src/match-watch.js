import watchManifest from './match-watch-approvals.json' with {type:'json'};
export const WATCH_APPROVALS=watchManifest.items;
// Only service-owned, explicitly reviewed catalogue records are eligible for UI.
// Public requests never discover/fetch/submit arbitrary videos or provider URLs.
export const watchCacheKey=id=>`match-watch:${id}:v1`;
export const WATCH_PUBLISHERS=Object.freeze({fifa:'UCpcTrCXblq78GZrTUTLWeBw'});
export const WATCH_TTL_MS=30*60*1000;
const COUNTRY_CODES='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
export const WATCH_COUNTRIES=Object.freeze(Object.fromEntries(COUNTRY_CODES.map(code=>[code,code])));
let countryNames;
const countryName=code=>{countryNames ||= new Intl.DisplayNames(['ru'],{type:'region'});return countryNames.of(code);};
const id=value=>Number.isSafeInteger(value) && value>0?value:0;
const time=value=>typeof value==='string' && Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const text=(value,max=160)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f<>]/g,' ').trim().slice(0,max):'';
export function watchFixtureIdentity(match){
  const fixtureId=id(match?.fixtureId),homeId=id(match?.home?.id),awayId=id(match?.away?.id),leagueId=id(match?.leagueId),season=id(match?.season),date=time(match?.date);
  return fixtureId && homeId && awayId && homeId!==awayId && leagueId && season && Number.isFinite(date)
    ? `${fixtureId}:${homeId}:${awayId}:${leagueId}:${season}:${new Date(date).toISOString()}` : '';
}
export function officialWatchUrl(provider,value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port)return '';
    if(provider==='youtube'){
      const videoId=url.searchParams.get('v');
      if(url.hostname!=='www.youtube.com'||url.pathname!=='/watch'||[...url.searchParams.keys()].length!==1||!/^[A-Za-z0-9_-]{11}$/.test(videoId || ''))return '';
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
    if(url.search)return '';
    if(provider==='okko' && url.hostname==='okko.tv' && /^\/sport\/(?:event|product|match)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))return url.href;
    if(provider==='dazn' && url.hostname==='www.dazn.com' && /^\/[a-z]{2}-[A-Z]{2}\/home\/[a-z0-9]+\/[a-z0-9]+\/?$/.test(url.pathname))return url.href;
  }catch{}
  return '';
}

export function validatedWatchOptions(match,catalogue,{country='',now=Date.now(),enabled=true,approvals=WATCH_APPROVALS}={}){
  const identity=watchFixtureIdentity(match);
  if(!Array.isArray(approvals) || !enabled || !identity || !Number.isFinite(now) || !catalogue || catalogue.version!==1 || catalogue.fixtureIdentity!==identity || !Array.isArray(catalogue.items) || catalogue.items.length>10 || ['PST','CANC','ABD','AWD','WO','TBD'].includes(match.status))return [];
  const seen=new Set(),result=[];
  for(const item of catalogue.items){
    if(!item || typeof item!=='object' || Array.isArray(item) || !Array.isArray(item.countries))continue;
    const approvedSource=approvals.find(source=>source.confirmed===true && watchFixtureIdentity(source.match)===identity && source.provider===item.provider && source.eventUrl===item.eventUrl && source.kind===item.kind && source.access===item.access && source.confirmedAt===item.approval?.confirmedAt && source.publisher===item.publisher && time(source.validUntil)>now);
    if(!approvedSource || !Array.isArray(approvedSource.countries) || item.countries?.some(code=>!approvedSource.countries.includes(code)))continue;
    const checked=time(item?.checkedAt),expiry=time(item?.expiresAt),approved=time(item?.approval?.confirmedAt);
    if(item?.approval?.version!==1 || item.approval.fixtureIdentity!==identity || item.approval.confirmed!==true || !Number.isFinite(checked)||!Number.isFinite(expiry)||!Number.isFinite(approved)||approved>now+5000||checked>now+5000||expiry<=now||expiry>time(approvedSource.validUntil)||expiry-checked>WATCH_TTL_MS||now-checked>WATCH_TTL_MS||checked<approved)continue;
    if(!['live','replay','highlights'].includes(item.kind)||!['free','subscription','ppv','unknown'].includes(item.access))continue;
    if(!Array.isArray(item.countries)||item.countries.length<1||item.countries.length>Object.keys(WATCH_COUNTRIES).length||item.countries.some(code=>!Object.hasOwn(WATCH_COUNTRIES,code))||country && !item.countries.includes(country))continue;
    // A replay never becomes a current live option due to a scheduled premiere.
    if(item.kind==='live' && match.finished===true || item.kind!=='live' && match.finished!==true)continue;
    const eventUrl=officialWatchUrl(item.provider,item.eventUrl);
    if(!eventUrl || seen.has(eventUrl))continue;
    const videoId=item.provider==='youtube'?new URL(eventUrl).searchParams.get('v'):'';
    if(item.provider==='youtube' && (item.videoId!==videoId || item.publicVideo!==true || item.regionVerified!==true || item.ageRestricted!==false || WATCH_PUBLISHERS[item.publisher]!==item.channelId))continue;
    seen.add(eventUrl);
    result.push({provider:item.provider,name:item.provider==='youtube'?'YouTube':item.provider==='okko'?'Okko':'DAZN',
      kind:item.kind,access:item.access,eventUrl,videoId,
      // Official player only, with independent official-link fallback.
      embed:item.provider==='youtube' && item.embeddable===true,
      label:text(item.label)|| (item.kind==='live'?'Трансляция':item.kind==='replay'?'Полная запись':'Обзор'),
      countries:[...new Set(item.countries)],checkedAt:new Date(checked).toISOString(),expiresAt:new Date(expiry).toISOString(),
      availableFrom:Number.isFinite(time(item.availableFrom))?new Date(time(item.availableFrom)).toISOString():null});
  }
  return result;
}

export function watchApiPayload(match,catalogue,options={}){
  const all=validatedWatchOptions(match,catalogue,{...options,country:''});
  const items=options.country?all.filter(item=>item.countries.includes(options.country)):[];
  return {fixtureId:id(match?.fixtureId),country:options.country || '',available:items.length>0,
    countries:[...new Set(all.flatMap(item=>item.countries))].map(code=>({code,name:countryName(code)})),items};
}
