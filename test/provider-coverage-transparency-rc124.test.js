import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync('public/app.js','utf8');
const css=fs.readFileSync('public/styles.css','utf8');

test('RC124 analysis explains provider feature coverage to users',()=>{
  assert.match(app,/function providerCoverageHtml\(reliability = \{\}\)/);
  for (const label of ['Травмы','Составы','Коэффициенты','Прогноз API','Очные встречи']) assert.ok(app.includes(label));
  assert.match(app,/providerCoverageHtml\(d\.providerReliability \|\| d\.dataPolicy\?\.reliability \|\| \{\}\)/);
});

test('RC124 distinguishes plan limits from empty and delayed provider data',()=>{
  assert.match(app,/plan_limited:\['!','Недоступно на текущем тарифе источника'\]/);
  assert.match(app,/empty_response:\['○','Источник вернул пустой ответ'\]/);
  assert.match(app,/skipped:\['○','Запрос отложен'\]/);
  assert.match(app,/rate_limited:\['!','Лимит запросов'\]/);
});

test('RC124 exposes reliability trust cap without inventing missing data',()=>{
  assert.match(app,/доверие ≤/);
  assert.match(app,/AI использует только подтверждённые сигналы/);
  assert.match(css,/\/\* provider coverage transparency \*\//);
  assert.match(css,/provider-coverage-row\.degraded/);
});



function renderProviderCoverageForTest(input){
  const begin=app.indexOf('function providerCoverageHtml(');
  const end=app.indexOf('\nconst SCENARIO_BETTING_TEXT',begin);
  assert.ok(begin>=0 && end>begin);
  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
  }[ch]));
  const render=new Function('escapeHtml','publicText',app.slice(begin,end)+'\nreturn providerCoverageHtml;')(
    escapeHtml,value=>String(value??''),
  );
  return render(input);
}

test('RC124 shows genuine zero trust cap without promoting unavailable data to 100 percent',()=>{
  const html=renderProviderCoverageForTest({
    state:'degraded',trustCap:0,
    features:{injuries:{state:'plan_limited',available:false,degraded:true}},
  });
  assert.match(html,/доверие ≤ 0%/);
  assert.doesNotMatch(html,/доверие ≤ 100%/);
  assert.match(html,/provider-coverage-row degraded/);
});

test('RC124 rejects missing, invalid and out-of-range trust caps instead of inventing confidence',()=>{
  for(const cap of [undefined,null,'0','100',NaN,Infinity,-1,101,{},[]]){
    const html=renderProviderCoverageForTest({
      trustCap:cap,features:{odds:{state:'empty_response',available:false}},
    });
    assert.match(html,/доверие ≤ —/);
    assert.doesNotMatch(html,/NaN%|Infinity%|undefined%/);
  }
  const html=renderProviderCoverageForTest({
    trustCap:62.5,features:{odds:{state:'available',available:true}},
  });
  assert.match(html,/доверие ≤ 63%/);
});

test('RC124 ignores truthy availability strings and shows plan-limit degradation honestly',()=>{
  const html=renderProviderCoverageForTest({
    state:'healthy',trustCap:40,
    features:{
      injuries:{state:'plan_limited',available:'true',degraded:'false'},
      odds:{state:'available',available:'false'},
      h2h:{state:'available',available:true},
    },
  });
  assert.equal((html.match(/provider-coverage-row available/g)||[]).length,1);
  assert.equal((html.match(/provider-coverage-row degraded/g)||[]).length,1);
  assert.equal((html.match(/provider-coverage-row missing/g)||[]).length,1);
  assert.match(html,/Недоступно на текущем тарифе источника/);
});

test('RC124 malformed provider metadata cannot inject markup, classes or false coverage rows',()=>{
  const html=renderProviderCoverageForTest({
    state:'healthy" onclick="bad',trustCap:NaN,note:'<script>alert(1)</script>',
    features:{
      injuries:null,lineups:'false',
      odds:{state:'<img onerror=bad>',available:true},
      h2h:{state:'available',available:true},
      unknown_feature:{state:'available',available:true},
    },
  });
  assert.match(html,/provider-coverage-card partial/);
  assert.doesNotMatch(html,/onclick=|<script>|<img/i);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((html.match(/provider-coverage-row /g)||[]).length,4);
  assert.match(html,/Статус не определён/);
  assert.equal(renderProviderCoverageForTest({features:{}}),'');
  assert.equal(renderProviderCoverageForTest(null),'');
});
