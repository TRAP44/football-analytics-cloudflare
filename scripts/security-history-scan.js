import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { forbiddenTrackedFile } from './security-scan.js';

const HISTORY_PATTERNS = Object.freeze([
  ['private_key','-----BEGIN( [A-Z0-9]+)? PRIVATE KEY-----'],
  ['telegram_bot_token','[0-9]{6,12}:[A-Za-z0-9_-]{30,}'],
  ['supabase_secret_key','sb_secret_[A-Za-z0-9_-]{16,}'],
  ['github_token','(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})'],
  ['tavily_key','tvly-[A-Za-z0-9_-]{20,}'],
  ['jwt_secret','eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}'],
]);

function runGit(args, {allowNoMatch=false} = {}) {
  const result=spawnSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
  if (result.status===0) return result.stdout || '';
  if (allowNoMatch && result.status===1) return '';
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

export function parseGitGrep(text='', type='secret_pattern') {
  const findings=[];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line) continue;
    const match=line.match(/^([0-9a-f]{40}):([^:]+):(\d+):/i);
    if (!match) continue;
    findings.push({commit:match[1],path:match[2],line:Number(match[3]),type});
  }
  return findings;
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
  const chunkSize=24;
  for (const [type,pattern] of HISTORY_PATTERNS) {
    for (let offset=0;offset<commits.length;offset+=chunkSize) {
      const chunk=commits.slice(offset,offset+chunkSize);
      const output=runGit(
        ['grep','-I','-n','-E',pattern,...chunk,'--','.'],
        {allowNoMatch:true},
      );
      findings.push(...parseGitGrep(output,type));
      if (findings.length>100) break;
    }
    if (findings.length>100) break;
  }

  const clean=unique(findings).slice(0,100);
  if (clean.length) {
    console.error('Secret History Audit found historical secret evidence:');
    for (const item of clean) {
      console.error('- ' + (item.commit || 'unknown').slice(0,12) + ' ' + item.path + ': ' + item.type + (item.line ? ' line ' + item.line : ''));
    }
    console.error('Matched secret values are intentionally never printed.');
    return {ok:false,findings:clean,commitCount:commits.length};
  }

  console.log('Secret History Audit: no known secret patterns or forbidden secret files found across ' + commits.length + ' reachable commits.');
  return {ok:true,findings:[],commitCount:commits.length};
}

const isCli=process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if (isCli) {
  const result=runSecurityHistoryScan();
  if (!result.ok) process.exit(1);
}
