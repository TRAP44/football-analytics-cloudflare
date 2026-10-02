import fs from 'node:fs';
import path from 'node:path';

const target=process.argv[2] || 'codeql-results';

function walk(root) {
  const out=[];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const full=path.join(root,entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.sarif')) out.push(full);
  }
  return out;
}

function relativeUri(location={}) {
  return String(
    location?.physicalLocation?.artifactLocation?.uri
    || location?.logicalLocations?.[0]?.fullyQualifiedName
    || 'unknown'
  ).slice(0,240);
}

const files=walk(target);
if (!files.length) {
  console.error('CodeQL SARIF gate: no SARIF files found.');
  process.exit(2);
}

const findings=[];
for (const file of files) {
  const sarif=JSON.parse(fs.readFileSync(file,'utf8'));
  for (const run of sarif.runs || []) {
    const rules=new Map((run.tool?.driver?.rules || []).map(rule=>[String(rule.id || ''),rule]));
    for (const result of run.results || []) {
      if (Array.isArray(result.suppressions) && result.suppressions.length) continue;
      const ruleId=String(result.ruleId || result.rule?.id || 'unknown');
      const rule=rules.get(ruleId) || {};
      const level=String(result.level || rule.defaultConfiguration?.level || 'warning');
      findings.push({
        ruleId,
        level,
        file:relativeUri(result.locations?.[0] || {}),
        message:String(result.message?.text || rule.shortDescription?.text || 'CodeQL finding').replace(/\s+/g,' ').slice(0,240),
      });
    }
  }
}

if (!findings.length) {
  console.log(`CodeQL SARIF gate: clean (${files.length} SARIF file(s), 0 findings).`);
  process.exit(0);
}

console.error(`CodeQL SARIF gate: ${findings.length} unsuppressed finding(s).`);
for (const finding of findings.slice(0,50)) {
  console.error(`- [${finding.level}] ${finding.ruleId} · ${finding.file} · ${finding.message}`);
}
if (findings.length>50) console.error(`- ... ${findings.length-50} more finding(s)`);
process.exit(1);
