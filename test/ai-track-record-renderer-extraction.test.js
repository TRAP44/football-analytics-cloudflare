import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAiTrackRecordRenderer } from '../public/modules/ai-track-record-renderer.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function element() {
  return {
    innerHTML:'',
    listeners:{},
    addEventListener(type,fn) {
      this.listeners[type]=fn;
    },
    click() {
      this.listeners.click?.();
    },
  };
}

function createElements() {
  const map=new Map([['aiTrackRecord',element()]]);
  return {
    map,
    elementById(id) {
      if (!map.has(id)) map.set(id,element());
      return map.get(id);
    },
  };
}

function escapeHtml(value='') {
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function createRenderer({
  state,
  elements=createElements(),
  onRetry=()=>{},
  dateTime=value=>`date:${value}`,
}={}) {
  return {
    elements,
    renderer:createAiTrackRecordRenderer({
      state,
      elementById:elements.elementById,
      escapeHtml,
      dateTime,
      onRetry,
    }),
  };
}

const app=readRepoFile('public/app.js');
const rendererSource=readRepoFile('public/modules/ai-track-record-renderer.js');

test('AI track record renderer owns presentation while network loading stays in app root', () => {
  assert.match(rendererSource,/export function createAiTrackRecordRenderer/);
  assert.match(rendererSource,/function renderAiTrackRecord\(\)/);
  assert.doesNotMatch(rendererSource,/\/api\/ai-track-record|\bapi\s*\(|fetch\s*\(/);

  assert.match(app,/async function loadAiTrackRecord\(\)/);
  assert.match(
    app,
    /api\('\/api\/ai-track-record\?days=180',\{retry:false,timeoutMs:9000\}\)/,
  );
  assert.doesNotMatch(app,/ai-track-record\?days=180[^'\`]*refresh=1/);
  assert.doesNotMatch(app,/Здесь нет рекламного «процента побед»/);
});

test('app lazy-loads the renderer and retry no longer carries a force-refresh flag', () => {
  assert.match(
    app,
    /async function ensureAiTrackRecordRenderer\(\)[\s\S]*?import\('\.\/modules\/ai-track-record-renderer\.js'\)[\s\S]*?createAiTrackRecordRenderer\(\{[\s\S]*?state,[\s\S]*?elementById: \$,[\s\S]*?escapeHtml,[\s\S]*?dateTime,[\s\S]*?onRetry: \(\) => loadAiTrackRecord\(\)/,
  );
  assert.match(rendererSource,/addEventListener\('click',\(\)=>retry\(\)\)/);
  assert.doesNotMatch(rendererSource,/retry\(true\)/);
});

test('renderer preserves initial loading and error retry states without leaking raw error HTML', () => {
  const calls=[];
  const state={
    aiTrackRecordLoading:true,
    aiTrackRecordLoaded:false,
    aiTrackRecordError:'',
    aiTrackRecord:null,
  };
  const {renderer,elements}=createRenderer({
    state,
    onRetry:(...args)=>calls.push(args),
  });

  renderer.renderAiTrackRecord();
  assert.match(
    elements.map.get('aiTrackRecord').innerHTML,
    /Проверяю подтверждённую историю AI/,
  );

  state.aiTrackRecordLoading=false;
  state.aiTrackRecordError='<offline & retry>';
  renderer.renderAiTrackRecord();
  elements.map.get('aiTrackRetry').click();

  const html=elements.map.get('aiTrackRecord').innerHTML;
  assert.match(html,/Протокол AI временно недоступен/);
  assert.match(html,/&lt;offline &amp; retry&gt;/);
  assert.doesNotMatch(html,/<offline/);
  assert.deepEqual(calls,[[]]);
});

test('renderer preserves the forming empty state', () => {
  const {renderer,elements}=createRenderer({
    state:{
      aiTrackRecordLoading:false,
      aiTrackRecordLoaded:true,
      aiTrackRecordError:'',
      aiTrackRecord:{available:false},
    },
  });

  renderer.renderAiTrackRecord();

  const html=elements.map.get('aiTrackRecord').innerHTML;
  assert.match(html,/Протокол AI формируется/);
  assert.match(html,/Подтверждённые результаты появятся здесь/);
});

test('renderer shows verified metrics and escapes all textual recent-row content', () => {
  const {renderer,elements}=createRenderer({
    state:{
      aiTrackRecordLoading:false,
      aiTrackRecordLoaded:true,
      aiTrackRecordError:'',
      aiTrackRecord:{
        available:true,
        periodDays:180,
        sample:{
          state:'informative',
          label:'<Информативная выборка>',
          verified:42,
          matched:25,
          missed:17,
          message:'<sample>',
        },
        probabilityQuality:{
          avgBrier:0.18349,
          explanation:'<lower & better>',
        },
        recent:[{
          matched:true,
          home:'<Home>',
          away:'Away & Co',
          league:'<League>',
          kickoffAt:'2026-09-30T10:00:00Z',
          score:'<2:1>',
          predictedLabel:'<П1>',
          topProbability:61.2,
          actualLabel:'П1 & final',
        }],
        methodology:{disclaimer:'<verified only>'},
      },
    },
    dateTime:value=>`<time>${value}</time>`,
  });

  renderer.renderAiTrackRecord();
  const html=elements.map.get('aiTrackRecord').innerHTML;

  assert.match(html,/Проверенная история модели/);
  assert.match(html,/>42<|>42<\/strong>/);
  assert.match(html,/0\.183/);
  assert.match(html,/&lt;Информативная выборка&gt;/);
  assert.match(html,/&lt;Home&gt; — Away &amp; Co/);
  assert.match(html,/&lt;League&gt;/);
  assert.match(html,/&lt;time&gt;2026-09-30T10:00:00Z&lt;\/time&gt;/);
  assert.match(html,/&lt;2:1&gt;/);
  assert.match(html,/&lt;П1&gt; · 61\.2%/);
  assert.match(html,/П1 &amp; final/);
  assert.match(html,/&lt;lower &amp; better&gt;/);
  assert.match(html,/&lt;verified only&gt;/);
  assert.doesNotMatch(html,/<time>|<Home>|<League>/);
  assert.match(html,/Здесь нет рекламного «процента побед»/);
});

test('renderer fails safe for malformed numeric public data', () => {
  const {renderer,elements}=createRenderer({
    state:{
      aiTrackRecordLoading:false,
      aiTrackRecordLoaded:true,
      aiTrackRecordError:'',
      aiTrackRecord:{
        available:true,
        periodDays:-90,
        sample:{
          state:'early',
          label:'Малая выборка',
          verified:Infinity,
          matched:-5,
          missed:'not-a-number',
        },
        probabilityQuality:{avgBrier:-1},
        recent:[{
          matched:false,
          home:'Home',
          away:'Away',
          topProbability:150,
          score:'0:1',
          predictedLabel:'П1',
          actualLabel:'П2',
        }],
        methodology:{},
      },
    },
  });

  renderer.renderAiTrackRecord();
  const html=elements.map.get('aiTrackRecord').innerHTML;

  assert.doesNotMatch(html,/Infinity|NaN|-5|150%|-1\.000/);
  assert.match(html,/Проверено<\/span><strong>0<\/strong>/);
  assert.match(html,/180 дней/);
  assert.match(html,/Брайер<\/span><strong>—<\/strong>/);
});

test('stale refresh failure keeps the last verified record visible with an escaped warning', () => {
  const {renderer,elements}=createRenderer({
    state:{
      aiTrackRecordLoading:false,
      aiTrackRecordLoaded:true,
      aiTrackRecordError:'refresh <failed>',
      aiTrackRecord:{
        available:true,
        sample:{
          state:'early',
          label:'Малая выборка',
          verified:2,
          matched:1,
          missed:1,
        },
        probabilityQuality:{},
        recent:[],
        methodology:{},
      },
    },
  });

  renderer.renderAiTrackRecord();
  const html=elements.map.get('aiTrackRecord').innerHTML;

  assert.match(html,/Показана последняя загруженная версия/);
  assert.match(html,/Малая выборка/);
  assert.match(html,/refresh &lt;failed&gt;/);
  assert.doesNotMatch(html,/refresh <failed>/);
});
