import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const styles = fs.readFileSync('public/styles.css', 'utf8');
const publicShell = fs.readFileSync('public/styles/public-shell.css', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const NAV = [
  ['navMatches', 'Главная'],
  ['navMyTeams', 'Мои команды'],
  ['navHistory', 'История'],
  ['navProfile', 'Профиль'],
];

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function navButtonMarkup(navMarkup, id) {
  return new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/button>`).exec(navMarkup)?.[0] || '';
}

function headerBlock(headers, pathname) {
  const lines = String(headers || '').split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === pathname);
  if (start < 0) return '';
  const blockLines = [lines[start]];
  for (let index = start + 1; index < lines.length && lines[index].trim(); index += 1) {
    blockLines.push(lines[index]);
  }
  return blockLines.join('\n');
}

function bottomNavColumnDeclarations(css) {
  return [...css.matchAll(/[^{}]*\.bottom-nav[^{}]*\{([^{}]*)\}/g)]
    .map(match => /grid-template-columns\s*:\s*([^;]+);?/i.exec(match[1])?.[1])
    .filter(Boolean)
    .map(normalize);
}

test('public bottom navigation contains exactly the four canonical visible destinations in order', () => {
  const navMarkup = /<nav class="bottom-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] || '';
  assert.match(navMarkup, /<nav class="bottom-nav"[^>]*aria-label="Основная навигация"/);

  const ids = [...navMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(ids, NAV.map(([id]) => id));

  for (const [id, label] of NAV) {
    const button = navButtonMarkup(navMarkup, id);
    assert.ok(button, `${id} must exist in the canonical bottom navigation`);
    assert.match(button, /\bclass="[^"]*\bnav-item\b[^"]*"/);
    assert.match(button, /\btype="button"/);
    assert.match(button, new RegExp(`<small>${label}<\\/small>`));
    if (id === 'navMatches') {
      assert.match(button, /\bclass="[^"]*\bactive\b[^"]*"/);
      assert.match(button, /\baria-current="page"/);
    } else {
      assert.doesNotMatch(button, /\baria-current=/);
    }
  }

  assert.equal((navMarkup.match(/\saria-current=/g) || []).length, 1);
  assert.doesNotMatch(navMarkup, /\shidden(?:\s|>|=)/i);
});

test('every bottom-nav grid declaration is four minmax columns and final public rule wins cascade', () => {
  const declarations = [
    ...bottomNavColumnDeclarations(styles),
    ...bottomNavColumnDeclarations(publicShell),
  ];
  assert.ok(declarations.length >= 2);
  assert.deepEqual(new Set(declarations), new Set(['repeat(4,minmax(0,1fr))']));
  assert.equal(declarations.at(-1), 'repeat(4,minmax(0,1fr))');
  assert.match(
    publicShell,
    /Bottom navigation visibility cascade guard[\s\S]*?\.miniapp-public-shell \.bottom-nav\s*\{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/i,
  );
});

test('final public rule forces all four nav items visible without horizontal min-width pressure', () => {
  for (const [id] of NAV) assert.match(publicShell, new RegExp(`#${id}`));
  assert.match(publicShell, /display:grid!important/);
  assert.match(publicShell, /visibility:visible!important/);
  assert.match(publicShell, /min-width:0/);
  assert.match(publicShell, /white-space:nowrap/);
});

test('Telegram safe-area and cache-bust contracts cover the public shell', () => {
  assert.match(publicShell, /env\(safe-area-inset-left\)/);
  assert.match(publicShell, /env\(safe-area-inset-right\)/);
  assert.match(publicShell, /env\(safe-area-inset-bottom\)/);
  assert.match(publicShell, /box-sizing:border-box/);
  assert.match(publicShell, /left:max\(7px,env\(safe-area-inset-left\)\)/);
  assert.match(publicShell, /right:max\(7px,env\(safe-area-inset-right\)\)/);
  assert.match(publicShell, /transform:none/);

  const revision = /<meta name="frontend-asset-revision" content="([^"]+)" \/>/.exec(html)?.[1];
  assert.ok(revision);
  assert.notEqual(revision, pkg.version);
  assert.ok(revision.startsWith(`${pkg.version}-`));
  for (const asset of ['/app.js', '/styles.css', '/styles/public-shell.css', '/styles/premium-ui.css']) {
    assert.ok(html.includes(`${asset}?v=${revision}`), `${asset} must use the current frontend asset revision`);
  }
});

test('versioned shell assets are immutable while HTML entry points revalidate', () => {
  const headers = fs.readFileSync('public/_headers', 'utf8');
  for (const asset of ['/app.js', '/styles.css', '/styles/public-shell.css', '/styles/premium-ui.css']) {
    assert.match(
      headerBlock(headers, asset),
      /Cache-Control: public, max-age=31536000, immutable/,
      `${asset} must remain immutable because index.html cache-busts it with the frontend revision`,
    );
  }
  assert.match(headerBlock(headers, '/index.html'), /Cache-Control: no-cache, max-age=0, must-revalidate/);
  assert.match(headerBlock(headers, '/'), /Cache-Control: no-cache, max-age=0, must-revalidate/);
});

test('render regression covers the required Telegram mobile widths', () => {
  const renderSmoke = fs.readFileSync('scripts/bottom-nav-render-smoke.js', 'utf8');
  for (const width of [360, 375, 390, 430]) {
    assert.match(renderSmoke, new RegExp(`\\b${width}\\b`));
  }
  assert.match(renderSmoke, /getBoundingClientRect/);
  assert.match(renderSmoke, /getComputedStyle/);
  assert.match(renderSmoke, /gridTemplateColumns/);
  assert.match(renderSmoke, /nav\.scrollWidth/);
  assert.match(renderSmoke, /--remote-debugging-port=0/);
  assert.match(renderSmoke, /DevToolsActivePort/);
  assert.match(renderSmoke, /--user-data-dir=\$\{profileDir\}/);
});
