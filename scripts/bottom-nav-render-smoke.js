import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const WIDTHS = [360, 375, 390, 430];
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
  if (!snapshot.assetRevision) throw new Error(`${width}px: frontend asset revision meta is missing`);
  if (snapshot.assetTokens.length !== 3 || snapshot.assetTokens.some(token => token !== snapshot.assetRevision)) {
    throw new Error(`${width}px: frontend JS/CSS cache-bust tokens are not coherent`);
  }
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
      const navResult = await cdp.call('Page.navigate', { url: targetUrl });
      if (navResult.errorText) throw new Error(`Page.navigate failed: ${navResult.errorText}`);
      await waitForReady(cdp);
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
          return {
            innerWidth: window.innerWidth,
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
    }
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
