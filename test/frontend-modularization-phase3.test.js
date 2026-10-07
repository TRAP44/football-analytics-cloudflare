import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  createApiClient,
  initTelegramWebApp,
} from '../public/modules/client-core.js';
import {
  adminProviderStylesheetHref,
  createAdminProviderModule,
  ensureAdminProviderStyles,
} from '../public/modules/admin-provider.js';
import { FRONTEND_ASSET_REVISION } from '../public/modules/app-runtime.js';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const client=fs.readFileSync('public/modules/client-core.js','utf8');
const admin=fs.readFileSync('public/modules/admin-provider.js','utf8');
const adminCss=fs.readFileSync('public/styles/admin.css','utf8');
const headers=fs.readFileSync('public/_headers','utf8');

function staticModuleSpecifiers(source) {
  const out=[];
  const re=/\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  let match;
  while ((match=re.exec(source))) out.push(match[1] || match[2]);
  return out;
}

function fakeDocument(existing=null) {
  let link=existing;
  let appendCount=0;
  return {
    querySelector(selector) {
      return selector==='link[data-admin-styles]' ? link : null;
    },
    createElement(tag) {
      assert.equal(tag,'link');
      return {dataset:{}};
    },
    head:{
      append(value) {
        appendCount+=1;
        link=value;
      },
    },
    get link() { return link; },
    get appendCount() { return appendCount; },
  };
}

function adminDeps(overrides={}) {
  return {
    document:fakeDocument(),
    state:{},
    $:()=>null,
    isAdmin:()=>true,
    humanizeTechnicalText:value=>String(value ?? ''),
    escapeHtml:value=>String(value ?? ''),
    planLabel:value=>String(value ?? ''),
    dateTime:value=>String(value ?? ''),
    technicalStateLabel:value=>String(value ?? ''),
    freshnessSourceLabel:value=>String(value ?? ''),
    toast:()=>{},
    api:async()=>({}),
    renderAdminOverview:()=>{},
    ...overrides,
  };
}

test('Phase 3 keeps public client transport statically separated from admin code',()=>{
  const imports=staticModuleSpecifiers(app);
  assert.ok(imports.includes('./modules/client-core.js'));
  assert.equal(imports.includes('./modules/admin-provider.js'),false);
  assert.match(app,/import\('\.\/modules\/admin-provider\.js'\)/);

  assert.equal(typeof createApiClient,'function');
  assert.doesNotMatch(
    client,
    /\/api\/provider|admin-provider|styles\/admin\.css/,
  );
});

test('Telegram bootstrap tolerates partial and hostile SDK objects',()=>{
  const calls=[];
  const tg={
    ready(){calls.push('ready');},
    expand(){calls.push('expand'); throw new Error('expand unavailable');},
    setHeaderColor(value){calls.push(['header',value]);},
  };

  assert.equal(
    initTelegramWebApp({Telegram:{WebApp:tg}}),
    tg,
  );
  assert.deepEqual(calls,[
    'ready',
    'expand',
    ['header','secondary_bg_color'],
  ]);

  const partial={ready(){calls.push('partial-ready');}};
  assert.doesNotThrow(
    ()=>initTelegramWebApp({Telegram:{WebApp:partial}}),
  );
  assert.equal(initTelegramWebApp({Telegram:{}}),null);

  const hostile={};
  Object.defineProperty(hostile,'Telegram',{
    get(){throw new Error('hostile Telegram getter');},
  });
  assert.doesNotThrow(()=>initTelegramWebApp(hostile));
  assert.equal(initTelegramWebApp(hostile),null);
});

test('admin provider stylesheet always uses the shared frontend revision',()=>{
  assert.equal(
    adminProviderStylesheetHref(),
    '/styles/admin.css?v='+FRONTEND_ASSET_REVISION,
  );
  assert.throws(
    ()=>adminProviderStylesheetHref('6.120.0'),
    /revision is invalid/,
  );

  const documentObject=fakeDocument();
  const link=ensureAdminProviderStyles(documentObject);
  assert.equal(documentObject.appendCount,1);
  assert.equal(link.rel,'stylesheet');
  assert.equal(
    link.href,
    '/styles/admin.css?v='+FRONTEND_ASSET_REVISION,
  );
  assert.equal(link.dataset.adminStyles,'true');

  const same=ensureAdminProviderStyles(documentObject);
  assert.equal(same,link);
  assert.equal(documentObject.appendCount,1);
});

test('existing stale admin stylesheet is repaired rather than duplicated',()=>{
  const existing={
    rel:'stylesheet',
    href:'/styles/admin.css?v=old',
    dataset:{adminStyles:'true'},
  };
  const documentObject=fakeDocument(existing);

  const link=ensureAdminProviderStyles(documentObject);

  assert.equal(link,existing);
  assert.equal(documentObject.appendCount,0);
  assert.equal(
    link.href,
    '/styles/admin.css?v='+FRONTEND_ASSET_REVISION,
  );
});

test('admin module mounts admin CSS only for authenticated admin context',()=>{
  const publicDocument=fakeDocument();
  const publicModule=createAdminProviderModule(adminDeps({
    document:publicDocument,
    isAdmin:()=>false,
  }));
  assert.equal(Object.isFrozen(publicModule),true);
  assert.equal(publicDocument.appendCount,0);

  const adminDocument=fakeDocument();
  const adminModule=createAdminProviderModule(adminDeps({
    document:adminDocument,
    isAdmin:()=>true,
  }));
  assert.equal(Object.isFrozen(adminModule),true);
  assert.equal(adminDocument.appendCount,1);
});

test('admin module rejects incomplete composition instead of failing later in render paths',()=>{
  const deps=adminDeps();
  for (const key of [
    '$',
    'isAdmin',
    'humanizeTechnicalText',
    'escapeHtml',
    'planLabel',
    'dateTime',
    'technicalStateLabel',
    'freshnessSourceLabel',
    'toast',
    'api',
    'renderAdminOverview',
  ]) {
    assert.throws(
      ()=>createAdminProviderModule({...deps,[key]:null}),
      /requires state and explicit UI\/API dependencies/,
      key,
    );
  }
});

test('public HTML does not eagerly load admin provider code or admin stylesheet',()=>{
  assert.doesNotMatch(html,/admin-provider\.js/);
  assert.doesNotMatch(html,/\/styles\/admin\.css/);

  assert.match(admin,/FRONTEND_ASSET_REVISION/);
  assert.match(admin,/\/styles\/admin\.css\?v=/);
  assert.match(adminCss,/admin-zone-heading/);
  assert.match(
    headers,
    /\/styles\/admin\.css\n\s+Cache-Control: public, max-age=31536000, immutable/,
  );
});

test('public bottom navigation exposes only product destinations',()=>{
  const start=html.indexOf('<nav class="bottom-nav"');
  const end=html.indexOf('</nav>',start);
  assert.ok(start>=0 && end>start);
  const nav=html.slice(start,end);

  for (const id of [
    'navMatches',
    'navMyTeams',
    'navHistory',
    'navProfile',
  ]) {
    assert.match(nav,new RegExp('id="'+id+'"'));
  }
  assert.doesNotMatch(
    nav,
    /admin|provider|runtime|release|diagnostic/i,
  );
});
