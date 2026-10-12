// Задача 0: версии Cloudflare, созданные правкой секрета или переменной в панели
// или `wrangler secret put`. Cloudflare создаёт такую версию из кода, который был
// в проде, но без отметки CI (`release=… sha=…` и тега), и сразу переводит на неё
// 100% трафика. Пометка триггера у таких версий разная (у правки в панели —
// не `secret`), поэтому решает не она, а доказательство «код тот же»: история
// деплоев ведёт к версии CI, и хеш кода (`resources.script.etag`) совпадает.

const RELEASE_MESSAGE_RE = /^release=\S+ sha=([0-9a-f]{40})$/i;

function annotation(version, key) {
  const value = version?.annotations?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function versionTrigger(version) {
  return annotation(version, 'workers/triggered_by').toLowerCase();
}

// Отметка CI: сообщение `release=… sha=…` и тег, равный этому SHA.
export function versionHasReleaseStamp(version) {
  const message = RELEASE_MESSAGE_RE.exec(annotation(version, 'workers/message'));
  return Boolean(message) && annotation(version, 'workers/tag').toLowerCase() === message[1].toLowerCase();
}

// Версия без отметки CI — кандидат «после правки настроек». Принимается только
// вместе с доказательством того же кода (assertSameScriptContent).
export function settingsOnlyVersion(version) {
  if (!version || typeof version !== 'object' || Array.isArray(version)) return false;
  return !versionHasReleaseStamp(version);
}

// Для диагностики в Summary деплоя: только пометки и наличие хеша, без значений.
export function describeVersion(version) {
  const value = version && typeof version === 'object' ? version : {};
  const show = text => (text ? text.slice(0, 40).replace(/[^\w .:=+-]/g, '?') : '—');
  return [
    `id=${show(String(value.id || ''))}`,
    `trigger=${show(versionTrigger(value))}`,
    `source=${show(String(value.metadata?.source || ''))}`,
    `message=${annotation(value, 'workers/message') ? (RELEASE_MESSAGE_RE.test(annotation(value, 'workers/message')) ? 'release' : 'other') : 'none'}`,
    `tag=${annotation(value, 'workers/tag') ? 'present' : 'none'}`,
    `etag=${scriptContentEtag(value) ? 'present' : 'none'}`,
  ].join(' ');
}

export function scriptContentEtag(version) {
  const etag = version?.resources?.script?.etag;
  if (typeof etag !== 'string') return '';
  const value = etag.trim();
  return value.length >= 8 && value.length <= 200 && /^[\x21-\x7e]+$/.test(value) ? value : '';
}

export function assertSameScriptContent(settingsVersion, baseVersion) {
  const settingsEtag = scriptContentEtag(settingsVersion);
  const baseEtag = scriptContentEtag(baseVersion);
  if (!settingsEtag || !baseEtag) {
    throw new Error('Script content hash (resources.script.etag) is missing; settings-only version cannot be proven equal to the CI-stamped version.');
  }
  if (settingsEtag !== baseEtag) {
    throw new Error(`Settings-only version ${settingsVersion?.id || 'unknown'} runs different script content than CI-stamped version ${baseVersion?.id || 'unknown'}.`);
  }
}
