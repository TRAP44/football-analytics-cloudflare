export const CLIENT_VERSION = '6.120.0-rc144';
export const CLIENT_API_CONTRACT = 5;
export const CLIENT_RELEASE_CHANNEL = 'rc144';
export const FRONTEND_ASSET_REVISION = '6.120.0-rc144';
export const SUPABASE_SCHEMA_HINT = 'проверьте актуальную схему Supabase (baseline v6.19 + миграции до v6.29.1)';

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

export function readUiPreferences(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(UI_PREFERENCES_KEY) || '{}');
    return {
      theme: ['system', 'dark', 'light', 'ocean'].includes(saved.theme) ? saved.theme : DEFAULT_UI_PREFERENCES.theme,
      accent: ['system', 'green', 'blue', 'violet', 'amber'].includes(saved.accent) ? saved.accent : DEFAULT_UI_PREFERENCES.accent,
      buttonStyle: ['soft', 'compact'].includes(saved.buttonStyle) ? saved.buttonStyle : DEFAULT_UI_PREFERENCES.buttonStyle,
    };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}


export function readMatchWatchlist(storage = localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(MATCH_WATCHLIST_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw
      .map(item => ({
        fixtureId: Number(item?.fixtureId || 0),
        homeName: String(item?.homeName || '').trim().slice(0, 160),
        awayName: String(item?.awayName || '').trim().slice(0, 160),
        league: String(item?.league || '').trim().slice(0, 160),
        date: String(item?.date || '').trim().slice(0, 80),
        homeId: Number(item?.homeId || 0),
        awayId: Number(item?.awayId || 0),
        homeLogo: String(item?.homeLogo || '').trim().slice(0, 2048),
        awayLogo: String(item?.awayLogo || '').trim().slice(0, 2048),
        addedAt: String(item?.addedAt || '').trim().slice(0, 80),
      }))
      .filter(item => {
        if (!Number.isSafeInteger(item.fixtureId) || item.fixtureId <= 0 || seen.has(item.fixtureId)) return false;
        if (!item.homeName || !item.awayName) return false;
        seen.add(item.fixtureId);
        return true;
      })
      .slice(0, 50);
  } catch {
    return [];
  }
}
