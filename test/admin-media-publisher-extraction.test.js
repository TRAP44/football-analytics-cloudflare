import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdminMediaPublisherModule } from '../public/modules/admin-media-publisher.js';

function readRepoFile(relativePath) {
  return readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');
}

function createElements() {
  const elements = new Map();
  const elementById = id => {
    if (!elements.has(id)) {
      const listeners = new Map();
      elements.set(id, {
        value: '',
        hidden: false,
        disabled: false,
        innerHTML: '',
        textContent: '',
        addEventListener(type, handler) {
          listeners.set(type, handler);
        },
        listeners,
      });
    }
    return elements.get(id);
  };
  return { elements, elementById };
}

function createModule({
  elementById,
  isAdmin = () => true,
  api = async () => ({}),
  toast = () => {},
  escapeHtml = value => String(value ?? ''),
  tg = null,
} = {}) {
  return createAdminMediaPublisherModule({
    $: elementById,
    isAdmin,
    toast,
    api,
    escapeHtml,
    tg,
  });
}

const app = readRepoFile('public/app.js');
const mediaPublisher = readRepoFile('public/modules/admin-media-publisher.js');
const publisherRuntime = readRepoFile('src/publisher-runtime.js');
const router = readRepoFile('src/router.js');

test('media publisher implementation stays outside the shared app root', () => {
  assert.match(mediaPublisher, /export function createAdminMediaPublisherModule/);
  assert.match(mediaPublisher, /async function generateMediaPublisherLink\(\)/);
  assert.match(mediaPublisher, /async function copyMediaPublisherPost\(\)/);
  assert.match(mediaPublisher, /\/api\/media-publisher-link/);

  assert.doesNotMatch(app, /let mediaPublisherPayload = null/);
  assert.doesNotMatch(app, /Создаю ссылку и текст публикации/);
});

test('media publisher endpoint delegates to a server handler with its own admin authorization', () => {
  assert.match(
    router,
    /method === 'POST' && pathname === '\/api\/media-publisher-link'[\s\S]*?apiMediaPublisherLink\(request,cfg,user\)/,
  );
  assert.match(
    publisherRuntime,
    /async function apiMediaPublisherLink\(request,cfg,user\)[\s\S]*?if \(!isAdminUser\(user,cfg\)\) return adminForbidden\(\)/,
  );
});

test('shared app root lazy-loads media publisher only behind admin role', () => {
  assert.match(
    app,
    /async function ensureAdminMediaPublisherModule\(\)[\s\S]*?if \(!isAdmin\(\)\) return null;[\s\S]*?import\('\.\/modules\/admin-media-publisher\.js'\)/,
  );
  assert.match(
    app,
    /createAdminMediaPublisherModule\(\{[\s\S]*?\$, isAdmin, toast, api, escapeHtml, tg/,
  );
  assert.match(app, /module\?\.generateMediaPublisherLink\(\.\.\.args\)/);
  assert.match(app, /module\?\.copyMediaPublisherPost\(\.\.\.args\)/);
});

test('media publisher fails closed for non-admin generation and copy calls without touching DOM or API', async () => {
  let apiCalls = 0;
  const module = createModule({
    elementById: () => {
      throw new Error('DOM must not be touched for non-admin callers');
    },
    isAdmin: () => false,
    api: async () => {
      apiCalls += 1;
      return {};
    },
  });

  await assert.doesNotReject(() => module.generateMediaPublisherLink());
  await assert.doesNotReject(() => module.copyMediaPublisherPost());

  assert.equal(apiCalls, 0);
});

test('media publisher rejects malformed fixture ids before calling the API', async () => {
  const { elementById } = createElements();
  const toasts = [];
  let apiCalls = 0;
  elementById('mediaPublisherFixtureId').value = 'not-a-fixture';

  const module = createModule({
    elementById,
    api: async () => {
      apiCalls += 1;
      return {};
    },
    toast: message => toasts.push(message),
  });

  await module.generateMediaPublisherLink();

  assert.equal(apiCalls, 0);
  assert.deepEqual(toasts, ['Укажите корректный fixture ID или оставьте поле пустым.']);
});

test('media publisher preserves generation request contract and renders returned payload', async () => {
  const { elementById } = createElements();
  const calls = [];
  const toasts = [];

  elementById('mediaPublisherFixtureId').value = '12345';
  elementById('mediaPublisherSource').value = 'press';
  elementById('mediaPublisherCampaign').value = 'launch';
  elementById('mediaPublisherContent').value = 'article1';
  elementById('mediaPublisherCopyBtn').disabled = true;

  const module = createModule({
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        mode: 'fixture',
        deepLink: 'https://t.me/example?start=fixture',
        startParam: 'fixture_start',
        telegramShareUrl: 'https://t.me/share/url?url=fixture',
        copy: { body: 'MatchRadar fixture post' },
      };
    },
    toast: message => toasts.push(message),
  });

  await module.generateMediaPublisherLink();

  assert.deepEqual(calls, [{
    path: '/api/media-publisher-link',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fixtureId: 12345,
        source: 'press',
        campaign: 'launch',
        content: 'article1',
      }),
      retry: false,
      dedupe: false,
      timeoutMs: 9000,
    },
  }]);
  assert.equal(elementById('mediaPublisherGenerateBtn').disabled, false);
  assert.equal(elementById('mediaPublisherCopyBtn').disabled, false);
  assert.match(elementById('mediaPublisherResult').innerHTML, /https:\/\/t\.me\/example\?start=fixture/);
  assert.match(elementById('mediaPublisherResult').innerHTML, /MatchRadar fixture post/);
  assert.deepEqual(toasts, ['Ссылка на матч готова']);
});

test('media publisher uses safe defaults for campaign links without fixture id', async () => {
  const { elementById } = createElements();
  const calls = [];
  const module = createModule({
    elementById,
    api: async (requestPath, options) => {
      calls.push({ path: requestPath, options });
      return {
        mode: 'campaign',
        deepLink: 'https://t.me/example?start=campaign',
        startParam: 'campaign_start',
        telegramShareUrl: '',
        copy: { body: 'Campaign post' },
      };
    },
  });

  await module.generateMediaPublisherLink();

  assert.deepEqual(JSON.parse(calls[0].options.body), {
    fixtureId: null,
    source: 'telegram_channel',
    campaign: 'soft_launch',
    content: 'post1',
  });
});

test('media publisher clears stale payload and restores controls after API failure', async () => {
  const { elementById } = createElements();
  const toasts = [];
  const module = createModule({
    elementById,
    api: async () => {
      throw new Error('publisher unavailable');
    },
    toast: message => toasts.push(message),
  });

  await assert.doesNotReject(() => module.generateMediaPublisherLink());

  assert.equal(elementById('mediaPublisherGenerateBtn').disabled, false);
  assert.equal(elementById('mediaPublisherCopyBtn').disabled, true);
  assert.match(elementById('mediaPublisherResult').innerHTML, /publisher unavailable/);

  await module.copyMediaPublisherPost();
  assert.deepEqual(toasts, ['Сначала создайте ссылку.']);
});

test('telegram share callback rechecks admin role before opening a generated link', async () => {
  const { elementById } = createElements();
  let admin = true;
  const opened = [];

  const module = createModule({
    elementById,
    isAdmin: () => admin,
    api: async () => ({
      mode: 'campaign',
      deepLink: 'https://t.me/example?start=campaign',
      startParam: 'campaign_start',
      telegramShareUrl: 'https://t.me/share/url?url=campaign',
      copy: { body: 'Campaign post' },
    }),
    tg: {
      openTelegramLink: url => opened.push(url),
    },
  });

  await module.generateMediaPublisherLink();
  const click = elementById('mediaPublisherTelegramBtn').listeners.get('click');
  assert.equal(typeof click, 'function');

  admin = false;
  click();
  assert.deepEqual(opened, []);
});
