import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKFLOW_SECRET_ALLOWLIST = Object.freeze({
  '.github/workflows/backup-supabase.yml': new Set(['SUPABASE_DB_URL','BACKUP_ENCRYPTION_PASSPHRASE']),
  '.github/workflows/deploy-production.yml': new Set(['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','SUPABASE_ACCESS_TOKEN']),
  '.github/workflows/verify-production-migration.yml': new Set(['SUPABASE_ACCESS_TOKEN']),
  '.github/workflows/rollback-production.yml': new Set(['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']),
});

const SECRET_NAME_PATTERN = /(TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE|SERVICE_ROLE|DB_URL|API_KEY)/i;
const PUBLIC_SECRET_REFERENCES = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'BACKUP_ENCRYPTION_PASSPHRASE',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_PUBLISHER_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'API_FOOTBALL_KEY',
  'FOOTBALL_DATA_TOKEN',
  'THE_ODDS_API_KEY',
  'TAVILY_KEY',
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out=[];
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const full=path.join(dir,entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full.replaceAll('\\','/'));
  }
  return out;
}

function stripYamlComments(text='') {
  return String(text).split(/\r?\n/).map(line=>{
    let quote='';
    let escaped=false;
    for (let index=0;index<line.length;index+=1) {
      const char=line[index];
      if (quote) {
        if (escaped) {
          escaped=false;
          continue;
        }
        if (char==='\\' && quote==='"') {
          escaped=true;
          continue;
        }
        if (char===quote) quote='';
        continue;
      }
      if (char==='"' || char==="'") {
        quote=char;
        continue;
      }
      if (char==='#') return line.slice(0,index);
    }
    return line;
  }).join('\n');
}

export function workflowSecretRefs(text='') {
  const source=stripYamlComments(text);
  const refs=[];
  for (const match of source.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\b[^}]*\}\}/g)) {
    refs.push(match[1]);
  }
  for (const match of source.matchAll(/\$\{\{\s*secrets\[\s*['"]([A-Z0-9_]+)['"]\s*\][^}]*\}\}/g)) {
    refs.push(match[1]);
  }
  return [...new Set(refs)];
}

export function workflowActionRefs(text='') {
  return String(text).split(/\r?\n/)
    .map(line=>line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/)?.[1] || '')
    .map(ref=>ref.replace(/^(["'])(.*)\1$/,'$2'))
    .filter(Boolean);
}

export function workflowPaths(dir='.github/workflows') {
  return walk(dir)
    .filter(file=>/\.ya?ml$/i.test(file))
    .sort();
}

function workflowJobs(text='') {
  const jobs=[];
  let insideJobs=false;
  let current=null;
  for(const line of stripYamlComments(text).split(/\r?\n/)) {
    if (!insideJobs) {
      if (/^jobs:\s*$/.test(line)) insideJobs=true;
      continue;
    }
    if (/^\S/.test(line)) break;
    const match=/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (match) {
      current={name:match[1],lines:[]};
      jobs.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return jobs;
}

function productionEnvironmentProtected(text='') {
  const jobs=workflowJobs(text);
  if (!jobs.length) return false;
  const productionJobNames=new Set(['deploy','rollback','backup','restore_drill']);
  const sensitive=jobs.filter(job=>{
    const body=job.lines.join('\n');
    return productionJobNames.has(job.name)
      || workflowSecretRefs(body).length>0
      || /\$\{\{[^}]*\bsecrets\s*\[/.test(body);
  });
  if (!sensitive.length) return false;
  return sensitive.every(job=>/^    environment:\s*production\s*$/m.test(job.lines.join('\n')));
}

export function auditWorkflow(pathName, text='') {
  const findings=[];
  const source=String(text);
  if (!/^permissions:\s*\n/m.test(source)) {
    findings.push({path:pathName,type:'missing_explicit_permissions'});
  }
  if (/^permissions:\s*write-all\s*$/mi.test(source)) {
    findings.push({path:pathName,type:'write_all_permissions'});
  }

  const cleanSource=stripYamlComments(source);
  const allowed=WORKFLOW_SECRET_ALLOWLIST[pathName] || new Set();
  for (const secret of workflowSecretRefs(cleanSource)) {
    if (!allowed.has(secret)) findings.push({path:pathName,type:'unexpected_secret_reference',name:secret});
  }
  if (/\bsecrets\s*\[/.test(cleanSource)) {
    for (const match of cleanSource.matchAll(/\$\{\{[^}]*\bsecrets\s*\[\s*([^\]]+)\s*\][^}]*\}\}/g)) {
      const key=String(match[1] || '').trim();
      if (!/^['"][A-Z0-9_]+['"]$/.test(key)) {
        findings.push({path:pathName,type:'dynamic_secret_reference',name:key.slice(0,80)});
      }
    }
  }

  for (const ref of workflowActionRefs(cleanSource)) {
    if (ref.startsWith('./')) continue;
    const at=ref.lastIndexOf('@');
    const revision=at>=0 ? ref.slice(at+1) : '';
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
      findings.push({path:pathName,type:'unpinned_action',name:ref.split('@')[0] || ref});
    }
  }

  if (['.github/workflows/backup-supabase.yml','.github/workflows/deploy-production.yml','.github/workflows/rollback-production.yml','.github/workflows/verify-production-migration.yml'].includes(pathName)
      && !productionEnvironmentProtected(source)) {
    findings.push({path:pathName,type:'production_environment_missing'});
  }

  return findings;
}

function matchingJsoncBrace(source,open) {
  let depth=0;
  let string=false;
  let escaped=false;
  let lineComment=false;
  let blockComment=false;
  for (let i=open;i<source.length;i+=1) {
    const char=source[i];
    const next=source[i+1] || '';

    if (lineComment) {
      if (char==='\n') lineComment=false;
      continue;
    }
    if (blockComment) {
      if (char==='*' && next==='/') {
        blockComment=false;
        i+=1;
      }
      continue;
    }
    if (string) {
      if (escaped) {
        escaped=false;
        continue;
      }
      if (char==='\\') {
        escaped=true;
        continue;
      }
      if (char==='"') string=false;
      continue;
    }
    if (char==='/' && next==='/') {
      lineComment=true;
      i+=1;
      continue;
    }
    if (char==='/' && next==='*') {
      blockComment=true;
      i+=1;
      continue;
    }
    if (char==='"') {
      string=true;
      continue;
    }
    if (char==='{') depth+=1;
    else if (char==='}') {
      depth-=1;
      if (depth===0) return i;
      if (depth<0) return -1;
    }
  }
  return -1;
}

export function auditWranglerVars(text='') {
  const findings=[];
  const source=String(text);
  const start=source.search(/^\s*"vars"\s*:/m);
  if (start<0) return findings;
  const open=source.indexOf('{',start);
  if (open<0) {
    findings.push({path:'wrangler.jsonc',type:'vars_block_invalid'});
    return findings;
  }
  const end=matchingJsoncBrace(source,open);
  if (end<=open) {
    findings.push({path:'wrangler.jsonc',type:'vars_block_invalid'});
    return findings;
  }
  const block=source.slice(open+1,end);
  for (const match of block.matchAll(/"([A-Z0-9_]+)"\s*:/g)) {
    const name=match[1];
    if (SECRET_NAME_PATTERN.test(name)) findings.push({path:'wrangler.jsonc',type:'secret_like_worker_var',name});
  }
  return findings;
}

export function auditPublicFiles(paths, readFile=file=>fs.readFileSync(file,'utf8')) {
  const findings=[];
  for (const file of paths) {
    const textAsset=/\.(?:js|mjs|cjs|html|css|json|txt|md|svg|xml)$/i.test(file)
      || /(?:^|\/)_(?:headers|redirects)$/i.test(file);
    if (!textAsset) continue;
    let text='';
    try {
      text=readFile(file);
    } catch {
      findings.push({path:file,type:'unreadable_public_asset'});
      continue;
    }
    for (const name of PUBLIC_SECRET_REFERENCES) {
      if (text.includes(name)) findings.push({path:file,type:'server_secret_name_in_public_asset',name});
    }
  }
  return findings;
}

export function runPrivilegedAccessAudit() {
  const findings=[];
  const workflows=workflowPaths();
  if (!workflows.length) {
    findings.push({path:'.github/workflows',type:'workflow_directory_empty'});
  }
  for (const pathName of workflows) {
    findings.push(...auditWorkflow(pathName,fs.readFileSync(pathName,'utf8')));
  }
  for (const pathName of Object.keys(WORKFLOW_SECRET_ALLOWLIST)) {
    if (!workflows.includes(pathName)) findings.push({path:pathName,type:'workflow_missing'});
  }
  if (fs.existsSync('wrangler.jsonc')) findings.push(...auditWranglerVars(fs.readFileSync('wrangler.jsonc','utf8')));
  findings.push(...auditPublicFiles(walk('public')));

  if (findings.length) {
    console.error('Privileged Access Audit blocked the release:');
    for (const item of findings) {
      console.error('- ' + item.path + ': ' + item.type + (item.name ? ' (' + item.name + ')' : ''));
    }
    return {ok:false,findings};
  }

  console.log('Privileged Access Audit: workflow permissions, secret references, action pins and public assets are clean.');
  return {ok:true,findings:[]};
}

const isCli=process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if (isCli) {
  const result=runPrivilegedAccessAudit();
  if (!result.ok) process.exit(1);
}
