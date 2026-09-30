import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const mediaPublisher = readFileSync(new URL('../public/modules/admin-media-publisher.js', import.meta.url), 'utf8');

test('media publisher implementation lives outside the shared app root', () => {
  assert.match(mediaPublisher, /export function createAdminMediaPublisherModule/);
  assert.match(mediaPublisher, /async function generateMediaPublisherLink\(\)/);
  assert.match(mediaPublisher, /async function copyMediaPublisherPost\(\)/);
  assert.match(mediaPublisher, /\/api\/media-publisher-link/);
  assert.doesNotMatch(app, /let mediaPublisherPayload = null/);
  assert.doesNotMatch(app, /Создаю ссылку и текст публикации/);
});

test('shared app root lazy-loads media publisher only for admins', () => {
  const start = app.indexOf('async function ensureAdminMediaPublisherModule()');
  const end = app.indexOf('\nfunction launchFunnelPct', start);
  assert.ok(start >= 0 && end > start);
  const boundary = app.slice(start, end);
  assert.match(boundary, /if \(!isAdmin\(\)\) return null/);
  assert.match(boundary, /import\('\.\/modules\/admin-media-publisher\.js'\)/);
  assert.match(boundary, /generateMediaPublisherLink/);
  assert.match(boundary, /copyMediaPublisherPost/);
});
