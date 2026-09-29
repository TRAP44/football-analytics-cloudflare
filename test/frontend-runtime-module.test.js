import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_VERSION,
  CLIENT_API_CONTRACT,
  CLIENT_RELEASE_CHANNEL,
  DEFAULT_UI_PREFERENCES,
  appSurface,
  readUiPreferences,
} from '../public/modules/app-runtime.js';

test('frontend runtime centralizes stable client identity', () => {
  assert.equal(CLIENT_VERSION, '6.120.0-rc144');
  assert.equal(CLIENT_API_CONTRACT, 5);
  assert.equal(CLIENT_RELEASE_CHANNEL, 'rc144');
});

test('surface detection defaults public and recognizes dedicated admin meta', () => {
  const doc = value => ({
    querySelector() {
      return value === null ? null : { content: value };
    },
  });
  assert.equal(appSurface(doc('admin')), 'admin');
  assert.equal(appSurface(doc('public')), 'public');
  assert.equal(appSurface(doc(null)), 'public');
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
