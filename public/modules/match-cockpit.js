function plainObject(value) {
  return value && typeof value==='object' && !Array.isArray(value)
    ? value
    : null;
}

function scalarNumber(value) {
  if (typeof value==='number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value!=='string') return null;
  const raw=value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw)) {
    return null;
  }
  const number=Number(raw.replace(',','.'));
  return Number.isFinite(number) ? number : null;
}

function rangedNumber(value,min,max) {
  const number=scalarNumber(value);
  return number!==null && number>=min && number<=max
    ? number
    : null;
}

function boundedInteger(value,min,max) {
  const number=scalarNumber(value);
  return number!==null
    && Number.isSafeInteger(number)
    && number>=min
    && number<=max
      ? number
      : null;
}

function safeText(value,fallback='') {
  if (typeof value!=='string') return fallback;
  const text=value.normalize('NFKC').replace(/\s+/gu,' ').trim();
  return text || fallback;
}

function featureMeta(data,key) {
  const provider=plainObject(data?.providerReliability);
  const providerFeatures=plainObject(provider?.features);
  const policy=plainObject(data?.dataPolicy);
  const policyReliability=plainObject(policy?.reliability);
  const policyFeatures=plainObject(policyReliability?.features);
  return plainObject(providerFeatures?.[key])
    || plainObject(policyFeatures?.[key])
    || {};
}

export function cockpitFeatureTrusted(meta) {
  const source=plainObject(meta);
  return Boolean(
    source
    && source.confidenceBearing===true
    && source.stale!==true
    && source.provenanceState==='verified'
  );
}

function metricByKey(metrics,key) {
  return metrics.find(item=>
    plainObject(item)?.key===key
  ) || null;
}

function ppgPair(metric,fallbackHome,fallbackAway) {
  const source=plainObject(metric);
  const home=rangedNumber(source?.homeValue,0,3)
    ?? rangedNumber(fallbackHome,0,3);
  const away=rangedNumber(source?.awayValue,0,3)
    ?? rangedNumber(fallbackAway,0,3);
  return home!==null && away!==null
    ? {home,away}
    : null;
}

function rankPair(metric) {
  const source=plainObject(metric);
  const home=boundedInteger(source?.homeValue,1,500);
  const away=boundedInteger(source?.awayValue,1,500);
  return home!==null && away!==null
    ? {home,away}
    : null;
}

function lineupSideConfirmed(data,side,lineupTrusted) {
  if (!lineupTrusted) return false;
  const impact=plainObject(data?.lineupImpact);
  const key=side==='home' ? 'homeConfirmed' : 'awayConfirmed';
  if (typeof impact?.[key]==='boolean') {
    return impact[key]===true;
  }
  const lineups=plainObject(data?.lineups);
  const lineup=plainObject(lineups?.[side]);
  const quality=plainObject(lineup?.quality);
  return quality?.confirmed===true;
}

function h2hSummary(value) {
  const source=plainObject(value);
  if (!source) return null;
  const homeWins=boundedInteger(source.homeWins,0,1000);
  const draws=boundedInteger(source.draws,0,1000);
  const awayWins=boundedInteger(source.awayWins,0,1000);
  if (homeWins===null || draws===null || awayWins===null) return null;
  const sample=homeWins+draws+awayWins;
  return sample>0
    ? {homeWins,draws,awayWins,sample}
    : null;
}

function marketSummary(data,oddsMeta) {
  if (!cockpitFeatureTrusted(oddsMeta)) return null;
  const market=plainObject(data?.market);
  const odds=plainObject(market?.odds);
  const home=rangedNumber(odds?.home,1.000001,999.999);
  const draw=rangedNumber(odds?.draw,1.000001,999.999);
  const away=rangedNumber(odds?.away,1.000001,999.999);
  if (home===null || draw===null || away===null) return null;

  const movement=plainObject(data?.marketMovement);
  const sample=boundedInteger(movement?.sample,0,100000) ?? 0;
  const deltas=plainObject(movement?.probabilityChange);
  let strongestMove=null;
  if (sample>=2 && deltas) {
    const homeDelta=rangedNumber(deltas.home,-100,100);
    const drawDelta=rangedNumber(deltas.draw,-100,100);
    const awayDelta=rangedNumber(deltas.away,-100,100);
    if (
      homeDelta!==null
      && drawDelta!==null
      && awayDelta!==null
      && Math.abs(homeDelta+drawDelta+awayDelta)<=1
    ) {
      strongestMove=[
        ['П1',homeDelta],
        ['Н',drawDelta],
        ['П2',awayDelta],
      ].sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0] || null;
      if (!strongestMove || Math.abs(strongestMove[1])<1) {
        strongestMove=null;
      }
    }
  }

  return {
    odds:{home,draw,away},
    provider:safeText(
      plainObject(data?.dataProvenance)?.features?.odds?.provider,
      safeText(market?.provider),
    ),
    strongestMove,
  };
}

function qualitySummary(data) {
  const confidence=rangedNumber(data?.confidence?.score,0,100);
  const score=rangedNumber(data?.completeness?.score,0,100000);
  const max=rangedNumber(data?.completeness?.max,0.000001,100000);
  const completeness=score!==null && max!==null && score<=max
    ? {score,max}
    : null;
  return {
    confidence:confidence===null ? null : Math.round(confidence),
    completeness,
    label:safeText(data?.confidence?.label),
  };
}

export function deriveMatchCockpit(data = {}) {
  const source=plainObject(data) || {};
  const match=plainObject(source.match) || {};
  const recent=plainObject(source.recentForm) || {};
  const homeRecent=plainObject(recent.home) || {};
  const awayRecent=plainObject(recent.away) || {};
  const homeOverall=plainObject(homeRecent.overall) || {};
  const awayOverall=plainObject(awayRecent.overall) || {};
  const homeVenue=plainObject(homeRecent.venue) || {};
  const awayVenue=plainObject(awayRecent.venue) || {};
  const comparison=plainObject(source.comparison) || {};
  const metrics=Array.isArray(comparison.metrics)
    ? comparison.metrics.slice(0,100)
    : [];

  const formMetric=metricByKey(metrics,'form_ppg');
  const venueMetric=metricByKey(metrics,'venue_ppg');
  const tableMetric=metricByKey(metrics,'table_rank');

  const formSamples={
    home:boundedInteger(homeOverall.sample,1,1000),
    away:boundedInteger(awayOverall.sample,1,1000),
  };
  const formPair=formSamples.home!==null && formSamples.away!==null
    ? ppgPair(
        formMetric,
        homeOverall.ppg,
        awayOverall.ppg,
      )
    : null;

  const venueSamples={
    home:boundedInteger(homeVenue.sample,1,1000),
    away:boundedInteger(awayVenue.sample,1,1000),
  };
  const venuePair=venueSamples.home!==null && venueSamples.away!==null
    ? ppgPair(
        venueMetric,
        homeVenue.ppg,
        awayVenue.ppg,
      )
    : null;

  const injuriesMeta=featureMeta(source,'injuries');
  const lineupMeta=featureMeta(source,'lineups');
  const oddsMeta=featureMeta(source,'odds');
  const injuryConfirmed=cockpitFeatureTrusted(injuriesMeta);
  const lineupTrusted=cockpitFeatureTrusted(lineupMeta);
  const homeConfirmed=lineupSideConfirmed(
    source,
    'home',
    lineupTrusted,
  );
  const awayConfirmed=lineupSideConfirmed(
    source,
    'away',
    lineupTrusted,
  );

  const absences=plainObject(source.absences) || {};
  const homeAbs=injuryConfirmed && Array.isArray(absences.home)
    ? Math.min(200,absences.home.length)
    : 0;
  const awayAbs=injuryConfirmed && Array.isArray(absences.away)
    ? Math.min(200,absences.away.length)
    : 0;

  return {
    homeName:safeText(match?.home?.name,'Хозяева'),
    awayName:safeText(match?.away?.name,'Гости'),
    balanceLabel:safeText(comparison.balanceLabel),
    form:{
      available:Boolean(formPair),
      pair:formPair,
    },
    venue:{
      available:Boolean(venuePair),
      pair:venuePair,
    },
    table:{
      available:Boolean(rankPair(tableMetric)),
      pair:rankPair(tableMetric),
    },
    injuries:{
      confirmed:injuryConfirmed,
      state:safeText(injuriesMeta.state),
      homeAbs,
      awayAbs,
    },
    lineups:{
      trusted:lineupTrusted,
      state:safeText(lineupMeta.state),
      homeConfirmed,
      awayConfirmed,
      confirmedCount:Number(homeConfirmed)+Number(awayConfirmed),
    },
    h2h:h2hSummary(source.h2h),
    market:marketSummary(source,oddsMeta),
    quality:qualitySummary(source),
    lineupNote:safeText(source?.lineupImpact?.note),
  };
}
