(() => {
  'use strict';
  // This module is a standalone UI prototype. There are no API, auth, billing,
  // or real-match-data calls. Every sporting value is deliberately fictional.
  const root = document.documentElement;
  const tg = window.Telegram?.WebApp ?? null;
  const views = new Set(['home', 'match', 'ai', 'profile']);
  const matchTabs = ['overview', 'ai', 'live', 'lineup'];
  const scenarios = Object.freeze({
    base: Object.freeze({
      probabilities: [43, 26, 31],
      heading: 'Контроль ещё не равен победе',
      copy: 'В условной модели «Атлас» активнее, но один момент способен изменить картину. Отсутствие подтверждённых составов снижает надёжность оценки.',
      badge: 'BASELINE · СИМУЛЯЦИЯ',
      confidence: 'Уверенность: умеренная',
    }),
    homeGoal: Object.freeze({
      probabilities: [68, 19, 13],
      heading: 'Гол превращает давление в преимущество',
      copy: 'Вымышленный гол хозяев меняет сценарий: вероятность их победы увеличивается. В реальном продукте пересчёт зависит от минуты, силы команд и источников.',
      badge: 'GOAL EVENT · СИМУЛЯЦИЯ',
      confidence: 'Уверенность: условная',
    }),
    redCard: Object.freeze({
      probabilities: [21, 24, 55],
      heading: 'Удаление разрушает исходный баланс',
      copy: 'В этом демонстрационном случае красная карточка хозяев резко меняет модельную оценку. Числа нельзя переносить на реальные матчи.',
      badge: 'RED CARD · СИМУЛЯЦИЯ',
      confidence: 'Уверенность: условная',
    }),
  });
  const fixtures = Object.freeze([
    {id: 'atlas', time: '67\'', status: 'live', label: 'LIVE', home: 'Атлас', away: 'Орион', score: '1 : 1', initials: ['A', 'O']},
    {id: 'valencia', time: '20:15', status: 'upcoming', label: 'СКОРО', home: 'Вектор', away: 'Норд', score: '— : —', initials: ['V', 'N']},
    {id: 'delta', time: '21:45', status: 'upcoming', label: 'СКОРО', home: 'Дельта', away: 'Арка', score: '— : —', initials: ['D', 'A']},
    {id: 'helios', time: '53\'', status: 'live', label: 'LIVE', home: 'Гелиос', away: 'Комета', score: '0 : 2', initials: ['H', 'K']},
  ]);
  const el = id => document.getElementById(id);
  const navButtons = Array.from(document.querySelectorAll('[data-nav]'));
  let currentView = 'home';
  let currentTab = 'overview';
  let activeFilter = 'all';
  const favorites = new Set();
  let toastTimer = null;

  function haptic() {
    try { tg?.HapticFeedback?.selectionChanged?.(); } catch { /* unsupported */ }
  }
  function toast(message) {
    const target = el('toast');
    if (!target) return;
    target.textContent = message;
    target.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => target.classList.remove('visible'), 3200);
  }
  function openView(name, options = {}) {
    if (!views.has(name)) return;
    currentView = name;
    for (const view of views) {
      const panel = el(`view-${view}`);
      if (panel) panel.hidden = view !== name;
    }
    document.querySelectorAll('.bottom-nav [data-nav]').forEach(button => {
      const active = button.dataset.nav === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (options.tab && name === 'match') openTab(options.tab, {focus: false});
    window.scrollTo({top: 0, behavior: 'instant'});
    haptic();
  }
  function openTab(name, options = {}) {
    if (!matchTabs.includes(name)) return;
    currentTab = name;
    matchTabs.forEach(key => {
      const button = el(`tab-${key}`);
      const panel = el(`panel-${key}`);
      const active = key === name;
      if (panel) panel.hidden = !active;
      if (button) {
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active && options.focus) button.focus();
      }
    });
    haptic();
  }
  function generateFixture(row) {
    const container = document.createElement('div');
    container.className = 'fixture-row';
    container.setAttribute('role', 'group');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'fixture-open';
    open.setAttribute('aria-label', `Открыть матч ${row.home} — ${row.away}`);
    // Separate interactive siblings: a large tappable match surface and a favorite button.
    // This preserves keyboard and screen-reader semantics without nested buttons.
    const time = document.createElement('div');
    time.className = 'fixture-time';
    const bold = document.createElement('strong');
    bold.textContent = row.time;
    const label = document.createElement('span');
    label.textContent = row.label;
    if (row.status === 'live') label.className = 'live';
    time.append(bold, label);
    const teams = document.createElement('div');
    teams.className = 'fixture-teams';
    [row.home, row.away].forEach((name, index) => {
      const line = document.createElement('div');
      const shield = document.createElement('span');
      shield.className = index === 1 ? 'mini-shield other' : 'mini-shield';
      shield.textContent = row.initials[index];
      const title = document.createElement('b');
      title.textContent = name;
      line.append(shield, title);
      teams.append(line);
    });
    const value = document.createElement('div');
    value.className = 'fixture-value';
    value.textContent = row.score;
    open.append(time, teams, value);
    open.addEventListener('click', () => {
      if (row.id === 'atlas') openView('match');
      else toast('Для этого матча пока доступна только демонстрационная карточка.');
    });
    const favorite = document.createElement('button');
    favorite.className = `favorite${favorites.has(row.id) ? ' saved' : ''}`;
    favorite.type = 'button';
    favorite.setAttribute('aria-label', `Добавить ${row.home} — ${row.away} в избранное`);
    favorite.setAttribute('aria-pressed', String(favorites.has(row.id)));
    favorite.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-star"/></svg>';
    favorite.addEventListener('click', () => {
      if (favorites.has(row.id)) favorites.delete(row.id);
      else favorites.add(row.id);
      renderFixtures();
      el('favoritesCount').textContent = String(favorites.size);
      haptic();
    });
    container.append(open, favorite);
    return container;
  }
  function renderFixtures() {
    const rootList = el('fixtureList');
    if (!rootList) return;
    rootList.replaceChildren();
    const visible = fixtures.filter(row => activeFilter === 'all'
      || row.status === activeFilter
      || (activeFilter === 'favorites' && favorites.has(row.id)));
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = activeFilter === 'favorites'
        ? 'Здесь пока пусто. Нажмите на звёздочку любого матча, чтобы добавить его.'
        : 'Матчей с таким статусом нет. Используйте «Сбросить» для возврата.';
      rootList.append(empty);
      return;
    }
    visible.forEach(row => rootList.append(generateFixture(row)));
  }
  function setFilter(name) {
    if (!['all', 'live', 'upcoming', 'favorites'].includes(name)) return;
    activeFilter = name;
    document.querySelectorAll('[data-filter]').forEach(button => {
      const active = button.dataset.filter === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderFixtures();
    haptic();
  }
  function chooseScenario(name) {
    const scenario = scenarios[name];
    if (!scenario) return;
    document.querySelectorAll('[data-scenario]').forEach(button => {
      const active = button.dataset.scenario === name;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('active', active);
    });
    const [home, draw, away] = scenario.probabilities;
    if (home + draw + away !== 100) throw new Error('Demo probability vector must total 100%');
    el('forecastTop').innerHTML = `${home}<span>%</span>`;
    el('forecastNote').textContent = name === 'redCard' ? 'Сценарий меняет лидера распределения' : 'Наиболее вероятный отдельный исход';
    el('segHome').style.width = `${home}%`;
    el('segDraw').style.width = `${draw}%`;
    el('segAway').style.width = `${away}%`;
    el('probHome').textContent = `${home}%`;
    el('probDraw').textContent = `${draw}%`;
    el('probAway').textContent = `${away}%`;
    const perimeter = 2 * Math.PI * 65;
    el('radialArc').setAttribute('stroke-dasharray', `${(home * perimeter / 100).toFixed(1)} ${perimeter.toFixed(1)}`);
    el('scenarioBadge').textContent = scenario.badge;
    el('scenarioConfidence').textContent = scenario.confidence;
    el('scenarioHeading').textContent = scenario.heading;
    el('scenarioCopy').textContent = scenario.copy;
    haptic();
  }
  function enableTelegramIntegration() {
    if (!tg) return;
    try { tg.ready(); tg.expand(); } catch { /* standalone browser */ }
    const applySafeArea = () => {
      try {
        const safe = tg.safeAreaInset ?? {};
        const content = tg.contentSafeAreaInset ?? {};
        const top = Math.max(0, Math.min(100, Number(safe.top || 0) + Number(content.top || 0)));
        const bottom = Math.max(0, Math.min(100, Number(safe.bottom || 0) + Number(content.bottom || 0)));
        root.style.setProperty('--tg-safe-top', `${top}px`);
        root.style.setProperty('--tg-safe-bottom', `${bottom}px`);
      } catch { /* optional version API */ }
    };
    applySafeArea();
    try { tg.onEvent('safeAreaChanged', applySafeArea); tg.onEvent('contentSafeAreaChanged', applySafeArea); } catch { /* compatibility */ }
  }
  async function sharePreview() {
    if (location.protocol !== 'https:') {
      toast('Ссылка появится после публикации демо на тестовом адресе.');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(location.href);
        toast('Ссылка на интерактивный прототип скопирована.');
      } else toast('Откройте адрес прототипа в браузере и скопируйте его.');
    } catch { toast('Скопируйте адрес прототипа из адресной строки.'); }
  }
  navButtons.forEach(button => button.addEventListener('click', () => openView(button.dataset.nav, {tab: button.dataset.openTab})));
  document.querySelectorAll('[data-tab]').forEach((button, index) => {
    button.addEventListener('click', () => openTab(button.dataset.tab));
    button.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? matchTabs.length - 1
        : (index + (e.key === 'ArrowRight' ? 1 : -1) + matchTabs.length) % matchTabs.length;
      openTab(matchTabs[next], {focus: true});
    });
  });
  document.querySelectorAll('[data-tab-jump]').forEach(button => button.addEventListener('click', () => {
    openTab(button.dataset.tabJump);
    const tabs = document.querySelector('.match-tabs');
    tabs?.scrollIntoView({block: 'start', behavior: 'smooth'});
  }));
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => chooseScenario(button.dataset.scenario)));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  el('filterToggle').addEventListener('click', () => {
    const menu = el('filterMenu');
    menu.hidden = !menu.hidden;
    el('filterToggle').setAttribute('aria-expanded', String(!menu.hidden));
    haptic();
  });
  el('filterReset').addEventListener('click', () => setFilter('all'));
  el('shareMatch').addEventListener('click', sharePreview);
  renderFixtures();
  chooseScenario('base');
  openView('home');
  enableTelegramIntegration();
})();