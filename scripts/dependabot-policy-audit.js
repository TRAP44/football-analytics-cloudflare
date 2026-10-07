import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED=Object.freeze({
  npm:Object.freeze({
    directory:'/',
    day:'monday',
    time:'06:20',
    timezone:'Europe/Riga',
    prefix:'deps',
    group:'npm-minor-patch',
  }),
  'github-actions':Object.freeze({
    directory:'/',
    day:'monday',
    time:'06:40',
    timezone:'Europe/Riga',
    prefix:'ci',
    group:'github-actions-minor-patch',
  }),
});

function stripComment(line) {
  let quote='';
  let escaped=false;
  for (let index=0; index<line.length; index+=1) {
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
}

function unquote(value) {
  const text=String(value ?? '').trim();
  if (text.length>=2) {
    const first=text[0];
    const last=text[text.length-1];
    if ((first==='"' && last==='"') || (first==="'" && last==="'")) {
      return text.slice(1,-1);
    }
  }
  return text;
}

function indentOf(line) {
  const match=/^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

function scalar(lines,key,indent) {
  const prefix=' '.repeat(indent)+key+':';
  const values=[];
  for (const line of lines) {
    if (!line.startsWith(prefix)) continue;
    values.push(unquote(stripComment(line.slice(prefix.length))));
  }
  return values;
}

function section(lines,key,indent) {
  const marker=' '.repeat(indent)+key+':';
  const index=lines.findIndex(line=>line.trimEnd()===marker);
  if (index<0) return [];
  const out=[];
  for (let cursor=index+1; cursor<lines.length; cursor+=1) {
    const line=lines[cursor];
    if (!line.trim()) {
      out.push(line);
      continue;
    }
    if (indentOf(line)<=indent) break;
    out.push(line);
  }
  return out;
}

function listValues(lines,key,indent) {
  const body=section(lines,key,indent);
  const itemIndent=indent+2;
  const pattern=new RegExp('^ {'+itemIndent+'}-\\s+(.+?)\\s*$');
  return body
    .map(line=>pattern.exec(stripComment(line)))
    .filter(Boolean)
    .map(match=>unquote(match[1]));
}

function parseGroups(blockLines) {
  const groupsBody=section(blockLines,'groups',4);
  const groups=[];
  for (let index=0; index<groupsBody.length; index+=1) {
    const match=/^ {6}([A-Za-z0-9_-]+):\s*$/.exec(groupsBody[index]);
    if (!match) continue;
    const name=match[1];
    const lines=[];
    for (let cursor=index+1; cursor<groupsBody.length; cursor+=1) {
      const line=groupsBody[cursor];
      if (!line.trim()) {
        lines.push(line);
        continue;
      }
      if (indentOf(line)<=6) break;
      lines.push(line);
    }
    groups.push({
      name,
      appliesTo:scalar(lines,'applies-to',8),
      patterns:listValues(lines,'patterns',8),
      updateTypes:listValues(lines,'update-types',8),
    });
  }
  return groups;
}

export function parseDependabotConfig(source) {
  const lines=String(source ?? '').split(/\r?\n/).map(stripComment);
  const version=scalar(lines,'version',0);
  const updates=[];

  for (let index=0; index<lines.length; index+=1) {
    const match=/^ {2}- package-ecosystem:\s*(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const ecosystem=unquote(match[1]);
    const blockLines=[];
    for (let cursor=index+1; cursor<lines.length; cursor+=1) {
      if (/^ {2}- package-ecosystem:/.test(lines[cursor])) break;
      blockLines.push(lines[cursor]);
    }
    const scheduleLines=section(blockLines,'schedule',4);
    const commitLines=section(blockLines,'commit-message',4);
    updates.push({
      ecosystem,
      directory:scalar(blockLines,'directory',4),
      openPullRequestsLimit:scalar(blockLines,'open-pull-requests-limit',4),
      rebaseStrategy:scalar(blockLines,'rebase-strategy',4),
      targetBranch:scalar(blockLines,'target-branch',4),
      schedule:{
        interval:scalar(scheduleLines,'interval',6),
        day:scalar(scheduleLines,'day',6),
        time:scalar(scheduleLines,'time',6),
        timezone:scalar(scheduleLines,'timezone',6),
      },
      commitMessage:{
        prefix:scalar(commitLines,'prefix',6),
        include:scalar(commitLines,'include',6),
      },
      groups:parseGroups(blockLines),
    });
  }

  return {version,updates};
}

function requireSingle(findings,label,values,expected) {
  if (values.length!==1 || values[0]!==expected) {
    findings.push(label+' must equal '+JSON.stringify(expected)+' exactly once');
  }
}

function sameMembers(values,expected) {
  if (values.length!==expected.length) return false;
  const left=[...values].sort();
  const right=[...expected].sort();
  return left.every((value,index)=>value===right[index]);
}

export function auditDependabotConfig(source) {
  const findings=[];
  const parsed=parseDependabotConfig(source);
  requireSingle(findings,'version',parsed.version,'2');

  const ecosystems=parsed.updates.map(item=>item.ecosystem);
  if (!sameMembers(ecosystems,Object.keys(EXPECTED))) {
    findings.push('updates must contain exactly npm and github-actions once each');
  }

  const cleanSource=String(source ?? '')
    .split(/\r?\n/)
    .map(stripComment)
    .join('\n')
    .toLowerCase();
  for (const forbidden of ['auto-merge','automerge','merge-method']) {
    if (cleanSource.includes(forbidden)) findings.push('forbidden automatic merge option: '+forbidden);
  }

  for (const [ecosystem,policy] of Object.entries(EXPECTED)) {
    const matches=parsed.updates.filter(item=>item.ecosystem===ecosystem);
    if (matches.length!==1) continue;
    const item=matches[0];

    requireSingle(findings,ecosystem+'.directory',item.directory,policy.directory);
    requireSingle(findings,ecosystem+'.schedule.interval',item.schedule.interval,'weekly');
    requireSingle(findings,ecosystem+'.schedule.day',item.schedule.day,policy.day);
    requireSingle(findings,ecosystem+'.schedule.time',item.schedule.time,policy.time);
    requireSingle(findings,ecosystem+'.schedule.timezone',item.schedule.timezone,policy.timezone);
    requireSingle(findings,ecosystem+'.open-pull-requests-limit',item.openPullRequestsLimit,'5');
    requireSingle(findings,ecosystem+'.rebase-strategy',item.rebaseStrategy,'auto');
    requireSingle(findings,ecosystem+'.commit-message.prefix',item.commitMessage.prefix,policy.prefix);
    requireSingle(findings,ecosystem+'.commit-message.include',item.commitMessage.include,'scope');

    if (item.targetBranch.length) {
      findings.push(ecosystem+'.target-branch must stay unset so security updates can use the default branch');
    }

    if (item.groups.length!==1 || item.groups[0]?.name!==policy.group) {
      findings.push(ecosystem+'.groups must contain only '+policy.group);
      continue;
    }
    const group=item.groups[0];
    requireSingle(findings,ecosystem+'.groups.'+policy.group+'.applies-to',group.appliesTo,'version-updates');
    if (!sameMembers(group.patterns,['*'])) {
      findings.push(ecosystem+'.groups.'+policy.group+'.patterns must equal ["*"]');
    }
    if (!sameMembers(group.updateTypes,['minor','patch'])) {
      findings.push(ecosystem+'.groups.'+policy.group+'.update-types must equal ["minor","patch"]');
    }
  }

  return findings;
}

export function auditDependabotRunbook(source) {
  const text=String(source ?? '');
  const lower=text.toLowerCase();
  const findings=[];
  if (!/не выполняет merge/i.test(text) && !/автоматического merge нет/i.test(text)) {
    findings.push('runbook must state that Dependabot does not merge automatically');
  }
  if (!/quality gate/i.test(text)) findings.push('runbook must require the Quality gate');
  if (!/major version updates/i.test(text)) findings.push('runbook must describe major version updates separately');
  if (!/high\/critical/i.test(text)) findings.push('runbook must prioritize High/Critical security issues');
  if (!/version-update pr/i.test(text)) findings.push('runbook must scope the five-PR limit to version updates');
  if (!lower.includes('security update pr') || !lower.includes('не ограничиваются')) {
    findings.push('runbook must explain that security update PRs are outside open-pull-requests-limit');
  }
  if (!lower.includes('version-updates')) {
    findings.push('runbook must document that groups apply to version-updates');
  }
  return findings;
}

export function auditDependabotPolicy({
  configPath='.github/dependabot.yml',
  runbookPath='docs/DEPENDABOT_RUNBOOK_RU.md',
}={}) {
  const config=fs.readFileSync(configPath,'utf8');
  const runbook=fs.readFileSync(runbookPath,'utf8');
  return [
    ...auditDependabotConfig(config).map(message=>'config: '+message),
    ...auditDependabotRunbook(runbook).map(message=>'runbook: '+message),
  ];
}

function runCli() {
  const findings=auditDependabotPolicy();
  if (!findings.length) {
    console.log('Dependabot policy audit: configuration and runbook are aligned.');
    return;
  }
  console.error('Dependabot policy audit failed:');
  for (const finding of findings) console.error('- '+finding);
  process.exitCode=1;
}

const invokedPath=process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath=fileURLToPath(import.meta.url);
if (invokedPath && modulePath===invokedPath) runCli();
