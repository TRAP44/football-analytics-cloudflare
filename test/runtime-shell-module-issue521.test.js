import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRuntimeShellModule } from '../public/modules/runtime-shell.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('runtime shell module exposes extracted contract',()=>{
  assert.equal(typeof createRuntimeShellModule,'function');
  const module=createRuntimeShellModule({});
  for(const name of [
    'syncBootVersion',
    'stopLiveRefresh',
    'deactivateLiveRefresh',
    'suspendLiveRefresh',
    'resumeLiveRefresh',
    'viewBackTarget',
    'toast',
    'apiErrorCategory',
    'friendlyErrorMessage',
    'normalizeApiError',
    'telemetryViewName',
    'sendClientTelemetry',
    'sendProductAction',
    'sendActionError',
    'sendOperationTiming',
    'sendMatchDataCoverage',
    'setNetworkMode',
    'noteRequestSuccess',
    'noteRequestFailure',
    'recoveryCardHtml',
    'bindCooldownRetry',
    'recoverActiveView',
    'versionTuple',
    'compareVersions',
    'forceFreshReload',
    'renderVersionCompatibility',
    'evaluateCompatibility',
    'observeServerVersion',
    'loadAppManifest',
    'runtimeAllows',
    'runtimeDisabledLabels',
    'applyRuntimeUi',
    'loadRuntimeStatus',
    'setBootStatus',
    'hideBootGate',
    'showBootRecovery',
    'runStartupSequence',
    'ensureMatchCenterController',
    'ensureAnalysisController',
    'ensureDigestSettingsModule',
    'renderDigestSettings',
    'loadDigestSettings',
    'ensureSmartNotificationsModule',
    'renderSmartNotifications',
    'loadSmartNotifications',
    'ensureMatchCenterExtras',
  ]) {
    assert.equal(typeof module[name],'function', name);
  }
});

test('public app composes runtime shell instead of keeping it inline',()=>{
  assert.match(app,/import \{ createRuntimeShellModule \} from '\.\/modules\/runtime-shell\.js'/);
  assert.match(app,/createRuntimeShellModule\(\{/);
  assert.doesNotMatch(app,/function syncBootVersion\(\) \{/);
  assert.doesNotMatch(app,/async function runStartupSequence\(\) \{/);
  assert.doesNotMatch(app,/async function ensureMatchCenterExtras\(\) \{/);
});
