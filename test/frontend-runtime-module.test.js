import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLIENT_VERSION,
  CLIENT_API_CONTRACT,
  CLIENT_RELEASE_CHANNEL,
  FRONTEND_ASSET_REVISION,
  SUPABASE_SCHEMA_HINT,
  DEFAULT_UI_PREFERENCES,
  readUiPreferences,
} from '../public/modules/app-runtime.js';

const releaseContract = JSON.parse(readFileSync(new URL('../release-contract.json', import.meta.url), 'utf8'));

test('frontend runtime centralizes stable client identity', () => {
  assert.equal(CLIENT_VERSION, '6.120.0-rc144');
  assert.equal(CLIENT_API_CONTRACT, 5);
  assert.equal(CLIENT_RELEASE_CHANNEL, 'rc144');
  assert.equal(FRONTEND_ASSET_REVISION, '6.120.0-launch45');
  assert.match(SUPABASE_SCHEMA_HINT, /baseline v6\.19/);
  assert.ok(SUPABASE_SCHEMA_HINT.includes(`миграции до v${releaseContract.productionSchema}`));
});


test('UI preferences normalize persisted values and fail safe', () => {
  const good = {
    getItem() {
      return JSON.stringify({ theme:'ocean', accent:'violet', buttonStyle:'compact' });
    },
  };
  assert.deepEqual(readUiPreferences(good), {
    theme:'ocean',
    accent:'violet',
    buttonStyle:'compact',
  });

  const unsafe = {
    getItem() {
      return JSON.stringify({ theme:'unknown', accent:'pink', buttonStyle:'huge' });
    },
  };
  assert.deepEqual(readUiPreferences(unsafe), DEFAULT_UI_PREFERENCES);

  const broken = { getItem() { throw new Error('storage blocked'); } };
  assert.deepEqual(readUiPreferences(broken), DEFAULT_UI_PREFERENCES);
});
