export const CLIENT_VERSION = '6.120.0-rc144';
export const CLIENT_API_CONTRACT = 5;
export const CLIENT_RELEASE_CHANNEL = 'rc144';
export const SUPABASE_SCHEMA_HINT = 'проверьте актуальную схему Supabase (baseline v6.19 + миграция v6.20)';

export const UI_PREFERENCES_KEY = 'football-analytics:ui:v1';
export const FIRST_RUN_GUIDE_KEY = 'football-analytics:first-run-guide:v1';
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

export function appSurface(documentRef = document) {
  return documentRef.querySelector('meta[name="matchradar-surface"]')?.content === 'admin' ? 'admin' : 'public';
}

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
