import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  annotateEventReliability,
  assessMatchEventQuality,
  eventsForTrustedAnalytics,
  inspectMatchEvent,
  sanitizeEventsForDisplay,
} from '../src/event-quality.js';

const trustedMeta = Object.freeze({
  provider:'api-football',
  source:'network',
  state:'available',
  available:true,
  usable:true,
  observed:true,
  stale:false,
  confidenceBearing:true,
  freshnessState:'fresh',
  provenanceState:'verified',
  ageSeconds:0,
});

const ev = (
  id,
  minute,
  side,
  type='Goal',
  detail='Normal Goal',
  extra=0,
) => ({
  id,
  minute,
  extra,
  side,
  type,
  detail,
  player:'Player',
});

test('RC141 accepts trusted structurally valid events with measurable freshness',()=>{
  const rows=[
    ev('a',12,'home'),
    ev('b',40,'away','Card','Yellow Card'),
  ];
  const quality=assessMatchEventQuality(rows,{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:45,
  });

  assert.equal(quality.state,'verified');
  assert.equal(quality.displayCount,2);
  assert.equal(quality.analyticalCount,2);
  assert.equal(quality.confidenceBearing,true);
  assert.deepEqual(
    eventsForTrustedAnalytics(rows,quality).map(item=>item.id),
    ['a','b'],
  );
});

test('RC141 requires explicit measurable freshness and explicit nonstale evidence',()=>{
  const row=[ev('a',12,'home')];

  for (const meta of [
    {...trustedMeta,ageSeconds:undefined},
    {...trustedMeta,ageSeconds:undefined,stale:undefined},
    {
      ...trustedMeta,
      ageSeconds:undefined,
      fetchedAt:'2026-10-07T10:00:00',
    },
  ]) {
    const quality=assessMatchEventQuality(row,{
      eventsMeta:meta,
      mode:'live',
      elapsed:20,
    });
    assert.equal(quality.state,'source_untrusted');
    assert.equal(quality.sourceTrusted,false);
    assert.equal(quality.confidenceBearing,false);
  }

  const timestampBacked=assessMatchEventQuality(row,{
    eventsMeta:{
      ...trustedMeta,
      ageSeconds:undefined,
      fetchedAt:'2026-10-07T10:00:00+03:00',
    },
    mode:'live',
    elapsed:20,
  });
  assert.equal(timestampBacked.sourceTrusted,true);
  assert.equal(timestampBacked.state,'verified');
});

test('RC141 deduplicates exact provider repeats before analytics',()=>{
  const rows=[ev('a',12,'home'),ev('b',12,'home')];
  const quality=assessMatchEventQuality(rows,{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:20,
  });

  assert.equal(quality.state,'sanitized');
  assert.equal(quality.duplicateCount,1);
  assert.deepEqual(quality.duplicateEventIndices,[1]);
  assert.equal(sanitizeEventsForDisplay(rows,quality).length,1);
  assert.equal(eventsForTrustedAnalytics(rows,quality).length,1);
});

test('RC141 treats omitted extra time and explicit zero as the same fingerprint',()=>{
  const a=ev('a',12,'home');
  delete a.extra;
  const b=ev('b',12,'home');
  const quality=assessMatchEventQuality([a,b],{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:20,
  });

  assert.equal(quality.duplicateCount,1);
  assert.deepEqual(quality.displayEventIds,['a']);
});

test('RC141 rejects explicit null extra time instead of treating it as omitted',()=>{
  const item=ev('bad-extra',12,'home');
  item.extra=null;

  const inspected=inspectMatchEvent(item,{mode:'live',elapsed:20});
  assert.equal(inspected.displayValid,false);
  assert.equal(inspected.extra,null);
  assert.ok(inspected.reasons.includes('extra_invalid'));
});

test('RC141 future detection includes stoppage time and works from elapsed zero',()=>{
  const stoppage=inspectMatchEvent(
    ev('future-extra',90,'home','Goal','Normal Goal',12),
    {mode:'live',elapsed:90},
  );
  assert.equal(stoppage.future,true);
  assert.equal(stoppage.displayValid,false);

  const kickoffFuture=inspectMatchEvent(
    ev('future-kickoff',20,'away'),
    {mode:'live',elapsed:0},
  );
  assert.equal(kickoffFuture.future,true);

  const tolerated=inspectMatchEvent(
    ev('within-tolerance',45,'home','Goal','Normal Goal',6),
    {mode:'live',elapsed:45},
  );
  assert.equal(tolerated.future,false);
});

test('RC141 rejects future or invalid minutes and excludes unknown sides from analytics',()=>{
  assert.equal(
    inspectMatchEvent(ev('future',80,'home'),{
      mode:'live',
      elapsed:55,
    }).future,
    true,
  );

  const rows=[
    ev('future',80,'home'),
    ev('unknown',50,'','Card','Red Card'),
    ev('good',51,'away'),
  ];
  const quality=assessMatchEventQuality(rows,{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:55,
  });

  assert.equal(quality.state,'sanitized');
  assert.equal(quality.futureEventCount,1);
  assert.equal(quality.unknownSideCount,1);
  assert.deepEqual(
    sanitizeEventsForDisplay(rows,quality).map(item=>item.id),
    ['unknown','good'],
  );
  assert.deepEqual(
    eventsForTrustedAnalytics(rows,quality).map(item=>item.id),
    ['good'],
  );
});

test('RC141 rejects coercive malformed time values while retaining numeric-string provider fields',()=>{
  assert.equal(
    inspectMatchEvent(ev('bool-minute',true,'home'),{
      mode:'live',
      elapsed:20,
    }).displayValid,
    false,
  );
  assert.equal(
    inspectMatchEvent(ev('empty-minute','','home'),{
      mode:'live',
      elapsed:20,
    }).displayValid,
    false,
  );
  assert.equal(
    inspectMatchEvent(ev('array-minute',[12],'home'),{
      mode:'live',
      elapsed:20,
    }).displayValid,
    false,
  );
  assert.equal(
    inspectMatchEvent(ev('numeric-string','12','home'),{
      mode:'live',
      elapsed:'20',
    }).displayValid,
    true,
  );

  const future=inspectMatchEvent(
    ev('future',40,'home'),
    {mode:' LIVE ',elapsed:'20'},
  );
  assert.equal(future.future,true);

  const quality=assessMatchEventQuality(
    [ev('bad',true,'home'),ev('good',12,'away')],
    {eventsMeta:trustedMeta,mode:' LIVE ',elapsed:'20'},
  );
  assert.equal(quality.mode,'live');
  assert.deepEqual(quality.displayEventIds,['good']);
  assert.equal(quality.invalidTimeCount,1);
});

test('RC141 hostile event, metadata and option getters fail closed without escaping',()=>{
  const hostileEvent={id:'hostile',side:'home',type:'Goal'};
  Object.defineProperty(hostileEvent,'minute',{
    enumerable:true,
    get(){throw new Error('minute getter');},
  });

  const inspected=inspectMatchEvent(hostileEvent,{mode:'live',elapsed:20});
  assert.equal(inspected.displayValid,false);
  assert.ok(inspected.reasons.includes('minute_invalid'));

  const hostileMeta={...trustedMeta};
  Object.defineProperty(hostileMeta,'confidenceBearing',{
    enumerable:true,
    get(){throw new Error('confidence getter');},
  });

  const quality=assessMatchEventQuality([ev('a',12,'home')],{
    eventsMeta:hostileMeta,
    mode:'live',
    elapsed:20,
  });
  assert.equal(quality.state,'source_untrusted');
  assert.equal(quality.sourceTrusted,false);

  const hostileOptions={eventsMeta:trustedMeta};
  Object.defineProperty(hostileOptions,'elapsed',{
    get(){throw new Error('elapsed getter');},
  });
  assert.doesNotThrow(
    ()=>assessMatchEventQuality([ev('a',12,'home')],hostileOptions),
  );
});

test('RC141 sanitized index selection ignores coercive and out-of-range indices',()=>{
  const rows=[
    ev('a',10,'home'),
    ev('b',11,'away'),
    ev('c',12,'home'),
  ];
  const forged={
    sourceTrusted:true,
    analyticalConfidenceBearing:true,
    displayEventIndices:[true,'0',[1],-1,99],
    analyticalEventIndices:[false,'2',{},99],
  };

  assert.deepEqual(
    sanitizeEventsForDisplay(rows,forged).map(row=>row.id),
    ['a'],
  );
  assert.deepEqual(
    eventsForTrustedAnalytics(rows,forged).map(row=>row.id),
    ['c'],
  );
});

test('RC141 display-only events never become confidence-bearing analytics',()=>{
  const rows=[ev('note',12,'home','Comment','Weather delay')];
  const quality=assessMatchEventQuality(rows,{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:20,
  });

  assert.equal(quality.state,'verified');
  assert.equal(quality.displayCount,1);
  assert.equal(quality.analyticalCount,0);
  assert.equal(quality.confidenceBearing,false);
  assert.equal(quality.analyticalConfidenceBearing,false);
  assert.deepEqual(eventsForTrustedAnalytics(rows,quality),[]);

  const meta=annotateEventReliability(trustedMeta,quality);
  assert.equal(meta.available,true);
  assert.equal(meta.usable,true);
  assert.equal(meta.confidenceBearing,false);
  assert.equal(meta.reason,'no_analytical_events');
});

test('RC141 fails closed when freshness or provenance is not trusted',()=>{
  const rows=[ev('a',12,'home')];
  const quality=assessMatchEventQuality(rows,{
    eventsMeta:{
      ...trustedMeta,
      stale:true,
      confidenceBearing:false,
      freshnessState:'stale',
    },
    mode:'live',
    elapsed:20,
  });

  assert.equal(quality.state,'source_untrusted');
  assert.equal(quality.confidenceBearing,false);
  assert.equal(sanitizeEventsForDisplay(rows,quality).length,0);
  assert.equal(eventsForTrustedAnalytics(rows,quality).length,0);

  const meta=annotateEventReliability({
    ...trustedMeta,
    stale:true,
    confidenceBearing:false,
    freshnessState:'stale',
  },quality);
  assert.equal(meta.available,false);
  assert.equal(meta.confidenceBearing,false);
});

test('RC141 annotation tolerates hostile metadata fields',()=>{
  const hostile={...trustedMeta};
  Object.defineProperty(hostile,'state',{
    enumerable:true,
    get(){throw new Error('state getter');},
  });

  const quality=assessMatchEventQuality([ev('a',12,'home')],{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:20,
  });

  const annotated=annotateEventReliability(hostile,quality);
  assert.equal(annotated.available,true);
  assert.equal(annotated.confidenceBearing,true);
  assert.equal(annotated.semanticState,'verified');
});

test('Issue #406 sanitizer cannot re-include rejected duplicate rows sharing one provider id',()=>{
  const rows=[
    ev('same',12,'home'),
    ev('same',12,'home'),
    ev('future',80,'away'),
  ];
  const quality=assessMatchEventQuality(rows,{
    eventsMeta:trustedMeta,
    mode:'live',
    elapsed:20,
  });

  assert.deepEqual(quality.displayEventIndices,[0]);
  assert.deepEqual(quality.duplicateEventIndices,[1]);
  assert.deepEqual(quality.rejectedEventIndices,[2]);
  assert.deepEqual(
    sanitizeEventsForDisplay(rows,quality).map(row=>row.id),
    ['same'],
  );
  assert.deepEqual(
    eventsForTrustedAnalytics(rows,quality).map(row=>row.id),
    ['same'],
  );
});

test('Match Center wires sanitized events into analytics and uses the rolled cache contract',()=>{
  const runtime=fs.readFileSync('src/match-center-runtime.js','utf8');

  assert.match(
    runtime,
    /assessMatchEventQuality\([\s\S]{0,160}?rawFormattedEvents/,
  );
  assert.match(
    runtime,
    /sanitizeEventsForDisplay\([\s\S]{0,160}?rawFormattedEvents,[\s\S]{0,160}?eventQuality/,
  );
  assert.match(
    runtime,
    /eventsForTrustedAnalytics\([\s\S]{0,160}?rawFormattedEvents,[\s\S]{0,160}?eventQuality/,
  );
  assert.match(
    runtime,
    /buildPostMatchReview\(\{[\s\S]{0,600}?events:analyticalEvents/,
  );
  assert.match(
    runtime,
    /buildSmartMatchInsights\(\{[\s\S]{0,600}?events:analyticalEvents/,
  );
  assert.match(
    runtime,
    /buildLiveAiCoach\(\{[\s\S]{0,600}?events:analyticalEvents/,
  );
  assert.match(
    runtime,
    /match-center:\$\{fixtureId\}:v17-event-evidence-rc144/,
  );
});

test('Match Center UI exposes the event-quality state alongside the sanitized timeline',()=>{
  const app=fs.readFileSync('public/app.js','utf8')+'\n'+fs.readFileSync('public/modules/match-center-view.js','utf8');

  assert.match(app,/function eventQualityHintHtml/);
  assert.match(app,/eventQualityHintHtml\(d\.eventQuality\)/);
  assert.match(app,/timelineEventsHtml\(eventRows, m\)/);
});
