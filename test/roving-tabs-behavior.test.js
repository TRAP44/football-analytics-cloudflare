import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindRovingTabKeyboard,
  nextRovingTabIndex,
} from '../public/modules/roving-tabs.js';

test('nextRovingTabIndex wraps and supports Home/End', () => {
  assert.equal(nextRovingTabIndex(0, 'ArrowRight', 3), 1);
  assert.equal(nextRovingTabIndex(2, 'ArrowRight', 3), 0);
  assert.equal(nextRovingTabIndex(0, 'ArrowLeft', 3), 2);
  assert.equal(nextRovingTabIndex(1, 'Home', 3), 0);
  assert.equal(nextRovingTabIndex(1, 'End', 3), 2);
  assert.equal(nextRovingTabIndex(1, 'Enter', 3), 1);
});

function fakeTab(value, key = 'tab') {
  const handlers = new Map();
  return {
    dataset: { [key]: value },
    focused: false,
    addEventListener(type, handler) { handlers.set(type, handler); },
    dispatchKey(eventKey) {
      let prevented = false;
      handlers.get('keydown')?.({
        key: eventKey,
        preventDefault() { prevented = true; },
      });
      return prevented;
    },
    focus() { this.focused = true; },
  };
}

test('bindRovingTabKeyboard activates and focuses the next tab', () => {
  const tabs = [fakeTab('first'), fakeTab('second'), fakeTab('third')];
  const activated = [];
  bindRovingTabKeyboard(tabs, 'tab', value => activated.push(value));

  assert.equal(tabs[0].dispatchKey('ArrowRight'), true);
  assert.deepEqual(activated, ['second']);
  assert.equal(tabs[1].focused, true);

  assert.equal(tabs[2].dispatchKey('ArrowRight'), true);
  assert.deepEqual(activated, ['second', 'first']);
  assert.equal(tabs[0].focused, true);
});

test('non-navigation keys do not alter activation or focus', () => {
  const tabs = [fakeTab('first'), fakeTab('second')];
  const activated = [];
  bindRovingTabKeyboard(tabs, 'tab', value => activated.push(value));

  assert.equal(tabs[0].dispatchKey('Enter'), false);
  assert.deepEqual(activated, []);
  assert.equal(tabs[0].focused, false);
  assert.equal(tabs[1].focused, false);
});
