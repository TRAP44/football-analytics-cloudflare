import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const router=fs.readFileSync('src/router.js','utf8');
const publisher=fs.readFileSync('src/publisher-runtime.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const mediaPublisher=fs.readFileSync('public/modules/admin-media-publisher.js','utf8');
const html=fs.readFileSync('public/admin.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

function sourceSection(source,start,end) {
  const from=source.indexOf(start);
  assert.notEqual(from,-1,`missing section start: ${start}`);
  const to=source.indexOf(end,from+start.length);
  assert.notEqual(to,-1,`missing section end: ${end}`);
  assert.ok(to>from,`invalid section order: ${start} -> ${end}`);
  return source.slice(from,to);
}

test('RC67 keeps the publisher endpoint admin-only',()=>{
  const fn=sourceSection(publisher,'async function apiMediaPublisherLink','function mediaPublisherDrill');
  assert.match(fn,/if \(!isAdminUser\(user,cfg\)\) return adminForbidden\(\)/);
  assert.match(router,/method === 'POST' && pathname === '\/api\/media-publisher-link'/);
  assert.match(router,/apiMediaPublisherLink\(request,cfg,user\)/);
  assert.match(worker,/function apiMediaPublisherLink\(\.\.\.args\).*getPublisherRuntime\(\)\.apiMediaPublisherLink/s);
});

test('publisher creates tagged fixture links and publication copy',()=>{
  const fn=sourceSection(publisher,'async function apiMediaPublisherLink','function mediaPublisherDrill');
  assert.match(fn,/fixtureTelegramDeepLink\(cfg,fixtureId,\{source,campaign,content\}\)/);
  assert.match(publisher,/function mediaPublisherCopy\(/);
  assert.match(fn,/eventName:'media_link_created'/);
  assert.match(fn,/telegramShareUrl:telegramShareComposerUrl\(link\.url,copy\.title\)/);
  assert.match(fn,/attribution:\{source,campaign,content,startParam:link\.startParam\}/);
});

test('admin launch panel exposes publisher controls',()=>{
  assert.match(html,/id="mediaPublisherFixtureId"/);
  assert.match(html,/id="mediaPublisherGenerateBtn"/);
  assert.match(html,/id="mediaPublisherResult"/);
  assert.match(mediaPublisher,/async function generateMediaPublisherLink\(/);
  assert.match(mediaPublisher,/async function copyMediaPublisherPost\(/);
  assert.match(mediaPublisher,/\/api\/media-publisher-link/);
  assert.match(app,/import\('\.\/modules\/admin-media-publisher\.js'\)/);
  assert.match(css,/\.media-publisher-kit/);
});

test('publisher does not require a provider request for known metadata',()=>{
  const fn=sourceSection(publisher,'async function apiMediaPublisherLink','function mediaPublisherDrill');
  assert.match(fn,/getCache/);
  assert.doesNotMatch(fn,/apiFootball\(/);
});

test('RC67 deterministic drill remains wired through the modular publisher runtime',()=>{
  const drill=sourceSection(publisher,'function mediaPublisherDrill','return Object.freeze');
  assert.match(drill,/fixtureShareStartParam/);
  assert.match(drill,/campaignStartParam/);
  assert.match(drill,/pass:/);
  assert.match(drill,/cases:8/);
  assert.match(worker,/function mediaPublisherDrill\(\.\.\.args\).*getPublisherRuntime\(\)\.mediaPublisherDrill/s);
  assert.match(worker,/createPublisherRuntime/);
});
