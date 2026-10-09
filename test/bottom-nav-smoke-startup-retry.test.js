import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  chromeProxyArguments,
  isTransientNavigationError,
  launchChromeWithRetry,
  navigateWithRetry,
  normalizeRetryAttempts,
} from '../scripts/bottom-nav-render-smoke.js';

function fakeChrome() {
  const chrome = new EventEmitter();
  chrome.exitCode = null;
  chrome.stderr = {
    setEncoding() {},
    on() {},
  };
  return chrome;
}

test('retry attempt normalization is bounded and rejects ambiguous values', () => {
  assert.equal(normalizeRetryAttempts(undefined, 3), 3);
  assert.equal(normalizeRetryAttempts(1, 3), 1);
  assert.equal(normalizeRetryAttempts(2, 3), 2);
  assert.equal(normalizeRetryAttempts(99, 3), 3);
  assert.equal(normalizeRetryAttempts(0, 3), 3);
  assert.equal(normalizeRetryAttempts(-1, 3), 3);
  assert.equal(normalizeRetryAttempts(2.5, 3), 3);
  assert.equal(normalizeRetryAttempts('garbage', 3), 3);
});

test('Chrome startup retry uses a fresh profile and cleans every failed attempt', async () => {
  const createdProfiles = [];
  const removedProfiles = [];
  const stopped = [];
  const sleeps = [];
  const spawnCalls = [];
  let waits = 0;

  const result = await launchChromeWithRetry('/fake/chrome', 3, {
    makeTempDir: async prefix => {
      const profile = `/tmp/test-profile-${createdProfiles.length + 1}`;
      createdProfiles.push({ prefix, profile });
      return profile;
    },
    spawnProcess: (executable, args, options) => {
      const chrome = fakeChrome();
      spawnCalls.push({ executable, args, options, chrome });
      return chrome;
    },
    waitForPort: async profileDir => {
      waits += 1;
      if (waits < 3) throw new Error(`startup failed for ${profileDir}`);
      return 9222;
    },
    stopProcess: async chrome => {
      stopped.push(chrome);
    },
    removeProfile: async profileDir => {
      removedProfiles.push(profileDir);
    },
    sleep: async ms => {
      sleeps.push(ms);
    },
  });

  assert.equal(result.debugPort, 9222);
  assert.equal(result.profileDir, '/tmp/test-profile-3');
  assert.equal(spawnCalls.length, 3);
  assert.equal(stopped.length, 2);
  assert.deepEqual(removedProfiles, ['/tmp/test-profile-1', '/tmp/test-profile-2']);
  assert.deepEqual(sleeps, [250, 500]);

  const userDataDirs = spawnCalls.map(call =>
    call.args.find(arg => String(arg).startsWith('--user-data-dir='))
  );
  assert.deepEqual(userDataDirs, [
    '--user-data-dir=/tmp/test-profile-1',
    '--user-data-dir=/tmp/test-profile-2',
    '--user-data-dir=/tmp/test-profile-3',
  ]);
  assert.equal(new Set(userDataDirs).size, 3);
  assert.ok(createdProfiles.every(item => item.prefix.includes('matchradar-nav-render-')));
});

test('Chrome startup retries continue even when failed-attempt cleanup itself errors', async () => {
  let attempts = 0;
  let cleanupAttempts = 0;

  const result = await launchChromeWithRetry('/fake/chrome', 2, {
    makeTempDir: async () => `/tmp/cleanup-profile-${attempts + 1}`,
    spawnProcess: () => {
      attempts += 1;
      return fakeChrome();
    },
    waitForPort: async () => {
      if (attempts === 1) throw new Error('first startup failed');
      return 9333;
    },
    stopProcess: async () => {
      cleanupAttempts += 1;
      throw new Error('stop failed');
    },
    removeProfile: async () => {
      cleanupAttempts += 1;
      throw new Error('remove failed');
    },
    sleep: async () => {},
  });

  assert.equal(attempts, 2);
  assert.equal(result.debugPort, 9333);
  assert.equal(cleanupAttempts, 2);
});

test('Chrome startup failure is bounded to three attempts and reports the last failure', async () => {
  let attempts = 0;
  const removed = [];
  const sleeps = [];

  await assert.rejects(
    () => launchChromeWithRetry('/fake/chrome', 99, {
      makeTempDir: async () => `/tmp/fail-profile-${attempts + 1}`,
      spawnProcess: () => {
        attempts += 1;
        return fakeChrome();
      },
      waitForPort: async () => {
        throw new Error(`failure-${attempts}`);
      },
      stopProcess: async () => {},
      removeProfile: async profileDir => {
        removed.push(profileDir);
      },
      sleep: async ms => {
        sleeps.push(ms);
      },
    }),
    /Chrome startup failed after 3 attempts: failure-3/,
  );

  assert.equal(attempts, 3);
  assert.equal(removed.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
});

test('navigation retry accepts only the known transient Chrome network errors', () => {
  for (const code of [
    'net::ERR_CONNECTION_CLOSED',
    'net::ERR_CONNECTION_RESET',
    'net::ERR_TIMED_OUT',
    'net::ERR_NETWORK_CHANGED',
    'net::ERR_HTTP2_PROTOCOL_ERROR',
  ]) {
    assert.equal(isTransientNavigationError(code), true, code);
    assert.equal(isTransientNavigationError(`  ${code}  `), true, `trimmed ${code}`);
  }

  for (const code of [
    '',
    'net::ERR_ABORTED',
    'net::ERR_NAME_NOT_RESOLVED',
    'HTTP 500',
    'CONNECTION_RESET',
  ]) {
    assert.equal(isTransientNavigationError(code), false, code || '(empty)');
  }
});

test('Page.navigate retries transient response failures with bounded backoff', async () => {
  const calls = [];
  const sleeps = [];
  const responses = [
    { errorText: 'net::ERR_CONNECTION_RESET' },
    { errorText: 'net::ERR_TIMED_OUT' },
    { frameId: 'frame-ok' },
  ];
  const cdp = {
    call: async (method, params) => {
      calls.push({ method, params });
      return responses.shift();
    },
  };

  const result = await navigateWithRetry(cdp, 'https://example.test/', 3, async ms => {
    sleeps.push(ms);
  });

  assert.deepEqual(result, { frameId: 'frame-ok' });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.method), ['Page.navigate', 'Page.navigate', 'Page.navigate']);
  assert.deepEqual(calls.map(call => call.params.url), [
    'https://example.test/',
    'https://example.test/',
    'https://example.test/',
  ]);
  assert.deepEqual(sleeps, [250, 500]);
});

test('Page.navigate also retries a thrown transient network error', async () => {
  let calls = 0;
  const sleeps = [];
  const cdp = {
    call: async () => {
      calls += 1;
      if (calls === 1) throw new Error('net::ERR_NETWORK_CHANGED');
      return { frameId: 'recovered' };
    },
  };

  const result = await navigateWithRetry(cdp, 'https://example.test/', 3, async ms => {
    sleeps.push(ms);
  });

  assert.deepEqual(result, { frameId: 'recovered' });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [250]);
});

test('Page.navigate does not retry non-transient errors', async () => {
  let calls = 0;
  let sleeps = 0;
  const cdp = {
    call: async () => {
      calls += 1;
      return { errorText: 'net::ERR_NAME_NOT_RESOLVED' };
    },
  };

  await assert.rejects(
    () => navigateWithRetry(cdp, 'https://example.test/', 3, async () => {
      sleeps += 1;
    }),
    /Page\.navigate failed after 3 attempt\(s\): net::ERR_NAME_NOT_RESOLVED/,
  );

  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test('render smoke main path still cleans the successful profile and uses retry helpers', () => {
  const script = readFileSync(new URL('../scripts/bottom-nav-render-smoke.js', import.meta.url), 'utf8');
  const mainStart = script.indexOf('async function main()');
  assert.ok(mainStart >= 0);
  const main = script.slice(mainStart);

  assert.match(main, /launchChromeWithRetry\(browserExecutable\(\), 3\)/);
  assert.match(main, /navigateForExpectedRevision\(cdp, targetUrl, Boolean\(remoteUrl\)\)/);
  assert.match(main, /if \(profileDir\)[\s\S]*?fsp\.rm\(profileDir/);
  assert.doesNotMatch(script, /spawnSync\('sh'/);
});


test('browser proxy is explicit and preserves TLS verification',()=>{
  assert.deepEqual(chromeProxyArguments(),['--no-proxy-server']);
  assert.deepEqual(chromeProxyArguments('http://proxy.example:8080'),['--proxy-server=http://proxy.example:8080']);
  assert.deepEqual(chromeProxyArguments('https://proxy.example'),['--proxy-server=https://proxy.example']);
  for (const value of ['bad','socks5://proxy.example','http://user:password@proxy.example','http://proxy.example/path','http://proxy.example?token=x','http://proxy.example#fragment']) {
    assert.throws(()=>chromeProxyArguments(value),/CHROME_PROXY_SERVER/);
  }
});
