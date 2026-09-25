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

const trustedMeta = {
  provider:'api-football', source:'network', state:'available', available:true, usable:true,
  observed:true, stale:false, confidenceBearing:true, freshnessState:'fresh', provenanceState:'verified',
};

const ev = (id, minute, side, type='Goal', detail='Normal Goal', extra=0) => ({id,minute,extra,side,type,detail,player:'Player'});

test('RC141 accepts trusted, structurally valid events', () => {
  const rows=[ev('a',12,'home'),ev('b',40,'away','Card','Yellow Card')];
  const quality=assessMatchEventQuality(rows,{eventsMeta:trustedMeta,mode:'live',elapsed:45});
  assert.equal(quality.state,'verified');
  assert.equal(quality.displayCount,2);
  assert.equal(quality.analyticalCount,2);
  assert.equal(quality.confidenceBearing,true);
  assert.deepEqual(eventsForTrustedAnalytics(rows,quality).map(x=>x.id),['a','b']);
});

test('RC141 deduplicates exact provider repeats before analytics', () => {
  const rows=[ev('a',12,'home'),ev('b',12,'home')];
  const quality=assessMatchEventQuality(rows,{eventsMeta:trustedMeta,mode:'live',elapsed:20});
  assert.equal(quality.state,'sanitized');
  assert.equal(quality.duplicateCount,1);
  assert.equal(sanitizeEventsForDisplay(rows,quality).length,1);
  assert.equal(eventsForTrustedAnalytics(rows,quality).length,1);
});

test('RC141 rejects future/invalid minutes and excludes unknown sides from analytics', () => {
  assert.equal(inspectMatchEvent(ev('future',80,'home'),{mode:'live',elapsed:55}).future,true);
  const rows=[ev('future',80,'home'),ev('unknown',50,'','Card','Red Card'),ev('good',51,'away')];
  const quality=assessMatchEventQuality(rows,{eventsMeta:trustedMeta,mode:'live',elapsed:55});
  assert.equal(quality.state,'sanitized');
  assert.equal(quality.futureEventCount,1);
  assert.equal(quality.unknownSideCount,1);
  assert.deepEqual(sanitizeEventsForDisplay(rows,quality).map(x=>x.id),['unknown','good']);
  assert.deepEqual(eventsForTrustedAnalytics(rows,quality).map(x=>x.id),['good']);
});

test('RC141 fails closed when freshness/provenance is not trusted', () => {
  const rows=[ev('a',12,'home')];
  const quality=assessMatchEventQuality(rows,{eventsMeta:{...trustedMeta,stale:true,confidenceBearing:false,freshnessState:'stale'},mode:'live',elapsed:20});
  assert.equal(quality.state,'source_untrusted');
  assert.equal(quality.confidenceBearing,false);
  assert.equal(sanitizeEventsForDisplay(rows,quality).length,0);
  assert.equal(eventsForTrustedAnalytics(rows,quality).length,0);
  const meta=annotateEventReliability({...trustedMeta,stale:true,confidenceBearing:false,freshnessState:'stale'},quality);
  assert.equal(meta.available,false);
  assert.equal(meta.confidenceBearing,false);
});


const worker = fs.readFileSync('src/worker.js', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');

test('RC141 routes sanitized events into live and post-match analytics', () => {
  assert.match(worker, /assessMatchEventQuality\(rawFormattedEvents/);
  assert.match(worker, /sanitizeEventsForDisplay\(rawFormattedEvents, eventQuality\)/);
  assert.match(worker, /eventsForTrustedAnalytics\(rawFormattedEvents, eventQuality\)/);
  assert.match(worker, /buildPostMatchReview\(\{prediction:postMatchPrediction,fixture,statistics:analyticalStatistics,events:analyticalEvents/);
  assert.match(worker, /buildSmartMatchInsights\(\{[\s\S]{0,320}events: analyticalEvents/);
  assert.match(worker, /buildLiveAiCoach\(\{[\s\S]{0,320}events: analyticalEvents/);
  assert.match(worker, /eventQuality,/);
  assert.match(worker, /eventSemanticQualityGuard: 'enabled'/);
});

test('RC141 exposes event quality in Match Center UI and rolls the cache contract', () => {
  assert.match(worker, /match-center:\$\{fixtureId\}:v14-statistics-quality-rc142/);
  assert.match(app, /function eventQualityHintHtml/);
  assert.match(app, /eventQualityHintHtml\(d\.eventQuality\)/);
});
