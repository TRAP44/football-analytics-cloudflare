import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');

function block(start,end){
  const a=app.indexOf(start);
  const b=app.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return app.slice(a,b);
}

// Исполняет настоящий radarFeedItems с подменёнными зависимостями.
function radarFeed({ personalFixtureId }) {
  const source=block('function radarFeedItems','\nfunction renderRadarFeed');
  const matches=[
    { fixtureId:1, live:true, home:{id:42,name:'Арсенал'}, away:{id:49,name:'Челси'}, league:'АПЛ', elapsed:67, score:{home:1,away:1} },
    { fixtureId:2, live:true, home:{id:157,name:'Бавария'}, away:{id:165,name:'Боруссия'}, league:'Бундеслига', elapsed:30, score:{home:0,away:0} },
  ];
  const deps={
    state:{ matches },
    favoriteSet:()=>new Set([42,157]),
    personalContextSignals:()=>({ viewedTeams:new Set() }),
    homePersonalMatch:()=>personalFixtureId ? { match:matches.find(m=>m.fixtureId===personalFixtureId) } : null,
    reminderFor:()=>null,
    analysisHistoryForFixture:()=>null,
    isWatchedMatch:()=>false,
    timeOf:()=>'20:00',
    dateTime:()=>'',
    normalizedSignalText:value=>String(value || '').toLowerCase(),
  };
  const names=Object.keys(deps);
  const fn=new Function(...names,`${source}\nreturn radarFeedItems;`)(...names.map(name=>deps[name]));
  return fn(Date.now());
}

test('radar feed skips the match already shown in the «Для вас» card',()=>{
  const all=radarFeed({ personalFixtureId:0 }).map(row=>row.fixtureId);
  assert.ok(all.includes(1) && all.includes(2));
  const deduped=radarFeed({ personalFixtureId:1 }).map(row=>row.fixtureId);
  assert.ok(!deduped.includes(1));
  assert.ok(deduped.includes(2));
});

test('search placeholder fits the field on a phone',()=>{
  assert.match(html,/id="matchSearch"[^>]*placeholder="Команда или турнир"/);
});
