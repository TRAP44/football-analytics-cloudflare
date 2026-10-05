import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots=['src','public','scripts'];
const JS_EXTENSIONS=new Set(['.js','.mjs','.cjs']);

function walk(dir){
  if(!fs.existsSync(dir)) return [];
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...walk(full));
    else if(entry.isFile() && JS_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files=roots.flatMap(walk).sort();
if(!files.length){
  console.error('No JavaScript files found for syntax validation.');
  process.exit(1);
}

const failed=[];
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status===0) continue;
  failed.push(file);
  const output=[result.stdout,result.stderr].filter(Boolean).join('').trim();
  console.error(`\nSyntax check failed: ${file}`);
  if(output) console.error(output);
}

if(failed.length){
  console.error(`\nJavaScript syntax check failed for ${failed.length} of ${files.length} file(s).`);
  process.exit(1);
}

console.log(`JavaScript syntax check passed for ${files.length} files.`);
