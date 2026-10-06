import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_BOTTOM_NAV,
  createNavigationShell,
} from '../public/modules/navigation-shell.js';
import {
  CANONICAL_HOME_VIEW,
  PUBLIC_VIEW_IDS,
} from '../public/modules/navigation.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const publicShell = readFileSync(new URL('../public/styles/public-shell.css', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const NAV = [
  ['navMatches', 'matchesView', 'Главная'],
  ['navMyTeams', 'myTeamsView', 'Мои команды'],
  ['navHistory', 'historyView', 'История'],
  ['navProfile', 'profileView', 'Профиль'],
];

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function bottomNavColumnDeclarations(css) {
  return [...css.matchAll(/[^{}]*\.bottom-nav[^{}]*\{([^{}]*)\}/g)]
    .map(match => /grid-template-columns\s*:\s*([^;]+);?/i.exec(match[1])?.[1])
    .filter(Boolean)
    .map(normalize);
}

function headerBlock(pathname) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = headers.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\n((?:[ \\t]+[^\\n]+\\n?)*)`));
  return match?.[1] || '';
}

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    toggle: (name, force) => {
      if (force === true) values.add(name);
      else if (force === false) values.delete(name);
      else if (values.has(name)) values.delete(name);
      else values.add(name);
      return values.has(name);
    },
    contains: name => values.has(name),
  };
}

function element(id, classes = []) {
  const attrs = new Map();
  return {
    id,
    hidden: false,
    classList: classList(classes),
    setAttribute(name, value) { attrs.set(name, String(value)); },
    removeAttribute(name) { attrs.delete(name); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    toggleAttribute(name, force) {
      if (force) attrs.set(name, '');
      else attrs.delete(name);
    },
    contains() { return false; },
  };
}

function navigationHarness() {
  const elements = new Map();
  for (const id of PUBLIC_VIEW_IDS) {
    elements.set(id, element(id, id === CANONICAL_HOME_VIEW ? ['view', 'active'] : ['view']));
  }
  for (const [navId] of NAV) {
    elements.set(navId, element(navId, navId === 'navMatches' ? ['nav-item', 'active'] : ['nav-item']));
  }
  elements.get('navMatches').setAttribute('aria-current', 'page');

  const stray = element('unrelatedNav', ['nav-item', 'active']);
  stray.setAttribute('aria-current', 'step');
  elements.set(stray.id, stray);

  const scrollCalls = [];
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (selector === '.view.active') {
        return [...elements.values()].find(node => node.classList?.contains('view') && node.classList.contains('active')) || null;
      }
      return null;
    },
  };
  const window = {
    scrollY: 0,
    requestAnimationFrame(fn) { fn(); },
    scrollTo(options) { scrollCalls.push(options); },
  };

  const shell = createNavigationShell({
    window,
    document,
    elementById: id => elements.get(id) || null,
    viewIds: PUBLIC_VIEW_IDS,
    homeView: CANONICAL_HOME_VIEW,
    resolveBackTarget: () => CANONICAL_HOME_VIEW,
  });

  return { shell, elements, stray, scrollCalls };
}

test('public bottom navigation markup matches the canonical four destinations and initial current state', () => {
  assert.deepEqual(
    DEFAULT_BOTTOM_NAV.map(binding => [...binding]),
    NAV.map(([navId, viewId]) => [navId, viewId]),
  );

  const navMarkup = /<nav class="bottom-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] || '';
  const buttons = [...navMarkup.matchAll(/<button id="([^"]+)" class="nav-item([^"]*)"[^>]*>[\s\S]*?<small>([^<]+)<\/small><\/button>/g)]
    .map(match => ({ id: match[1], className: match[2], label: match[3] }));

  assert.deepEqual(
    buttons.map(({ id, label }) => [id, label]),
    NAV.map(([id, , label]) => [id, label]),
  );
  assert.match(navMarkup, /id="navMatches"[^>]*aria-current="page"/);
  assert.doesNotMatch(navMarkup, /\shidden(?:\s|>|=)/i);
});

test('navigation state changes only touch canonical bottom-nav bindings', () => {
  const { shell, elements, stray, scrollCalls } = navigationHarness();

  const target = shell.showView('historyView');
  assert.equal(target, 'historyView');
  assert.equal(shell.activeViewId(), 'historyView');

  for (const viewId of PUBLIC_VIEW_IDS) {
    const view = elements.get(viewId);
    const active = viewId === 'historyView';
    assert.equal(view.classList.contains('active'), active, viewId);
    assert.equal(view.hidden, !active, viewId);
    assert.equal(view.getAttribute('aria-hidden'), active ? 'false' : 'true', viewId);
  }

  for (const [navId, viewId] of NAV) {
    const item = elements.get(navId);
    const active = viewId === 'historyView';
    assert.equal(item.classList.contains('active'), active, navId);
    assert.equal(item.getAttribute('aria-current'), active ? 'page' : null, navId);
  }

  assert.equal(stray.classList.contains('active'), true);
  assert.equal(stray.getAttribute('aria-current'), 'step');
  assert.deepEqual(scrollCalls.at(-1), { top: 0, behavior: 'auto' });
});

test('invalid navigation targets fail closed to the canonical home destination', () => {
  const { shell, elements } = navigationHarness();

  shell.showView('historyView');
  assert.equal(shell.showView('not-a-view'), CANONICAL_HOME_VIEW);
  assert.equal(elements.get('matchesView').classList.contains('active'), true);
  assert.equal(elements.get('navMatches').getAttribute('aria-current'), 'page');

  shell.showView('profileView');
  assert.equal(shell.handleBackNavigation(), true);
  assert.equal(shell.activeViewId(), CANONICAL_HOME_VIEW);
  assert.equal(shell.handleBackNavigation(), false);
});

test('bottom-nav CSS keeps four shrinkable columns, safe areas and visible canonical items', () => {
  const declarations = [
    ...bottomNavColumnDeclarations(styles),
    ...bottomNavColumnDeclarations(publicShell),
  ];

  assert.ok(declarations.length >= 2);
  assert.deepEqual(new Set(declarations), new Set(['repeat(4,minmax(0,1fr))']));
  assert.equal(declarations.at(-1), 'repeat(4,minmax(0,1fr))');

  assert.match(publicShell, /\.miniapp-public-shell \.bottom-nav\{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[\s\S]*?box-sizing:border-box[\s\S]*?left:max\(7px,env\(safe-area-inset-left\)\)[\s\S]*?right:max\(7px,env\(safe-area-inset-right\)\)[\s\S]*?transform:none/);
  assert.match(publicShell, /bottom:max\(5px,env\(safe-area-inset-bottom\)\)/);

  for (const [id] of NAV) {
    assert.match(publicShell, new RegExp(`#${id}(?:,|\\{)`));
  }
  assert.match(publicShell, /display:grid!important/);
  assert.match(publicShell, /visibility:visible!important/);
  assert.match(publicShell, /min-width:0/);
  assert.match(publicShell, /text-overflow:ellipsis/);
  assert.match(publicShell, /white-space:nowrap/);
});

test('revisioned public assets are cache coherent while HTML remains revalidated', () => {
  const revision = /<meta name="frontend-asset-revision" content="([^"]+)" \/>/.exec(html)?.[1] || '';
  assert.ok(revision);
  assert.notEqual(revision, pkg.version);
  assert.ok(revision.startsWith(`${pkg.version}-`));

  const assets = [
    '/app.js',
    '/styles.css',
    '/styles/public-shell.css',
    '/styles/premium-ui.css',
  ];
  for (const asset of assets) {
    assert.ok(html.includes(`${asset}?v=${revision}`), `${asset} must use frontend asset revision ${revision}`);
    assert.match(headerBlock(asset), /Cache-Control:\s*public, max-age=31536000, immutable/);
  }

  assert.match(headerBlock('/index.html'), /Cache-Control:\s*no-cache, max-age=0, must-revalidate/);
  assert.match(headerBlock('/'), /Cache-Control:\s*no-cache, max-age=0, must-revalidate/);
});

test('render regression still covers Telegram mobile widths and real layout measurements', () => {
  const renderSmoke = readFileSync(new URL('../scripts/bottom-nav-render-smoke.js', import.meta.url), 'utf8');
  for (const width of [320, 360, 375, 390, 430]) {
    assert.match(renderSmoke, new RegExp(`\\b${width}\\b`));
  }
  assert.match(renderSmoke, /getBoundingClientRect/);
  assert.match(renderSmoke, /getComputedStyle/);
  assert.match(renderSmoke, /gridTemplateColumns/);
  assert.match(renderSmoke, /nav\.scrollWidth/);
  assert.match(renderSmoke, /documentWidth > width \+ 1/);
  assert.match(renderSmoke, /--remote-debugging-port=0/);
  assert.match(renderSmoke, /DevToolsActivePort/);
});
