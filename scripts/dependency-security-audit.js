import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECURITY_OVERRIDE_FLOORS=Object.freeze({
  undici:'7.30.0',
  sharp:'0.35.5',
});

function plainObject(value) {
  return value && typeof value==='object' && !Array.isArray(value) ? value : null;
}

function exactVersion(value) {
  if (typeof value!=='string') return null;
  const raw=value.trim();
  const match=/^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (!match) return null;
  const parts=match.slice(1).map(Number);
  if (parts.some(part=>!Number.isSafeInteger(part) || part<0)) return null;
  return {raw,parts};
}

function compareVersions(left,right) {
  for (let index=0; index<3; index+=1) {
    if (left.parts[index]!==right.parts[index]) {
      return left.parts[index]-right.parts[index];
    }
  }
  return 0;
}

function lockEntriesFor(packages,name) {
  const suffix='/node_modules/'+name;
  return Object.entries(packages)
    .filter(([key])=>key==='node_modules/'+name || key.endsWith(suffix))
    .map(([key,value])=>({key,value:plainObject(value)}));
}

function expectedRegistryUrl(name,version) {
  const leaf=name.includes('/') ? name.slice(name.lastIndexOf('/')+1) : name;
  return 'https://registry.npmjs.org/'+name+'/-/'+leaf+'-'+version+'.tgz';
}

export function auditDependencySecurityOverrides(pkg,lock,{
  floors=SECURITY_OVERRIDE_FLOORS,
}={}) {
  const findings=[];
  const packageJson=plainObject(pkg);
  const lockJson=plainObject(lock);
  if (!packageJson) return ['package.json must contain a JSON object'];
  if (!lockJson) return ['package-lock.json must contain a JSON object'];

  const overrides=plainObject(packageJson.overrides) || {};
  const floorMap=plainObject(floors) || {};
  const expectedNames=Object.keys(floorMap).sort();
  const overrideNames=Object.keys(overrides).sort();

  if (overrideNames.length!==expectedNames.length
    || overrideNames.some((name,index)=>name!==expectedNames[index])) {
    findings.push(
      'security overrides must contain exactly: '+expectedNames.join(', '),
    );
  }

  const packages=plainObject(lockJson.packages);
  if (!packages) {
    findings.push('package-lock.json packages map is required');
    return findings;
  }

  for (const name of expectedNames) {
    const floor=exactVersion(floorMap[name]);
    const override=exactVersion(overrides[name]);

    if (!floor) {
      findings.push(name+': security floor is not an exact x.y.z version');
      continue;
    }
    if (!override) {
      findings.push(name+': override must be an exact x.y.z version');
      continue;
    }
    if (compareVersions(override,floor)<0) {
      findings.push(
        name+': override '+override.raw+' is below security floor '+floor.raw,
      );
    }

    const entries=lockEntriesFor(packages,name);
    if (!entries.length) {
      findings.push(name+': no installed lockfile entry exists');
      continue;
    }

    for (const entry of entries) {
      if (!entry.value) {
        findings.push(name+': '+entry.key+' must contain an object');
        continue;
      }
      const installed=exactVersion(entry.value.version);
      if (!installed || installed.raw!==override.raw) {
        findings.push(
          name+': '+entry.key+' must resolve exactly to override '+override.raw,
        );
      }

      const expectedUrl=expectedRegistryUrl(name,override.raw);
      if (entry.value.resolved!==expectedUrl) {
        findings.push(
          name+': '+entry.key+' must resolve from the canonical npm tarball for '+override.raw,
        );
      }

      const integrity=typeof entry.value.integrity==='string'
        ? entry.value.integrity.trim()
        : '';
      if (!/^sha512-[A-Za-z0-9+/=]{40,}$/.test(integrity)) {
        findings.push(name+': '+entry.key+' must carry sha512 lockfile integrity');
      }
    }
  }

  return findings;
}

export function auditDependencySecurityFiles({
  packagePath='package.json',
  lockPath='package-lock.json',
}={}) {
  let pkg;
  let lock;
  const findings=[];

  try {
    pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
  } catch {
    findings.push('package.json must be readable valid JSON');
  }
  try {
    lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
  } catch {
    findings.push('package-lock.json must be readable valid JSON');
  }
  if (findings.length) return findings;
  return auditDependencySecurityOverrides(pkg,lock);
}

function runCli() {
  const findings=auditDependencySecurityFiles();
  if (!findings.length) {
    console.log('Dependency security override audit: lockfile and policy are aligned.');
    return;
  }
  console.error('Dependency security override audit failed:');
  for (const finding of findings) console.error('- '+finding);
  process.exitCode=1;
}

const invokedPath=process.argv[1] ? path.resolve(process.argv[1]) : '';
const modulePath=fileURLToPath(import.meta.url);
if (invokedPath && modulePath===invokedPath) runCli();
