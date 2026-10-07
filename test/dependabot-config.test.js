import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditDependabotConfig,
  auditDependabotPolicy,
  auditDependabotRunbook,
  parseDependabotConfig,
} from '../scripts/dependabot-policy-audit.js';

const config=fs.readFileSync('.github/dependabot.yml','utf8');
const runbook=fs.readFileSync('docs/DEPENDABOT_RUNBOOK_RU.md','utf8');

test('Dependabot production policy is internally consistent',()=>{
  assert.deepEqual(auditDependabotPolicy(),[]);

  const parsed=parseDependabotConfig(config);
  assert.deepEqual(
    parsed.updates.map(item=>item.ecosystem).sort(),
    ['github-actions','npm'],
  );

  const npm=parsed.updates.find(item=>item.ecosystem==='npm');
  const actions=parsed.updates.find(item=>item.ecosystem==='github-actions');
  assert.equal(npm.schedule.time[0],'06:20');
  assert.equal(actions.schedule.time[0],'06:40');
  assert.equal(npm.groups[0].appliesTo[0],'version-updates');
  assert.equal(actions.groups[0].appliesTo[0],'version-updates');
});

test('Dependabot audit scopes schedule and timezone checks to each ecosystem',()=>{
  const mutated=config.replace(
    'time: "06:20"\n      timezone: "Europe/Riga"',
    'time: "06:20"\n      timezone: "UTC"',
  );
  const findings=auditDependabotConfig(mutated);

  assert.ok(
    findings.some(message=>message.includes('npm.schedule.timezone')),
    findings.join('\n'),
  );
  assert.equal(
    findings.some(message=>message.includes('github-actions.schedule.timezone')),
    false,
    findings.join('\n'),
  );
});

test('Dependabot audit rejects security/version grouping drift and major grouping',()=>{
  const securityGrouped=config.replace(
    'applies-to: "version-updates"',
    'applies-to: "security-updates"',
  );
  assert.ok(
    auditDependabotConfig(securityGrouped)
      .some(message=>message.includes('npm-minor-patch.applies-to')),
  );

  const majorGrouped=config.replace(
    '          - "patch"\n\n  - package-ecosystem: "github-actions"',
    '          - "patch"\n          - "major"\n\n  - package-ecosystem: "github-actions"',
  );
  assert.ok(
    auditDependabotConfig(majorGrouped)
      .some(message=>message.includes('npm-minor-patch.update-types')),
  );
});

test('Dependabot audit rejects duplicate ecosystems and automatic merge directives',()=>{
  const npmBlock=config.match(
    /  - package-ecosystem: "npm"[\s\S]*?(?=\n  - package-ecosystem: "github-actions")/,
  )?.[0];
  assert.ok(npmBlock);

  const duplicated=config+'\n'+npmBlock+'\n';
  assert.ok(
    auditDependabotConfig(duplicated)
      .some(message=>message.includes('exactly npm and github-actions once each')),
  );

  const autoMerge=config+'\nautomerge: true\n';
  assert.ok(
    auditDependabotConfig(autoMerge)
      .some(message=>message.includes('forbidden automatic merge option')),
  );
});

test('Dependabot runbook distinguishes version PR limits from security updates',()=>{
  assert.deepEqual(auditDependabotRunbook(runbook),[]);

  const stale=runbook
    .replace(
      'максимум 5 открытых Dependabot **version-update PR**',
      'максимум 5 открытых Dependabot PR',
    )
    .replace(
      'Security update PR этим параметром не ограничиваются и в этот лимит не входят.',
      'Security update PR обрабатываются отдельно.',
    );

  const findings=auditDependabotRunbook(stale);
  assert.ok(
    findings.some(message=>message.includes('five-PR limit')),
    findings.join('\n'),
  );
  assert.ok(
    findings.some(message=>message.includes('outside open-pull-requests-limit')),
    findings.join('\n'),
  );
});
