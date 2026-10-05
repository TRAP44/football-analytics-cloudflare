import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindAppEvents } from '../public/modules/app-events.js';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('app event bindings module exposes binder',()=>{
  assert.equal(typeof bindAppEvents,'function');
});

test('public app delegates DOM/event bindings to app-events module',()=>{
  assert.match(app,/import \{ bindAppEvents \} from '\.\/modules\/app-events\.js'/);
  assert.match(app,/bindAppEvents\(\{/);
  assert.doesNotMatch(app,/const imageObserver = new MutationObserver/);
  assert.doesNotMatch(app,/document\.querySelectorAll\('\.date-btn'\)\.forEach/);
  assert.doesNotMatch(app,/\$\('providerProbeBtn'\)\?\.addEventListener/);
});
