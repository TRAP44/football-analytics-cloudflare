import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const client=fs.readFileSync('public/modules/client-core.js','utf8');
const admin=fs.readFileSync('public/modules/admin-provider.js','utf8');
const baseCss=fs.readFileSync('public/styles.css','utf8');
const publicCss=fs.readFileSync('public/styles/public-shell.css','utf8');
const adminCss=fs.readFileSync('public/styles/admin.css','utf8');

test('Phase 3 keeps public client transport in a dedicated module',()=>{
  assert.match(app,/from '.\/modules\/client-core\.js'/);
  assert.match(client,/export function initTelegramWebApp/);
  assert.match(client,/export function createApiClient/);
  assert.match(client,/x-telegram-init-data/);
  assert.match(client,/inflightGetRequests/);
});

test('Phase 3 lazy-loads admin provider diagnostics only for authenticated admin UI',()=>{
  assert.match(app,/if \(!isAdmin\(\)\) return null;/);
  assert.match(app,/import\('\.\/modules\/admin-provider\.js'\)/);
  assert.doesNotMatch(html,/admin-provider\.js/);
  assert.match(admin,/createAdminProviderModule/);
  assert.match(admin,/\/api\/provider/);
  assert.match(admin,/\/api\/provider\/coverage-audit/);
  assert.match(admin,/\/api\/provider\/e2e-validation/);
});

test('Phase 3 keeps admin stylesheet out of the public HTML load path',()=>{
  assert.match(html,/\/styles\.css\?v=6\.120\.0/);
  assert.match(html,/\/styles\/public-shell\.css\?v=6\.120\.0/);
  assert.doesNotMatch(html,/\/styles\/admin\.css/);
  assert.match(admin,/\/styles\/admin\.css\?v=6\.120\.0/);
  assert.ok(baseCss.length>100000);
  assert.ok(publicCss.length>10000);
  assert.match(adminCss,/admin-zone-heading/);
});

test('Phase 3 admin boundary remains intact after Phase 4 public navigation',()=>{
  assert.match(html,/Мои команды/);
  assert.match(html,/id="navMatches"/);
  assert.match(html,/id="navMyTeams"/);
  assert.match(html,/id="navHistory"/);
  assert.match(html,/id="navProfile"/);
  assert.doesNotMatch(html.slice(html.indexOf('<nav class="bottom-nav"'),html.indexOf('</nav>',html.indexOf('<nav class="bottom-nav"'))),/admin|provider|runtime|release/i);
});
