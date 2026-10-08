import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker=fs.readFileSync('src/worker.js','utf8');
const searchRuntime=fs.readFileSync('src/telegram-search-runtime.js','utf8');
const botUiRuntime=fs.readFileSync('src/telegram-bot-ui-runtime.js','utf8');
const botOrchestrationRuntime=fs.readFileSync('src/telegram-bot-orchestration-runtime.js','utf8');

test('Telegram HTML sanitizer is safe for both text and quoted attributes', () => {
  const start=searchRuntime.indexOf("function telegramHtmlEscape");
  const end=searchRuntime.indexOf("function botSearchParts",start);
  assert.notEqual(start,-1);
  assert.notEqual(end,-1);
  const block=searchRuntime.slice(start,end);
  assert.match(block,/replace\(\/&\/g,'&amp;'\)/);
  assert.match(block,/replace\(\/<\/g,'&lt;'\)/);
  assert.match(block,/replace\(\/>\/g,'&gt;'\)/);
  assert.match(block,/replace\(\/"\/g,'&quot;'\)/);
  assert.match(block,/replace\(\/'\/g,'&#39;'\)/);
});

test('Telegram legal links keep URL output behind the complete HTML sanitizer', () => {
  const telegram=botUiRuntime+'\n'+botOrchestrationRuntime;
  assert.match(telegram,/function publicSiteUrl\(/);
  // The current bot renders legal links from a fixed page allow-list.
  // Verify URLs are generated safely and HTML attributes are escaped.
  for (const page of ['/privacy.html','/terms.html','/status.html']) {
    assert.ok(telegram.includes(`'${page}'`),`missing safe page ${page}`);
  }
  assert.match(telegram,/generatedHttpUrl\(publicSiteUrl,request,path\)/);
  assert.match(telegram,/href="\$\{escapeHtml\(url,2000\)\}"/);
});
