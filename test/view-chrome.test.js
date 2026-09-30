import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_CHROME,
  BACK_VIEW_LABELS,
  createViewChromeController,
} from '../public/modules/view-chrome.js';

function element() {
  return { textContent: '' };
}

test('view chrome keeps public screen titles and subtitles in one module', () => {
  assert.deepEqual(VIEW_CHROME.matchesView, ['Главная', 'Видим, что меняет матч.']);
  assert.deepEqual(VIEW_CHROME.analysisView, ['Матч-центр', 'Что происходит, почему и что важно дальше']);
  assert.equal(BACK_VIEW_LABELS.playerView, 'К игроку');
});

test('view chrome updates topbar with home fallback', () => {
  const elements = {
    topbarTitle: element(),
    topbarSubtitle: element(),
  };
  const controller = createViewChromeController({
    elementById: id => elements[id] || null,
    telegramWebApp: null,
    resolveBackTarget: () => 'matchesView',
    isTelegramBackVisible: () => false,
  });

  controller.syncTopbar('playerView');
  assert.equal(elements.topbarTitle.textContent, 'Игрок');
  assert.equal(elements.topbarSubtitle.textContent, 'Показатели и роль в текущем матче');

  controller.syncTopbar('unknownView');
  assert.equal(elements.topbarTitle.textContent, 'Главная');
});

test('view chrome resolves back labels through injected navigation semantics', () => {
  const elements = {
    backBtn: element(),
    teamBackBtn: element(),
    playerBackBtn: element(),
    tournamentBackBtn: element(),
  };
  const targets = {
    analysisView: 'matchesView',
    teamView: 'searchView',
    playerView: 'analysisView',
    tournamentView: 'matchesView',
  };
  const controller = createViewChromeController({
    elementById: id => elements[id] || null,
    telegramWebApp: null,
    resolveBackTarget: id => targets[id],
    isTelegramBackVisible: () => false,
  });

  controller.syncBackButtons();

  assert.equal(elements.backBtn.textContent, '← К матчам');
  assert.equal(elements.teamBackBtn.textContent, '← К поиску');
  assert.equal(elements.playerBackBtn.textContent, '← К матчу');
  assert.equal(elements.tournamentBackBtn.textContent, '← К матчам');
});

test('telegram back button remains controlled by navigation visibility', () => {
  const calls = [];
  const controller = createViewChromeController({
    elementById: () => null,
    telegramWebApp: {
      BackButton: {
        show: () => calls.push('show'),
        hide: () => calls.push('hide'),
      },
    },
    resolveBackTarget: () => 'matchesView',
    isTelegramBackVisible: id => id !== 'matchesView',
  });

  controller.syncTelegramBackButton('analysisView');
  controller.syncTelegramBackButton('matchesView');
  assert.deepEqual(calls, ['show', 'hide']);
});
