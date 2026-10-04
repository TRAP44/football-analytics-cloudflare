import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

function requireDbUrl() {
  const value = String(process.env.DB_URL || '').trim();
  if (!value.startsWith('postgresql://') && !value.startsWith('postgres://')) {
    throw new Error('DB_URL must point to the disposable local Supabase database.');
  }
  return value;
}

async function psql(sql) {
  const { stdout } = await execFileAsync(
    process.env.PSQL_BIN || 'psql',
    [
      requireDbUrl(),
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-A',
      '-t',
      '-c',
      sql,
    ],
    {
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );

  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) || '';
}

async function serviceRoleQuery(sql) {
  return psql('set role service_role; ' + sql);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(label + ' returned non-JSON output');
  }
}

function parsePgBoolean(text, label) {
  if (text === 't') return true;
  if (text === 'f') return false;
  throw new Error(label + ' returned unexpected boolean output');
}

async function testAnalysisQuota() {
  const telegramId = 900000000433;
  const usageDate = '2099-04-03';
  const limit = 5;

  await psql(
    'delete from public.usage_daily where telegram_id=' + telegramId + '; '
      + 'delete from public.users where telegram_id=' + telegramId + ';',
  );

  const results = await Promise.all(
    Array.from({ length: 12 }, () => serviceRoleQuery(
      'select public.consume_analysis_quota('
        + telegramId + ",date '" + usageDate + "'," + limit + ')::text;',
    )),
  );
  const decoded = results.map((value) => parseJson(value, 'consume_analysis_quota'));

  assert.equal(
    decoded.filter((item) => item.allowed === true).length,
    limit,
    'atomic analysis quota must allow exactly the configured number of claims',
  );

  const used = Number(await psql(
    'select analyses from public.usage_daily where telegram_id=' + telegramId
      + " and usage_date=date '" + usageDate + "';",
  ));
  assert.equal(used, limit, 'analysis quota row must stop exactly at the configured limit');
}

async function testProviderBudget() {
  const key = 'ci-433-provider-budget';
  const limit = 4;
  await psql(
    "delete from public.provider_rate_windows where bucket_key='" + key + "';",
  );

  const results = await Promise.all(
    Array.from({ length: 12 }, () => serviceRoleQuery(
      "select public.claim_provider_request('" + key + "'," + limit + ',60)::text;',
    )),
  );
  const decoded = results.map((value) => parseJson(value, 'claim_provider_request'));

  assert.equal(
    decoded.filter((item) => item.allowed === true).length,
    limit,
    'distributed provider budget must allow exactly the configured number of claims',
  );

  const count = Number(await psql(
    "select request_count from public.provider_rate_windows where bucket_key='" + key + "';",
  ));
  assert.equal(count, limit, 'provider budget row must not exceed the configured limit');
}

async function testTelegramDedupe() {
  const key = 'ci-433-telegram-update';
  await psql(
    "delete from public.telegram_update_claims where update_key='" + key + "';",
  );

  const results = await Promise.all(
    Array.from({ length: 12 }, () => serviceRoleQuery(
      "select public.claim_telegram_update('" + key + "',90);",
    )),
  );
  const claimed = results.map((value) => parsePgBoolean(value, 'claim_telegram_update'));

  assert.equal(
    claimed.filter(Boolean).length,
    1,
    'persistent Telegram dedupe must grant one active claim across concurrent sessions',
  );

  const duplicates = Number(await psql(
    "select duplicate_count from public.telegram_update_claims where update_key='" + key + "';",
  ));
  assert.equal(duplicates, 11, 'every rejected duplicate claim must be retained in telemetry');
}

async function testScheduledLease() {
  const group = 'ci-433-scheduled-group';

  await psql(
    "delete from public.scheduled_job_leases where group_key='" + group
      + "' or job_key like 'ci-433-scheduled-job-%';",
  );

  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => serviceRoleQuery(
      "select public.claim_scheduled_job('ci-433-scheduled-job-" + index
        + "','" + group + "',clock_timestamp(),120,600)::text;",
    )),
  );
  const decoded = results.map((value) => parseJson(value, 'claim_scheduled_job'));

  assert.equal(
    decoded.filter((item) => item.claimed === true).length,
    1,
    'scheduled group lease must grant exactly one concurrent owner',
  );

  const rows = Number(await psql(
    "select count(*) from public.scheduled_job_leases where group_key='" + group + "';",
  ));
  assert.equal(rows, 1, 'overlapping scheduled claims must not create competing lease rows');
}

async function cleanup() {
  await psql([
    'delete from public.usage_daily where telegram_id=900000000433',
    'delete from public.users where telegram_id=900000000433',
    "delete from public.provider_rate_windows where bucket_key='ci-433-provider-budget'",
    "delete from public.telegram_update_claims where update_key='ci-433-telegram-update'",
    "delete from public.scheduled_job_leases where group_key='ci-433-scheduled-group'",
  ].join('; ') + ';');
}

export async function runConcurrencyGate() {
  try {
    await testAnalysisQuota();
    await testProviderBudget();
    await testTelegramDedupe();
    await testScheduledLease();
  } finally {
    await cleanup();
  }

  console.log(
    'Supabase concurrency gate passed: quota, provider budget, Telegram dedupe and scheduled lease.',
  );
}

const isCli = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  try {
    await runConcurrencyGate();
  } catch (error) {
    console.error(String(error?.message || error));
    process.exit(1);
  }
}
