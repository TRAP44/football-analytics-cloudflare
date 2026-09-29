import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const WIDTHS = [320, 360, 375, 390, 430];
const NAV_IDS = ['navMatches', 'navMyTeams', 'navHistory', 'navProfile'];
const EXPECTED_LABELS = ['Главная', 'Мои команды', 'История', 'Профиль'];
const TELEGRAM_WEBVIEW_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/144.0.0.0 Mobile Safari/537.36 Telegram-Android/12.0';

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
  if (snapshot.assetTokens.length !== 3 || snapshot.assetTokens.some(token => token !== snapshot.assetRevision)) {
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
      root.innerHTML = ${JSON.stringify("\n        <article class=\"panel my-team-card\">\n          <button class=\"my-team-head team-open-link\" type=\"button\">\n            <span class=\"team-placeholder\">⚽</span>\n            <span><strong>Club Atlético Very Long International Football Association Name That Must Wrap Safely</strong><small>Ближайший матч</small></span>\n            <b>Открыть →</b>\n          </button>\n          <button class=\"my-team-match\" type=\"button\"><span>Extremely Long Home Team Name United — Extremely Long Away Team Name Athletic Club</span><strong>21:45</strong><small>Открыть матч →</small></button>\n        </article>\n        <article class=\"history-item\">\n          <div class=\"history-logos\"><span>⚽</span><span>—</span><span>⚽</span></div>\n          <div class=\"history-main\"><strong>Very Long Historical Home Team Name — Very Long Historical Away Team Name</strong><span>International Competition · сегодня</span><em class=\"history-ai-chip skip\">AI · Пропустить матч · 61/100</em></div>\n          <button class=\"history-open\" type=\"button\">Открыть</button>\n        </article>\n        <div class=\"favorite-team-row\"><button class=\"favorite-team-main\" type=\"button\"><span class=\"team-placeholder\">⚽</span><strong>Extremely Long Favourite Football Club Name Across Two Lines</strong></button><button class=\"favorite-remove\" type=\"button\">Удалить</button></div>\n        <div class=\"reminder-row\"><div><strong>Very Long Reminder Home Team Name — Very Long Reminder Away Team Name</strong><span>Сегодня · 21:45 · за 30 мин.</span></div><button class=\"reminder-remove\" type=\"button\">Отключить</button></div>\n        <div class=\"match-secondary-actions\"><span><button class=\"fav-star compact\" type=\"button\">☆</button></span><button class=\"quick-reminder-btn compact\" type=\"button\">Напомнить</button></div>\n        <button class=\"analyze-btn\" type=\"button\">AI-разбор</button>\n      ")};
      document.body.appendChild(root);
      const box = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll('.history-open,.favorite-remove,.reminder-remove,.fav-star.compact,.quick-reminder-btn.compact,.analyze-btn')].map(el => {
        const r=el.getBoundingClientRect(), s=getComputedStyle(el);
        return { className:el.className, height:r.height, width:r.width, visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0 };
      });
      const longText = [...root.querySelectorAll('.my-team-head strong,.my-team-match span,.history-main>strong,.favorite-team-main strong,.reminder-row strong')].map(el => {
        const s=getComputedStyle(el);
        const lineHeight=parseFloat(s.lineHeight) || parseFloat(s.fontSize)*1.3;
        return { className:el.className || el.parentElement?.className || el.tagName, clientWidth:el.clientWidth, scrollWidth:el.scrollWidth, clientHeight:el.clientHeight, scrollHeight:el.scrollHeight, lineHeight };
      });
      return { fixture:{clientWidth:root.clientWidth,scrollWidth:root.scrollWidth,left:box.left,right:box.right},controls,longText };
    })()`,
  });
  return evaluated?.result?.value || null;
}

async function captureLayoutSnapshot(cdp) {
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
  return evaluated?.result?.value;
}

async function verifyLayoutWithPropagationRetry(cdp, targetUrl, width, remote = false) {
  const attempts = remote ? 8 : 1;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await cdp.call('Runtime.evaluate', { expression:`localStorage.removeItem('football-analytics:first-run-guide:v1')` });
    await navigateForExpectedRevision(cdp, targetUrl, remote);
    const snapshot = await captureLayoutSnapshot(cdp);
    try {
      assertLayout(width, snapshot);
      return snapshot;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await cdp.call('Network.clearBrowserCache').catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  throw lastError || new Error(`${width}px: rendered layout did not converge`);
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
      await verifyLayoutWithPropagationRetry(cdp, targetUrl, width, Boolean(remoteUrl));
      console.log(`Bottom nav rendered correctly at ${width}px: 4 visible buttons, one row, no horizontal clipping.`);
      for (const theme of ['dark','light','ocean']) {
        const qaSnapshot = await inspectEdgeCaseFixture(cdp, width, theme);
        assertEdgeCaseFixture(width, theme, qaSnapshot);
        console.log(`Public UI edge cases rendered correctly at ${width}px in ${theme} theme.`);
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
