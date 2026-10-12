// Задача 0: версии Cloudflare, созданные правкой секрета в панели или
// `wrangler secret put`. Cloudflare создаёт такую версию из кода, который был в
// проде, но без отметки CI (`release=… sha=…` и тега), и сразу переводит на неё
// 100% трафика. Здесь — только проверки формы версии; доказательство «код тот
// же» строится по истории деплоев и хешу кода (`resources.script.etag`).

const RELEASE_MESSAGE_RE = /^release=\S+ sha=[0-9a-f]{40}$/i;

// Единственный триггер, который принимаем: «Secret Change» в терминах wrangler.
export const SETTINGS_ONLY_TRIGGER = 'secret';

function annotation(version, key) {
  const value = version?.annotations?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function versionTrigger(version) {
  return annotation(version, 'workers/triggered_by').toLowerCase();
}

export function versionHasReleaseStamp(version) {
  return RELEASE_MESSAGE_RE.test(annotation(version, 'workers/message'))
    && annotation(version, 'workers/tag') !== '';
}

// Версия без отметки CI, созданная только правкой секрета. Любая другая версия
// без отметки (загрузка из панели, ручной `wrangler deploy`) сюда не попадает.
export function settingsOnlyVersion(version) {
  if (!version || typeof version !== 'object' || Array.isArray(version)) return false;
  return versionTrigger(version) === SETTINGS_ONLY_TRIGGER
    && annotation(version, 'workers/tag') === ''
    && !RELEASE_MESSAGE_RE.test(annotation(version, 'workers/message'));
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
