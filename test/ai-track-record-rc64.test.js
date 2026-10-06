import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPredictionMathRuntime } from '../src/prediction-math-runtime.js';
import { createSettlementRuntime } from '../src/settlement-runtime.js';
import { createModelEvaluationRuntime } from '../src/model-evaluation-runtime.js';
import { createTelegramSearchRuntime } from '../src/telegram-search-runtime.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function normalizeThree(home, draw, away) {
  const total = Number(home) + Number(draw) + Number(away);
  if (!(total > 0)) return null;
  return {
    home:Number(home) / total * 100,
    draw:Number(draw) / total * 100,
    away:Number(away) / total * 100,
  };
}

const math=createPredictionMathRuntime({
  clamp:(value,min,max)=>Math.max(min,Math.min(max,Number(value))),
  normalizeThree,
});

const settlement=createSettlementRuntime({
  actualOutcomeFromGoals:math.actualOutcomeFromGoals,
  brierFromProbabilities:math.brierFromProbabilities,
  predictionOutcomeKey:math.predictionOutcomeKey,
});

function json(payload,status=200) {
  return new Response(JSON.stringify(payload),{
    status,
    headers:{'content-type':'application/json'},
  });
}

function createTrackRuntime({
  getCache = async () => null,
  hasSupabase = () => false,
  memory = {modelPredictions:new Map()},
  setCache = async () => true,
  supaSelectMany = async () => [],
} = {}) {
  return createModelEvaluationRuntime({
    MODEL_BASE_WEIGHTS:{},
    actualOutcomeFromGoals:math.actualOutcomeFromGoals,
    brierFromProbabilities:math.brierFromProbabilities,
    clamp:(value,min,max)=>Math.max(min,Math.min(max,Number(value))),
    getCache,
    hasSupabase,
    json,
    logLossFromProbabilities:math.logLossFromProbabilities,
    memory,
    parseJsonObject:math.parseJsonObject,
    predictedOutcomeForProbabilities:math.predictionOutcomeKey,
    predictionOutcomeLabel:math.predictionOutcomeLabel,
    redactOpsString:value=>String(value || '').slice(0,160),
    regulationScore:math.regulationScore,
    setCache,
    signalDisplayName:value=>String(value || ''),
    supaSelectMany,
    supaSelectOne:async()=>null,
    topProbabilityValue:math.topProbabilityValue,
    validThreeProbabilities:math.validThreeProbabilities,
    verifiedBrierScore:settlement.verifiedBrierScore,
    verifiedSettledRows:settlement.verifiedSettledRows,
  });
}

function settledRow(overrides = {}) {
  return {
    fixture_id:1,
    status:'settled',
    settlement_verification_state:'confirmed',
    captured_at:'2026-09-20T16:00:00Z',
    kickoff_at:'2026-09-20T18:00:00Z',
    home_prob:60,
    draw_prob:25,
    away_prob:15,
    predicted_outcome:'home',
    actual_home_goals:2,
    actual_away_goals:1,
    actual_outcome:'home',
    correct:true,
    home_name:'Home',
    away_name:'Away',
    league_name:'League',
    over25_correct:true,
    btts_correct:true,
    ...overrides,
  };
}

function createTelegramRuntime({
  loadPublicAiTrackRecord = async () => ({available:false}),
  telegramApi = async () => ({}),
} = {}) {
  return createTelegramSearchRuntime({
    apiFootball:async()=>[],
    digestTime:()=> '12:00',
    footballMatchActionKeyboard:()=>({inline_keyboard:[]}),
    footballSearchHandoffKeyboard:()=>({inline_keyboard:[]}),
    freeQuotaHealthy:()=>true,
    getCache:async()=>null,
    getFavorites:async()=>[],
    getHistory:async()=>[],
    loadPublicAiTrackRecord,
    loadSearchTeamMatches:async()=>({matches:[]}),
    normalizeSearchTeam:row=>row,
    rankTeamDiscoveryMatches:rows=>rows,
    recordGrowthEvent:()=>{},
    rememberBotFixtureCards:async()=>{},
    searchText:value=>String(value || '').toLowerCase().trim(),
    setCache:async()=>true,
    telegramApi,
    telegramWebAppUrl:(_request,params={})=>`https://app.test/?${new URLSearchParams(params)}`,
    todayUtc:()=> '2026-10-07',
    topTeamSearchPlan:query=>({best:{score:100,canonical:query},providerQuery:query,candidates:[]}),
  });
}

const router=readRepoFile('src/router.js');
const modelEvaluationSource=readRepoFile('src/model-evaluation-runtime.js');
const app=readRepoFile('public/app.js');
const renderer=readRepoFile('public/modules/ai-track-record-renderer.js');
const html=readRepoFile('public/index.html');
const css=readRepoFile('public/styles.css');
const telegramUpdate=readRepoFile('src/telegram-update-orchestration.js');

test('RC64 public track-record route remains GET-only without an admin gate', () => {
  assert.match(
    router,
    /if \(method === 'GET' && pathname === '\/api\/ai-track-record'\) return await apiAiTrackRecord\(request, cfg\)/,
  );
  const routeIndex=router.indexOf("pathname === '/api/ai-track-record'");
  const routeWindow=router.slice(Math.max(0,routeIndex-120),routeIndex+220);
  assert.doesNotMatch(routeWindow,/adminAllowed\(|adminForbidden\(/);
});

test('RC64 verified track record excludes untrusted, late, inconsistent and duplicate fixtures', () => {
  const good=settledRow();
  const adjudicated=settledRow({
    fixture_id:2,
    settlement_verification_state:'adjudicated',
    home_prob:25,
    draw_prob:25,
    away_prob:50,
    predicted_outcome:'away',
    actual_home_goals:0,
    actual_away_goals:1,
    actual_outcome:'away',
    correct:true,
  });
  const unverified=settledRow({
    fixture_id:3,
    settlement_verification_state:'unverified',
  });
  const late=settledRow({
    fixture_id:4,
    captured_at:'2026-09-20T18:00:00Z',
  });
  const inconsistent=settledRow({
    fixture_id:5,
    predicted_outcome:'away',
    correct:false,
  });
  const duplicate=settledRow({fixture_id:6});
  const duplicatePending={
    ...settledRow({fixture_id:6}),
    status:'pending',
    settlement_verification_state:'unverified',
  };

  const rows=settlement.verifiedSettledRows(
    [good,adjudicated,unverified,late,inconsistent,duplicate],
    [duplicatePending],
  );

  assert.deepEqual(rows.map(row=>row.fixture_id),[1,2]);
});

test('RC64 public record reports counts, Brier and methodology without inventing profitability', () => {
  const runtime=createTrackRuntime();
  const hit=settledRow();
  const miss=settledRow({
    fixture_id:2,
    home_prob:55,
    draw_prob:25,
    away_prob:20,
    predicted_outcome:'home',
    actual_home_goals:0,
    actual_away_goals:1,
    actual_outcome:'away',
    correct:false,
    over25_correct:false,
    btts_correct:false,
  });
  const unverified=settledRow({
    fixture_id:3,
    settlement_verification_state:'unverified',
  });

  const result=runtime.buildPublicAiTrackRecord(
    [hit,miss,unverified],
    [{fixture_id:9,status:'pending'}],
    180,
  );

  assert.equal(result.available,true);
  assert.deepEqual(result.sample,{
    verified:2,
    matched:1,
    missed:1,
    pending:1,
    excluded:1,
    state:'early',
    label:'Малая выборка',
    message:'Матчей пока мало — цифры показывают только раннюю историю и могут заметно меняться.',
  });
  assert.equal(result.probabilityQuality.avgBrier,0.208);
  assert.deepEqual(result.secondary.over25,{sample:2,matched:1,missed:1});
  assert.deepEqual(result.secondary.btts,{sample:2,matched:1,missed:1});
  assert.equal(result.methodology.immutablePrematch,true);
  assert.equal(result.methodology.verifiedOnly,true);
  assert.equal(result.methodology.profitabilityMetric,false);
  assert.match(result.methodology.disclaimer,/не равно доходности ставки/);
});

test('RC64 sample labels are explicit across empty, early, forming and informative cohorts', () => {
  const runtime=createTrackRuntime();

  assert.equal(runtime.publicTrackRecordSampleState(0).code,'empty');
  assert.equal(runtime.publicTrackRecordSampleState(1).code,'early');
  assert.equal(runtime.publicTrackRecordSampleState(19).code,'early');
  assert.equal(runtime.publicTrackRecordSampleState(20).code,'forming');
  assert.equal(runtime.publicTrackRecordSampleState(49).code,'forming');
  assert.equal(runtime.publicTrackRecordSampleState(50).code,'informative');
});

test('RC64 deterministic self-test remains green', () => {
  const runtime=createTrackRuntime();
  assert.deepEqual(runtime.publicAiTrackRecordDrill(),{pass:true,cases:6});
});

test('RC64 public API does not allow refresh=1 to bypass the shared cache', async () => {
  let selects=0;
  const cached={
    available:true,
    periodDays:180,
    sample:{verified:12},
    probabilityQuality:{avgBrier:0.21},
    recent:[],
    methodology:{profitabilityMetric:false},
  };
  const runtime=createTrackRuntime({
    hasSupabase:()=>true,
    getCache:async key=>{
      assert.equal(key,'public:ai-track-record:180:v1');
      return cached;
    },
    supaSelectMany:async()=>{
      selects+=1;
      return [];
    },
  });

  const response=await runtime.apiAiTrackRecord(
    new Request('https://app.test/api/ai-track-record?days=180&refresh=1'),
    {},
  );
  const payload=await response.json();

  assert.equal(response.status,200);
  assert.equal(payload.cached,true);
  assert.equal(payload.sample.verified,12);
  assert.equal(selects,0);
  assert.doesNotMatch(
    modelEvaluationSource,
    /loadPublicAiTrackRecord\(cfg,days,\{force:url\.searchParams\.get\('refresh'\)===\'1\'\}\)/,
  );
  assert.doesNotMatch(app,/ai-track-record\?days=180[^'\`]*refresh=1/);
});

test('RC64 allowed reporting windows are bounded to 90, 180 or 365 days', async () => {
  const cacheKeys=[];
  const runtime=createTrackRuntime({
    getCache:async key=>{
      cacheKeys.push(key);
      return {
        available:true,
        periodDays:Number(key.match(/:(90|180|365):/)?.[1] || 0),
      };
    },
  });

  assert.equal((await runtime.loadPublicAiTrackRecord({},90)).periodDays,90);
  assert.equal((await runtime.loadPublicAiTrackRecord({},365)).periodDays,365);
  assert.equal((await runtime.loadPublicAiTrackRecord({},999)).periodDays,180);
  assert.deepEqual(cacheKeys,[
    'public:ai-track-record:90:v1',
    'public:ai-track-record:365:v1',
    'public:ai-track-record:180:v1',
  ]);
});

test('RC64 History view separates global model evidence from personal analysis history', () => {
  assert.match(html,/id="aiTrackRecord"/);
  assert.match(html,/Проверенная история модели и ваши сохранённые разборы/);
  assert.match(html,/Ваши анализы/);
  assert.match(renderer,/Только неизменяемые предматчевые прогнозы с подтверждённым финальным результатом/);
  assert.match(renderer,/Здесь нет рекламного «процента побед»/);
  assert.doesNotMatch(app,/Винрейт/);
  assert.match(css,/\.ai-track-card/);
  assert.match(app,/api\('\/api\/ai-track-record\?days=180'/);
});

test('RC64 Telegram Protocol AI reports evidence without presenting it as betting profitability', () => {
  const telegram=createTelegramRuntime();
  const text=telegram.botAiTrackRecordText({
    available:true,
    periodDays:180,
    sample:{
      verified:24,
      matched:14,
      missed:10,
      label:'Выборка формируется',
      message:'История уже полезна для проверки модели.',
    },
    probabilityQuality:{avgBrier:0.187},
    recent:[{
      matched:true,
      home:'Home',
      away:'Away',
      score:'2:1',
      predictedLabel:'Home',
      actualLabel:'Home',
      topProbability:58,
    }],
  });

  assert.match(text,/Проверенных матчей: <b>24<\/b>/);
  assert.match(text,/Совпало \/ не совпало: <b>14 \/ 10<\/b>/);
  assert.match(text,/Ошибка Брайера: <b>0\.187<\/b>/);
  assert.match(text,/не «винрейт»/);
  assert.match(text,/не показатель доходности ставок/);
});

test('RC64 Telegram /track sends the public record with a History deep link', async () => {
  const sent=[];
  const telegram=createTelegramRuntime({
    loadPublicAiTrackRecord:async (_cfg,days)=>{
      assert.equal(days,180);
      return {
        available:true,
        periodDays:180,
        sample:{verified:1,matched:1,missed:0,label:'Малая выборка',message:'Ранняя история.'},
        probabilityQuality:{avgBrier:0.1},
        recent:[],
      };
    },
    telegramApi:async (method,_cfg,payload)=>{
      sent.push({method,payload});
      return {};
    },
  });

  await telegram.sendBotAiTrackRecord(
    new Request('https://bot.test/webhook'),
    {},
    456,
  );

  assert.equal(sent.length,1);
  assert.equal(sent[0].method,'sendMessage');
  assert.equal(sent[0].payload.chat_id,456);
  assert.equal(sent[0].payload.parse_mode,'HTML');
  assert.match(
    sent[0].payload.reply_markup.inline_keyboard[0][0].web_app.url,
    /view=history/,
  );
  assert.match(
    telegramUpdate,
    /\/\^\\\/track[\s\S]*?text === '📈 Протокол AI'[\s\S]*?sendBotAiTrackRecord\(request,cfg,chatId\)/,
  );
});
