import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  homeMatchSections,
  selectHomePersonalMatch,
} from '../public/modules/home-match-priority.js';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync(
  'public/styles/public-shell.css',
  'utf8',
);

test('Home priority keeps LIVE, soon, later and finished sections in product order',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const later={
    fixtureId:1,
    live:false,
    finished:false,
    date:new Date(now+5*60*60*1000).toISOString(),
  };
  const live={
    fixtureId:2,
    live:true,
    finished:false,
    date:new Date(now-30*60*1000).toISOString(),
  };
  const finished={
    fixtureId:3,
    live:false,
    finished:true,
    date:new Date(now-2*60*60*1000).toISOString(),
  };
  const soonA={
    fixtureId:4,
    live:false,
    finished:false,
    date:new Date(now+90*60*1000).toISOString(),
  };
  const soonB={
    fixtureId:5,
    live:false,
    finished:false,
    date:new Date(now+3*60*60*1000).toISOString(),
  };

  const sections=homeMatchSections(
    [later,live,finished,soonA,soonB],
    now,
  );

  assert.deepEqual(
    sections.map(section=>section.key),
    ['live','soon','later','finished'],
  );
  assert.deepEqual(
    sections.map(section=>section.label),
    ['Сейчас идут','Скоро начнутся','Позже','Завершённые'],
  );
  assert.deepEqual(
    sections[0].matches.map(match=>match.fixtureId),
    [2],
  );
  assert.deepEqual(
    sections[1].matches.map(match=>match.fixtureId),
    [4,5],
  );
  assert.deepEqual(
    sections[2].matches.map(match=>match.fixtureId),
    [1],
  );
  assert.deepEqual(
    sections[3].matches.map(match=>match.fixtureId),
    [3],
  );
  assert.equal(sections[2].matches[0],later);
});

test('Home priority fails closed on malformed identities, statuses and kickoff evidence',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const hostile={};
  Object.defineProperty(hostile,'fixtureId',{
    enumerable:true,
    get(){throw new Error('hostile fixture getter');},
  });

  assert.doesNotThrow(
    ()=>homeMatchSections([
      null,
      hostile,
      {
        fixtureId:true,
        live:false,
        finished:false,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:7,
        live:'true',
        finished:false,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:8,
        live:true,
        finished:true,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:9,
        live:false,
        finished:false,
        date:'2026-09-29T19:00:00',
      },
      {
        fixtureId:10,
        live:false,
        finished:false,
        date:'2026-09-29T17:00:00Z',
      },
      {
        fixtureId:11,
        live:false,
        finished:false,
        date:'2026-02-31T19:00:00Z',
      },
    ],now),
  );

  assert.deepEqual(
    homeMatchSections([
      null,
      hostile,
      {
        fixtureId:true,
        live:false,
        finished:false,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:7,
        live:'true',
        finished:false,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:8,
        live:true,
        finished:true,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:9,
        live:false,
        finished:false,
        date:'2026-09-29T19:00:00',
      },
      {
        fixtureId:10,
        live:false,
        finished:false,
        date:'2026-09-29T17:00:00Z',
      },
      {
        fixtureId:11,
        live:false,
        finished:false,
        date:'2026-02-31T19:00:00Z',
      },
    ],now),
    [],
  );

  assert.deepEqual(homeMatchSections({length:1},now),[]);
});

test('invalid clock cannot promote scheduled matches into the urgent section',()=>{
  const scheduled={
    fixtureId:1,
    live:false,
    finished:false,
    date:'2026-09-29T19:00:00Z',
  };
  const live={
    fixtureId:2,
    live:true,
    finished:false,
    date:'bad',
  };
  const finished={
    fixtureId:3,
    live:false,
    finished:true,
    date:'bad',
  };

  const sections=homeMatchSections(
    [scheduled,live,finished],
    Number.NaN,
  );
  assert.deepEqual(
    sections.map(section=>section.key),
    ['live','finished'],
  );
});

test('Home personal relevance requires genuine favorite or viewed-team evidence',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const matches=[
    {
      fixtureId:1,
      live:false,
      finished:false,
      date:'2026-09-29T20:00:00Z',
      kind:'league-only',
    },
    {
      fixtureId:2,
      live:false,
      finished:false,
      date:'2026-09-29T21:00:00Z',
      kind:'favorite',
    },
  ];

  const selected=selectHomePersonalMatch({
    matches,
    signals:{hasPersonalData:true},
    nowMs:now,
    insightForMatch:match=>
      match.kind==='favorite'
        ? {
            score:20,
            favorite:true,
            viewedTeam:false,
            viewedLeague:false,
          }
        : {
            score:999,
            favorite:false,
            viewedTeam:false,
            viewedLeague:true,
          },
  });

  assert.equal(selected.match.fixtureId,2);
  assert.equal(selected.insight.favorite,true);

  assert.equal(
    selectHomePersonalMatch({
      matches,
      signals:{hasPersonalData:false},
      nowMs:now,
      insightForMatch:()=>({
        score:999,
        favorite:true,
        viewedTeam:false,
      }),
    }),
    null,
  );
});

test('Home personal relevance prioritizes LIVE then nearest kickoff over score',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const matches=[
    {
      fixtureId:1,
      live:false,
      finished:false,
      date:'2026-09-29T19:00:00Z',
      kind:'numeric',
    },
    {
      fixtureId:2,
      live:false,
      finished:false,
      date:'2026-09-29T18:30:00Z',
      kind:'coercive',
    },
    {
      fixtureId:3,
      live:true,
      finished:false,
      date:'2026-09-29T17:00:00Z',
      kind:'live',
    },
  ];

  const insightForMatch=match=>{
    if (match.kind==='live') {
      return {score:1,favorite:false,viewedTeam:true};
    }
    if (match.kind==='coercive') {
      return {score:'999',favorite:true,viewedTeam:false};
    }
    return {score:10,favorite:true,viewedTeam:false};
  };

  const liveSelected=selectHomePersonalMatch({
    matches,
    signals:{hasPersonalData:true},
    insightForMatch,
    nowMs:now,
  });
  assert.equal(liveSelected.match.fixtureId,3);

  const nonLiveSelected=selectHomePersonalMatch({
    matches:matches.slice(0,2),
    signals:{hasPersonalData:true},
    insightForMatch,
    nowMs:now,
  });
  assert.equal(nonLiveSelected.match.fixtureId,2);
});

test('Home personal relevance rejects stale, timezone-less and malformed match state',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const hostile={fixtureId:7};
  Object.defineProperty(hostile,'live',{
    get(){throw new Error('hostile live getter');},
  });
  const rows=[
    hostile,
    {
      fixtureId:1,
      live:false,
      finished:false,
      date:'2026-09-29T17:00:00Z',
    },
    {
      fixtureId:2,
      live:false,
      finished:false,
      date:'2026-09-29T20:00:00',
    },
    {
      fixtureId:3,
      live:'false',
      finished:false,
      date:'2026-09-29T20:00:00Z',
    },
    {
      fixtureId:4,
      live:false,
      finished:false,
      youthReserve:true,
      date:'2026-09-29T20:00:00Z',
    },
  ];

  assert.doesNotThrow(
    ()=>selectHomePersonalMatch({
      matches:rows,
      signals:{hasPersonalData:true},
      insightForMatch:()=>({
        score:10,
        favorite:true,
        viewedTeam:false,
      }),
      nowMs:now,
    }),
  );
  assert.equal(
    selectHomePersonalMatch({
      matches:rows,
      signals:{hasPersonalData:true},
      insightForMatch:()=>({
        score:10,
        favorite:true,
        viewedTeam:false,
      }),
      nowMs:now,
    }),
    null,
  );
});

test('hostile personal insight getters are sanitized before selection output',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const hostileInsight={};
  Object.defineProperty(hostileInsight,'score',{
    enumerable:true,
    get(){throw new Error('hostile score getter');},
  });
  Object.defineProperty(hostileInsight,'favorite',{
    enumerable:true,
    get(){throw new Error('hostile favorite getter');},
  });
  Object.defineProperty(hostileInsight,'viewedTeam',{
    enumerable:true,
    get(){throw new Error('hostile viewedTeam getter');},
  });

  const selected=selectHomePersonalMatch({
    matches:[{
      fixtureId:1,
      live:false,
      finished:false,
      date:'2026-09-29T19:00:00Z',
    }],
    signals:{hasPersonalData:true},
    insightForMatch:()=>hostileInsight,
    nowMs:now,
  });

  assert.equal(selected,null);
});

test('personal insight failures are isolated and a later valid candidate can win',()=>{
  const now=Date.UTC(2026,8,29,18,0,0);
  const result=selectHomePersonalMatch({
    matches:[
      {
        fixtureId:1,
        live:false,
        finished:false,
        date:'2026-09-29T19:00:00Z',
      },
      {
        fixtureId:2,
        live:false,
        finished:false,
        date:'2026-09-29T20:00:00Z',
      },
    ],
    signals:{hasPersonalData:true},
    insightForMatch:match=>{
      if (match.fixtureId===1) {
        throw new Error('personal signal unavailable');
      }
      return {
        score:5,
        favorite:false,
        viewedTeam:true,
      };
    },
    nowMs:now,
  });

  assert.equal(result.match.fixtureId,2);
});

test('app delegates grouping and personal selection to extracted policy module',()=>{
  assert.match(
    app,
    /homeMatchSections as buildHomeMatchSections, selectHomePersonalMatch/,
  );
  assert.match(
    app,
    /function homeMatchSections\(list, nowMs = Date\.now\(\)\) \{[\s\S]*?buildHomeMatchSections\(list,nowMs\)/,
  );
  assert.match(
    app,
    /function homePersonalMatch\(signals = personalContextSignals\(\), nowMs = Date\.now\(\)\) \{[\s\S]*?selectHomePersonalMatch\(\{/,
  );
  assert.doesNotMatch(
    app,
    /const soonWindowMs = 3 \* 60 \* 60 \* 1000/,
  );
});

test('Home rendering preserves cards, existing actions and progressive disclosure',()=>{
  const start=app.indexOf('function homeMatchSectionsHtml');
  const end=app.indexOf(
    'function currentTournamentMatches',
    start,
  );
  const home=app.slice(start,end);

  assert.match(home,/data-home-match-section/);
  assert.match(
    home,
    /section\.matches\.map\(match => matchCardHtml\(match\)\)/,
  );
  assert.match(
    home,
    /\$\('matches'\)\.innerHTML = homeMatchSectionsHtml\(list\)/,
  );
  assert.match(home,/bindMatchActions\(\$\('matches'\)\)/);
  assert.match(
    home,
    /section\.key === 'later' \|\| section\.key === 'finished'/,
  );
  assert.match(home,/<details class="home-match-section/);
  assert.match(home,/<summary class="home-match-section-head">/);
  assert.match(home,/<section class="home-match-section/);

  assert.match(app,/homePersonalMatchBtn/);
  assert.match(app,/dataset\.personalFixture/);
  const personalAction=app.slice(app.indexOf("$('homePersonalMatchBtn')?.addEventListener"),app.indexOf("document.querySelectorAll('[data-theme-choice]')"));
  assert.match(personalAction,/openMatchCenter\(fixtureId, button\)/);
  assert.doesNotMatch(personalAction,/analyzeMatch|openHistoryAnalysis/);
});

test('Home priority styling remains compact, collapsible and mobile-safe',()=>{
  assert.match(
    css,
    /MatchRadar Home Content Priority — LIVE \/ soon \/ later/,
  );
  assert.match(
    css,
    /\.home-match-section-list\{[\s\S]*?display:grid;[\s\S]*?gap:10px/,
  );
  assert.match(
    css,
    /\.home-match-section--live \.home-match-section-head > strong\{[\s\S]*?var\(--brand-live\)/,
  );
  assert.match(
    css,
    /@media\(max-width:360px\)\{[\s\S]*?\.home-match-section-list\{[\s\S]*?gap:8px/,
  );
  assert.match(
    css,
    /MatchRadar Home Progressive Disclosure — keep first screen focused/,
  );
  assert.match(
    css,
    /MatchRadar Home Personal Relevance — one useful personal match, not a feed/,
  );
  assert.match(
    css,
    /\.home-priority-card\.home-personal-match\{[\s\S]*?background:color-mix/,
  );
  assert.match(
    css,
    /\.home-match-section\.is-collapsible > summary\{[\s\S]*?min-height:46px/,
  );
  assert.match(
    css,
    /\.home-match-section\.is-collapsible:not\(\[open\]\) > \.home-match-section-list\{[\s\S]*?display:none/,
  );
});

 test('favorite card chooses nearest favorite over higher scores and viewed teams',()=>{
  const result=selectHomePersonalMatch({
    signals:{hasPersonalData:true},nowMs:Date.parse('2026-10-10T10:00:00Z'),
    matches:[
      {fixtureId:1,date:'2026-10-10T11:00:00Z'},
      {fixtureId:2,date:'2026-10-10T12:00:00Z'},
      {fixtureId:3,date:'2026-10-10T10:30:00Z'},
    ],
    insightForMatch:m=>({favorite:m.fixtureId!==3,viewedTeam:true,score:m.fixtureId*100}),
  });
  assert.equal(result.match.fixtureId,1);
 });
