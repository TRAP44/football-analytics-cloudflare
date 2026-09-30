export const VIEW_CHROME = Object.freeze({
  matchesView: Object.freeze(['Главная', 'Видим, что меняет матч.']),
  searchView: Object.freeze(['Поиск', 'Найдите команду или матч']),
  myTeamsView: Object.freeze(['Мои команды', 'Избранные клубы и их матчи']),
  tournamentView: Object.freeze(['Турнир', 'Матчи и таблица']),
  teamView: Object.freeze(['Команда', 'Матчи и данные клуба']),
  playerView: Object.freeze(['Игрок', 'Показатели и роль в текущем матче']),
  analysisView: Object.freeze(['Матч-центр', 'Что происходит, почему и что важно дальше']),
  historyView: Object.freeze(['История', 'Сохранённые AI-разборы']),
  profileView: Object.freeze(['Профиль', 'Напоминания и настройки']),
});

export const BACK_VIEW_LABELS = Object.freeze({
  matchesView: 'К матчам',
  searchView: 'К поиску',
  historyView: 'К истории',
  profileView: 'К профилю',
  tournamentView: 'К турниру',
  teamView: 'К команде',
  playerView: 'К игроку',
  analysisView: 'К матчу',
});

export function createViewChromeController({
  elementById,
  telegramWebApp,
  resolveBackTarget,
  isTelegramBackVisible,
} = {}) {
  const $ = elementById;

  function syncTopbar(id) {
    const [title, subtitle] = VIEW_CHROME[id] || VIEW_CHROME.matchesView;
    const titleEl = $('topbarTitle');
    const subtitleEl = $('topbarSubtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
  }

  function syncBackButtons() {
    const bindings = [
      ['backBtn', resolveBackTarget('analysisView')],
      ['teamBackBtn', resolveBackTarget('teamView')],
      ['playerBackBtn', resolveBackTarget('playerView')],
      ['tournamentBackBtn', resolveBackTarget('tournamentView')],
    ];
    bindings.forEach(([id, target]) => {
      const button = $(id);
      if (button) button.textContent = `← ${BACK_VIEW_LABELS[target] || 'Назад'}`;
    });
  }

  function syncTelegramBackButton(id) {
    if (!telegramWebApp?.BackButton) return;
    try {
      if (isTelegramBackVisible(id)) telegramWebApp.BackButton.show();
      else telegramWebApp.BackButton.hide();
    } catch {}
  }

  return Object.freeze({
    syncTopbar,
    syncBackButtons,
    syncTelegramBackButton,
  });
}
