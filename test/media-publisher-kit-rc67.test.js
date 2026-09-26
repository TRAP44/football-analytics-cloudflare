import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8')+'\n'+fs.readFileSync('src/router.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC67 adds an admin-only publisher endpoint',()=>{
  assert.match(worker,/async function apiMediaPublisherLink\(/);
  assert.match(worker,/if \(!isAdminUser\(user,cfg\)\) return adminForbidden\(\)/);
  assert.match(worker,/url\.pathname === '\/api\/media-publisher-link'/);
});

test('publisher creates tagged fixture links and copy',()=>{
  assert.match(worker,/fixtureShareStartParam/);
  assert.match(worker,/function mediaPublisherCopy\(/);
  assert.match(worker,/media_link_created/);
  assert.match(worker,/telegramShareComposerUrl/);
});

test('admin launch panel exposes publisher controls',()=>{
  assert.match(html,/id="mediaPublisherFixtureId"/);
  assert.match(html,/id="mediaPublisherGenerateBtn"/);
  assert.match(html,/id="mediaPublisherResult"/);
  assert.match(app,/async function generateMediaPublisherLink\(/);
  assert.match(app,/copyMediaPublisherPost/);
  assert.match(css,/\.media-publisher-kit/);
});

test('publisher does not require a provider request for known metadata',()=>{
  const fn=worker.slice(worker.indexOf('async function apiMediaPublisherLink'),worker.indexOf('function mediaPublisherDrill'));
  assert.match(fn,/getCache/);
  assert.doesNotMatch(fn,/apiFootball\(/);
});

test('RC67 deterministic drill and health contract are present',()=>{
  assert.match(worker,/function mediaPublisherDrill\(/);
  assert.match(worker,/mediaPublisherSelfTest: mediaPublisherDrill\(\)\.pass \? 'enabled' : 'failed'/);
  for (const flag of ['mediaPublisherKit','campaignTaggedFixtureLinks','mediaCopyGenerator','adminPublisherOnly']) assert.ok(worker.includes(flag + ": 'enabled'"));
});