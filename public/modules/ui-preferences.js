import {
  UI_PREFERENCES_KEY,
  DEFAULT_UI_PREFERENCES,
  ACCENT_PALETTES,
} from './app-runtime.js';

export function createInterfacePreferencesController({
  document,
  window,
  tg,
  state,
  storage,
  toast,
}) {
  function preferredAccentMode(theme) {
    if (theme === 'light') return 'light';
    if (theme === 'dark' || theme === 'ocean') return 'dark';
    if (tg?.colorScheme === 'light') return 'light';
    if (tg?.colorScheme === 'dark') return 'dark';
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyAccentPreference(prefs = state.uiPreferences || DEFAULT_UI_PREFERENCES) {
    const root = document.documentElement;
    const choice = String(prefs.accent || 'system');
    root.dataset.accent = choice;
    if (choice === 'system' || !ACCENT_PALETTES[choice]) {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-text');
      return;
    }
    const pair = ACCENT_PALETTES[choice][preferredAccentMode(prefs.theme)] || ACCENT_PALETTES[choice].dark;
    root.style.setProperty('--accent', pair.accent);
    root.style.setProperty('--accent-text', pair.text);
  }

  function advancedAppearanceLabel(prefs = state.uiPreferences || DEFAULT_UI_PREFERENCES) {
    const parts = [];
    if (prefs.theme === 'ocean') parts.push('Океан');
    const accentLabels = {
      green: 'Зелёный акцент',
      blue: 'Синий акцент',
      violet: 'Фиолетовый акцент',
      amber: 'Янтарный акцент',
    };
    if (prefs.accent !== 'system' && accentLabels[prefs.accent]) parts.push(accentLabels[prefs.accent]);
    if (prefs.buttonStyle === 'compact') parts.push('Строгие кнопки');
    return parts.length ? parts.join(' · ') : 'По умолчанию';
  }

  function applyInterfacePreferences({ announce = false } = {}) {
    const prefs = state.uiPreferences || DEFAULT_UI_PREFERENCES;
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.buttonStyle = prefs.buttonStyle;
    applyAccentPreference(prefs);

    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === prefs.theme;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-button-style-choice]').forEach(button => {
      const active = button.dataset.buttonStyleChoice === prefs.buttonStyle;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-accent-choice]').forEach(button => {
      const active = button.dataset.accentChoice === prefs.accent;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const advancedSummary = document.getElementById('advancedAppearanceSummary');
    if (advancedSummary) advancedSummary.textContent = advancedAppearanceLabel(prefs);

    window.requestAnimationFrame(() => {
      const background = window.getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1220';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
      try { tg?.setHeaderColor(background); } catch {}
      try { tg?.setBackgroundColor(background); } catch {}
    });

    if (announce) toast('Оформление применено');
  }

  function saveInterfacePreference(key, value) {
    state.uiPreferences = { ...state.uiPreferences, [key]: value };
    try { storage.setItem(UI_PREFERENCES_KEY, JSON.stringify(state.uiPreferences)); } catch {}
    applyInterfacePreferences({ announce: true });
  }

  return {
    applyInterfacePreferences,
    saveInterfacePreference,
  };
}
