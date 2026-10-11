import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EXPLANATION_ANALYSIS_CACHE_KEY,
  EXPLANATION_MODEL,
  buildExplanationFacts,
  composeExplanation,
  createMatchExplanationRuntime,
  defaultExplanationOrder,
  explanationCatalogHash,
  explanationPrompt,
  parseExplanationSelection,
} from '../src/match-explanation-runtime.js';

// Задача 5: «невозможно выдумать» — тексты и роли только с сервера, LLM лишь выбирает порядок ID.

const CONNECTORS = { lead: 'Главное:', support: 'Это подкрепляет:', risk: 'Риск:', caveat: 'Важно учитывать:' };

function form(wins, draws, losses) {
  return { overall: { sample: wins + draws + losses, wins, draws, losses } };
}

function payload(overrides = {}) {
  return {
    analysisVersion: '4.17.0-starting-xi',
    match: { fixtureId: 77, status: 'NS', home: { name: 'Милан' }, away: { name: 'Рома' } },
    probabilities: { home: 54, draw: 25, away: 21 },
    confidence: { score: 72 },
    completeness: { score: 8, max: 10 },
    recentForm: { home: form(4, 1, 0), away: form(1, 1, 3) },
    h2h: { homeWins: 4, draws: 1, awayWins: 1 },
    absences: { home: [], away: [{}, {}, {}] },
    lineupQuality: { bothConfirmed: false },
    goalModel: { over25: 62 },
    ...overrides,
  };
}

test('fact catalog: canonical server texts and roles from validated data only', () => {
  const facts = buildExplanationFacts(payload());
  const byId = Object.fromEntries(facts.map(f => [f.id, f]));
  assert.equal(byId.model_lead.role, 'lead');
  assert.equal(byId.model_lead.text, 'По оценке модели фаворит — Милан: победа с вероятностью 54%.');
  assert.equal(byId.form_home.role, 'support');
  assert.equal(byId.form_home.text, 'Милан: 4 победы в 5 последних матчах (2,6 очка за игру).');
  assert.equal(byId.form_away.role, 'support', 'weak form of the opponent supports the leader');
  assert.equal(byId.h2h.role, 'support');
  assert.equal(byId.h2h.text, 'Очные встречи: Милан — 4 победы, Рома — 1, ничьих — 1.');
  assert.equal(byId.absences_away.role, 'support');
  assert.equal(byId.absences_away.text, 'Рома: 3 игрока вне заявки или под вопросом по данным источника.');
  assert.equal(byId.confidence_high.role, 'support');
  assert.equal(byId.lineups_pending.role, 'caveat');
  assert.equal(byId.goals_high.text, 'Модель ждёт результативную игру: 3+ гола — 62%.');
  for (const fact of facts) {
    assert.doesNotMatch(fact.text, /[Рр]ын(ок|к|оч)|оэффициент|ставк|П1|П2|ТБ|1X2/);
  }
});

test('fact catalog: facts against the model leader become risks; balanced matches use caveats', () => {
  const against = buildExplanationFacts(payload({ recentForm: { home: form(0, 1, 4), away: form(4, 0, 1) }, absences: { home: [{}, {}, {}], away: [] }, h2h: null }));
  const byId = Object.fromEntries(against.map(f => [f.id, f]));
  assert.equal(byId.form_home.role, 'risk');
  assert.equal(byId.form_away.role, 'risk');
  assert.equal(byId.absences_home.role, 'risk');

  const balanced = buildExplanationFacts(payload({ probabilities: { home: 36, draw: 32, away: 32 }, confidence: { score: 45 } }));
  const lead = balanced.find(f => f.role === 'lead');
  assert.equal(lead.id, 'model_balance');
  assert.equal(lead.text, 'Явного фаворита нет: Милан — 36%, ничья — 32%, Рома — 32%.');
  assert.ok(balanced.filter(f => f.role !== 'lead').every(f => f.role === 'caveat'));
  assert.ok(balanced.some(f => f.id === 'confidence_low'));
  assert.ok(!balanced.some(f => f.id === 'confidence_high'));
});

test('fact catalog: no lead (and no explanation) without valid probabilities; hostile names are cleaned', () => {
  assert.deepEqual(buildExplanationFacts(payload({ probabilities: { home: 80, draw: 30, away: 20 } })), []);
  assert.deepEqual(buildExplanationFacts(payload({ probabilities: null })), []);
  const facts = buildExplanationFacts(payload({ match: { fixtureId: 77, home: { name: '<script>Milan' }, away: {} } }));
  assert.ok(facts.every(f => !/[<>]/.test(f.text)));
  assert.match(facts[0].text, /Milan/);
});

test('default order: lead first, up to 5 facts, no LLM needed', () => {
  const facts = buildExplanationFacts(payload());
  const ids = defaultExplanationOrder(facts);
  assert.equal(ids[0], 'model_lead');
  assert.ok(ids.length >= 3 && ids.length <= 5);
  assert.equal(new Set(ids).size, ids.length);
});

test('composed text contains only canonical fact texts with the connector of the fact role', () => {
  const facts = buildExplanationFacts(payload());
  const items = composeExplanation(facts, ['model_lead', 'absences_away', 'lineups_pending', 'nope']);
  assert.equal(items.length, 3);
  for (const item of items) {
    const fact = facts.find(f => f.id === item.id);
    assert.equal(item.text, fact.text);
    assert.equal(item.connector, CONNECTORS[fact.role]);
    assert.deepEqual(Object.keys(item).sort(), ['connector', 'id', 'role', 'text']);
  }
});

test('LLM response is accepted only as a clean list of known ids; anything else is rejected whole', () => {
  const facts = buildExplanationFacts(payload());
  const good = ['model_lead', 'form_home', 'absences_away'];
  assert.deepEqual(parseExplanationSelection({ response: JSON.stringify({ factIds: good }) }, facts), good);
  assert.deepEqual(parseExplanationSelection({ response: JSON.stringify(good) }, facts), good);
  assert.deepEqual(parseExplanationSelection({ response: '```json\n{"factIds":["model_lead","h2h","lineups_pending"]}\n```' }, facts), ['model_lead', 'h2h', 'lineups_pending']);
  assert.deepEqual(parseExplanationSelection({ response: { factIds: good } }, facts), good);

  const rejected = [
    'Милан выиграет, ставьте П1',
    'Here you go: {"factIds":["model_lead","form_home","h2h"]}',
    JSON.stringify({ factIds: [...good, 'model_lead'] }),
    JSON.stringify({ factIds: ['model_lead', 'form_home', 'made_up'] }),
    JSON.stringify({ factIds: good, text: 'Хозяева контролируют игру' }),
    JSON.stringify({ factIds: good, connector: 'Риск:' }),
    JSON.stringify({ factIds: good, roles: { form_home: 'risk' } }),
    JSON.stringify({ ids: good }),
    JSON.stringify(['model_lead', 'form_home']),
    JSON.stringify(['model_lead', 'form_home', 'h2h', 'absences_away', 'lineups_pending', 'goals_high']),
    JSON.stringify(['form_home', 'model_lead', 'h2h']),
    JSON.stringify([{ id: 'model_lead' }, 'form_home', 'h2h']),
    '',
    null,
  ];
  for (const response of rejected) {
    assert.equal(parseExplanationSelection({ response }, facts), null, String(response));
  }
  assert.equal(parseExplanationSelection(undefined, facts), null);
});

test('catalog hash changes when any fact changes and is stable otherwise', async () => {
  const base = await explanationCatalogHash(buildExplanationFacts(payload()));
  assert.equal(base, await explanationCatalogHash(buildExplanationFacts(payload())));
  const changes = [
    payload({ probabilities: { home: 55, draw: 25, away: 20 } }),
    payload({ lineupQuality: { bothConfirmed: true } }),
    payload({ absences: { home: [], away: [{}, {}, {}, {}] } }),
    payload({ recentForm: { home: form(3, 2, 0), away: form(1, 1, 3) } }),
    payload({ match: { fixtureId: 77, status: 'NS', home: { name: 'Интер' }, away: { name: 'Рома' } } }),
  ];
  for (const changed of changes) {
    assert.notEqual(await explanationCatalogHash(buildExplanationFacts(changed)), base);
  }
});

test('prompt carries only ids, roles and canonical texts and asks for ids only', () => {
  const facts = buildExplanationFacts(payload());
  const [system, user] = explanationPrompt(facts);
  assert.match(system.content, /JSON only/);
  assert.match(system.content, /"factIds"/);
  for (const fact of facts) assert.ok(user.content.includes(`${fact.id} (${fact.role}): ${fact.text}`));
});

function json(body, status = 200) {
  return { status, body };
}

function runtime({ history = [{ fixture_id: 77 }], analysis = payload(), cached = null, ai, rpc, controls, serviceUsedToday = 0 } = {}) {
  const calls = { ai: 0, rpc: [], setCache: [], historyOptions: null };
  const cache = new Map();
  if (analysis) cache.set(EXPLANATION_ANALYSIS_CACHE_KEY(77), analysis);
  const rt = createMatchExplanationRuntime({
    json,
    getCache: async key => (key.startsWith('explain:') ? cached : cache.get(key) || null),
    getStaleCache: async () => null,
    setCache: async (key, fixtureId, value) => { calls.setCache.push({ key, fixtureId, value }); },
    getHistory: async (_userId, _cfg, options) => {
      calls.historyOptions = options;
      if (history instanceof Error) throw history;
      return history;
    },
    hasSupabase: () => true,
    supaRpc: async (_cfg, name, params) => {
      calls.rpc.push({ name, params });
      return rpc ? rpc(params) : { allowed: true };
    },
    supaSelectMany: async (_cfg, table, filters) => {
      calls.selects = (calls.selects || []).concat([{ table, filters }]);
      return serviceUsedToday ? [{ bucket_key: 'ai-explain-global:h00', window_started_at: new Date(Math.floor(Date.now() / 86400000) * 86400000).toISOString(), request_count: serviceUsedToday }] : [];
    },
    loadRuntimeControls: async () => ({ value: controls || { analysisEnabled: true, maintenanceMode: false } }),
    recordOpsEvent: async () => {},
    bumpTelemetry: () => {},
    memory: {},
  });
  const cfg = {
    workersAi: ai === null ? null : {
      run: async (model, input) => {
        calls.ai += 1;
        calls.model = model;
        calls.input = input;
        return ai ? ai() : { response: '{"factIds":["model_lead","absences_away","form_home"]}' };
      },
    },
    aiExplanationEnabled: true,
    aiExplanationDailyLimit: 1000,
    aiExplanationUserHourlyLimit: 6,
  };
  const call = (fixtureId = 77, user = { id: 5 }) => rt.apiMatchExplanation(new Request(`https://x.test/api/match-explanation?fixtureId=${fixtureId}`), cfg, user);
  return { call, calls, cfg };
}

test('API: AI picks the order, server builds the text and caches the selection by catalog hash', async () => {
  const { call, calls } = runtime();
  const res = await call();
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'ai');
  assert.deepEqual(res.body.items.map(i => i.id), ['model_lead', 'absences_away', 'form_home']);
  assert.equal(res.body.items[1].connector, 'Это подкрепляет:');
  assert.equal(calls.model, EXPLANATION_MODEL);
  assert.deepEqual(calls.historyOptions, { strict: true });
  assert.equal(calls.rpc[0].params.p_bucket_key, 'ai-explain:user:5');
  assert.equal(calls.rpc[0].params.p_window_seconds, 3600, 'per-user limit is honestly hourly');
  assert.match(calls.rpc[1].params.p_bucket_key, /^ai-explain-global:h\d{2}$/);
  assert.equal(calls.rpc[1].params.p_window_seconds, 3600);
  assert.equal(calls.selects[0].table, 'provider_rate_windows');
  assert.equal(calls.selects[0].filters.bucket_key, 'like.ai-explain-global:h*');
  assert.equal(calls.setCache.length, 1);
  assert.match(calls.setCache[0].key, /^explain:v1:77:4\.17\.0-starting-xi:[0-9a-f]{24}$/);
  assert.deepEqual(calls.setCache[0].value.factIds, ['model_lead', 'absences_away', 'form_home']);
});

test('API: cached selection is reused without calling the model or spending limits', async () => {
  const { call, calls } = runtime({ cached: { factIds: ['model_lead', 'h2h', 'lineups_pending'] } });
  const res = await call();
  assert.equal(res.body.source, 'ai');
  assert.equal(res.body.reason, 'cached');
  assert.equal(calls.ai, 0);
  assert.equal(calls.rpc.length, 0);
});

test('API: invalid model answer, errors, limits or missing binding fall back to the default order', async () => {
  const cases = [
    [{ ai: () => ({ response: 'Хозяева контролируют игру, ставьте П1' }) }, 'invalid_response'],
    [{ ai: () => { throw new Error('quota exceeded'); } }, 'ai_error'],
    [{ ai: null }, 'no_binding'],
    [{ rpc: params => ({ allowed: !params.p_bucket_key.includes(':user:') }) }, 'user_limit'],
    [{ rpc: params => ({ allowed: !params.p_bucket_key.startsWith('ai-explain-global') }) }, 'daily_limit'],
    [{ serviceUsedToday: 1000 }, 'daily_limit'],
  ];
  for (const [options, reason] of cases) {
    const { call, calls } = runtime(options);
    const res = await call();
    assert.equal(res.status, 200, reason);
    assert.equal(res.body.source, 'default', reason);
    assert.equal(res.body.reason, reason);
    assert.equal(res.body.items[0].id, 'model_lead');
    assert.equal(calls.setCache.length, 0, reason);
    if (reason.endsWith('_limit') || reason === 'no_binding') assert.equal(calls.ai, 0, reason);
  }
  const disabled = runtime();
  disabled.cfg.aiExplanationEnabled = false;
  const res = await disabled.call();
  assert.equal(res.body.reason, 'disabled');
  assert.equal(disabled.calls.ai, 0);
});

test('API: only for users who already opened this analysis; honest errors otherwise', async () => {
  assert.equal((await runtime().call(77, { id: 0 })).status, 401);
  assert.equal((await runtime().call(0)).status, 400);
  const notMine = await runtime({ history: [{ fixture_id: 12 }] }).call();
  assert.equal(notMine.status, 404);
  assert.equal(notMine.body.code, 'EXPLANATION_NOT_IN_HISTORY');
  const down = await runtime({ history: new Error('db down') }).call();
  assert.equal(down.status, 503);
  assert.equal(down.body.code, 'HISTORY_UNAVAILABLE');
  const noAnalysis = await runtime({ analysis: null }).call();
  assert.deepEqual(noAnalysis.body, { available: false, reason: 'analysis_unavailable' });
  const wrongFixture = await runtime({ analysis: payload({ match: { fixtureId: 99, home: { name: 'A' }, away: { name: 'B' } } }) }).call();
  assert.equal(wrongFixture.body.available, false);
  const paused = await runtime({ controls: { analysisEnabled: false } }).call();
  assert.deepEqual(paused.body, { available: false, reason: 'analysis_disabled' });
});

test('wiring: route, rate policy, Workers AI binding without secrets, same analysis cache key', () => {
  const router = fs.readFileSync('src/router.js', 'utf8');
  assert.match(router, /pathname === '\/api\/match-explanation'\) return await apiMatchExplanation\(request, cfg, user\)/);
  assert.match(fs.readFileSync('src/account-rate-limit.js', 'utf8'), /\/api\/match-explanation', limit:20, windowSeconds:60, label:'match-explanation'/);
  const wrangler = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(wrangler.ai, { binding: 'AI' });
  assert.match(fs.readFileSync('src/common-infrastructure-runtime.js', 'utf8'), /workersAi: env\.AI \|\| null/);
  assert.match(fs.readFileSync('src/analysis-runtime.js', 'utf8'), /const cacheKey=`fixture:\$\{fixtureId\}:v17-starting-xi-rc146`/);
  assert.equal(EXPLANATION_ANALYSIS_CACHE_KEY(5), 'fixture:5:v17-starting-xi-rc146');
});
