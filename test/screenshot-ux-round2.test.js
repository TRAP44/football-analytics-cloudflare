import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const notifications = fs.readFileSync('public/modules/smart-notifications.js', 'utf8');
const premium = fs.readFileSync('public/styles/premium-ui.css', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');

test('match card AI CTA owns the full primary action row', () => {
  assert.match(app, /match-card-actions compact-actions single/);
  assert.match(premium, /\\.compact-actions \\{[\\s\\S]*grid-template-columns:\\s*minmax\\(0, 1fr\\)/);
  assert.match(premium, /\.compact-actions \.analyze-btn\{[\s\S]*width:100%/);
});

test('profile removes redundant PRO CTA technical data drawer and status link', () => {
  assert.doesNotMatch(notifications, /smartNotificationsUpgradeBtn/);
  assert.doesNotMatch(notifications, /Посмотреть PRO/);
  assert.doesNotMatch(html, /profile-data-details/);
  assert.doesNotMatch(html, /href="\/status\.html"/);
});

test('analysis tie states do not claim a single winner and old cached analyses are guarded client-side', () => {
  assert.match(worker, /rows\[0\]\.value - rows\[1\]\.value < 1/);
  assert.match(worker, /Нет явного фаворита/);
  assert.match(app, /function likelyOutcomeDisplay/);
  assert.match(app, /rows\[0\] - rows\[1\] < 1/);
  assert.match(app, /likelyOutcomeDisplay\(p, d\.likelyOutcome\)/);
});

test('analysis favorite buttons use explicit compact favorite state and no return-to-Telegram CTA', () => {
  assert.match(app, /analysis-favorite-star/);
  assert.match(app, /analysis-favorite-copy/);
  assert.match(app, /В избранном/);
  assert.doesNotMatch(app, /returnToTelegramBtn/);
  assert.match(premium, /\.analysis-favorite-btn\.secondary-btn/);
});
