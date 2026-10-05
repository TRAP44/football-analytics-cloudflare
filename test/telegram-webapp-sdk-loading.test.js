import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicHtml = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');
const staticHeaders = fs.readFileSync('public/_headers', 'utf8');
const decision = fs.readFileSync('docs/security-telegram-webapp-sdk.md', 'utf8');

const sdkTag = '<script src="https://telegram.org/js/telegram-web-app.js?63"></script>';

test('public and admin surfaces use the same official Telegram Web App SDK contract', () => {
  assert.equal((publicHtml.match(/https:\/\/telegram\.org\/js\/telegram-web-app\.js\?63/g) || []).length, 1);
  assert.equal((adminHtml.match(/https:\/\/telegram\.org\/js\/telegram-web-app\.js\?63/g) || []).length, 1);
  assert.ok(publicHtml.includes(sdkTag));
  assert.ok(adminHtml.includes(sdkTag));
  assert.doesNotMatch(publicHtml, /telegram-web-app\.js[^>]+integrity=/i);
  assert.doesNotMatch(adminHtml, /telegram-web-app\.js[^>]+integrity=/i);
});

test('CSP limits external scripts to the Telegram origin and the decision is documented', () => {
  assert.match(staticHeaders, /script-src 'self' https:\/\/telegram\.org;/);
  assert.doesNotMatch(staticHeaders, /script-src[^\n]*https:\/\/\*\.telegram\.org/);
  assert.match(decision, /does \*\*not\*\* attach a static Subresource Integrity hash/);
  assert.match(decision, /https:\/\/telegram\.org\/js\/telegram-web-app\.js\?63/);
});
