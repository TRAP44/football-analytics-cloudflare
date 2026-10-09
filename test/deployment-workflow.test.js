import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  auditDeploymentWorkflowFiles,
  auditDeploymentWorkflowSources,
} from '../scripts/deployment-workflow-audit.js';

const deploy=fs.readFileSync(
  new URL('../.github/workflows/deploy-production.yml',import.meta.url),
  'utf8',
);
const rollback=fs.readFileSync(
  new URL('../.github/workflows/rollback-production.yml',import.meta.url),
  'utf8',
);
const quality=fs.readFileSync(
  new URL('../.github/workflows/quality.yml',import.meta.url),
  'utf8',
);
const wrangler=fs.readFileSync(
  new URL('../wrangler.jsonc',import.meta.url),
  'utf8',
);

function audit(overrides={}) {
  return auditDeploymentWorkflowSources({
    deploy,
    rollback,
    quality,
    wrangler,
    ...overrides,
  });
}

test('production deployment and rollback workflows satisfy the release policy',()=>{
  assert.deepEqual(auditDeploymentWorkflowFiles(),[]);
});

test('deploy re-verification cannot silently drift behind the Quality security gates',()=>{
  const weakened=deploy.replace(
    '          npm run security:dependencies\n',
    '',
  ).replace(
    '          npm run security:privileged\n',
    '',
  );

  const findings=audit({deploy:weakened});
  assert.ok(
    findings.some(message=>
      message.includes('deploy re-verification')
      && message.includes('security:dependencies')
    ),
    findings.join('\n'),
  );
  assert.ok(
    findings.some(message=>
      message.includes('deploy re-verification')
      && message.includes('security:privileged')
    ),
    findings.join('\n'),
  );
});

test('production mutation is blocked when rollback preflight is moved behind deploy',()=>{
  const preflightStart=deploy.indexOf(
    '      - name: Preflight previous-known-good rollback target',
  );
  const deployStart=deploy.indexOf('      - name: Deploy Worker');
  assert.ok(preflightStart>=0 && deployStart>preflightStart);

  const preflightBlock=deploy.slice(preflightStart,deployStart);
  const weakened=
    deploy.slice(0,preflightStart)
    + deploy.slice(deployStart,deploy.indexOf(
      '      - name: RC120 verify active production release identity',
      deployStart,
    ))
    + preflightBlock
    + deploy.slice(deploy.indexOf(
      '      - name: RC120 verify active production release identity',
      deployStart,
    ));

  const findings=audit({deploy:weakened});
  assert.ok(
    findings.some(message=>message.includes('unsafe ordering')),
    findings.join('\n'),
  );
});

test('schema-drift recovery cannot promote an unverified uploaded version',()=>{
  const weakened=deploy
    .replace('            node scripts/verify-schema-drift-recovery.js "$SMOKE_URL"\n','')
    .replace('            node scripts/post-deploy-smoke.js "$RECOVERY_URL" "$RELEASE_VERSION" "$DEPLOY_SHA"\n','');

  const findings=audit({deploy:weakened});
  assert.ok(
    findings.some(message=>
      message.includes('rollback preflight recovery')
      && (
        message.includes('verify-schema-drift-recovery')
        || message.includes('post-deploy-smoke')
      )
    ),
    findings.join('\n'),
  );
});

test('schema-drift recovery promotion stays between preflight and production identity verification',()=>{
  const preflight=deploy.indexOf('- name: Preflight previous-known-good rollback target');
  const promote=deploy.indexOf('- name: Promote schema-drift recovery candidate');
  const identity=deploy.indexOf('- name: RC120 verify active production release identity');
  assert.ok(preflight>=0 && promote>preflight && identity>promote);
  assert.match(
    deploy.slice(promote,identity),
    /wrangler versions deploy "\$RECOVERY_VERSION_ID@100%" -y/,
  );
});

test('production deploy requires immutable GitHub Action pins',()=>{
  const weakened=deploy.replace(
    'cloudflare/wrangler-action@953926a2e2182532811c01a25e53647d93bf07c0',
    'cloudflare/wrangler-action@v4',
  );
  const findings=audit({deploy:weakened});

  assert.ok(
    findings.some(message=>message.includes('full commit SHA')),
    findings.join('\n'),
  );
  assert.ok(
    findings.some(message=>message.includes('mutable version-tag')),
    findings.join('\n'),
  );
});

test('production smoke must still run when the runtime artifact is unchanged',()=>{
  const marker='      - name: Verify production deployment\n';
  const weakened=deploy.replace(
    marker,
    marker+"        if: steps.production_changes.outputs.changed == 'true'\n",
  );
  const findings=audit({deploy:weakened});

  assert.ok(
    findings.some(message=>
      message.includes('production smoke verification')
      && message.includes('changed and unchanged runtime')
    ),
    findings.join('\n'),
  );
});

test('manual rollback verifies the exact target identity before mutation',()=>{
  const identityStart=rollback.indexOf(
    '      - name: RC117 verify rollback release identity',
  );
  const mutationStart=rollback.indexOf('      - name: Roll back Worker');
  assert.ok(identityStart>=0 && mutationStart>identityStart);

  const identityBlock=rollback.slice(identityStart,mutationStart);
  const afterMutation=rollback.slice(mutationStart);
  const next=afterMutation.indexOf(
    '      - name: RC119 verify exact rollback deployment target',
  );
  assert.ok(next>0);
  const mutationBlock=afterMutation.slice(0,next);

  const weakened=
    rollback.slice(0,identityStart)
    + mutationBlock
    + identityBlock
    + afterMutation.slice(next);

  const findings=audit({rollback:weakened});
  assert.ok(
    findings.some(message=>
      message.includes('rollback target identity')
      && message.includes('before mutation')
    ),
    findings.join('\n'),
  );
});

test('health probes remain Worker-first instead of falling into the SPA shell',()=>{
  const weakened=wrangler.replace('      "/health/*",\n','');
  const findings=audit({wrangler:weakened});

  assert.ok(
    findings.some(message=>
      message.includes('Worker-first health routing')
      && message.includes('/health/*')
    ),
    findings.join('\n'),
  );
});

test('Cloudflare credential preflight never prints secret values',()=>{
  const marker='            echo "### Cloudflare deploy blocked" >> "$GITHUB_STEP_SUMMARY"';
  const weakened=deploy.replace(
    marker,
    marker+'\n            echo "$CLOUDFLARE_API_TOKEN $CLOUDFLARE_ACCOUNT_ID"',
  );
  const findings=audit({deploy:weakened});

  assert.ok(
    findings.some(message=>message.includes('must not echo Cloudflare secret values')),
    findings.join('\n'),
  );
});


test('production deploy uses an ephemeral hosted runner',()=>{
  assert.match(deploy,/runs-on:\s*ubuntu-latest/);
  assert.doesNotMatch(deploy,/runs-on:\s*\[self-hosted/);
});


test('Quality rejects non-blocking regression failures',()=>{
  for (const command of ['npm test','npm run test:review-tail']) {
    const weakened=quality.replace('        run: '+command+'\n','        continue-on-error: true\n        run: '+command+'\n');
    assert.notEqual(weakened,quality);
    assert.ok(audit({quality:weakened}).some(message=>message.includes('continue-on-error')));
  }
});

test('full and review-tail regressions cannot be removed from release verification',()=>{
  for (const command of ['npm test','npm run test:review-tail']) {
    const weakenedQuality=quality.replace('        run: '+command+'\n','');
    assert.ok(audit({quality:weakenedQuality}).some(message=>message.includes('Quality gate') && message.includes(command)));
    const weakenedDeploy=deploy.replace('          '+command+'\n','');
    assert.ok(audit({deploy:weakenedDeploy}).some(message=>message.includes('deploy re-verification') && message.includes(command)));
  }
});
