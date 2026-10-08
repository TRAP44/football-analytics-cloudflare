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
});

test('API security headers keep framing and cross-origin isolation fail-closed',()=>{
  assert.equal(API_SECURITY_HEADERS['x-frame-options'],'DENY');
  assert.equal(API_SECURITY_HEADERS['cross-origin-opener-policy'],'same-origin');
  assert.equal(API_SECURITY_HEADERS['cross-origin-resource-policy'],'same-origin');
  assert.match(API_SECURITY_HEADERS['content-security-policy'],/default-src 'none'/);
  assert.match(API_SECURITY_HEADERS['content-security-policy'],/frame-ancestors 'none'/);
  assert.doesNotMatch(API_SECURITY_HEADERS['content-security-policy'],/'unsafe-inline'|'unsafe-eval'/);
  assert.equal(API_SECURITY_HEADERS['strict-transport-security'],'max-age=31536000');
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
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(
    response.headers.get('content-security-policy'),
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('API header factory isolates changes without weakening immutable defaults',()=>{
  assert.equal(Object.isFrozen(API_SECURITY_HEADERS),true);
  const first=apiSecurityHeaders();
  const second=apiSecurityHeaders();
  assert.notEqual(first,second);
  first['x-frame-options']='ALLOWALL';
  first['content-security-policy']="default-src *";
  assert.equal(second['x-frame-options'],'DENY');
  assert.match(second['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal(API_SECURITY_HEADERS['x-frame-options'],'DENY');
  assert.equal(API_SECURITY_HEADERS['permissions-policy'],'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
});
