import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfileDataCapabilitiesModule } from '../public/modules/profile-data-capabilities.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const capabilitiesSource = readFileSync(new URL('../public/modules/profile-data-capabilities.js', import.meta.url), 'utf8');

function element() {
  return { textContent: '' };
}

function createElements() {
  return new Map([
    ['dataModeLabel', element()],
    ['dataModeSummary', element()],
    ['dataModeRefresh', element()],
    ['dataModeLineups', element()],
    ['dataModePlayers', element()],
    ['dataModeOdds', element()],
    ['dataModeNote', element()],
  ]);
}

function createModule(state, elements = createElements()) {
  return {
    module: createProfileDataCapabilitiesModule({
      state,
      elementById: id => elements.get(id) || null,
    }),
    elements,
  };
}

test('profile data capabilities implementation lives outside app and remains read-only', () => {
  assert.match(app, /import \{ createProfileDataCapabilitiesModule \} from '\.\/modules\/profile-data-capabilities\.js'/);
  assert.match(app, /const \{ renderDataCapabilities \} = createProfileDataCapabilitiesModule\(\{ state, elementById: \$ \}\)/);
  assert.match(app, /renderDataCapabilities\(\);/);
  assert.doesNotMatch(app, /function renderDataCapabilities\(\)/);
  assert.match(capabilitiesSource, /export function createProfileDataCapabilitiesModule/);
  assert.match(capabilitiesSource, /function renderDataCapabilities\(\)/);
  assert.doesNotMatch(capabilitiesSource, /\bapi\s*\(|fetch\s*\(|state\.[A-Za-z0-9_]+\s*=/);
});

test('top-level data capabilities take precedence over profile fallback', () => {
  const state = {
    dataCapabilities: {
      mode: 'expanded',
      refreshSeconds: 20,
      features: {
        liveRefresh: true,
        lineupsFallback: true,
        playerStats: true,
        liveOdds: true,
      },
    },
    profile: {
      features: {
        dataCapabilities: {
          mode: 'standard',
          refreshSeconds: 90,
          features: {},
        },
      },
    },
  };
  const { module, elements } = createModule(state);

  module.renderDataCapabilities();

  assert.equal(elements.get('dataModeLabel').textContent, 'Расширенный');
  assert.equal(elements.get('dataModeSummary').textContent, 'Подробнее');
  assert.equal(elements.get('dataModeRefresh').textContent, 'часто');
  assert.equal(elements.get('dataModeLineups').textContent, 'Чаще доступны');
  assert.equal(elements.get('dataModePlayers').textContent, 'Чаще доступны');
  assert.equal(elements.get('dataModeOdds').textContent, 'Чаще доступны');
  assert.equal(elements.get('dataModeNote').textContent, 'Если каких-то данных нет, MatchRadar не подставляет их искусственно.');
});

test('profile fallback preserves standard availability copy', () => {
  const state = {
    dataCapabilities: null,
    profile: {
      features: {
        dataCapabilities: {
          mode: 'standard',
          refreshSeconds: 60,
          features: {
            liveRefresh: true,
            lineupsFallback: false,
            playerStats: false,
            liveOdds: false,
          },
        },
      },
    },
  };
  const { module, elements } = createModule(state);

  module.renderDataCapabilities();

  assert.equal(elements.get('dataModeLabel').textContent, 'Стандартный');
  assert.equal(elements.get('dataModeSummary').textContent, 'Подробнее');
  assert.equal(elements.get('dataModeRefresh').textContent, 'автоматически');
  assert.equal(elements.get('dataModeLineups').textContent, 'Если доступны');
  assert.equal(elements.get('dataModePlayers').textContent, 'Если доступны');
  assert.equal(elements.get('dataModeOdds').textContent, 'Если доступны');
});

test('disabled or zero-second refresh remains temporarily paused', () => {
  for (const capabilities of [
    { refreshSeconds: 30, features: { liveRefresh: false } },
    { refreshSeconds: 0, features: { liveRefresh: true } },
  ]) {
    const { module, elements } = createModule({ dataCapabilities: capabilities, profile: null });
    module.renderDataCapabilities();
    assert.equal(elements.get('dataModeRefresh').textContent, 'временно приостановлены');
  }
});

test('missing optional DOM nodes do not break profile capability rendering', () => {
  const state = { dataCapabilities: { mode: 'expanded', refreshSeconds: 20, features: {} } };
  const module = createProfileDataCapabilitiesModule({
    state,
    elementById: () => null,
  });

  assert.doesNotThrow(() => module.renderDataCapabilities());
});



test('missing or malformed refresh interval never falsely implies updates are paused or rapid',()=>{
  for(const value of [undefined,null,'',-5,-1,NaN,Infinity,[],{},'bad']){
    const {module,elements}=createModule({dataCapabilities:{
      mode:'standard',refreshSeconds:value,features:{liveRefresh:true},
    }});
    module.renderDataCapabilities();
    assert.equal(elements.get('dataModeRefresh').textContent,'автоматически');
  }
});

test('explicit zero and unavailable live-refresh flag disable live updates',()=>{
  for(const input of [
    {refreshSeconds:0,liveRefresh:true},
    {refreshSeconds:'0',liveRefresh:true},
    {refreshSeconds:30,liveRefresh:'false'},
    {refreshSeconds:30,liveRefresh:null},
  ]){
    const {module,elements}=createModule({dataCapabilities:{
      refreshSeconds:input.refreshSeconds,features:{liveRefresh:input.liveRefresh},
    }});
    module.renderDataCapabilities();
    assert.equal(elements.get('dataModeRefresh').textContent,'временно приостановлены');
  }
  const {module,elements}=createModule({dataCapabilities:{refreshSeconds:'30',features:{liveRefresh:true}}});
  module.renderDataCapabilities();
  assert.equal(elements.get('dataModeRefresh').textContent,'часто');
});

test('only confirmed boolean capability flags may advertise enhanced data coverage',()=>{
  const {module,elements}=createModule({dataCapabilities:{
    mode:'expanded',refreshSeconds:20,
    features:{lineupsFallback:'false',playerStats:1,liveOdds:{enabled:true},liveRefresh:true},
  }});
  module.renderDataCapabilities();
  for(const id of ['dataModeLineups','dataModePlayers','dataModeOdds']){
    assert.equal(elements.get(id).textContent,'Если доступны');
  }
  assert.equal(elements.get('dataModeLabel').textContent,'Расширенный');
});

test('malformed capabilities and optional feature containers render safely without mutating state',()=>{
  for(const capabilities of [[],true,'expanded',{mode:'expanded',features:[]},{features:null}]){
    const state={dataCapabilities:capabilities};
    const previous=JSON.stringify(state);
    const {module,elements}=createModule(state);
    assert.doesNotThrow(()=>module.renderDataCapabilities());
    assert.equal(elements.get('dataModeLineups').textContent,'Если доступны');
    assert.equal(JSON.stringify(state),previous);
  }
});
