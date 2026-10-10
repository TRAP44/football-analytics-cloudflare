import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');

function block(source,start,end){
  const a=source.indexOf(start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,start);
  assert.ok(b>a,end);
  return source.slice(a,b);
}

function fakeElement(id, dataset = {}) {
  const attrs=new Map();
  const classes=new Set();
  return {
    id, dataset, hidden:false, tabIndex:0,
    classList:{ toggle:(name,on)=>{ if(on) classes.add(name); else classes.delete(name); }, contains:name=>classes.has(name) },
    setAttribute:(name,value)=>attrs.set(name,String(value)),
    getAttribute:name=>attrs.get(name),
    toggleAttribute:(name,on)=>{ if(on) attrs.set(name,''); else attrs.delete(name); },
  };
}

// Исполняет настоящую функцию переключения на имитации DOM, где $ ищет по текущему id.
function harness(fnSource, fnName, buttonClass, dataKey, panelIds, extraNames = []) {
  const buttons=Object.keys(panelIds).map(key=>fakeElement('',{[dataKey]:key}));
  const panels=Object.values(panelIds).map(id=>fakeElement(id));
  const byId=id=>panels.find(panel=>panel.id===id) || null;
  const document={ querySelectorAll:selector=>selector===`.${buttonClass}` ? buttons : [] };
  const noop=()=>{};
  const args=['document','$',...extraNames];
  const fn=new Function(...args,`${fnSource}\nreturn ${fnName};`)(document,byId,...extraNames.map(()=>noop));
  return { fn, buttons, panels, byId };
}

test('tournament tabs keep switching panels after the first switch',()=>{
  const source=block(app,'function setTournamentTab','\n\nfunction teamResultBadge');
  const { fn, panels }=harness(source,'setTournamentTab','tournament-tab','tournamentTab',
    { matches:'tournamentMatchesPanel', table:'tournamentTablePanel' },['loadTournamentStandings']);
  fn('matches',false);
  fn('table',false);
  const [matches,table]=panels;
  assert.equal(matches.hidden,true);
  assert.equal(table.hidden,false);
  assert.equal(table.classList.contains('active'),true);
  fn('matches',false);
  assert.equal(matches.hidden,false);
  assert.equal(table.hidden,true);
  // id панелей постоянные: на них опирается восстановление сети.
  assert.deepEqual(panels.map(panel=>panel.id),['tournamentMatchesPanel','tournamentTablePanel']);
});

test('team tabs keep switching panels and aria-controls points at real panels',()=>{
  const source=block(app,'const teamPanels = [','\nfunction openTournamentFromTeam');
  const ids={ overview:'teamOverviewPanel', intelligence:'teamIntelligencePanel', squad:'teamSquadPanel', results:'teamResultsPanel', schedule:'teamSchedulePanel' };
  const { fn, buttons, panels, byId }=harness(source,'setTeamTab','team-tab','teamTab',ids,['loadTeamIntelligence','loadTeamSquad']);
  for (const tab of ['overview','results','schedule','overview']) {
    fn(tab);
    for (const panel of panels) assert.equal(panel.hidden,panel.id!==ids[tab],`${tab}: ${panel.id}`);
  }
  for (const btn of buttons) assert.ok(byId(btn.getAttribute('aria-controls')),btn.dataset.teamTab);
});

test('network recovery still finds the tournament table panel by its id',()=>{
  assert.match(app,/\$\('tournamentTablePanel'\)\?\.classList\.contains\('active'\)/);
  assert.doesNotMatch(block(app,'function setTournamentTab','\n\nfunction teamResultBadge'),/panel\.id =/);
  assert.doesNotMatch(block(app,'const teamPanels = [','\nfunction openTournamentFromTeam'),/panel\.id =/);
});

test('match center team cards open the team with a team object, not a bare id',()=>{
  const view=fs.readFileSync('public/modules/match-center-view.js','utf8');
  const bind=block(view,"root.querySelectorAll('[data-center-team]')",'}));');
  assert.doesNotMatch(bind,/openTeam\(teamId/);
  assert.match(bind,/openTeam\(\{ id: teamId, name:/);
  assert.match(bind,/\[m\.home, m\.away\]\.find/);
});

test('standings show points right after games played so they fit on a phone',()=>{
  const render=block(app,'function renderTournamentStandings','\nasync function loadTournamentStandings');
  const head=render.match(/<thead>[\s\S]*?<\/thead>/)[0];
  const cols=[...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m=>m[1]);
  assert.deepEqual(cols.slice(0,5),['#','Команда','И','О','+/-']);
  const row=render.slice(render.indexOf('<td>${Number(row.played)}</td>'));
  assert.ok(row.indexOf('row.points')<row.indexOf('row.goalsDiff'));
  assert.ok(row.indexOf('row.goalsDiff')<row.indexOf('row.goalsFor'));
});

test('team form uses neutral wording and badges instead of betting shorthand',()=>{
  const hub=block(app,'function renderTeamHub','\nasync function loadTeamHub');
  assert.doesNotMatch(hub,/<span>ОЗ<\/span>/);
  assert.match(hub,/<span>Забивали обе<\/span>/);
  assert.match(hub,/class="team-hero-form">\$\{form\?\.form \? String\(form\.form\)\.slice\(-5\)\.split\(''\)\.map\(teamResultBadge\)/);
});
