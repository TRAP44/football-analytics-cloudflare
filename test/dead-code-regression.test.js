import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditDeadCode,
  RETIRED_CSS_FRAGMENTS,
  RETIRED_MINIAPP_CONSTANTS,
  RETIRED_MINIAPP_HELPERS,
  RETIRED_WORKER_CONSTANTS,
  RETIRED_WORKER_HELPERS,
} from '../scripts/dead-code-audit.js';

test('retired production helpers, constants and styles stay removed across extracted modules',()=>{
  assert.deepEqual(auditDeadCode(),[]);
});

test('dead-code gate detects reintroduced declarations outside the old monolithic entry files',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dead-code-regression-'));
  const srcRoot=path.join(root,'src');
  const publicRoot=path.join(root,'public');
  fs.mkdirSync(path.join(srcRoot,'runtime'),{recursive:true});
  fs.mkdirSync(path.join(publicRoot,'modules'),{recursive:true});
  fs.mkdirSync(path.join(publicRoot,'styles'),{recursive:true});

  try {
    fs.writeFileSync(
      path.join(srcRoot,'runtime','legacy-runtime.js'),
      [
        'export const combineProbabilities = () => null;',
        'const NEWS_IMPACT_ACTION_WINDOW_MS = 1000;',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(publicRoot,'modules','legacy-ui.js'),
      [
        'function liveStatsHtml() { return ""; }',
        'const MINIAPP_PRODUCT_MODE = "legacy";',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(publicRoot,'styles','legacy.css'),
      '.match-ai-snapshot { display: block; }\n',
      'utf8',
    );

    const findings=auditDeadCode({srcRoot,publicRoot});
    const summary=findings
      .map(item=>({type:item.type,name:item.name}))
      .sort((a,b)=>(a.type+':'+a.name).localeCompare(b.type+':'+b.name));
    const expected=[
      {type:'retired_worker_helper',name:'combineProbabilities'},
      {type:'retired_worker_constant',name:'NEWS_IMPACT_ACTION_WINDOW_MS'},
      {type:'retired_miniapp_helper',name:'liveStatsHtml'},
      {type:'retired_miniapp_constant',name:'MINIAPP_PRODUCT_MODE'},
      {type:'retired_css_fragment',name:'match-ai-snapshot'},
    ].sort((a,b)=>(a.type+':'+a.name).localeCompare(b.type+':'+b.name));
    assert.deepEqual(summary,expected);
    assert.ok(findings.every(item=>Number.isSafeInteger(item.line) && item.line>0));
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('dead-code gate ignores historical names that appear only in comments or strings',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dead-code-comments-'));
  const srcRoot=path.join(root,'src');
  const publicRoot=path.join(root,'public');
  fs.mkdirSync(srcRoot,{recursive:true});
  fs.mkdirSync(publicRoot,{recursive:true});

  try {
    fs.writeFileSync(
      path.join(srcRoot,'safe.js'),
      [
        '// function botMatchAction() {}',
        'const note = "NEWS_IMPACT_OUTCOME_WINDOW_MS";',
        '/* const patchReminder = () => null; */',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(publicRoot,'safe.js'),
      [
        '// function absenceList() {}',
        'const label = "MINIAPP_PRODUCT_MODE";',
        '/* const statValue = () => null; */',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(publicRoot,'safe.css'),
      '/* .competition-group { display:none; } */\n.safe { display:block; }',
      'utf8',
    );

    assert.deepEqual(auditDeadCode({srcRoot,publicRoot}),[]);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('dead-code contract itself stays explicit and duplicate-free',()=>{
  const groups=[
    RETIRED_WORKER_HELPERS,
    RETIRED_WORKER_CONSTANTS,
    RETIRED_MINIAPP_HELPERS,
    RETIRED_MINIAPP_CONSTANTS,
    RETIRED_CSS_FRAGMENTS,
  ];

  for (const group of groups) {
    assert.ok(Object.isFrozen(group));
    assert.equal(group.length,new Set(group).size);
    assert.ok(group.every(value=>typeof value==='string' && value.trim()===value && value.length>0));
  }

  assert.ok(RETIRED_WORKER_HELPERS.includes('combineProbabilities'));
  assert.ok(RETIRED_MINIAPP_HELPERS.includes('matchAiSnapshotHtml'));
  assert.ok(RETIRED_CSS_FRAGMENTS.includes('competition-chip.cat-'));
});
