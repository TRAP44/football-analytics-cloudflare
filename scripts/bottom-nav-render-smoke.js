import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const WIDTHS = [320, 360, 375, 390, 430, 768, 1280];
const NAV_IDS = ['navMatches', 'navMyTeams', 'navHistory', 'navProfile'];
const EXPECTED_LABELS = ['Главная', 'Мои команды', 'История', 'Профиль'];
const TELEGRAM_WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.0.0 Mobile Safari/537.36 Telegram-Android/12.0';
const EXPECTED_ASSET_REVISION = (() => {
  const html = fs.readFileSync(path.resolve('public/index.html'), 'utf8');
  const match = html.match(/<meta\s+name=["']frontend-asset-revision["']\s+content=["']([^"']+)["']/i);
  if (!match?.[1]) throw new Error('frontend asset revision is missing from public/index.html');
  return match[1];
})();

function browserExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/') && fs.existsSync(candidate)) return candidate;
    const probe = spawnSync('sh', ['-lc', `command -v "${candidate}"`], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  }
  throw new Error('Chromium/Chrome executable is required for rendered navigation regression.');
}

function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function localServer() {
  const root = path.resolve('public');
  const server = createServer(async (req, res) => {
    try {
      const rawPath = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
      const relative = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) throw new Error('invalid path');
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitForJson(url, attempts = 80) {
  let last = '';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error?.message || String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome DevTools endpoint unavailable: ${last}`);
}

async function waitForDevToolsPort(profileDir, chrome, stderrText, attempts = 100) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  let last = 'not ready';
  for (let i = 0; i < attempts; i += 1) {
    if (chrome.exitCode !== null) {
      const stderr = String(stderrText?.() || '').trim().slice(-1200);
      throw new Error(
        `Chrome exited before DevTools became ready (exit ${chrome.exitCode})${stderr ? `: ${stderr}` : ''}`,
      );
    }
    try {
      const raw = await fsp.readFile(activePortFile, 'utf8');
      const port = Number(raw.split(/\r?\n/, 1)[0]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
      last = `invalid DevToolsActivePort: ${raw.slice(0, 80)}`;
    } catch (error) {
      last = error?.code === 'ENOENT'
        ? 'DevToolsActivePort not created yet'
        : (error?.message || String(error));
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const stderr = String(stderrText?.() || '').trim().slice(-1200);
  throw new Error(
    `Chrome DevToolsActivePort unavailable: ${last}${stderr ? `; stderr: ${stderr}` : ''}`,
  );
}

async function stopChrome(chrome) {
  if (!chrome || chrome.exitCode !== null) return;
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => chrome.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ]);
  if (chrome.exitCode === null) {
    chrome.kill('SIGKILL');
    await Promise.race([
      new Promise(resolve => chrome.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 1000)),
    ]);
  }
}

async function launchChromeWithRetry(executable, attempts = 3) {
  let lastError = null;
  const totalAttempts = Math.max(1, Math.min(3, Number(attempts || 3)));

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), `matchradar-nav-render-${attempt}-`));
    let stderrText = '';
    const chrome = spawn(executable, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-proxy-server',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    chrome.stderr?.setEncoding('utf8');
    chrome.stderr?.on('data', chunk => {
      stderrText = (stderrText + String(chunk)).slice(-8000);
    });

    try {
      const debugPort = await waitForDevToolsPort(profileDir, chrome, () => stderrText, 120);
      return { chrome, profileDir, debugPort };
    } catch (error) {
      lastError = error;
      await stopChrome(chrome);
      await fsp.rm(profileDir, { recursive:true, force:true, maxRetries:5, retryDelay:100 }).catch(() => {});
      if (attempt < totalAttempts) {
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw new Error(`Chrome startup failed after ${totalAttempts} attempts: ${lastError?.message || lastError || 'unknown error'}`);
}

class Cdp {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP websocket failed to open')), { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
      else pending.resolve(message.result || {});
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try { this.socket.close(); } catch {}
  }
}

function isTransientNavigationError(errorText = '') {
  return /^net::ERR_(?:CONNECTION_CLOSED|CONNECTION_RESET|TIMED_OUT|NETWORK_CHANGED|HTTP2_PROTOCOL_ERROR)$/.test(String(errorText || ''));
}

async function navigateWithRetry(cdp, url, attempts = 3) {
  const totalAttempts = Math.max(1, Math.min(3, Number(attempts || 3)));
  let lastError = '';

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const navResult = await cdp.call('Page.navigate', { url });
    if (!navResult.errorText) return navResult;

    lastError = String(navResult.errorText);
    if (!isTransientNavigationError(lastError) || attempt >= totalAttempts) break;
    await new Promise(resolve => setTimeout(resolve, 250 * attempt));
  }

  throw new Error(`Page.navigate failed after ${totalAttempts} attempt(s): ${lastError || 'unknown error'}`);
}

async function navigateForExpectedRevision(cdp, url, remote = false) {
  const attempts = remote ? 8 : 1;
  let lastRevision = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const next = new URL(url);
    if (remote) next.searchParams.set('__mr_render_smoke', `${EXPECTED_ASSET_REVISION}-${attempt}`);
    await navigateWithRetry(cdp, next.toString(), 3);
    await waitForReady(cdp);
    const result = await cdp.call('Runtime.evaluate', {
      returnByValue:true,
      expression:`document.querySelector('meta[name="frontend-asset-revision"]')?.content || ''`,
    });
    lastRevision = String(result?.result?.value || '');
    if (lastRevision === EXPECTED_ASSET_REVISION) return;
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`frontend assets did not converge to ${EXPECTED_ASSET_REVISION}; last revision=${lastRevision || 'missing'}`);
}

async function waitForReady(cdp) {
  let lastValue = {};
  for (let i = 0; i < 100; i += 1) {
    const result = await cdp.call('Runtime.evaluate', {
      expression: `({ ready: document.readyState, href: location.href, nav: Boolean(document.querySelector('.bottom-nav')) })`,
      returnByValue: true,
    });
    const value = result?.result?.value || {};
    lastValue = value;
    if (value.ready === 'complete' && value.nav) {
      await new Promise(resolve => setTimeout(resolve, 250));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Rendered Mini App did not reach a complete document with .bottom-nav: ${JSON.stringify(lastValue)}`);
}

function assertLayout(width, snapshot) {
  if (snapshot.innerWidth !== width) throw new Error(`${width}px: innerWidth=${snapshot.innerWidth}`);
  if (!snapshot.nav) throw new Error(`${width}px: .bottom-nav missing`);
  if (snapshot.nav.display !== 'grid') throw new Error(`${width}px: bottom nav display is ${snapshot.nav.display}`);
  const columns = snapshot.nav.gridTemplateColumns.trim().split(/\s+/).filter(Boolean);
  if (columns.length !== 4) throw new Error(`${width}px: rendered grid has ${columns.length} columns (${snapshot.nav.gridTemplateColumns})`);
  if (snapshot.buttons.length !== 4) throw new Error(`${width}px: rendered nav button count is ${snapshot.buttons.length}`);

  snapshot.buttons.forEach((button, index) => {
    if (button.id !== NAV_IDS[index]) throw new Error(`${width}px: unexpected nav order at ${index}: ${button.id}`);
    if (button.label !== EXPECTED_LABELS[index]) throw new Error(`${width}px: label mismatch for ${button.id}: ${button.label}`);
    if (!button.visible) throw new Error(`${width}px: ${button.id} is not visible (display=${button.display}, visibility=${button.visibility})`);
    if (button.rect.left < snapshot.nav.rect.left - 1 || button.rect.right > snapshot.nav.rect.right + 1) {
      throw new Error(`${width}px: ${button.id} is horizontally clipped outside the nav container`);
    }
  });

  const rowTop = snapshot.buttons[0].rect.top;
  if (snapshot.buttons.some(button => Math.abs(button.rect.top - rowTop) > 1)) {
    throw new Error(`${width}px: navigation wrapped to more than one row`);
  }
  if (snapshot.nav.rect.left < -1 || snapshot.nav.rect.right > width + 1) {
    throw new Error(`${width}px: bottom nav exceeds viewport horizontally`);
  }
  if (snapshot.nav.scrollWidth > snapshot.nav.clientWidth + 1) {
    throw new Error(`${width}px: bottom nav has horizontal overflow (${snapshot.nav.scrollWidth} > ${snapshot.nav.clientWidth})`);
  }
  if (snapshot.documentWidth > width + 1) {
    throw new Error(`${width}px: document has horizontal overflow (${snapshot.documentWidth} > ${width})`);
  }
  if (!snapshot.firstRun || snapshot.firstRun.hidden) throw new Error(`${width}px: first-run guide is not visible for a fresh session`);
  if (snapshot.firstRun.scrollWidth > snapshot.firstRun.clientWidth + 1) {
    throw new Error(`${width}px: first-run guide overflows horizontally`);
  }
  for (const action of snapshot.firstRun.actions || []) {
    if (!action.visible) throw new Error(`${width}px: first-run action ${action.id} is not visible`);
    if (action.height < 43.5) throw new Error(`${width}px: first-run action ${action.id} touch target is only ${action.height}px`);
  }
  if (!snapshot.assetRevision) throw new Error(`${width}px: frontend asset revision meta is missing`);
  if (snapshot.assetRevision !== EXPECTED_ASSET_REVISION) {
    throw new Error(`${width}px: frontend asset revision ${snapshot.assetRevision} does not match expected ${EXPECTED_ASSET_REVISION}`);
  }
  if (snapshot.assetTokens.length !== 4 || snapshot.assetTokens.some(token => token !== snapshot.assetRevision)) {
    throw new Error(`${width}px: frontend JS/CSS cache-bust tokens are not coherent`);
  }
}


function assertEdgeCaseFixture(width, theme, snapshot) {
  if (!snapshot?.fixture) throw new Error(`${width}px/${theme}: QA fixture missing`);
  if (snapshot.fixture.scrollWidth > snapshot.fixture.clientWidth + 1) {
    throw new Error(`${width}px/${theme}: QA fixture overflows horizontally (${snapshot.fixture.scrollWidth} > ${snapshot.fixture.clientWidth})`);
  }
  for (const control of snapshot.controls || []) {
    if (!control.visible) throw new Error(`${width}px/${theme}: ${control.className} is not visible`);
    if (control.height < 43.5) throw new Error(`${width}px/${theme}: ${control.className} touch target is only ${control.height}px`);
  }
  for (const text of snapshot.longText || []) {
    if (text.scrollWidth > text.clientWidth + 1) {
      throw new Error(`${width}px/${theme}: long text overflows in ${text.className}`);
    }
    if (text.clientHeight > text.lineHeight * 2.35) {
      throw new Error(`${width}px/${theme}: visible long text exceeds two lines in ${text.className}`);
    }
  }
  const competition=snapshot.clippedCompetition;
  if (!competition || competition.overflow!=='hidden' || competition.textOverflow!=='ellipsis' || competition.whiteSpace!=='nowrap') {
    throw new Error(`${width}px/${theme}: competition label does not preserve single-line ellipsis clipping`);
  }
  for (const team of snapshot.teamLabels || []) {
    if (team.overflow!=='hidden' || team.whiteSpace==='nowrap' || String(team.lineClamp)!=='2') {
      throw new Error(`${width}px/${theme}: compact team label does not preserve two-line clipping`);
    }
    if (team.clientHeight > team.lineHeight * 2.35) {
      throw new Error(`${width}px/${theme}: compact team label exceeds two visible lines`);
    }
  }
  const personal=snapshot.personalState;
  if (!personal
    || personal.strongOverflow!=='hidden'
    || personal.strongTextOverflow!=='ellipsis'
    || personal.strongWhiteSpace!=='nowrap'
    || personal.smallOverflow!=='hidden'
    || personal.smallTextOverflow!=='ellipsis'
    || personal.smallWhiteSpace!=='nowrap') {
    throw new Error(`${width}px/${theme}: personal Home card does not preserve single-line ellipsis clipping`);
  }
  const radar=snapshot.radar;
  if (!radar || radar.display!=='flex' || radar.copyWidth < 100 || radar.width < radar.parentWidth - 2 || radar.scrollWidth > radar.clientWidth + 1) {
    throw new Error(`${width}px/${theme}: Radar Feed row collapsed or overflowed: ${JSON.stringify(radar)}`);
  }
  for (const action of snapshot.singleActions || []) {
    if (Math.abs(action.groupWidth - action.buttonWidth) > 2) {
      throw new Error(`${width}px/${theme}: single primary action does not fill its row: ${JSON.stringify(action)}`);
    }
  }
  if (!snapshot.star || Math.abs(snapshot.star.width - 19) > 0.6 || Math.abs(snapshot.star.height - 19) > 0.6) {
    throw new Error(`${width}px/${theme}: favorite SVG geometry is unstable: ${JSON.stringify(snapshot.star)}`);
  }
  if (!snapshot.time || !/^\d{2}:\d{2}$/.test(snapshot.time.text) || snapshot.time.borderTopWidth !== '0px' || snapshot.time.borderRadius !== '0px') {
    throw new Error(`${width}px/${theme}: match time is not a plain HH:mm label: ${JSON.stringify(snapshot.time)}`);
  }
  const disclosure=snapshot.disclosureState;
  if (!disclosure || disclosure.open || disclosure.contentDisplay!=='none') {
    throw new Error(`${width}px/${theme}: lower-priority Home section is not collapsed by default`);
  }
  if (disclosure.summaryHeight < 43.5) {
    throw new Error(`${width}px/${theme}: Home disclosure summary touch target is only ${disclosure.summaryHeight}px`);
  }
  const expectedSurfaces=['search','match-center','analysis','profile','billing','notifications','digest'];
  const surfaces=new Map((snapshot.surfaceFixtures || []).map(item=>[item.name,item]));
  for (const name of expectedSurfaces) {
    const surface=surfaces.get(name);
    if (!surface) throw new Error(`${width}px/${theme}: ${name} QA surface missing`);
    if (surface.scrollWidth > surface.clientWidth + 1) {
      throw new Error(`${width}px/${theme}: ${name} surface overflows horizontally (${surface.scrollWidth} > ${surface.clientWidth})`);
    }
    if (surface.rect.left < -1 || surface.rect.right > width + 1) {
      throw new Error(`${width}px/${theme}: ${name} surface exceeds viewport bounds`);
    }
    for (const control of surface.controls || []) {
      if (!control.visible) throw new Error(`${width}px/${theme}: ${name} control is not visible: ${control.label}`);
      if (control.height < 39.5) throw new Error(`${width}px/${theme}: ${name} control touch target is only ${control.height}px: ${control.label}`);
    }
  }
}

async function waitForCondition(cdp, expression, label, attempts = 100) {
  let lastValue = null;
  for (let i = 0; i < attempts; i += 1) {
    const result = await cdp.call('Runtime.evaluate', { expression, returnByValue:true });
    lastValue = result?.result?.value;
    if (lastValue) return lastValue;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become true; last=${JSON.stringify(lastValue)}`);
}

async function firstRunState(cdp) {
  const result = await cdp.call('Runtime.evaluate', {
    returnByValue:true,
    expression:`(() => {
      const guide=document.getElementById('firstRunGuide');
      return {
        exists:Boolean(guide),
        hidden:Boolean(guide?.hidden),
        stored:localStorage.getItem('football-analytics:first-run-guide:v1'),
        activeView:document.querySelector('.view.active')?.id || '',
        activeElement:document.activeElement?.id || '',
        searchValue:document.getElementById('globalSearchInput')?.value || '',
      };
    })()`,
  });
  return result?.result?.value || {};
}

async function clearFirstRunAndNavigate(cdp, url) {
  await cdp.call('Runtime.evaluate', { expression:`localStorage.removeItem('football-analytics:first-run-guide:v1')` });
  await navigateWithRetry(cdp,url,3);
  await waitForReady(cdp);
}

async function assertFirstRunBehavior(cdp, targetUrl) {
  const base=new URL(targetUrl);
  base.search='';

  await clearFirstRunAndNavigate(cdp,base.toString());
  const first=await firstRunState(cdp);
  if (!first.exists || first.hidden || first.stored) throw new Error(`first launch state invalid: ${JSON.stringify(first)}`);

  await cdp.call('Runtime.evaluate',{expression:`document.getElementById('firstRunGuideDismiss')?.click()`});
  const skipped=await firstRunState(cdp);
  if (!skipped.hidden || skipped.stored!=='1') throw new Error(`first-run skip did not persist: ${JSON.stringify(skipped)}`);

  await navigateWithRetry(cdp,base.toString(),3);
  await waitForReady(cdp);
  const reopened=await firstRunState(cdp);
  if (!reopened.hidden || reopened.stored!=='1') throw new Error(`returning/reopen state invalid: ${JSON.stringify(reopened)}`);

  await clearFirstRunAndNavigate(cdp,base.toString());
  const actionResult=await cdp.call('Runtime.evaluate',{
    returnByValue:true,
    expression:`(() => {
      const webApp=window.Telegram?.WebApp;
      if (webApp) webApp.initData='behavioral-smoke';
      const originalFetch=window.fetch;
      window.fetch=()=>{ throw new Error('forced telemetry transport failure'); };
      document.getElementById('firstRunGuideSearch')?.click();
      const result={
        hidden:Boolean(document.getElementById('firstRunGuide')?.hidden),
        stored:localStorage.getItem('football-analytics:first-run-guide:v1'),
        activeElement:document.activeElement?.id || '',
      };
      window.fetch=originalFetch;
      return result;
    })()`,
  });
  const action=actionResult?.result?.value || {};
  if (!action.hidden || action.stored!=='1' || action.activeElement!=='matchSearch') {
    throw new Error(`first-run primary action was blocked: ${JSON.stringify(action)}`);
  }

  await clearFirstRunAndNavigate(cdp,base.toString());
  await cdp.call('Runtime.evaluate',{expression:`document.getElementById('firstRunGuideFavorite')?.click()`});
  await waitForCondition(cdp,
    `(() => document.querySelector('#searchView')?.classList.contains('active') && localStorage.getItem('football-analytics:first-run-guide:v1')==='1')()`,
    'first-run favorite action');

  await cdp.call('Runtime.evaluate',{expression:`localStorage.removeItem('football-analytics:first-run-guide:v1')`});
  const deepLink=new URL(base);
  deepLink.searchParams.set('view','search');
  deepLink.searchParams.set('q','Arsenal');
  await navigateWithRetry(cdp,deepLink.toString(),3);
  await waitForReady(cdp);
  await waitForCondition(cdp,
    `(() => document.querySelector('#searchView')?.classList.contains('active') && document.getElementById('globalSearchInput')?.value==='Arsenal')()`,
    'direct search launch');
  const direct=await firstRunState(cdp);
  if (!direct.hidden || direct.stored) throw new Error(`direct launch should bypass without completing onboarding: ${JSON.stringify(direct)}`);

  console.log('First-run behavioral smoke passed: launch, skip, reopen, meaningful actions, telemetry fail-soft and direct-link entry.');
}

async function inspectEdgeCaseFixture(cdp, width, theme) {
  const evaluated = await cdp.call('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      document.getElementById('matchradarQaFixture')?.remove();
      const root = document.createElement('section');
      root.id = 'matchradarQaFixture';
      root.style.cssText = 'position:fixed;left:0;top:0;width:100%;max-width:430px;padding:10px;box-sizing:border-box;z-index:99999;background:var(--bg)';
      root.innerHTML = ${JSON.stringify("\n        <button class=\"home-priority-card home-personal-match\" type=\"button\"><span>Для вас</span><strong>Extremely Long Favourite Football Club — Another Long Team Name</strong><small>Любимая команда · 21:45 · Premier League</small><b>Открыть →</b></button>\n        <article class=\"panel my-team-card\">\n          <button class=\"my-team-head team-open-link\" type=\"button\">\n            <span class=\"team-placeholder\">⚽</span>\n            <span><strong>Club Atlético Very Long International Football Association Name That Must Wrap Safely</strong><small>Ближайший матч</small></span>\n            <b>Открыть →</b>\n          </button>\n          <button class=\"my-team-match\" type=\"button\"><span>Extremely Long Home Team Name United — Extremely Long Away Team Name Athletic Club</span><strong>21:45</strong><small>Открыть матч →</small></button>\n        </article>\n        <article class=\"history-item\">\n          <div class=\"history-logos\"><span>⚽</span><span>—</span><span>⚽</span></div>\n          <div class=\"history-main\"><strong>Very Long Historical Home Team Name — Very Long Historical Away Team Name</strong><span>International Competition · сегодня</span><em class=\"history-ai-chip skip\">AI · Пропустить матч · 61/100</em></div>\n          <button class=\"history-open\" type=\"button\">Открыть</button>\n        </article>\n        <div class=\"favorite-team-row\"><button class=\"favorite-team-main\" type=\"button\"><span class=\"team-placeholder\">⚽</span><strong>Extremely Long Favourite Football Club Name Across Two Lines</strong></button><button class=\"favorite-remove\" type=\"button\">Удалить</button></div>\n        <div class=\"reminder-row\"><div><strong>Very Long Reminder Home Team Name — Very Long Reminder Away Team Name</strong><span>Сегодня · 21:45 · за 30 мин.</span></div><button class=\"reminder-remove\" type=\"button\">Отключить</button></div>\n        <section class=\"home-match-section home-match-section--live\" data-home-match-section=\"live\">\n          <div class=\"home-match-section-head\"><strong>Сейчас идут</strong><span>1</span></div>\n          <div class=\"home-match-section-list\">\n        <article class=\"match-card compact-match-card is-live\">\n          <div class=\"match-card-topline\"><span class=\"competition-name\">UEFA Champions League with a Very Long Competition Name</span><b class=\"match-live-label\">LIVE · 88′</b></div>\n          <div class=\"compact-match-row\">\n            <button class=\"team-open-link compact-team\" type=\"button\"><span class=\"team-logo-fallback\">⚽</span><strong>Extremely Long Home Football Club Name United</strong></button>\n            <div class=\"compact-score score-live\">2 : 1</div>\n            <button class=\"team-open-link compact-team away\" type=\"button\"><strong>Extremely Long Away Athletic Club Name</strong><span class=\"team-logo-fallback\">⚽</span></button>\n          </div>\n          <div class=\"match-card-actions compact-actions\"><button class=\"analyze-btn live-center-btn\" type=\"button\">Матч-центр</button></div>\n        </article>\n          </div>\n        </section>\n        <section class=\"home-match-section home-match-section--soon\" data-home-match-section=\"soon\">\n          <div class=\"home-match-section-head\"><strong>Скоро начнутся</strong><span>1</span></div>\n          <div class=\"home-match-section-list\">\n        <article class=\"match-card compact-match-card is-upcoming\">\n          <div class=\"match-card-topline\"><span class=\"competition-name\">Premier League</span><span class=\"match-time-label\">21:45</span></div>\n          <div class=\"compact-match-row\">\n            <button class=\"team-open-link compact-team\" type=\"button\"><span class=\"team-logo-fallback\">⚽</span><strong>Long Home Team Name</strong></button>\n            <div class=\"compact-score score-upcoming\">VS</div>\n            <button class=\"team-open-link compact-team away\" type=\"button\"><strong>Long Away Team Name</strong><span class=\"team-logo-fallback\">⚽</span></button>\n          </div>\n          <div class=\"match-card-actions compact-actions\"><button class=\"analyze-btn\" type=\"button\">AI-разбор</button></div>\n        </article>\n          </div>\n        </section>\n        <details class=\"home-match-section home-match-section--later is-collapsible\" data-home-match-section=\"later\">\n          <summary class=\"home-match-section-head\"><strong>Позже</strong><span>4</span></summary>\n          <div class=\"home-match-section-list home-match-section-list--collapsed\"><div class=\"compact-match-card\">Скрытая карточка</div></div>\n        </details>\n        <div class=\"radar-feed\"><div class=\"radar-feed-list\"><button class=\"radar-feed-item tone-ai\" type=\"button\"><span class=\"radar-feed-pulse\"></span><span class=\"radar-feed-copy\"><small>AI-РАЗБОР ГОТОВ</small><strong>Extremely Long Home Club — Extremely Long Away Club</strong><em>Нет явного фаворита · 21:45</em></span><b>→</b></button></div></div>\n        <div class=\"date-strip\"><button class=\"date-btn\" type=\"button\">Вчера</button><button class=\"date-btn active\" type=\"button\">Сегодня</button><button class=\"date-btn\" type=\"button\">Завтра</button></div>\n        <div class=\"filter-strip\"><button class=\"filter-btn active\" type=\"button\">Для вас</button><button class=\"filter-btn\" type=\"button\">LIVE</button><button class=\"filter-btn\" type=\"button\">Все</button></div>\n        <div class=\"match-secondary-actions\"><span><button class=\"fav-star compact\" type=\"button\"><svg class=\"fav-star-icon\" viewBox=\"0 0 24 24\"><path d=\"M12 3.7l2.55 5.17 5.71.83-4.13 4.03.98 5.69L12 16.73l-5.11 2.69.98-5.69-4.13-4.03 5.71-.83L12 3.7z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/></svg></button></span><button class=\"quick-reminder-btn compact\" type=\"button\">Напомнить</button></div>\n        <span class=\"match-time-label\">21:45</span>\n        <div class=\"match-card-actions compact-actions\"><button class=\"analyze-btn\" type=\"button\">AI-разбор</button></div>\n        <section data-qa-surface=\"search\" class=\"panel global-search-panel\"><div class=\"global-search-box\"><input class=\"search-input\" type=\"search\" value=\"Очень длинное название футбольного клуба для проверки мобильного поиска\"><button class=\"global-search-btn\" type=\"button\">Найти</button></div></section>\n        <section data-qa-surface=\"match-center\" class=\"panel\"><div class=\"center-tabs\" role=\"tablist\"><button class=\"center-tab-btn active\" type=\"button\">Обзор</button><button class=\"center-tab-btn\" type=\"button\">События</button><button class=\"center-tab-btn\" type=\"button\">Статистика</button></div><div class=\"center-hero-actions\"><button class=\"secondary-btn\" type=\"button\">Напомнить</button><button class=\"primary-btn\" type=\"button\">AI-разбор</button></div></section>\n        <section data-qa-surface=\"analysis\" class=\"panel\"><div class=\"analysis-tabs\" role=\"tablist\"><button class=\"analysis-tab-btn active\" type=\"button\">Кратко</button><button class=\"analysis-tab-btn\" type=\"button\">Факторы</button><button class=\"analysis-tab-btn\" type=\"button\">Составы</button></div><p>Длинный текст аналитического объяснения должен оставаться внутри карточки без горизонтального переполнения на узком экране.</p></section>\n        <section data-qa-surface=\"profile\" class=\"panel profile-panel\"><div class=\"plan-card\"><div><span class=\"muted\">Тариф</span><strong>Бесплатный</strong></div><div><span class=\"muted\">Анализы сегодня</span><strong>0 / 3</strong></div><button class=\"profile-stat-link\" type=\"button\"><span class=\"muted\">Избранные команды</span><strong>12</strong></button><button class=\"profile-stat-link\" type=\"button\"><span class=\"muted\">Напоминания</span><strong>5</strong></button></div></section>\n        <section data-qa-surface=\"billing\" class=\"panel billing-panel\"><div class=\"billing-summary-grid\"><div><span>Использовано AI</span><strong>2</strong></div><div><span>Лимит сегодня</span><strong>10</strong></div><div><span>Осталось</span><strong>8</strong></div><div><span>Подписка</span><strong>Без подписки</strong></div></div><div class=\"pass-grid\"><article class=\"pass-card\"><div class=\"pass-card-top\"><strong>Weekend Pass</strong><b>39 ⭐</b></div><p>Расширенный AI-доступ на футбольный уикенд с лимитом использования.</p><button class=\"primary-setting-btn\" type=\"button\">Купить</button></article></div></section>\n        <section data-qa-surface=\"notifications\" class=\"panel smart-notifications-panel\"><div class=\"smart-notification-head\"><div><h2>🔔 Уведомления</h2><p>Только важные изменения по матчам, командам и игрокам — без лишних повторов.</p></div><span class=\"smart-notification-plan\">PRO</span></div><label class=\"switch-row smart-notification-master\"><span><strong>Получать уведомления</strong><small>Главный выключатель для уведомлений MatchRadar.</small></span><input type=\"checkbox\" checked><i></i></label><details class=\"smart-notification-details\"><summary><span><strong>Что присылать</strong><small>Выберите нужные категории</small></span><b>Настроить</b></summary></details></section>\n        <section data-qa-surface=\"digest\" class=\"panel digest-settings-panel\"><div class=\"digest-settings-head\"><div><h2>☀️ Утренняя подборка</h2><p>До 3 заметных матчей дня и важные футбольные новости — прямо в личный чат MatchRadar.</p></div><span class=\"digest-status-chip is-on\">Включена</span></div><label class=\"switch-row digest-main-toggle\"><span><strong>Получать подборку</strong><small>Включить или отключить Telegram-доставку.</small></span><input type=\"checkbox\" checked><i></i></label><div class=\"digest-settings-grid\"><div><span>Время доставки</span><strong>09:00–09:55</strong><small>По вашему местному времени</small></div><div><span>Тариф</span><strong>Бесплатный</strong><small>Базовая подборка доступна.</small></div></div></section>\n      ")};
      document.body.appendChild(root);
      const box = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll('.home-personal-match,.history-open,.favorite-remove,.reminder-remove,.fav-star.compact,.quick-reminder-btn.compact,.analyze-btn,.date-btn,.filter-btn')].map(el => {
        const r=el.getBoundingClientRect(), s=getComputedStyle(el);
        return { className:el.className, height:r.height, width:r.width, visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0 };
      });
      const longText = [...root.querySelectorAll('.my-team-head strong,.my-team-match span,.history-main>strong,.favorite-team-main strong,.reminder-row strong')].map(el => {
        const s=getComputedStyle(el);
        const lineHeight=parseFloat(s.lineHeight) || parseFloat(s.fontSize)*1.3;
        return { className:el.className || el.parentElement?.className || el.tagName, clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, clientHeight:el.clientHeight, scrollHeight:el.scrollHeight, lineHeight };
      });
      const competition = root.querySelector('.competition-name');
      const competitionStyle = competition ? getComputedStyle(competition) : null;
      const clippedCompetition = competition ? {
        clientWidth:competition.clientWidth,
        scrollWidth:competition.scrollWidth,
        overflow:competitionStyle.overflow,
        textOverflow:competitionStyle.textOverflow,
        whiteSpace:competitionStyle.whiteSpace,
      } : null;
      const teamLabels = [...root.querySelectorAll('.compact-team strong')].map(el => {
        const s=getComputedStyle(el);
        const lineHeight=parseFloat(s.lineHeight) || parseFloat(s.fontSize)*1.3;
        return {
          overflow:s.overflow,
          whiteSpace:s.whiteSpace,
          lineClamp:s.webkitLineClamp,
          clientHeight:el.clientHeight,
          lineHeight,
        };
      });
      const personalCard = root.querySelector('.home-personal-match');
      const personalStrong = personalCard?.querySelector('strong');
      const personalSmall = personalCard?.querySelector('small');
      const personalStrongStyle = personalStrong ? getComputedStyle(personalStrong) : null;
      const personalSmallStyle = personalSmall ? getComputedStyle(personalSmall) : null;
      const personalState = personalCard ? {
        strongOverflow:personalStrongStyle?.overflow || '',
        strongTextOverflow:personalStrongStyle?.textOverflow || '',
        strongWhiteSpace:personalStrongStyle?.whiteSpace || '',
        smallOverflow:personalSmallStyle?.overflow || '',
        smallTextOverflow:personalSmallStyle?.textOverflow || '',
        smallWhiteSpace:personalSmallStyle?.whiteSpace || '',
      } : null;
      const disclosure = root.querySelector('.home-match-section.is-collapsible');
      const disclosureSummary = disclosure?.querySelector('summary');
      const disclosureList = disclosure?.querySelector('.home-match-section-list');
      const disclosureRect = disclosureSummary?.getBoundingClientRect();
      const disclosureStyle = disclosureList ? getComputedStyle(disclosureList) : null;
      const disclosureState = disclosure ? {
        open:disclosure.open,
        summaryHeight:disclosureRect?.height || 0,
        contentDisplay:disclosureStyle?.display || '',
      } : null;
      const radar = root.querySelector('.radar-feed-item');
      const radarCopy = radar?.querySelector('.radar-feed-copy');
      const radarRect = radar?.getBoundingClientRect();
      const radarParentRect = radar?.parentElement?.getBoundingClientRect();
      const radarStyle = radar ? getComputedStyle(radar) : null;
      const singleActions = [...root.querySelectorAll('.compact-actions')].map(group => {
        const button=group.querySelector(':scope > button:only-child');
        if (!button) return null;
        const gr=group.getBoundingClientRect(), br=button.getBoundingClientRect();
        return { groupWidth:gr.width, buttonWidth:br.width };
      }).filter(Boolean);
      const star = root.querySelector('.fav-star-icon');
      const starRect = star?.getBoundingClientRect();
      const time = root.querySelector('.match-time-label');
      const timeStyle = time ? getComputedStyle(time) : null;
      const surfaceFixtures = [...root.querySelectorAll('[data-qa-surface]')].map(surface => ({
        name:surface.dataset.qaSurface || '',
        clientWidth:surface.clientWidth,
        scrollWidth:surface.scrollWidth,
        rect:{left:surface.getBoundingClientRect().left,right:surface.getBoundingClientRect().right,width:surface.getBoundingClientRect().width},
        controls:[...surface.querySelectorAll('button,input[type="search"],select,summary')].map(el => {
          const r=el.getBoundingClientRect(), s=getComputedStyle(el);
          return {
            label:(el.textContent || el.value || el.getAttribute('aria-label') || el.tagName).trim().slice(0,80),
            height:r.height,
            width:r.width,
            visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,
          };
        }),
      }));
      return {
        fixture:{clientWidth:root.clientWidth,scrollWidth:root.scrollWidth,left:box.left,right:box.right},
        controls,longText,clippedCompetition,teamLabels,disclosureState,personalState,
        radar:radar ? { display:radarStyle.display,width:radarRect.width,parentWidth:radarParentRect.width,copyWidth:radarCopy?.getBoundingClientRect().width || 0,scrollWidth:radar.scrollWidth,clientWidth:radar.clientWidth } : null,
        singleActions,
        surfaceFixtures,
        star:starRect ? {width:starRect.width,height:starRect.height} : null,
        time:timeStyle ? {text:time.textContent.trim(),borderTopWidth:timeStyle.borderTopWidth,borderRadius:timeStyle.borderRadius} : null,
      };
    })()`,
  });
  return evaluated?.result?.value || null;
}

async function main() {
  const remoteUrl = process.argv[2] ? new URL(process.argv[2]).toString() : '';
  const local = remoteUrl ? null : await localServer();
  const targetUrl = remoteUrl || local.url;
  let chrome = null;
  let profileDir = '';
  let cdp;
  try {
    const launched = await launchChromeWithRetry(browserExecutable(), 3);
    chrome = launched.chrome;
    profileDir = launched.profileDir;
    const debugPort = launched.debugPort;
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const page = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' }).then(r => r.json());
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Network.enable');
    await cdp.call('Network.setCacheDisabled', { cacheDisabled:true });
    await cdp.call('Network.setUserAgentOverride', { userAgent: TELEGRAM_WEBVIEW_UA });
    await cdp.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    for (const width of WIDTHS) {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: 844,
      });
      await cdp.call('Runtime.evaluate', { expression:`localStorage.removeItem('football-analytics:first-run-guide:v1')` });
      await navigateForExpectedRevision(cdp, targetUrl, Boolean(remoteUrl));
      const evaluated = await cdp.call('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          const ids = ${JSON.stringify(NAV_IDS)};
          const nav = document.querySelector('.bottom-nav');
          const rectJson = rect => ({ left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height });
          const buttons = ids.map(id => {
            const el = document.getElementById(id);
            if (!el) return { id, missing:true, label:'' };
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return {
              id,
              label: el.textContent.trim(),
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              visible: style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0,
              rect: rectJson(rect),
            };
          });
          const navStyle = nav ? getComputedStyle(nav) : null;
          const revision = document.querySelector('meta[name="frontend-asset-revision"]')?.content || '';
          const urls = [
            document.querySelector('script[src*="/app.js"]')?.src || '',
            document.querySelector('link[href*="/styles.css"]')?.href || '',
            document.querySelector('link[href*="/styles/public-shell.css"]')?.href || '',
            document.querySelector('link[href*="/styles/premium-ui.css"]')?.href || '',
          ];
          const guide=document.getElementById('firstRunGuide');
          const guideRect=guide?.getBoundingClientRect();
          const firstRun=guide ? {
            hidden:Boolean(guide.hidden),
            clientWidth:guide.clientWidth,
            scrollWidth:guide.scrollWidth,
            rect:rectJson(guideRect),
            actions:[...guide.querySelectorAll('button')].map(el => {
              const r=el.getBoundingClientRect(), s=getComputedStyle(el);
              return {id:el.id,height:r.height,width:r.width,visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
            }),
          } : null;
          return {
            innerWidth: window.innerWidth,
            documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
            firstRun,
            assetRevision: revision,
            assetTokens: urls.map(value => {
              try { return new URL(value, location.href).searchParams.get('v') || ''; } catch { return ''; }
            }),
            nav: nav ? {
              display: navStyle.display,
              gridTemplateColumns: navStyle.gridTemplateColumns,
              rect: rectJson(nav.getBoundingClientRect()),
              clientWidth: nav.clientWidth,
              scrollWidth: nav.scrollWidth,
            } : null,
            buttons,
          };
        })()`,
      });
      const snapshot = evaluated?.result?.value;
      assertLayout(width, snapshot);
      console.log(`Bottom nav rendered correctly at ${width}px: 4 visible buttons, one row, no horizontal clipping.`);
      for (const theme of ['dark','light','ocean']) {
        const qaSnapshot = await inspectEdgeCaseFixture(cdp, width, theme);
        assertEdgeCaseFixture(width, theme, qaSnapshot);
        console.log(`Public UI edge cases rendered correctly at ${width}px in ${theme} theme; search, Match Center, Analysis, Profile, Billing/Pass, Notifications and Digest have no horizontal overflow.`);
      }
    }
    if (local) await assertFirstRunBehavior(cdp,targetUrl);
  } finally {
    cdp?.close();
    await stopChrome(chrome);
    if (local) await new Promise(resolve => local.server.close(resolve));
    if (profileDir) {
      await fsp.rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
    }
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
