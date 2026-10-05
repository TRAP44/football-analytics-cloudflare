import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');

test('admin.html remains structural and delegates application behavior to modules',()=>{
  assert.ok(html.length < 65_000, `admin.html should stay below 65k chars, got ${html.length}`);
  assert.doesNotMatch(html,/\son(?:click|change|input|submit|keydown|keyup|load|toggle)\s*=/i);
  assert.doesNotMatch(html,/javascript:/i);

  const scriptTags=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scriptTags.length >= 1);
  for (const [, attrs, body] of scriptTags) {
    assert.match(attrs,/\bsrc\s*=\s*["'][^"']+["']/i);
    assert.equal(body.trim(),'');
  }
  assert.match(html,/type=["']module["'][^>]*src=["']\/app\.js\?v=/i);
});
