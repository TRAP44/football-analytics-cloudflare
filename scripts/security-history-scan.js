import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { forbiddenTrackedFile, scanTextForSecrets } from './security-scan.js';

function runGit(args) {
  const result=spawnSync('git',args,{encoding:'utf8',maxBuffer:128*1024*1024});
  if (result.status===0) return result.stdout || '';
  throw new Error('git ' + args[0] + ' failed with exit ' + result.status);
}

export function parseHistoricalAddedPaths(text='') {
  const findings=[];
  let commit='';
  for (const raw of String(text).split(/\r?\n/)) {
    const line=raw.trim();
    if (!line) continue;
    if (line.startsWith('@@')) {
      commit=line.slice(2,42);
      continue;
    }
    if (forbiddenTrackedFile(line)) findings.push({commit,path:line,type:'forbidden_historical_file'});
  }
  return findings;
}

export function parseHistoricalPatchForSecrets(text='') {
  const findings=[];
  let commit='';
  let file='';
  let newLine=0;

  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith('@@COMMIT:')) {
      commit=raw.slice('@@COMMIT:'.length).trim().slice(0,40);
      file='';
      newLine=0;
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const target=raw.slice(4).trim();
      file=target==='/dev/null' ? '' : target.replace(/^b\//,'');
      continue;
    }
    const hunk=raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine=Number(hunk[1] || 0);
      continue;
    }
    if (!file || raw.startsWith('diff --git ') || raw.startsWith('--- ')) continue;

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const line=raw.slice(1);
      for (const type of scanTextForSecrets(line)) {
        findings.push({commit,path:file,line:newLine || null,type});
      }
      newLine+=1;
      continue;
    }
    if (raw.startsWith('-') && !raw.startsWith('---')) continue;
    if (newLine>0) newLine+=1;
  }

  return findings;
}

export const REVIEWED_SYNTHETIC_HISTORY_FIXTURES = Object.freeze({
  '7d4e5ff5329830168e4fb7acf301e68f2c9c7160|test/pass-entitlements.test.js|telegram_bot_token': 1,
  '775e63fdcc7bf441481ca7ec8c951ddc604ec07e|test/security-scan-rc102.test.js|telegram_bot_token': 1,
  '775e63fdcc7bf441481ca7ec8c951ddc604ec07e|test/security-scan-rc102.test.js|supabase_secret_key': 2,
  '775e63fdcc7bf441481ca7ec8c951ddc604ec07e|test/security-scan-rc102.test.js|private_key': 1,
});

function reviewedFixtureKey(item = {}) {
  return [String(item.commit || ''),String(item.path || ''),String(item.type || '')].join('|');
}

export function applyReviewedSyntheticFixtureAllowlist(items = [], allowlist = REVIEWED_SYNTHETIC_HISTORY_FIXTURES) {
  const used=new Map();
  const actionable=[];
  const reviewed=[];
  for (const item of items || []) {
    const key=reviewedFixtureKey(item);
    const expected=Math.max(0,Number(allowlist?.[key] || 0));
    const seen=Number(used.get(key) || 0);
    if (seen<expected) {
      used.set(key,seen+1);
      reviewed.push(item);
    } else {
      actionable.push(item);
    }
  }
  return {actionable,reviewed};
}

function unique(items=[]) {
  const seen=new Set();
  const out=[];
  for (const item of items) {
    const key=[item.type,item.commit,item.path,item.line || 0].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function runSecurityHistoryScan() {
  const findings=[];

  const added=runGit(['log','--all','--format=@@%H','--name-only','--diff-filter=A']);
  findings.push(...parseHistoricalAddedPaths(added));

  const commits=runGit(['rev-list','--all']).split(/\r?\n/).filter(value=>/^[0-9a-f]{40}$/i.test(value));
  const patch=runGit([
    'log',
    '--all',
    '--full-history',
    '--no-color',
    '--format=@@COMMIT:%H',
    '-p',
    '--',
    '.',
  ]);
  findings.push(...parseHistoricalPatchForSecrets(patch));

  const uniqueFindings=unique(findings);
  const review=applyReviewedSyntheticFixtureAllowlist(uniqueFindings);
  const clean=review.actionable.slice(0,100);
  if (clean.length) {
    console.error('Secret History Audit found unreviewed historical secret evidence:');
    for (const item of clean) {
      console.error('- ' + (item.commit || 'unknown').slice(0,12) + ' ' + item.path + ': ' + item.type + (item.line ? ' line ' + item.line : ''));
    }
    console.error('Matched secret values are intentionally never printed.');
    return {ok:false,findings:clean,reviewedFixtureCount:review.reviewed.length,commitCount:commits.length};
  }

  console.log(
    'Secret History Audit: no unreviewed secret evidence across '
      + commits.length
      + ' reachable commits; reviewed synthetic fixture findings: '
      + review.reviewed.length
      + '.'
  );
  return {ok:true,findings:[],reviewedFixtureCount:review.reviewed.length,commitCount:commits.length};
}

const isCli=process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if (isCli) {
  const result=runSecurityHistoryScan();
  if (!result.ok) process.exit(1);
}
