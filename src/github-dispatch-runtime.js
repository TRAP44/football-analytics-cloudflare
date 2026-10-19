// Фоновые задачи: Cloudflare cron как надёжные часы, GitHub Actions как исполнитель.
//
// Расписание GitHub (`schedule`) в этом репозитории срабатывает раз в несколько
// часов, а cron Cloudflare на Workers Free даёт 10 мс CPU — на сами задачи не
// хватает, но на один запрос «запусти workflow» хватает с запасом. Поэтому
// cron Cloudflare каждые 5 минут только просит GitHub запустить
// `.github/workflows/cron-runner.yml` на `main`.
//
// Токен — fine-grained, только этот репозиторий, право «Actions: Read and write»
// (запуск workflow; кода не меняет). Хранится только в секретах Cloudflare.

export const BACKGROUND_JOBS_WORKFLOW = 'cron-runner.yml';
export const BACKGROUND_JOBS_REF = 'main';
export const DEFAULT_DISPATCH_REPOSITORY = 'TRAP44/football-analytics-cloudflare';
const REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const DISPATCH_TIMEOUT_MS = 5000;

export function dispatchRepository(value) {
  const repository = String(value || '').trim();
  if (!repository) return DEFAULT_DISPATCH_REPOSITORY;
  return REPOSITORY_RE.test(repository) && !repository.includes('..') ? repository : '';
}

export function backgroundJobsDispatchUrl(repository) {
  return `https://api.github.com/repos/${repository}/actions/workflows/${BACKGROUND_JOBS_WORKFLOW}/dispatches`;
}

// Возвращает { dispatched, reason, status }. Никогда не бросает и не выводит токен.
export async function dispatchBackgroundJobs(cfg = {}, { fetchImpl = globalThis.fetch, timeoutMs = DISPATCH_TIMEOUT_MS } = {}) {
  const token = typeof cfg.githubDispatchToken === 'string' ? cfg.githubDispatchToken.trim() : '';
  if (!token) return { dispatched: false, reason: 'token_missing', status: 0 };
  if (/\s/.test(token) || token.length > 400) return { dispatched: false, reason: 'token_invalid', status: 0 };
  const repository = dispatchRepository(cfg.githubDispatchRepository);
  if (!repository) return { dispatched: false, reason: 'repository_invalid', status: 0 };
  if (typeof fetchImpl !== 'function') return { dispatched: false, reason: 'fetch_unavailable', status: 0 };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DISPATCH_TIMEOUT_MS)) : null;
  try {
    const response = await fetchImpl(backgroundJobsDispatchUrl(repository), {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'MatchRadar-Background-Jobs',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: BACKGROUND_JOBS_REF }),
      redirect: 'manual',
      ...(controller ? { signal: controller.signal } : {}),
    });
    const status = Number(response?.status || 0);
    if (status === 204 || status === 200) return { dispatched: true, reason: '', status };
    if (status === 429 || (status === 403 && (response.headers?.get('x-ratelimit-remaining') === '0' || response.headers?.has('retry-after')))) return { dispatched: false, reason: 'rate_limited', status };
    if (status === 401 || status === 403) return { dispatched: false, reason: 'token_rejected', status };
    if (status === 404) return { dispatched: false, reason: 'workflow_or_repository_not_found', status };
    if (status === 422) return { dispatched: false, reason: 'dispatch_rejected', status };
    return { dispatched: false, reason: 'github_unavailable', status };
  } catch (error) {
    return { dispatched: false, reason: error?.name === 'AbortError' ? 'timeout' : 'network_error', status: 0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
