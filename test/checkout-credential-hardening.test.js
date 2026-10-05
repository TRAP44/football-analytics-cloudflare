import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hardened=[
  '.github/workflows/quality.yml',
  '.github/workflows/privileged-access-audit.yml',
  '.github/workflows/external-production-monitor.yml',
  '.github/workflows/external-production-monitor-diagnostics.yml',
  '.github/workflows/backup-supabase.yml',
  '.github/workflows/codeql.yml',
];

function checkoutBlocks(source='') {
  const lines=String(source).split(/\r?\n/);
  const blocks=[];
  for (let i=0;i<lines.length;i+=1) {
    if (!lines[i].includes('uses: actions/checkout@')) continue;
    const indent=(lines[i].match(/^(\s*)/) || ['',''])[1].length;
    let end=i+1;
    while (end<lines.length) {
      const line=lines[end];
      if (!line.trim()) { end+=1; continue; }
      const nextIndent=(line.match(/^(\s*)/) || ['',''])[1].length;
      if (nextIndent<=Math.max(0,indent-2) && line.trimStart().startsWith('- ')) break;
      end+=1;
    }
    blocks.push(lines.slice(i,end).join('\n'));
  }
  return blocks;
}

test('non-deploy workflows disable persisted checkout credentials',()=>{
  for (const path of hardened) {
    const source=fs.readFileSync(path,'utf8');
    const blocks=checkoutBlocks(source);
    assert.ok(blocks.length>0,path);
    for (const block of blocks) {
      assert.match(block,/persist-credentials:\s*false/,path+' checkout must not persist credentials');
    }
  }
});

test('deploy and rollback provenance workflows intentionally retain checkout credentials for git fetch',()=>{
  for (const path of ['.github/workflows/deploy-production.yml','.github/workflows/rollback-production.yml']) {
    const source=fs.readFileSync(path,'utf8');
    assert.match(source,/git fetch --no-tags origin main/);
    assert.doesNotMatch(source,/persist-credentials:\s*false/);
  }
});
