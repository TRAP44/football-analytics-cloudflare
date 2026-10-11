import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CRON_RUNNER_SECRET_KEYS, cronSlot, missingRequiredSecrets, redactor, runCron, runnerEnv, summarizeRun, wranglerVars,
} from '../scripts/cron-runner.js';

test('cron runner aligns delayed GitHub runs to the 5-minute cron slot', () => {
  assert.equal(new Date(cronSlot(Date.parse('2026-10-11T15:33:47Z'))).toISOString(), '2026-10-11T15:30:00.000Z');
  assert.equal(new Date(cronSlot(Date.parse('2026-10-11T15:35:00Z'))).toISOString(), '2026-10-11T15:35:00.000Z');
});

test('cron runner reads plain wrangler vars and only allow-listed secrets', () => {
  const vars = wranglerVars(fs.readFileSync('wrangler.jsonc', 'utf8'));
  assert.equal(vars.PREMATCH_PREDICTIONS_ENABLED !== undefined, true);
  assert.deepEqual(wranglerVars('not json'), {});
  const env = runnerEnv({ SUPABASE_URL: ' https://x.supabase.co ', TELEGRAM_BOT_TOKEN: 'secret-token', HOME: '/root', GITHUB_TOKEN: 'ghs_x', API_FOOTBALL_KEY: '' }, { CACHE_MINUTES: '10' }, { sha: 'abcdef1234567' });
  assert.equal(env.SUPABASE_URL, 'https://x.supabase.co');
  assert.equal(env.TELEGRAM_BOT_TOKEN, 'secret-token');
  assert.equal(env.CACHE_MINUTES, '10');
  assert.equal(Object.hasOwn(env, 'HOME'), false, 'the runner environment never leaks into the worker env');
  assert.equal(Object.hasOwn(env, 'GITHUB_TOKEN'), false);
  assert.equal(Object.hasOwn(env, 'API_FOOTBALL_KEY'), false, 'empty secrets stay unset');
  assert.equal(env.CF_VERSION_METADATA.tag, 'abcdef1234567');
});

test('cron runner redacts secrets and token-shaped strings from output', () => {
  const redact = redactor({ SUPABASE_SECRET_KEY: 'sb_secret_123456789', API_FOOTBALL_KEY: 'football-key-42' });
  const text = redact('fail https://api.telegram.org/bot123456789:AAEabcdefghijklmnopqrstuvwxyz/sendMessage key sb_secret_123456789 football-key-42 ?apikey=zzz');
  assert.doesNotMatch(text, /sb_secret_123456789|football-key-42|AAEabcdefghijklmnopqrstuvwxyz|zzz/);
});

test('cron runner waits for the whole scheduled run and reports failed tasks', async () => {
  const seen = {};
  const worker = {
    async scheduled(controller, env, ctx) {
      seen.controller = controller;
      seen.env = env;
      ctx.waitUntil(new Promise(resolve => setTimeout(() => resolve([
        { task: 'reminders', status: 'ok', reason: '' },
        { task: 'smart_notifications', status: 'failed', reason: 'telegram_down' },
      ]), 20)));
      return undefined;
    },
  };
  const result = await runCron({ worker, env: { A: '1' }, nowMs: Date.parse('2026-10-11T15:33:47Z') });
  assert.equal(new Date(seen.controller.scheduledTime).toISOString(), '2026-10-11T15:30:00.000Z');
  assert.deepEqual(seen.env, { A: '1' });
  assert.equal(result.failed, true);
  assert.deepEqual(result.tasks.map(row => row.status), ['ok', 'failed']);

  const ok = await runCron({ worker: { async scheduled(_c, _e, ctx) { ctx.waitUntil(Promise.resolve([{ task: 'backtest', status: 'skipped', reason: 'overlap' }])); } }, env: {} });
  assert.equal(ok.failed, false);

  const hung = await runCron({ worker: { async scheduled(_c, _e, ctx) { ctx.waitUntil(new Promise(() => {})); } }, env: {}, timeoutMs: 30 });
  assert.equal(hung.failed, true);
  assert.equal(hung.tasks[0].reason, 'cron_runner_timeout');
  assert.equal(summarizeRun([{ status: 'rejected', reason: new Error('boom') }]).failed, true);
});

test('background jobs run from GitHub every 5 minutes, only on main, with environment-scoped secrets', async () => {
  const wf = fs.readFileSync('.github/workflows/cron-runner.yml', 'utf8');
  assert.match(wf, /on:\n  workflow_dispatch:\n  schedule:\n[\s\S]*?- cron: "\*\/5 \* \* \* \*"/);
  assert.match(wf, /permissions:\n  contents: read\n/);
  assert.match(wf, /cancel-in-progress: false/);
  assert.match(wf, /    if: github\.ref == 'refs\/heads\/main'\n    environment: background-jobs\n/);
  assert.match(wf, /persist-credentials: false/);
  for (const line of wf.split('\n').filter(row => /uses:/.test(row))) assert.match(line, /@[0-9a-f]{40} #/);
  for (const key of CRON_RUNNER_SECRET_KEYS) assert.match(wf, new RegExp(`${key}: \\$\\{\\{ secrets\\.${key} \\}\\}`));
  assert.match(wf, /run: node scripts\/cron-runner\.js/);

  // Один исполнитель: cron Cloudflare выключен, иначе два делили бы блокировку cron-global.
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.match(wrangler, /"crons": \[\]/);

  const { auditWorkflow } = await import('../scripts/privileged-access-audit.js');
  assert.deepEqual(auditWorkflow('.github/workflows/cron-runner.yml', wf), []);
  const withoutEnvironment = wf.replace('    environment: background-jobs\n', '');
  assert.ok(auditWorkflow('.github/workflows/cron-runner.yml', withoutEnvironment).some(row => row.type === 'secret_environment_missing'));
  const extraSecret = wf.replace('TAVILY_KEY: ${{ secrets.TAVILY_KEY }}', 'TAVILY_KEY: ${{ secrets.TAVILY_KEY }}\n      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
  assert.ok(auditWorkflow('.github/workflows/cron-runner.yml', extraSecret).some(row => row.type === 'unexpected_secret_reference' && row.name === 'CLOUDFLARE_API_TOKEN'));
});

test('a missing lease fails the run, an overlap with a running job does not', () => {
  for (const reason of ['lease_unavailable', 'invalid_lease_claim', 'execution_lease_heartbeat_lost', 'execution_lease_completion_failed']) {
    assert.equal(summarizeRun([{ status: 'fulfilled', value: [{ task: 'scheduled_execution', status: 'skipped', reason }] }]).failed, true, reason);
  }
  for (const reason of ['overlap', 'duplicate', 'duplicate_active', 'cooldown']) {
    assert.equal(summarizeRun([{ status: 'fulfilled', value: [{ task: 'scheduled_execution', status: 'skipped', reason }] }]).failed, false, reason);
  }
  assert.equal(summarizeRun([{ status: 'fulfilled', value: [{ task: 'scheduled_execution', status: 'degraded', reason: 'lease_renewal_failed' }] }]).failed, true);
  assert.equal(summarizeRun([{ status: 'fulfilled', value: [{ task: 'reminders', status: 'skipped', reason: 'lease_unavailable' }] }]).failed, false, 'only the whole-run lease matters');
});

test('the run refuses to start without the mandatory job secrets', () => {
  const full = { SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k', TELEGRAM_BOT_TOKEN: 't', API_FOOTBALL_KEY: 'a' };
  assert.deepEqual(missingRequiredSecrets(full), []);
  assert.deepEqual(missingRequiredSecrets({ ...full, SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: 's' }), []);
  assert.deepEqual(missingRequiredSecrets({ ...full, TELEGRAM_BOT_TOKEN: '' }), ['TELEGRAM_BOT_TOKEN']);
  assert.deepEqual(missingRequiredSecrets({ ...full, API_FOOTBALL_KEY: undefined }), ['API_FOOTBALL_KEY']);
  assert.equal(missingRequiredSecrets({}).length, 4);
  assert.match(fs.readFileSync('scripts/cron-runner.js', 'utf8'), /const missing = missingRequiredSecrets\(env\);\n  if \(missing\.length\) \{/);
});
