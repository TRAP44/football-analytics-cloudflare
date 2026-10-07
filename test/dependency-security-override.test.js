import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  auditDependencySecurityFiles,
  auditDependencySecurityOverrides,
  SECURITY_OVERRIDE_FLOORS,
} from '../scripts/dependency-security-audit.js';

const pkg=JSON.parse(
  readFileSync(new URL('../package.json',import.meta.url),'utf8'),
);
const lock=JSON.parse(
  readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'),
);

test('security overrides and installed lockfile instances satisfy the audited floors',()=>{
  assert.deepEqual(auditDependencySecurityFiles(),[]);
  assert.deepEqual(Object.keys(SECURITY_OVERRIDE_FLOORS).sort(),['sharp','undici']);
  assert.equal(pkg.overrides.undici,'7.30.0');
  assert.equal(pkg.overrides.sharp,'0.35.5');
});

test('security audit rejects a downgrade even when package.json and lockfile agree',()=>{
  const downgradedPkg=structuredClone(pkg);
  const downgradedLock=structuredClone(lock);
  downgradedPkg.overrides.undici='7.29.0';
  downgradedLock.packages['node_modules/undici'].version='7.29.0';
  downgradedLock.packages['node_modules/undici'].resolved=
    'https://registry.npmjs.org/undici/-/undici-7.29.0.tgz';

  const findings=auditDependencySecurityOverrides(downgradedPkg,downgradedLock);
  assert.ok(
    findings.some(message=>message.includes('below security floor 7.30.0')),
    findings.join('\n'),
  );
});

test('security audit rejects lockfile drift and noncanonical tarball sources',()=>{
  const drifted=structuredClone(lock);
  drifted.packages['node_modules/sharp'].version='0.35.4';
  drifted.packages['node_modules/sharp'].resolved=
    'https://example.invalid/sharp-0.35.4.tgz';

  const findings=auditDependencySecurityOverrides(pkg,drifted);
  assert.ok(
    findings.some(message=>message.includes('must resolve exactly to override 0.35.5')),
    findings.join('\n'),
  );
  assert.ok(
    findings.some(message=>message.includes('canonical npm tarball')),
    findings.join('\n'),
  );
});

test('security audit checks every installed copy of an overridden dependency',()=>{
  const duplicated=structuredClone(lock);
  duplicated.packages['node_modules/example/node_modules/undici']={
    version:'7.29.0',
    resolved:'https://registry.npmjs.org/undici/-/undici-7.29.0.tgz',
    integrity:'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };

  const findings=auditDependencySecurityOverrides(pkg,duplicated);
  assert.ok(
    findings.some(message=>
      message.includes('node_modules/example/node_modules/undici')
      && message.includes('7.30.0')
    ),
    findings.join('\n'),
  );
});

test('security audit rejects range overrides, missing integrity and unreviewed overrides',()=>{
  const malformedPkg=structuredClone(pkg);
  const malformedLock=structuredClone(lock);
  malformedPkg.overrides.undici='^7.30.0';
  malformedPkg.overrides.unreviewed='1.0.0';
  malformedLock.packages['node_modules/sharp'].integrity='sha256-not-enough';

  const findings=auditDependencySecurityOverrides(malformedPkg,malformedLock);
  assert.ok(
    findings.some(message=>message.includes('must contain exactly')),
    findings.join('\n'),
  );
  assert.ok(
    findings.some(message=>message.includes('undici: override must be an exact x.y.z version')),
    findings.join('\n'),
  );
  assert.ok(
    findings.some(message=>message.includes('sha512 lockfile integrity')),
    findings.join('\n'),
  );
});
