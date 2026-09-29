import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('public/styles.css', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const adminHtml = fs.readFileSync('public/admin.html', 'utf8');

test('hidden attribute cannot be overridden by component display styles', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/i);
});

test('admin badge starts hidden and is gated by server role flags', () => {
  assert.match(adminHtml, /id="adminRoleBadge"[^>]*\shidden(?:\s|>)/i);
  assert.match(app, /state\.profile\?\.features\?\.isAdmin\s*===\s*true/);
  assert.match(app, /state\.profile\?\.features\?\.role\s*===\s*['"]admin['"]/);
  assert.match(app, /badge\.hidden\s*=\s*!admin/);
  assert.match(app, /el\.toggleAttribute\(['"]inert['"],\s*!admin\)/);
});

test('admin-only blocks fail closed in the DOM', () => {
  assert.match(css, /\[data-admin-only\]\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/i);
  assert.match(css, /\[data-admin-only\]\[aria-hidden="true"\]/i);
});
