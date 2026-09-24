import fs from 'node:fs';
import path from 'node:path';

const roots=['src','public','scripts'];
const textExtensions=new Set(['.js','.html','.css']);
const workMarkers=['TO'+'DO','FIX'+'ME','HA'+'CK','W'+'IP','X'+'XX'];
const conflictMarkers=['<' .repeat(7),'=' .repeat(7),'>' .repeat(7)];

function walk(dir){
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) return walk(full);
    return entry.isFile() && textExtensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

const findings=[];
for(const file of roots.flatMap(walk).sort()){
  if(file.endsWith(path.join('scripts','source-hygiene.js'))) continue;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
  lines.forEach((line,index)=>{
    if(/\bdebugger\s*;/.test(line)) findings.push({file,line:index+1,type:'debugger'});
    if(conflictMarkers.some(marker=>line.startsWith(marker))) findings.push({file,line:index+1,type:'merge_conflict'});
    for(const marker of workMarkers){
      if(new RegExp('\\b'+marker+'\\b','i').test(line)) findings.push({file,line:index+1,type:'unfinished_marker'});
    }
  });
}

if(findings.length){
  console.error('Source hygiene gate failed:');
  for(const finding of findings) console.error(`- ${finding.file}:${finding.line} ${finding.type}`);
  process.exit(1);
}
console.log('Source hygiene gate: production source is clean.');
