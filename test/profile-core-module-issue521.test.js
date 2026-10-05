import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProfileCoreModule } from '../public/modules/profile-core.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('profile core module exposes extracted contract',()=>{
  assert.equal(typeof createProfileCoreModule,'function');
  const module=createProfileCoreModule({});
  for(const name of [
    'loadProfile',
    'isAdmin',
    'ensureAdminBillingRefundModule',
    'renderAdminBillingRefund',
    'loadAdminBillingRefund',
    'ensureAdminBetaDashboardModule',
    'renderBetaDashboard',
    'loadBetaDashboard',
    'ensureBetaFeedbackModule',
    'setBetaFeedbackOpen',
    'submitBetaFeedback',
    'ensureAdminOverviewModule',
    'renderAdminOverview',
    'applyAdminVisibility',
    'organizeAdminConsole',
    'loadAdvancedAdminTools',
    'planLabel',
    'technicalStateLabel',
    'humanizeTechnicalText',
    'publicText',
    'dataPolicyModeLabel',
    'calibrationModeLabel',
    'predictionAdviceLabel',
    'renderProfile',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes profile core instead of keeping it inline',()=>{
  assert.match(app,/import \{ createProfileCoreModule \} from '\.\/modules\/profile-core\.js'/);
  assert.match(app,/createProfileCoreModule\(\{/);
  assert.doesNotMatch(app,/async function loadProfile\(\) \{/);
  assert.doesNotMatch(app,/function renderProfile\(\) \{/);
  assert.doesNotMatch(app,/async function loadAdvancedAdminTools\(\) \{/);
});
