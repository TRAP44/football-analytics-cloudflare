import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const START='personal-write-guards.test.js';
const files=fs.readdirSync('test')
  .filter(name=>name.endsWith('.test.js'))
  .sort();
const start=files.indexOf(START);
if (start < 0) {
  console.error('Review-tail start file is missing: '+START);
  process.exit(2);
}
const selected=files.slice(start);
const failures=[];
let passed=0;

for (const file of selected) {
  const result=spawnSync(process.execPath,['--test','test/'+file],{
    encoding:'utf8',
    timeout:45_000,
    maxBuffer:8*1024*1024,
  });
  if (result.status === 0 && !result.error) {
    passed += 1;
    continue;
  }
  failures.push({
    file,
    status:result.status,
    signal:result.signal,
    error:result.error?.message || '',
    output:(String(result.stdout || '')+'\n'+String(result.stderr || ''))
      .split(/\r?\n/)
      .filter(line=>/not ok|error:|ERR_|TypeError|AssertionError|SyntaxError|ReferenceError|location:/.test(line))
      .slice(-24),
  });
}

console.log('REVIEW_TAIL_TOTAL='+selected.length);
console.log('REVIEW_TAIL_PASSED='+passed);
console.log('REVIEW_TAIL_FAILED='+failures.length);
for (const failure of failures) {
  console.log('REVIEW_TAIL_FAIL='+failure.file);
  for (const line of failure.output) console.log('  '+line);
}
if (failures.length) process.exitCode=1;
