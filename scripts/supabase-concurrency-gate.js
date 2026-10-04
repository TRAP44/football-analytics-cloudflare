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

  const owner=decoded.find((item)=>item.claimed===true);
  assert.ok(owner?.jobKey,'scheduled lease owner must expose its job key');
  assert.ok(owner?.leaseToken,'scheduled lease owner must expose its lease token');

  const before=await psql(
    "select extract(epoch from locked_until)::bigint from public.scheduled_job_leases where job_key='"
      + owner.jobKey + "';",
  );
  await psql("select pg_sleep(0.05);");
  const renewed=parseJson(await serviceRoleQuery(
    "select public.renew_scheduled_job('" + owner.jobKey + "','"
      + owner.leaseToken + "',120)::text;",
  ),'renew_scheduled_job');
  assert.equal(renewed.renewed,true,'active owner heartbeat must renew its lease');

  const after=await psql(
    "select extract(epoch from locked_until)::bigint from public.scheduled_job_leases where job_key='"
      + owner.jobKey + "';",
  );
  assert.ok(Number(after)>=Number(before),'heartbeat must not shorten the active lease');

  const staleRenew=parseJson(await serviceRoleQuery(
    "select public.renew_scheduled_job('" + owner.jobKey
      + "','stale-token-000000000000',120)::text;",
  ),'renew_scheduled_job stale token');
  assert.equal(staleRenew.renewed,false,'stale lease token must not renew ownership');

  const overlapping=parseJson(await serviceRoleQuery(
    "select public.claim_scheduled_job('ci-433-scheduled-job-heartbeat-overlap','"
      + group + "',clock_timestamp(),120,600)::text;",
  ),'claim_scheduled_job heartbeat overlap');
  assert.equal(overlapping.claimed,false,'second run must stay blocked while heartbeat lease is active');
  assert.equal(overlapping.reason,'overlap');

  await psql(
    "update public.scheduled_job_leases set locked_until=clock_timestamp()-interval '1 second'"
      + " where job_key='" + owner.jobKey + "';",
  );

  const staleComplete=parsePgBoolean(await serviceRoleQuery(
    "select public.complete_scheduled_job('" + owner.jobKey + "','"
      + owner.leaseToken + "');",
  ),'complete_scheduled_job expired owner');
  assert.equal(staleComplete,false,'expired owner must not complete after ownership loss');

  const reclaimed=parseJson(await serviceRoleQuery(
    "select public.claim_scheduled_job('ci-433-scheduled-job-reclaimed','"
      + group + "',clock_timestamp(),120,600)::text;",
  ),'claim_scheduled_job reclaim');
  assert.equal(reclaimed.claimed,true,'group lease must be reclaimable after heartbeat stops and lease expires');
  assert.notEqual(reclaimed.leaseToken,owner.leaseToken,'reclaim must issue a new owner token');

  const staleRelease=parsePgBoolean(await serviceRoleQuery(
    "select public.release_scheduled_job('" + owner.jobKey + "','"
      + owner.leaseToken + "');",
  ),'release_scheduled_job stale owner');
  assert.equal(staleRelease,false,'stale owner must not release after another run reclaimed the group');

  const rows = Number(await psql(
    "select count(*) from public.scheduled_job_leases where group_key='" + group + "';",
  ));
  assert.equal(rows, 2, 'reclaim should retain the stale audit row and create one current owner row');
}

async function testSensitiveMutationIdempotency() {
  const operationKey='435'.padEnd(64,'a');
  const requestDigest='435'.padEnd(64,'b');
  const retryKey='436'.padEnd(64,'c');
  const retryDigest='436'.padEnd(64,'d');

  await psql(
    "delete from public.sensitive_mutation_idempotency where operation_key in ('"
      + operationKey + "','" + retryKey + "');",
  );

  const results=await Promise.all(
    Array.from({length:12},()=>serviceRoleQuery(
      "select public.claim_sensitive_mutation('"
        + operationKey + "',900000000435,'POST','/api/runtime-controls','"
        + requestDigest + "',null,300,300)::text;",
    )),
  );
  const decoded=results.map(value=>parseJson(value,'claim_sensitive_mutation'));
  assert.equal(
    decoded.filter(item=>item.claimed===true).length,
    1,
    'distributed sensitive mutation claim must grant exactly one owner',
  );

  const owner=decoded.find(item=>item.claimed===true);
  assert.ok(owner?.leaseToken,'winning sensitive mutation claim must return a lease token');

  const completed=parseJson(await serviceRoleQuery(
    "select public.complete_sensitive_mutation('"
      + operationKey + "','" + owner.leaseToken + "',300)::text;",
  ),'complete_sensitive_mutation');
  assert.equal(completed.ok,true,'winning owner must complete the operation');

  const completedDuplicate=parseJson(await serviceRoleQuery(
    "select public.claim_sensitive_mutation('"
      + operationKey + "',900000000435,'POST','/api/runtime-controls','"
      + requestDigest + "',null,300,300)::text;",
  ),'claim_sensitive_mutation completed duplicate');
  assert.equal(completedDuplicate.claimed,false);
  assert.equal(completedDuplicate.reason,'duplicate_completed');

  const retryClaim=parseJson(await serviceRoleQuery(
    "select public.claim_sensitive_mutation('"
      + retryKey + "',900000000435,'POST','/api/runtime-controls/rollback','"
      + retryDigest + "',null,300,300)::text;",
  ),'claim_sensitive_mutation retry');
  assert.equal(retryClaim.claimed,true);

  const failed=parseJson(await serviceRoleQuery(
    "select public.fail_sensitive_mutation('"
      + retryKey + "','" + retryClaim.leaseToken + "',true,300)::text;",
  ),'fail_sensitive_mutation');
  assert.equal(failed.ok,true);
  assert.equal(failed.retryable,true);

  const retryOwner=parseJson(await serviceRoleQuery(
    "select public.claim_sensitive_mutation('"
      + retryKey + "',900000000435,'POST','/api/runtime-controls/rollback','"
      + retryDigest + "',null,300,300)::text;",
  ),'claim_sensitive_mutation retry owner');
  assert.equal(retryOwner.claimed,true,'retryable failed mutation must be reclaimable');
  assert.equal(retryOwner.reason,'retry_failed');
}

async function cleanup() {
  await psql([
    'delete from public.usage_daily where telegram_id=900000000433',
    'delete from public.users where telegram_id=900000000433',
    "delete from public.provider_rate_windows where bucket_key='ci-433-provider-budget'",
    "delete from public.telegram_update_claims where update_key='ci-433-telegram-update'",
    "delete from public.scheduled_job_leases where group_key='ci-433-scheduled-group'",
    "delete from public.sensitive_mutation_idempotency where actor_id=900000000435",
  ].join('; ') + ';');
}

export async function runConcurrencyGate() {
  try {
    await testAnalysisQuota();
    await testProviderBudget();
    await testTelegramDedupe();
    await testScheduledLease();
    await testSensitiveMutationIdempotency();
  } finally {
    await cleanup();
  }

  console.log(
    'Supabase concurrency gate passed: quota, provider budget, Telegram dedupe, renewable scheduled lease and sensitive mutation idempotency.',
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
