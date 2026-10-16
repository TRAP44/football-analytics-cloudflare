// Пакетирование однотипных фоновых вызовов Supabase (Issue #923). Вызовы с
// одинаковыми supabaseUrl + supabaseKey, пришедшие в окне windowMs, уходят одним
// REST-запросом (до maxSize штук). Каждый caller получает свой результат и ждёт
// подтверждения базы. При ошибке пакета каждый caller получает ошибку и сам
// решает, делать ли прежний индивидуальный вызов. Неизвестная identity —
// индивидуальный вызов, разные проекты/ключи не смешиваются.
export function createSupabaseCallBatcher(run, { maxSize = 100, windowMs = 2 } = {}) {
  if (typeof run !== 'function') throw new TypeError('Supabase call batcher requires run(cfg, items).');
  const groups = new Map();

  function settle(group) {
    const items = group.jobs.map(job => job.item);
    Promise.resolve()
      .then(() => run(group.cfg, items))
      .then(results => {
        if (!Array.isArray(results) || results.length !== items.length) {
          throw new Error('Supabase batch returned a result count that does not match its callers.');
        }
        group.jobs.forEach((job, index) => job.resolve(results[index]));
      }, error => {
        for (const job of group.jobs) job.reject(error);
      })
      .catch(error => {
        for (const job of group.jobs) job.reject(error);
      });
  }

  function flush(key, group) {
    if (groups.get(key) !== group) return;
    groups.delete(key);
    clearTimeout(group.timer);
    settle(group);
  }

  return function enqueue(cfg, item) {
    if (typeof cfg?.supabaseUrl !== 'string' || !cfg.supabaseUrl || typeof cfg?.supabaseKey !== 'string' || !cfg.supabaseKey) {
      return Promise.resolve().then(() => run(cfg, [item])).then(results => {
        if (!Array.isArray(results) || results.length !== 1) throw new Error('Supabase call returned an invalid result.');
        return results[0];
      });
    }
    const key = JSON.stringify([cfg.supabaseUrl, cfg.supabaseKey]);
    let group = groups.get(key);
    if (!group) {
      // Конфигурация соединения копируется при постановке в очередь.
      group = { cfg: { ...cfg }, jobs: [], timer: null };
      groups.set(key, group);
      group.timer = setTimeout(() => flush(key, group), windowMs);
    }
    return new Promise((resolve, reject) => {
      group.jobs.push({ item, resolve, reject });
      if (group.jobs.length >= maxSize) flush(key, group);
    });
  };
}
