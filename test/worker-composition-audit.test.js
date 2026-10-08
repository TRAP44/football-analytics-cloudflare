import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workerPath=path.join('src','worker.js');

function workerSource() {
  return fs.readFileSync(workerPath,'utf8');
}

function splitTopLevel(source) {
  const parts=[];
  let start=0;
  let depth=0;
  let quote='';
  let escaped=false;
  for (let index=0; index<source.length; index+=1) {
    const char=source[index];
    if (quote) {
      if (escaped) {
        escaped=false;
        continue;
      }
      if (char==='\\') {
        escaped=true;
        continue;
      }
      if (char===quote) quote='';
      continue;
    }
    if (char==="'" || char==='"' || char==='\`') {
      quote=char;
      continue;
    }
    if ('({['.includes(char)) depth+=1;
    else if (')}]'.includes(char)) depth-=1;
    else if (char===',' && depth===0) {
      parts.push(source.slice(start,index).trim());
      start=index+1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function matchingDelimiter(source,start,open,close) {
  let depth=0;
  let quote='';
  let escaped=false;
  for (let index=start; index<source.length; index+=1) {
    const char=source[index];
    if (quote) {
      if (escaped) {
        escaped=false;
        continue;
      }
      if (char==='\\') {
        escaped=true;
        continue;
      }
      if (char===quote) quote='';
      continue;
    }
    if (char==="'" || char==='"' || char==='\`') {
      quote=char;
      continue;
    }
    if (char===open) depth+=1;
    else if (char===close) {
      depth-=1;
      if (depth===0) return index;
    }
  }
  return -1;
}

function importedFactories(source) {
  const rows=[];
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];/g)) {
    for (const item of splitTopLevel(match[1])) {
      const parsed=item.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!parsed) continue;
      const imported=parsed[1];
      const local=parsed[2] || imported;
      if (/^create[A-Z]/.test(local)) rows.push({imported,local,from:match[2]});
    }
  }
  return rows;
}

function callObject(source,name) {
  const matches=[...source.matchAll(new RegExp('\\b'+name+'\\s*\\(','g'))];
  if (matches.length!==1) return {count:matches.length,keys:[],entries:[],index:-1};
  const index=matches[0].index;
  const openParen=source.indexOf('(',index);
  let cursor=openParen+1;
  while (/\s/.test(source[cursor] || '')) cursor+=1;
  if (source[cursor]!== '{') {
    const closeParen=matchingDelimiter(source,openParen,'(',')');
    const raw=closeParen>=0 ? source.slice(openParen+1,closeParen).trim() : '';
    return {count:1,keys:[],entries:[],index,nonObject:true,raw};
  }

  const end=matchingDelimiter(source,cursor,'{','}');
  assert.ok(end>cursor,`Could not parse ${name} argument object`);
  const body=source.slice(cursor+1,end);
  const entries=splitTopLevel(body).map(item=>{
    const alias=item.match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
    return alias
      ? {key:alias[1],expr:alias[2].trim()}
      : {key:item,expr:item};
  }).filter(entry=>/^[A-Za-z_$][\w$]*$/.test(entry.key));

  return {
    count:1,
    keys:entries.map(entry=>entry.key),
    entries,
    index,
  };
}

function factoryContract(source,name) {
  const marker=`export function ${name}`;
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,`Factory ${name} is not exported by its module`);

  const openParen=source.indexOf('(',start);
  const closeParen=matchingDelimiter(source,openParen,'(',')');
  assert.ok(closeParen>openParen,`Could not parse ${name} signature`);
  const params=source.slice(openParen+1,closeParen).trim();

  if (params.startsWith('{')) {
    const closeBrace=matchingDelimiter(params,0,'{','}');
    const objectBody=params.slice(1,closeBrace);
    const all=[];
    for (const entry of splitTopLevel(objectBody)) {
      const parsed=entry.match(/^([A-Za-z_$][\w$]*)/);
      if (parsed) all.push(parsed[1]);
    }
    // Legacy factories often make a destructured parameter optional in the
    // body rather than with an "= default" in the signature. Static auditing
    // can safely reject extra/duplicate keys here; the factory still owns its
    // own requiredness validation.
    return {all,required:[],style:'destructured-param'};
  }

  const tail=source.slice(closeParen+1);
  const destructure=tail.match(/const\s*\{([\s\S]*?)\}\s*=\s*deps\s*;/);
  if (!destructure) {
    // Factories with an optional options bag can read their accepted fields
    // through safeRead(options, 'key') instead of destructuring dependencies.
    if (/^options\s*=\s*\{\}$/.test(params)) {
      const allowed=[...tail.matchAll(/safeRead\(\s*options\s*,\s*['"]([^'"]+)['"]/g)]
        .map(match=>match[1]);
      if (allowed.length) return {all:[...new Set(allowed)],required:[],style:'options-bag'};
    }
    return {all:[],required:[],style:'zero-dependency'};
  }
  const all=splitTopLevel(destructure[1])
    .map(entry=>entry.trim())
    .filter(entry=>/^[A-Za-z_$][\w$]*$/.test(entry));
  return {all,required:all,style:'deps-object'};
}

function importUsage(source) {
  const rows=[];
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];/g)) {
    for (const item of splitTopLevel(match[1])) {
      const parsed=item.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!parsed) continue;
      rows.push({local:parsed[2] || parsed[1],from:match[2]});
    }
  }
  for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"];/g)) {
    rows.push({local:match[1],from:match[2]});
  }
  return rows;
}

function strippedWorker(source) {
  return source
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/^import\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+default\s+/g,'const __defaultExport = ')
    .replace(/\bexport\s+/g,'');
}

function braceDepthAt(source,target) {
  let depth=0;
  let state='code';
  let escaped=false;
  let regexClass=false;

  const regexMayStart=index=>{
    let cursor=index-1;
    while (cursor>=0 && /\s/.test(source[cursor])) cursor-=1;
    if (cursor<0) return true;
    return '=([{,:;!?&|+-*%^~<>'.includes(source[cursor]);
  };

  for (let index=0; index<target; index+=1) {
    const char=source[index];
    const next=source[index+1] || '';
    if (state==='line') {
      if (char==='\n') state='code';
      continue;
    }
    if (state==='block') {
      if (char==='*' && next==='/') {
        state='code';
        index+=1;
      }
      continue;
    }
    if (state==='single' || state==='double' || state==='template') {
      if (escaped) {
        escaped=false;
        continue;
      }
      if (char==='\\') {
        escaped=true;
        continue;
      }
      if (
        (state==='single' && char=="'")
        || (state==='double' && char==='"')
        || (state==='template' && char==='\`')
      ) state='code';
      continue;
    }
    if (state==='regex') {
      if (escaped) {
        escaped=false;
        continue;
      }
      if (char==='\\') {
        escaped=true;
        continue;
      }
      if (char==='[') {
        regexClass=true;
        continue;
      }
      if (char===']') {
        regexClass=false;
        continue;
      }
      if (char==='/' && !regexClass) state='code';
      continue;
    }
    if (char==='/' && next==='/') {
      state='line';
      index+=1;
      continue;
    }
    if (char==='/' && next==='*') {
      state='block';
      index+=1;
      continue;
    }
    if (char=="'") {
      state='single';
      continue;
    }
    if (char==='"') {
      state='double';
      continue;
    }
    if (char==='\`') {
      state='template';
      continue;
    }
    if (char==='/' && regexMayStart(index)) {
      state='regex';
      regexClass=false;
      continue;
    }
    if (char==='{') depth+=1;
    else if (char==='}') depth=Math.max(0,depth-1);
  }
  return depth;
}

function declarationMap(source) {
  const map=new Map();
  const add=(name,index,type)=>{
    const current=map.get(name);
    if (!current || current.index>index) map.set(name,{index,type});
  };

  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const item of splitTopLevel(match[1])) {
      const parsed=item.match(/^(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)$/);
      if (parsed) add(parsed[1],match.index,'import');
    }
  }
  for (const match of source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/g)) {
    add(match[1],match.index,'import');
  }
  for (const match of source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/gm)) {
    add(match[1],match.index,'function');
  }
  for (const match of source.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/gm)) {
    add(match[1],match.index,'variable');
  }
  for (const match of source.matchAll(/^const\s*\{([\s\S]*?)\}\s*=\s*[^;]+;/gm)) {
    for (const item of splitTopLevel(match[1])) {
      const parsed=item.match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (parsed) add(parsed[2] || parsed[1],match.index,'destructure');
    }
  }
  return map;
}

test('worker source parses after ESM syntax is stripped', () => {
  assert.doesNotThrow(()=>new Function(strippedWorker(workerSource())));
});

test('worker has no unused static imports', () => {
  const source=workerSource();
  const dead=importUsage(source).filter(item=>{
    const matches=source.match(new RegExp('\\b'+item.local+'\\b','g')) || [];
    return matches.length===1;
  });
  assert.deepEqual(dead,[]);
});

test('worker has no unused top-level destructured runtime bindings', () => {
  const source=workerSource();
  const dead=[];
  for (const match of source.matchAll(/^const\s*\{([\s\S]*?)\}\s*=\s*[^;]+;/gm)) {
    if (braceDepthAt(source,match.index)!==0) continue;
    for (const item of splitTopLevel(match[1])) {
      const parsed=item.match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (!parsed) continue;
      const name=parsed[2] || parsed[1];
      const uses=source.match(new RegExp('\\b'+name+'\\b','g')) || [];
      if (uses.length===1) dead.push(name);
    }
  }
  assert.deepEqual(dead,[]);
});

test('all directly instantiated imported factories have compatible dependency wiring', () => {
  const source=workerSource();
  const mismatches=[];

  for (const item of importedFactories(source)) {
    const call=callObject(source,item.local);
    if (call.count===0) continue;
    if (call.count!==1) {
      mismatches.push({factory:item.local,reason:'call_count',count:call.count});
      continue;
    }

    const modulePath=path.normalize(path.join('src',item.from.replace(/^\.\//,'')));
    const moduleSource=fs.readFileSync(modulePath,'utf8');
    const contract=factoryContract(moduleSource,item.imported);

    if (call.nonObject) {
      if (call.raw || contract.required.length) {
        mismatches.push({
          factory:item.local,
          reason:'non_object_arguments',
          raw:call.raw,
          required:contract.required,
        });
      }
      continue;
    }

    const duplicateKeys=[...new Set(call.keys.filter((key,index,array)=>array.indexOf(key)!==index))];
    const missing=contract.required.filter(key=>!call.keys.includes(key));
    const extra=call.keys.filter(key=>!contract.all.includes(key));
    if (duplicateKeys.length || missing.length || extra.length) {
      mismatches.push({factory:item.local,duplicateKeys,missing,extra});
    }
  }

  assert.deepEqual(mismatches,[]);
});

test('eager top-level factory calls never read late const bindings directly', () => {
  const source=workerSource();
  const declarations=declarationMap(source);
  const unsafe=[];

  for (const item of importedFactories(source)) {
    const call=callObject(source,item.local);
    if (call.count!==1 || call.index<0 || braceDepthAt(source,call.index)!==0) continue;

    for (const entry of call.entries) {
      if (!/^[A-Za-z_$][\w$]*$/.test(entry.expr)) continue;
      const declaration=declarations.get(entry.expr);
      if (
        !declaration
        || (
          declaration.type!=='function'
          && declaration.type!=='import'
          && declaration.index>call.index
        )
      ) {
        unsafe.push({
          factory:item.local,
          dependency:entry.key,
          expression:entry.expr,
        });
      }
    }
  }

  assert.deepEqual(unsafe,[]);
});

test('worker source contains no unfinished or known corrupted extraction seams', () => {
  const source=workerSource();

  assert.doesNotMatch(source,/\bdebugger\b/);
  assert.doesNotMatch(source,/^(?:<{7}|={7}|>{7})/m);
  assert.doesNotMatch(source,/\b(?:TODO|FIXME|HACK|WIP|XXX)\b/i);
  assert.doesNotMatch(source,/const tavll\(/);
  assert.doesNotMatch(source,/const buildSmartMatchInsights = \(\.\.\.args\) home:/);
  assert.doesNotMatch(source,/\n\s*r \}\);\s*\n/);
});
