import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKFLOW_SECRET_ALLOWLIST = Object.freeze({
  '.github/workflows/backup-supabase.yml': new Set(['SUPABASE_DB_URL','BACKUP_ENCRYPTION_PASSPHRASE']),
  '.github/workflows/deploy-production.yml': new Set(['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']),
  '.github/workflows/rollback-production.yml': new Set(['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']),
  '.github/workflows/external-production-monitor.yml': new Set(),
  '.github/workflows/quality.yml': new Set(),
  '.github/workflows/codeql.yml': new Set(),
  '.github/workflows/privileged-access-audit.yml': new Set(),
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

export function workflowSecretRefs(text='') {
  return [...String(text).matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map(match=>match[1]);
}

export function workflowActionRefs(text='') {
  return String(text).split(/\r?\n/)
    .map(line=>line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/)?.[1] || '')
    .filter(Boolean);
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

  const allowed=WORKFLOW_SECRET_ALLOWLIST[pathName] || new Set();
  for (const secret of workflowSecretRefs(source)) {
    if (!allowed.has(secret)) findings.push({path:pathName,type:'unexpected_secret_reference',name:secret});
  }

  for (const ref of workflowActionRefs(source)) {
    if (ref.startsWith('./')) continue;
    const at=ref.lastIndexOf('@');
    const revision=at>=0 ? ref.slice(at+1) : '';
    if (!/^[0-9a-f]{40}$/i.test(revision)) {
      findings.push({path:pathName,type:'unpinned_action',name:ref.split('@')[0] || ref});
    }
  }

  if (['.github/workflows/backup-supabase.yml','.github/workflows/deploy-production.yml','.github/workflows/rollback-production.yml'].includes(pathName)
      && !/^\s*environment:\s*production\s*$/mi.test(source)) {
    findings.push({path:pathName,type:'production_environment_missing'});
  }

  return findings;
}

export function auditWranglerVars(text='') {
  const findings=[];
  const source=String(text);
  const start=source.indexOf('"vars"');
  if (start<0) return findings;
  const open=source.indexOf('{',start);
  if (open<0) return findings;
  let depth=0;
  let end=-1;
  for (let i=open;i<source.length;i+=1) {
    if (source[i]==='{') depth+=1;
    else if (source[i]==='}') {
      depth-=1;
      if (depth===0) { end=i; break; }
    }
  }
  const block=end>open ? source.slice(open+1,end) : '';
  for (const match of block.matchAll(/"([A-Z0-9_]+)"\s*:/g)) {
    const name=match[1];
    if (SECRET_NAME_PATTERN.test(name)) findings.push({path:'wrangler.jsonc',type:'secret_like_worker_var',name});
  }
  return findings;
}

export function auditPublicFiles(paths, readFile=file=>fs.readFileSync(file,'utf8')) {
  const findings=[];
  for (const file of paths) {
    if (!/\.(?:js|html|css|json|txt|md)$/i.test(file)) continue;
    let text='';
    try { text=readFile(file); } catch { continue; }
    for (const name of PUBLIC_SECRET_REFERENCES) {
      if (text.includes(name)) findings.push({path:file,type:'server_secret_name_in_public_asset',name});
    }
  }
  return findings;
}

export function runPrivilegedAccessAudit() {
  const findings=[];
  for (const pathName of Object.keys(WORKFLOW_SECRET_ALLOWLIST)) {
    if (!fs.existsSync(pathName)) {
      findings.push({path:pathName,type:'workflow_missing'});
      continue;
    }
    findings.push(...auditWorkflow(pathName,fs.readFileSync(pathName,'utf8')));
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
