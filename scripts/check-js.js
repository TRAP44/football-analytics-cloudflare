import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const roots=['src','public','scripts'];

function walk(dir){
  if(!fs.existsSync(dir)) return [];
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...walk(full));
    else if(entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

const files=roots.flatMap(walk).sort();
if(!files.length){
  console.error('No JavaScript files found for syntax validation.');
  process.exit(1);
}

for(const file of files){
  execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
}

console.log(`JavaScript syntax check passed for ${files.length} files.`);
