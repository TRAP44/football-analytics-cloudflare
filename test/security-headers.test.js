import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/worker.js';
import { API_SECURITY_HEADERS, apiSecurityHeaders } from '../src/security-headers.js';

const staticHeaders = fs.readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

test('static assets receive a Telegram-compatible restrictive CSP', () => {
  assert.match(staticHeaders, /Content-Security-Policy:/);
  assert.match(staticHeaders, /script-src 'self' https:\/\/telegram\.org/);
  assert.match(staticHeaders, /connect-src 'self'/);
  assert.match(staticHeaders, /object-src 'none'/);
  assert.match(staticHeaders, /base-uri 'none'/);
  assert.match(staticHeaders, /frame-ancestors 'self' https:\/\/web\.telegram\.org https:\/\/\*\.telegram\.org/);
  assert.match(staticHeaders, /Strict-Transport-Security: max-age=31536000/);
  assert.doesNotMatch(staticHeaders, /script-src[^\n;]*'unsafe-inline'/);
  assert.match(staticHeaders, /style-src 'self'/);
  assert.doesNotMatch(staticHeaders, /style-src[^\n;]*'unsafe-inline'/);
});

test('public frontend contains no inline style attributes or runtime style mutations', () => {
  const roots=[
    new URL('../public/app.js',import.meta.url),
    new URL('../public/status.js',import.meta.url),
    new URL('../public/index.html',import.meta.url),
    new URL('../public/admin.html',import.meta.url),
    new URL('../public/status.html',import.meta.url),
    new URL('../public/privacy.html',import.meta.url),
    new URL('../public/terms.html',import.meta.url),
  ];
  const moduleDir=new URL('../public/modules/',import.meta.url);
  const moduleFiles=fs.readdirSync(moduleDir)
    .filter(name=>name.endsWith('.js'))
    .map(name=>new URL(name,moduleDir));
  for (const file of [...roots,...moduleFiles]) {
    const source=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(source,/\\sstyle\\s*=/i,String(file));
    assert.doesNotMatch(source,/\\.style\\./,String(file));
    assert.doesNotMatch(source,/style\\.cssText/,String(file));
    assert.doesNotMatch(source,/setAttribute\\(\\s*['"]style['"]/,String(file));
  }
});

test('security header factory returns an isolated copy', () => {
  const headers = apiSecurityHeaders();
  headers['referrer-policy'] = 'unsafe-url';
  assert.equal(API_SECURITY_HEADERS['referrer-policy'], 'no-referrer');
});

test('Worker JSON responses include API security headers without permissive CORS', async () => {
  const response = await worker.fetch(new Request('https://football.example.test/health/live'), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
