import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

function functionBody(name, nextName) {
  const start = app.indexOf('function ' + name);
  const end = nextName ? app.indexOf('function ' + nextName, start + 1) : -1;
  assert.ok(start >= 0, name + ' must exist');
  return app.slice(start, end >= 0 ? end : undefined);
}

function cssRules(source) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(source))) {
    for (const selector of match[1].split(',').map(x => x.trim()).filter(Boolean)) {
      rules.push({ selector, body: match[2] });
    }
  }
  return rules;
}

function declaration(body, property) {
  const re = new RegExp('(?:^|;)\\s*' + property + '\\s*:\\s*([^;]+)', 'i');
  return body.match(re)?.[1]?.trim() || '';
}

function luminance(hex) {
  const value = hex.replace('#', '');
  const rgb = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('public shell has no stronger two-column navigation rule overriding four items', () => {
  const publicNav = cssRules(css).filter(r => r.selector.includes('.miniapp-public-shell') && r.selector.includes('.bottom-nav'));
  const columns = publicNav.map(r => declaration(r.body, 'grid-template-columns')).filter(Boolean);
  assert.ok(columns.length > 0);
  assert.equal(columns.some(value => /repeat\(\s*2\s*,/i.test(value)), false, columns.join(' | '));
  assert.ok(columns.some(value => /repeat\(\s*4\s*,/i.test(value)), columns.join(' | '));
  assert.match(html, /id="navMatches"[\s\S]*id="navMyTeams"[\s\S]*id="navHistory"[\s\S]*id="navProfile"/);
  assert.doesNotMatch(html, /id="navSearch"/);
});

test('quick discovery sections are not permanently suppressed by public-shell CSS', () => {
  const rules = cssRules(css);
  for (const id of ['searchRecentWrap', 'searchFavoritesWrap', 'searchCompetitionsWrap']) {
    const applicable = rules.filter(r => r.selector.includes('.miniapp-public-shell') && r.selector.includes('#' + id));
    const forcedHidden = applicable.filter(r => /display\s*:\s*none\s*!important/i.test(r.body));
    assert.ok(forcedHidden.every(r => r.selector.includes('[hidden]')), id + ': ' + forcedHidden.map(r => r.selector).join(', '));
  }
  assert.match(app, /function setDiscoveryHomeVisibility\(visible\)/);
  assert.match(app, /setDiscoveryHomeVisibility\(!query\)/);
});

test('startup hides release identifiers while About shows the public app version', () => {
  const boot = html.slice(html.indexOf('id="bootGate"'), html.indexOf('class="app-shell"'));
  assert.doesNotMatch(boot, /bootVersion|версия|RC\d|release|build/i);
  assert.match(boot, /FutLens AI/);
  assert.match(boot, /Понимай матч глубже\./);
  assert.match(boot, /Загружаем матчи/);
  assert.match(html, /id="publicAppVersion">6\.120\.0</);
  assert.match(app, /CLIENT_VERSION\.split\('-'\)\[0\]/);
  const profile = functionBody('renderProfile', 'qualityPct');
  assert.match(profile, /profileButtonLabel\.textContent = 'Профиль'/);
  assert.doesNotMatch(profile, /profilePlanLabel/);
});

test('custom accent persists independently and shipped pairs keep WCAG-safe contrast', () => {
  for (const choice of ['system', 'green', 'blue', 'violet', 'amber']) {
    assert.ok(html.includes('data-accent-choice="' + choice + '"'), choice);
  }
  assert.match(app, /function applyAccentPreference/);
  assert.match(app, /saveInterfacePreference\('accent'/);
  const pairs = [
    ['#57e389', '#041009', '#050607'],
    ['#147a3d', '#ffffff', '#f3f6f8'],
    ['#60a5fa', '#07111f', '#050607'],
    ['#1d4ed8', '#ffffff', '#f3f6f8'],
    ['#c084fc', '#160624', '#050607'],
    ['#6d28d9', '#ffffff', '#f3f6f8'],
    ['#fbbf24', '#1c1200', '#050607'],
    ['#92400e', '#ffffff', '#f3f6f8'],
  ];
  for (const [accent, text, background] of pairs) {
    assert.ok(app.includes(accent) && app.includes(text));
    assert.ok(contrast(accent, text) >= 4.5, accent + ' button contrast');
    assert.ok(contrast(accent, background) >= 4.5, accent + ' surface contrast');
  }
});

test('admin overview is gated and uses existing state without new API calls', () => {
  const start = html.indexOf('<section class="panel admin-console" data-admin-only hidden>');
  const end = html.indexOf('</section>', start);
  const block = html.slice(start, end + 10);
  assert.match(block, /АДМИНИСТРИРОВАНИЕ/);
  for (const id of ['adminOverviewService', 'adminOverviewFeatures', 'adminOverviewSource', 'adminOverviewVersion']) {
    assert.ok(block.includes('id="' + id + '"'), id);
  }
  const overview = functionBody('renderAdminOverview', 'applyAdminVisibility');
  assert.doesNotMatch(overview, /\bapi\s*\(/);
  assert.match(overview, /state\.runtimeControlsAdmin/);
  assert.match(overview, /state\.provider/);
});

test('ordinary profile copy avoids implementation vocabulary', () => {
  const profileStart = html.indexOf('<section id="profileView"');
  const adminStart = html.indexOf('<section class="panel admin-console"', profileStart);
  const publicProfile = html.slice(profileStart, adminStart).replace(/<[^>]+>/g, ' ').toLowerCase();
  for (const forbidden of ['provider', 'provenance', 'freshness guard', 'cache', 'release', 'rc144', 'технические лимиты']) {
    assert.equal(publicProfile.includes(forbidden), false, forbidden);
  }
  const capabilities = functionBody('renderDataCapabilities', 'planLabel');
  assert.doesNotMatch(capabilities, /c\.note/);
  assert.match(capabilities, /Доступность зависит от турнира и конкретного матча/);
});
