// Фоновые задачи (cron) вне Cloudflare.
//
// На тарифе Workers Free у cron-запуска 10 мс процессорного времени, поэтому
// запуски воркера обрываются, не доходя до конца. Этот скрипт выполняет тот
// же обработчик scheduled() из src/worker.js в обычном Node (GitHub Actions),
// где такого лимита нет. Задачи, блокировки (scheduled_job_leases) и данные —
// те же самые: запуск из GitHub и из Cloudflare не пересекаются благодаря
// общей блокировке cron-global.
//
// Секреты приходят только из переменных окружения (GitHub Secrets) и
// вырезаются из любого вывода.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CRON_RUNNER_SECRET_KEYS = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_PUBLISHER_BOT_TOKEN',
  'ADMIN_TELEGRAM_IDS',
  'BETA_TELEGRAM_IDS',
  'BETA_ACCESS_ENABLED',
  'API_FOOTBALL_KEY',
  'FOOTBALL_DATA_TOKEN',
  'TAVILY_KEY',
]);

const SLOT_MS = 5 * 60 * 1000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

// Слот cron (кратный 5 минутам), к которому относится запуск: GitHub запускает
// расписание с задержкой, а задачи проверяют интервалы по минутам слота.
export function cronSlot(nowMs = Date.now()) {
  return Math.floor(nowMs / SLOT_MS) * SLOT_MS;
}

export function wranglerVars(source) {
  const text = String(source || '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n');
  try {
    const vars = JSON.parse(text)?.vars;
    if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return {};
    return Object.fromEntries(Object.entries(vars)
      .filter(([key, value]) => /^[A-Z][A-Z0-9_]{0,80}$/.test(key) && ['string', 'number', 'boolean'].includes(typeof value))
      .map(([key, value]) => [key, String(value)]));
  } catch {
    return {};
  }
}

export function runnerEnv(processEnv = {}, vars = {}, { sha = '', now = Date.now() } = {}) {
  const env = { ...vars };
  for (const key of CRON_RUNNER_SECRET_KEYS) {
    const value = processEnv[key];
    if (typeof value === 'string' && value.trim()) env[key] = value.trim();
  }
  env.CF_VERSION_METADATA = {
    id: 'github-actions-cron',
    tag: /^[0-9a-f]{7,40}$/.test(String(sha)) ? String(sha) : 'github-actions',
    timestamp: new Date(now).toISOString(),
  };
  return env;
}

// Без этих ключей задачи «успешно» ничего не делают (уведомления без бота,
// расчёты без провайдера) — такой запуск должен быть красным, а не зелёным.
export function missingRequiredSecrets(env = {}) {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SECRET_KEY или SUPABASE_SERVICE_ROLE_KEY');
  if (!env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!env.API_FOOTBALL_KEY) missing.push('API_FOOTBALL_KEY');
  return missing;
}

export function redactor(env = {}) {
  const secrets = CRON_RUNNER_SECRET_KEYS
    .map(key => env[key])
    .filter(value => typeof value === 'string' && value.length >= 6)
    .sort((a, b) => b.length - a.length);
  return text => {
    let out = String(text ?? '');
    for (const secret of secrets) out = out.split(secret).join('***');
    // Токен бота в URL Telegram и ключи в query — даже если их нет в env.
    return out
      .replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot***')
      .replace(/([?&](?:key|token|apikey|api_key)=)[^&\s"]+/gi, '$1***');
  };
}

// Пропуск всего запуска из-за недоступной блокировки — это сбой, а не обычное
// «предыдущий запуск ещё идёт» (overlap/duplicate): иначе фоновые задачи
// молча перестанут работать при зелёном Actions.
const FAILED_SKIP_REASONS = new Set(['lease_unavailable', 'invalid_lease_claim', 'lease_not_claimed', 'lease_renewal_failed', 'renew_not_configured', 'heartbeat_timer_failed', 'execution_lease_heartbeat_lost', 'execution_lease_completion_failed']);

// Итог запуска: по каждой задаче — статус; провал — если упала хоть одна задача
// или весь запуск.
export function summarizeRun(settled = []) {
  const tasks = [];
  let failed = false;
  for (const entry of settled) {
    if (entry?.status === 'rejected') {
      failed = true;
      tasks.push({ task: 'scheduled_execution', status: 'failed', reason: String(entry.reason?.message || entry.reason || '') });
      continue;
    }
    for (const result of Array.isArray(entry?.value) ? entry.value : []) {
      if (!result || typeof result !== 'object') continue;
      const status = String(result.status || (result.ok === false ? 'failed' : 'ok'));
      const reason = String(result.reason || result.skipped || '');
      if (status === 'failed') failed = true;
      // Деградация всего запуска (потеря блокировки, незакрытая отметка) — тоже сбой.
      if (String(result.task || '') === 'scheduled_execution' && (status === 'degraded' || FAILED_SKIP_REASONS.has(reason))) failed = true;
      tasks.push({ task: String(result.task || ''), status, reason });
    }
  }
  return { failed, tasks };
}

export function degradedWarnings(tasks = []) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter(row => row && row.status === 'degraded' && row.task !== 'scheduled_execution')
    .map(row => `::warning title=Фоновая задача ${String(row.task).slice(0, 60)}::частичный сбой${row.reason ? `: ${String(row.reason).slice(0, 160)}` : ''}`);
}

export async function runCron({ worker, env, nowMs = Date.now(), timeoutMs = RUN_TIMEOUT_MS } = {}) {
  const pending = [];
  const ctx = {
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    passThroughOnException() {},
  };
  const scheduledTime = cronSlot(nowMs);
  let timer = null;
  const work = (async () => {
    const returned = await worker.scheduled({ scheduledTime, cron: '*/5 * * * *', noRetry() {} }, env, ctx);
    // Обработчик отдаёт работу в waitUntil; ждём, пока она завершится целиком
    // (в том числе то, что добавилось по ходу).
    const settled = [];
    for (let index = 0; index < pending.length; index += 1) {
      settled.push(...await Promise.allSettled([pending[index]]));
    }
    if (Array.isArray(returned)) settled.push({ status: 'fulfilled', value: returned });
    return settled;
  })();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('cron_runner_timeout')), timeoutMs);
  });
  try {
    const settled = await Promise.race([work, timeout]);
    return { scheduledTime, ...summarizeRun(settled) };
  } catch (error) {
    return { scheduledTime, failed: true, tasks: [{ task: 'scheduled_execution', status: 'failed', reason: String(error?.message || error) }] };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const vars = wranglerVars(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
  const env = runnerEnv(process.env, vars, { sha: process.env.GITHUB_SHA || '' });
  const redact = redactor(env);
  const missing = missingRequiredSecrets(env);
  if (missing.length) {
    console.error(`cron-runner: в окружении background-jobs не заданы обязательные ключи: ${missing.join(', ')} — запуск невозможен.`);
    process.exit(1);
  }
  const { default: worker } = await import(pathToFileURL(path.join(root, 'src', 'worker.js')).href);
  const result = await runCron({ worker, env });
  console.log(`cron-runner: слот ${new Date(result.scheduledTime).toISOString()}`);
  for (const row of result.tasks) {
    console.log(redact(`  ${row.task || '—'}: ${row.status}${row.reason ? ` (${row.reason.slice(0, 200)})` : ''}`));
  }
  // Частичный сбой задачи (например, часть доставок в Telegram не прошла —
  // пользователь заблокировал бота) — предупреждение в Actions, а не красный
  // запуск: иначе каждый заблокировавший бота делал бы все запуски красными.
  for (const line of degradedWarnings(result.tasks)) console.log(redact(line));
  // Ни одной задачи — обработчик остановился раньше (нет связи с Supabase,
  // защитный режим или пауза фоновых задач). Это видно как провал запуска.
  if (!result.tasks.length) console.log('  задачи не запускались (проверь ключи Supabase и runtime controls)');
  process.exit(result.failed || !result.tasks.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(redactor(runnerEnv(process.env))(`cron-runner: ${String(error?.message || error).slice(0, 300)}`));
    process.exit(1);
  });
}
