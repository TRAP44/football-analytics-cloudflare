export const CLIENT_VERSION = '6.120.0-rc144';
export const CLIENT_API_CONTRACT = 5;
export const CLIENT_RELEASE_CHANNEL = 'rc144';
export const FRONTEND_ASSET_REVISION = '6.120.0-launch80';
export const SUPABASE_SCHEMA_HINT = 'проверьте актуальную схему Supabase (baseline v6.19 + миграции до v6.29.14)';

export const UI_PREFERENCES_KEY = 'football-analytics:ui:v1';
export const FIRST_RUN_GUIDE_KEY = 'football-analytics:first-run-guide:v1';
export const MATCH_WATCHLIST_KEY = 'matchradar:watchlist:v1';

export const DEFAULT_UI_PREFERENCES = Object.freeze({
  theme: 'system',
  accent: 'system',
  buttonStyle: 'soft',
});

export const ACCENT_PALETTES = Object.freeze({
  green: Object.freeze({
    dark: Object.freeze({ accent: '#57e389', text: '#041009' }),
    light: Object.freeze({ accent: '#147a3d', text: '#ffffff' }),
  }),
  blue: Object.freeze({
    dark: Object.freeze({ accent: '#60a5fa', text: '#07111f' }),
    light: Object.freeze({ accent: '#1d4ed8', text: '#ffffff' }),
  }),
  violet: Object.freeze({
    dark: Object.freeze({ accent: '#c084fc', text: '#160624' }),
    light: Object.freeze({ accent: '#6d28d9', text: '#ffffff' }),
  }),
  amber: Object.freeze({
    dark: Object.freeze({ accent: '#fbbf24', text: '#1c1200' }),
    light: Object.freeze({ accent: '#92400e', text: '#ffffff' }),
  }),
});

const UI_THEME_VALUES=Object.freeze(['system','dark','light','ocean']);
const UI_ACCENT_VALUES=Object.freeze(['system','green','blue','violet','amber']);
const UI_BUTTON_STYLE_VALUES=Object.freeze(['soft','compact']);

function plainObject(value) {
  try {
    return value && typeof value==='object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function safeRead(value,key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeStorageText(storage,key) {
  try {
    const getItem=safeRead(storage,'getItem');
    if (typeof getItem!=='function') return '';
    const value=getItem.call(storage,key);
    return typeof value==='string' ? value : '';
  } catch {
    return '';
  }
}

function safeText(value,max) {
  if (typeof value!=='string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,max);
}

function positiveInteger(value) {
  if (typeof value==='number') {
    return Number.isSafeInteger(value) && value>0 ? value : 0;
  }
  if (typeof value!=='string') return 0;
  const raw=value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  const parsed=Number(raw);
  return Number.isSafeInteger(parsed) && parsed>0 ? parsed : 0;
}

function optionalPositiveInteger(value) {
  if (
    value===undefined
    || value===null
    || value===''
    || value===0
  ) return 0;
  return positiveInteger(value);
}

function safeHttpUrl(value) {
  if (typeof value!=='string' || !value.trim()) return '';
  try {
    const url=new URL(value.trim());
    if (!['http:','https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function defaultsCopy() {
  return {...DEFAULT_UI_PREFERENCES};
}

export function normalizeUiPreferences(value) {
  const saved=plainObject(value);
  if (!saved) return defaultsCopy();

  const theme=safeRead(saved,'theme');
  const accent=safeRead(saved,'accent');
  const buttonStyle=safeRead(saved,'buttonStyle');

  return {
    theme:typeof theme==='string' && UI_THEME_VALUES.includes(theme)
      ? theme
      : DEFAULT_UI_PREFERENCES.theme,
    accent:typeof accent==='string' && UI_ACCENT_VALUES.includes(accent)
      ? accent
      : DEFAULT_UI_PREFERENCES.accent,
    buttonStyle:
      typeof buttonStyle==='string'
      && UI_BUTTON_STYLE_VALUES.includes(buttonStyle)
        ? buttonStyle
        : DEFAULT_UI_PREFERENCES.buttonStyle,
  };
}

export function updateUiPreference(current,key,value) {
  if (
    typeof key!=='string'
    || typeof value!=='string'
    || !['theme','accent','buttonStyle'].includes(key)
  ) return null;

  const next=normalizeUiPreferences(current);
  const candidate=normalizeUiPreferences({
    ...next,
    [key]:value,
  });
  return candidate[key]===value ? candidate : null;
}

export function readUiPreferences(storage=globalThis.localStorage) {
  const raw=safeStorageText(storage,UI_PREFERENCES_KEY);
  if (!raw) return defaultsCopy();

  let saved;
  try {
    saved=JSON.parse(raw);
  } catch {
    return defaultsCopy();
  }
  return normalizeUiPreferences(saved);
}

function normalizeWatchlistItem(value) {
  const item=plainObject(value);
  if (!item) return null;

  const fixtureId=positiveInteger(safeRead(item,'fixtureId'));
  const homeName=safeText(safeRead(item,'homeName'),160);
  const awayName=safeText(safeRead(item,'awayName'),160);
  if (!fixtureId || !homeName || !awayName) return null;

  return {
    fixtureId,
    homeName,
    awayName,
    league:safeText(safeRead(item,'league'),160),
    date:safeText(safeRead(item,'date'),80),
    homeId:optionalPositiveInteger(safeRead(item,'homeId')),
    awayId:optionalPositiveInteger(safeRead(item,'awayId')),
    homeLogo:safeHttpUrl(safeRead(item,'homeLogo')).slice(0,2048),
    awayLogo:safeHttpUrl(safeRead(item,'awayLogo')).slice(0,2048),
    addedAt:safeText(safeRead(item,'addedAt'),80),
  };
}

export function readMatchWatchlist(storage=globalThis.localStorage) {
  const raw=safeStorageText(storage,MATCH_WATCHLIST_KEY);
  if (!raw) return [];

  let parsed;
  try {
    parsed=JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen=new Set();
  const out=[];
  for (const value of parsed.slice(0,200)) {
    const item=normalizeWatchlistItem(value);
    if (!item || seen.has(item.fixtureId)) continue;
    seen.add(item.fixtureId);
    out.push(item);
    if (out.length>=50) break;
  }
  return out;
}
