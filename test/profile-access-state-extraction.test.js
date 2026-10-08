import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfileAccessStateModule } from '../public/modules/profile-access-state.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/modules/profile-access-state.js', import.meta.url), 'utf8');

function element() {
  return {
    innerHTML: '',
    hidden: false,
    listeners: [],
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) { return this.values.has(name); },
    },
    addEventListener(type, handler, options) {
      this.listeners.push({ type, handler, options });
    },
  };
}

function createElements() {
  return new Map([
    ['profileView', element()],
    ['profileRecovery', element()],
    ['profileRecoveryRetry', element()],
  ]);
}

function createModule({ elements = createElements(), onRetry = () => {} } = {}) {
  return {
    elements,
    module: createProfileAccessStateModule({
      elementById: id => elements.get(id) || null,
      escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
      onRetry,
    }),
  };
}

test('profile access state implementation lives outside app with explicit retry dependency', () => {
  assert.match(app, /import \{ createProfileAccessStateModule \} from '\.\/modules\/profile-access-state\.js'/);
  assert.match(app, /const \{ renderProfileAccessState \} = createProfileAccessStateModule\(\{/);
  assert.match(app, /onRetry: \(\) => openProfileView\(\)/);
  assert.doesNotMatch(app, /function renderProfileAccessState\(/);
  assert.match(source, /export function createProfileAccessStateModule/);
  assert.match(source, /function renderProfileAccessState\(kind = 'ready', message = ''\)/);
  assert.doesNotMatch(source, /openProfileView|\bapi\s*\(|fetch\s*\(|state\./);
});

test('ready profile state clears recovery UI and removes unavailable class', () => {
  const { module, elements } = createModule();
  elements.get('profileView').classList.toggle('profile-unavailable', true);
  elements.get('profileRecovery').hidden = false;
  elements.get('profileRecovery').innerHTML = 'old';

  module.renderProfileAccessState('ready');

  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'), false);
  assert.equal(elements.get('profileRecovery').hidden, true);
  assert.equal(elements.get('profileRecovery').innerHTML, '');
});

test('loading profile state exposes non-interactive loading recovery state', () => {
  const { module, elements } = createModule();

  module.renderProfileAccessState('loading', 'Подождите');

  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'), true);
  assert.equal(elements.get('profileRecovery').hidden, false);
  assert.match(elements.get('profileRecovery').innerHTML, /is-loading/);
  assert.match(elements.get('profileRecovery').innerHTML, /Загружаем профиль/);
  assert.match(elements.get('profileRecovery').innerHTML, /Подождите/);
  assert.doesNotMatch(elements.get('profileRecovery').innerHTML, /profileRecoveryRetry/);
  assert.equal(elements.get('profileRecoveryRetry').listeners.length, 0);
});

test('error profile state renders retry and wires injected callback once', () => {
  let retries = 0;
  const { module, elements } = createModule({ onRetry: () => { retries += 1; } });

  module.renderProfileAccessState('error', 'Ошибка <сети>');

  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'), true);
  assert.equal(elements.get('profileRecovery').hidden, false);
  assert.match(elements.get('profileRecovery').innerHTML, /is-error/);
  assert.match(elements.get('profileRecovery').innerHTML, /Профиль временно недоступен/);
  assert.match(elements.get('profileRecovery').innerHTML, /Ошибка &lt;сети&gt;/);
  assert.match(elements.get('profileRecovery').innerHTML, /profileRecoveryRetry/);

  const [listener] = elements.get('profileRecoveryRetry').listeners;
  assert.equal(listener.type, 'click');
  assert.deepEqual(listener.options, { once: true });
  listener.handler();
  assert.equal(retries, 1);
});

test('missing profile recovery DOM fails soft without invoking retry', () => {
  let retries = 0;
  const module = createProfileAccessStateModule({
    elementById: () => null,
    escapeHtml: value => String(value ?? ''),
    onRetry: () => { retries += 1; },
  });

  assert.doesNotThrow(() => module.renderProfileAccessState('error', 'offline'));
  assert.equal(retries, 0);
});



test('profile access state validates required dependencies and exposes a frozen interface',()=>{
  for(const args of [{},null,{elementById:()=>null,escapeHtml:String},{
    elementById:null,escapeHtml:String,onRetry:()=>{},
  }]){
    assert.throws(()=>createProfileAccessStateModule(args),/Profile Access State|Cannot destructure/);
  }
  const {module}=createModule();
  assert.equal(Object.isFrozen(module),true);
});

test('profile error content is escaped while its retry control remains accessible',()=>{
  const {module,elements}=createModule();
  module.renderProfileAccessState('error','Сбой <script>alert(1)</script>');
  const html=elements.get('profileRecovery').innerHTML;
  assert.match(html,/Сбой &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/aria-live="polite"/);
  assert.match(html,/role="status"/);
  assert.match(html,/type="button">Повторить<\/button>/);
});

test('profile loading and ready transitions do not offer an actionable retry',()=>{
  const {module,elements}=createModule();
  module.renderProfileAccessState('error','offline');
  module.renderProfileAccessState('loading','retry pending');
  assert.match(elements.get('profileRecovery').innerHTML,/is-loading/);
  assert.doesNotMatch(elements.get('profileRecovery').innerHTML,/id="profileRecoveryRetry"/);
  module.renderProfileAccessState('ready');
  assert.equal(elements.get('profileRecovery').innerHTML,'');
  assert.equal(elements.get('profileRecovery').hidden,true);
  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'),false);
});

test('unknown profile access states fail closed instead of silently exposing profile',()=>{
  const {module,elements}=createModule();
  module.renderProfileAccessState('unavailable','нет соединения');
  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'),true);
  assert.equal(elements.get('profileRecovery').hidden,false);
  assert.match(elements.get('profileRecovery').innerHTML,/Профиль временно недоступен/);
  assert.match(elements.get('profileRecovery').innerHTML,/нет соединения/);
});



test('non-string profile recovery messages use safe localized defaults without coercion',()=>{
  const {module,elements}=createModule();
  for(const message of [{toString:()=>{throw new Error('must not coerce')}},[],true,42,null,'   ']){
    assert.doesNotThrow(()=>module.renderProfileAccessState('error',message));
    assert.match(elements.get('profileRecovery').innerHTML,/Не удалось обновить профиль/);
    assert.doesNotMatch(elements.get('profileRecovery').innerHTML,/must not coerce/);
  }
  module.renderProfileAccessState('loading',{toString:()=>{throw new Error('not text')}});
  assert.match(elements.get('profileRecovery').innerHTML,/Получаем ваши настройки и избранное/);
});

test('profile recovery sanitizes untrusted error markup before insertion',()=>{
  const {module,elements}=createModule();
  const input='<img src=x onerror=alert(1)>';
  module.renderProfileAccessState('error',input);
  const html=elements.get('profileRecovery').innerHTML;
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<img src=x/);
  assert.match(html,/role="status"/);
});

test('profile state transitions restore ready UI after errors and subsequent reloads',()=>{
  const {module,elements}=createModule();
  module.renderProfileAccessState('error','offline');
  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'),true);
  module.renderProfileAccessState('loading','still loading');
  assert.match(elements.get('profileRecovery').innerHTML,/still loading/);
  assert.doesNotMatch(elements.get('profileRecovery').innerHTML,/<button/);
  module.renderProfileAccessState();
  assert.equal(elements.get('profileRecovery').hidden,true);
  assert.equal(elements.get('profileRecovery').innerHTML,'');
  assert.equal(elements.get('profileView').classList.contains('profile-unavailable'),false);
});

test('missing retry button remains nonfatal and cannot invoke an injected retry action',()=>{
  let retries=0;
  const elements=createElements();
  elements.delete('profileRecoveryRetry');
  const {module}=createModule({elements,onRetry:()=>{retries++;}});
  assert.doesNotThrow(()=>module.renderProfileAccessState('error','offline'));
  assert.match(elements.get('profileRecovery').innerHTML,/Профиль временно недоступен/);
  assert.equal(retries,0);
});
