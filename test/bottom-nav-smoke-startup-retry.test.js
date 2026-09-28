import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const script = fs.readFileSync('scripts/bottom-nav-render-smoke.js','utf8');

test('render smoke retries headless Chrome startup with a fresh profile', () => {
  assert.match(script, /async function launchChromeWithRetry\(executable, attempts = 3\)/);
  assert.match(script, /for \(let attempt = 1; attempt <= totalAttempts; attempt \+= 1\)/);
  assert.match(script, /matchradar-nav-render-\$\{attempt\}-/);
  assert.match(script, /waitForDevToolsPort\(profileDir, chrome, \(\) => stderrText, 120\)/);
  assert.match(script, /await stopChrome\(chrome\)/);
  assert.match(script, /250 \* attempt/);
});

test('render smoke cleans failed and successful Chrome profiles', () => {
  const retryStart = script.indexOf('async function launchChromeWithRetry');
  const mainStart = script.indexOf('async function main()', retryStart);
  assert.ok(retryStart >= 0 && mainStart > retryStart);
  const retryBlock = script.slice(retryStart, mainStart);
  assert.match(retryBlock, /fsp\.rm\(profileDir,[\s\S]*?maxRetries:5/);

  const mainBlock = script.slice(mainStart);
  assert.match(mainBlock, /if \(profileDir\)[\s\S]*?fsp\.rm\(profileDir/);
  assert.match(mainBlock, /launchChromeWithRetry\(browserExecutable\(\), 3\)/);
});


test('render smoke retries only transient Page.navigate network failures', () => {
  assert.match(script, /async function navigateWithRetry\(cdp, url, attempts = 3\)/);
  assert.match(script, /CONNECTION_CLOSED\|CONNECTION_RESET\|TIMED_OUT\|NETWORK_CHANGED\|HTTP2_PROTOCOL_ERROR/);
  assert.match(script, /if \(!isTransientNavigationError\(lastError\) \|\| attempt >= totalAttempts\) break/);
  assert.match(script, /250 \* attempt/);
  assert.match(script, /navigateWithRetry\(cdp, targetUrl, 3\)/);
});
