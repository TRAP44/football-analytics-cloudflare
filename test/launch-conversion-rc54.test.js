import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const readme=fs.readFileSync('README_CLOUDFLARE_RU.md','utf8');

test('RC54 shortens first-session path and prioritizes search',()=> {
  assert.ok(worker.includes('Напишите клуб прямо в чат'));
  assert.ok(worker.includes("[{ text: '🔎 Найти матч' }, { text: '⚽ Матчи сегодня' }]"));
  assert.ok(worker.includes('Можно по-русски: «Реал»'));
  assert.ok(!worker.includes("'<b>Как начать:</b>'"));
});
test('top-club discovery survives low quota better and covers more regions',()=> {
  for (const club of ['Flamengo','River Plate','Boca Juniors','Zenit','Olympiakos Piraeus','Red Bull Salzburg']) assert.ok(worker.includes(`canonical:'${club}'`));
  assert.ok(worker.includes('const highIntentTeam = Number(teamPlan.best?.score || 0) >= 170'));
  assert.ok(worker.includes('highIntentTeam && freeQuotaHealthy(2, 1)'));
  assert.ok(worker.includes('highIntent && freeQuotaHealthy(2,1)'));
  assert.ok(worker.includes('cfg, 1440'));
  assert.ok(app.includes("if (query.length < 2 || !runtimeAllows('searchEnabled'))"));
});
test('recognized clubs do not collapse into a false empty state',()=> {
  assert.ok(worker.includes('function knownTopTeamFallbacks'));
  assert.ok(worker.includes('knownTeams'));
  assert.ok(app.includes('knownTeams: []'));
  assert.ok(app.includes('КЛУБ РАСПОЗНАН'));
  assert.ok(app.includes('data.knownTeams || []'));
});
test('news return loop is separately measurable',()=> {
  assert.ok(worker.includes("callback_data:`news:match:${Number(fixture.fixtureId)}`"));
  assert.ok(worker.includes("eventName:'news_return'"));
  assert.ok(worker.includes("origin:'team_news'"));
  assert.ok(worker.includes('returnLoop:{newsOpen:newsOpen.size,newsReturn:newsReturn.size'));
});
test('launch funnel pages through media traffic and exposes bottleneck',()=> {
  assert.ok(worker.includes("supaSelectPaged(cfg,'growth_events'"));
  assert.ok(worker.includes('pageSize:1000,maxRows:10000'));
  assert.ok(worker.includes('const bottleneck=[...transitions]'));
  assert.ok(app.includes('Узкое место:'));
  assert.ok(app.includes('Возврат из новостей'));
});
test('RC54 release contract is documented and health-visible',()=> {
  for (const flag of ['launchSimulation','conversionUx','highIntentSearchFallback','newsReturnLoop']) assert.ok(worker.includes(`${flag}: 'enabled'`));
  assert.ok(readme.includes('RC54: Launch Simulation & Conversion UX'));
  assert.ok(simulation.includes('media deep-link → /start → поиск клуба → матч → быстрый AI → полный AI → новости → возврат'));
});
