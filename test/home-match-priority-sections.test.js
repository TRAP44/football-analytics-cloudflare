import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles/public-shell.css','utf8');

function extractedHomeMatchSections(){
  const start=app.indexOf('function homeMatchSections(');
  const end=app.indexOf('function homeMatchSectionsHtml',start);
  assert.ok(start>=0 && end>start,'homeMatchSections source missing');
  const source=app.slice(start,end);
  return Function(`${source}; return homeMatchSections;`)();
}

test('Home priority keeps LIVE first then soon later and finished',()=>{
  const group=extractedHomeMatchSections();
  const now=Date.UTC(2026,8,29,18,0,0);
  const rows=[
    {fixtureId:1,live:false,finished:false,date:new Date(now+5*60*60*1000).toISOString()},
    {fixtureId:2,live:true,finished:false,date:new Date(now-30*60*1000).toISOString()},
    {fixtureId:3,live:false,finished:true,date:new Date(now-2*60*60*1000).toISOString()},
    {fixtureId:4,live:false,finished:false,date:new Date(now+90*60*1000).toISOString()},
    {fixtureId:5,live:false,finished:false,date:new Date(now+3*60*60*1000).toISOString()},
  ];
  const sections=group(rows,now);
  assert.deepEqual(sections.map(section=>section.key),['live','soon','later','finished']);
  assert.deepEqual(sections[0].matches.map(match=>match.fixtureId),[2]);
  assert.deepEqual(sections[1].matches.map(match=>match.fixtureId),[4,5]);
  assert.deepEqual(sections[2].matches.map(match=>match.fixtureId),[1]);
  assert.deepEqual(sections[3].matches.map(match=>match.fixtureId),[3]);
});

test('Home priority omits empty sections and does not mutate match semantics',()=>{
  const group=extractedHomeMatchSections();
  const now=Date.UTC(2026,8,29,18,0,0);
  const upcoming={fixtureId:9,live:false,finished:false,date:new Date(now+30*60*1000).toISOString()};
  const sections=group([upcoming],now);
  assert.deepEqual(sections.map(section=>section.key),['soon']);
  assert.equal(sections[0].matches[0],upcoming);
});

test('Home rendering uses priority sections without changing card actions',()=>{
  const start=app.indexOf('function homeMatchSectionsHtml');
  const end=app.indexOf('function currentTournamentMatches',start);
  const home=app.slice(start,end);
  assert.match(home,/data-home-match-section/);
  assert.match(home,/section\.matches\.map\(match => matchCardHtml\(match\)\)/);
  assert.match(home,/\$\('matches'\)\.innerHTML = homeMatchSectionsHtml\(list\)/);
  assert.match(home,/bindMatchActions\(\$\('matches'\)\)/);
  for(const label of ['Сейчас идут','Скоро начнутся','Позже','Завершённые']) assert.ok(app.includes(label),label);
});

test('Home progressive disclosure keeps urgent sections open and lower-priority sections collapsed',()=>{
  const start=app.indexOf('function homeMatchSectionsHtml');
  const end=app.indexOf('function renderMatches',start);
  const home=app.slice(start,end);
  assert.match(home,/section\.key === 'later' \|\| section\.key === 'finished'/);
  assert.match(home,/<details class="home-match-section/);
  assert.match(home,/<summary class="home-match-section-head">/);
  assert.match(home,/<section class="home-match-section/);
  assert.doesNotMatch(home,/<details[^>]*data-home-match-section="live"/);
  assert.doesNotMatch(home,/<details[^>]*data-home-match-section="soon"/);
});

test('Home personal relevance selects only genuine favorite or viewed-team signals',()=>{
  const start=app.indexOf('function homePersonalMatch(');
  const end=app.indexOf('function homePersonalMatchMeta',start);
  const source=app.slice(start,end);
  assert.match(source,/if \(!signals\.hasPersonalData\) return null/);
  assert.match(source,/item\.insight\.favorite \|\| item\.insight\.viewedTeam/);
  assert.match(source,/if \(Boolean\(a\.match\.live\) !== Boolean\(b\.match\.live\)\) return a\.match\.live \? -1 : 1/);
  assert.doesNotMatch(source,/viewedLeague/);
  assert.doesNotMatch(source,/featured/);
});

test('Home renders one personal match card and routes it to existing match actions',()=>{
  assert.match(app,/homePersonalMatchBtn/);
  assert.match(app,/homePersonalMatchKicker/);
  assert.match(app,/homePersonalMatchText/);
  assert.match(app,/homePersonalMatchMeta/);
  assert.match(app,/dataset\.personalFixture/);
  assert.match(app,/if \(match\.live\) openMatchCenter\(fixtureId, button\)/);
  assert.match(app,/if \(saved\) openHistoryAnalysis\(fixtureId, button\)/);
  assert.match(app,/else analyzeMatch\(fixtureId, button\)/);
});

test('Home priority section styling is compact and mobile-safe',()=>{
  assert.match(css,/MatchRadar Home Content Priority — LIVE \/ soon \/ later/);
  assert.match(css,/\.home-match-section-list\{[\s\S]*?display:grid;[\s\S]*?gap:10px/);
  assert.match(css,/\.home-match-section--live \.home-match-section-head > strong\{[\s\S]*?var\(--brand-live\)/);
  assert.match(css,/@media\(max-width:360px\)\{[\s\S]*?\.home-match-section-list\{[\s\S]*?gap:8px/);
  assert.match(css,/MatchRadar Home Progressive Disclosure — keep first screen focused/);
  assert.match(css,/MatchRadar Home Personal Relevance — one useful personal match, not a feed/);
  assert.match(css,/\.home-priority-card\.home-personal-match\{[\s\S]*?background:color-mix/);
  assert.match(css,/\.home-match-section\.is-collapsible > summary\{[\s\S]*?min-height:46px/);
  assert.match(css,/\.home-match-section\.is-collapsible:not\(\[open\]\) > \.home-match-section-list\{[\s\S]*?display:none/);
});
