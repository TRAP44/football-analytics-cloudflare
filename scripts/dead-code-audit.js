import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RETIRED_WORKER_HELPERS=Object.freeze([
  'botMatchAction',
  'combineProbabilities',
  'digestAppUrl',
  'incrementUsage',
  'newsSourceKeyboard',
  'patchReminder',
]);

export const RETIRED_WORKER_CONSTANTS=Object.freeze([
  'NEWS_IMPACT_ACTION_WINDOW_MS',
  'NEWS_IMPACT_OUTCOME_WINDOW_MS',
  'NEWS_IMPACT_RECOVERY_WINDOW_MS',
]);

export const RETIRED_MINIAPP_HELPERS=Object.freeze([
  'absenceList',
  'coverageLabel',
  'discoveryCompetitionCard',
  'interestLabel',
  'liveStatsHtml',
  'playerLeadersHtml',
  'prematchUncertaintyClass',
  'betaHealthLabel',
  'betaActionLabel',
  'betaMetricLabel',
  'categoryClass',
  'competitionGroups',
  'matchAiSnapshotHtml',
  'statValue',
  'analysisSourceStatus',
]);

export const RETIRED_MINIAPP_CONSTANTS=Object.freeze([
  'MINIAPP_PRODUCT_MODE',
]);

export const RETIRED_CSS_FRAGMENTS=Object.freeze([
  'match-ai-snapshot',
  'competition-group',
  'competition-chip.cat-',
]);

const JS_EXTENSIONS=new Set(['.js','.mjs','.cjs']);

function escapeRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.-]/g,'\\$&');
}

function walkFiles(root,extensions) {
  if (!fs.existsSync(root)) return [];
  const out=[];
  for (const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const full=path.join(root,entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full,extensions));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function lineNumber(source,index) {
  return source.slice(0,index).split('\n').length;
}

function maskJsNonCode(source) {
  let out='';
  let state='code';
  let escaped=false;

  for (let index=0; index<source.length; index+=1) {
    const char=source[index];
    const next=source[index+1] || '';

    if (state==='line') {
      if (char==='\n') {
        state='code';
        out+='\n';
      } else {
        out+=' ';
      }
      continue;
    }

    if (state==='block') {
      if (char==='*' && next==='/') {
        out+='  ';
        index+=1;
        state='code';
      } else {
        out+=char==='\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state==='single' || state==='double' || state==='template') {
      if (escaped) {
        escaped=false;
        out+=char==='\n' ? '\n' : ' ';
        continue;
      }
      if (char==='\\') {
        escaped=true;
        out+=' ';
        continue;
      }
      const closes=(
        (state==='single' && char==="'")
        || (state==='double' && char==='"')
        || (state==='template' && char===String.fromCharCode(96))
      );
      out+=char==='\n' ? '\n' : ' ';
      if (closes) state='code';
      continue;
    }

    if (char==='/' && next==='/') {
      out+='  ';
      index+=1;
      state='line';
      continue;
    }
    if (char==='/' && next==='*') {
      out+='  ';
      index+=1;
      state='block';
      continue;
    }
    if (char==="'") {
      out+=' ';
      state='single';
      continue;
    }
    if (char==='"') {
      out+=' ';
      state='double';
      continue;
    }
    if (char===String.fromCharCode(96)) {
      out+=' ';
      state='template';
      continue;
    }

    out+=char;
  }

  return out;
}

function maskCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g,match=>match.replace(/[^\n]/g,' '));
}

function declarationMatches(source,name) {
  const escaped=escapeRegex(name);
  const patterns=[
    new RegExp('\\b(?:async\\s+)?function\\s+'+escaped+'\\b','g'),
    new RegExp('\\b(?:const|let|var|class)\\s+'+escaped+'\\b','g'),
    new RegExp('\\b(?:get|set)\\s+'+escaped+'\\s*\\(','g'),
  ];
  const matches=[];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      matches.push(match.index ?? 0);
    }
  }
  return [...new Set(matches)].sort((a,b)=>a-b);
}

function identifierMatches(source,name) {
  const pattern=new RegExp('\\b'+escapeRegex(name)+'\\b','g');
  return [...source.matchAll(pattern)].map(match=>match.index ?? 0);
}

function finding(file,line,type,name) {
  return {file:file.split(path.sep).join('/'),line,type,name};
}

export function auditDeadCode({
  srcRoot='src',
  publicRoot='public',
}={}) {
  const findings=[];
  const sourceFiles=walkFiles(srcRoot,JS_EXTENSIONS);
  const publicJsFiles=walkFiles(publicRoot,JS_EXTENSIONS);
  const cssFiles=walkFiles(publicRoot,new Set(['.css']));

  for (const file of sourceFiles) {
    const source=fs.readFileSync(file,'utf8');
    const code=maskJsNonCode(source);
    for (const name of RETIRED_WORKER_HELPERS) {
      for (const index of declarationMatches(code,name)) {
        findings.push(finding(file,lineNumber(source,index),'retired_worker_helper',name));
      }
    }
    for (const name of RETIRED_WORKER_CONSTANTS) {
      for (const index of identifierMatches(code,name)) {
        findings.push(finding(file,lineNumber(source,index),'retired_worker_constant',name));
      }
    }
  }

  for (const file of publicJsFiles) {
    const source=fs.readFileSync(file,'utf8');
    const code=maskJsNonCode(source);
    for (const name of RETIRED_MINIAPP_HELPERS) {
      for (const index of declarationMatches(code,name)) {
        findings.push(finding(file,lineNumber(source,index),'retired_miniapp_helper',name));
      }
    }
    for (const name of RETIRED_MINIAPP_CONSTANTS) {
      for (const index of identifierMatches(code,name)) {
        findings.push(finding(file,lineNumber(source,index),'retired_miniapp_constant',name));
      }
    }
  }

  for (const file of cssFiles) {
    const source=fs.readFileSync(file,'utf8');
    const code=maskCssComments(source);
    for (const fragment of RETIRED_CSS_FRAGMENTS) {
      let cursor=0;
      while (cursor<code.length) {
        const index=code.indexOf(fragment,cursor);
        if (index<0) break;
        findings.push(finding(file,lineNumber(source,index),'retired_css_fragment',fragment));
        cursor=index+fragment.length;
      }
    }
  }

  return findings.sort((a,b)=>
    a.file.localeCompare(b.file)
    || a.line-b.line
    || a.type.localeCompare(b.type)
    || a.name.localeCompare(b.name)
  );
}

function runCli() {
  const findings=auditDeadCode();
  if (!findings.length) {
    console.log('Dead-code regression gate: retired production symbols remain removed.');
    return;
  }
  console.error('Dead-code regression gate failed:');
  for (const item of findings) {
    console.error('- '+item.file+':'+item.line+' '+item.type+' '+item.name);
  }
  process.exitCode=1;
}

const invokedPath=process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath=fileURLToPath(import.meta.url);
if (invokedPath && modulePath===invokedPath) runCli();
