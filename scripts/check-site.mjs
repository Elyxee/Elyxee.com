// Walks the whole site in a real Chrome and checks, after every step, the
// address bar, the current view and that nothing logged an error or failed
// to load. Every way of moving between views is covered: nav clicks, the
// wheel, keys, Back / Forward and opening an address directly; on touch, that
// taps navigate and swipes never change view.
//
//   node scripts/check-site.mjs                 headless
//   node scripts/check-site.mjs --headed        watch it run
//   node scripts/check-site.mjs --shots DIR     also save a screenshot per step
//
// Needs Google Chrome (or set CHROME=/path/to/chrome). It serves the folder
// itself, with the same single-page fallback as the Cloudflare deployment.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- a static server with the deployment's single-page fallback ---------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  let file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT)) { response.writeHead(403).end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch { file = join(ROOT, 'index.html'); }
  try {
    const body = readFileSync(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// --- Chrome over the DevTools protocol ----------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'elyxee-check-'));
const port = 9500 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900',
  // Match the emulated device pixel ratio, so wheel and touch deltas arrive unscaled.
  '--force-device-scale-factor=2',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', ...(headed ? [] : ['--headless=new']), 'about:blank',
], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 60 && !targets.length; i++) {
  try { targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page'); }
  catch { await sleep(250); }
}
if (!targets.length) { console.error(`Could not start Chrome at ${CHROME}`); process.exit(2); }
const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let nextId = 0;
const pending = new Map(), problems = [];
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${message.params.exceptionDetails.exception?.description?.split('\n')[0]}`);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    problems.push(`console.error: ${message.params.args.map(arg => arg.value ?? arg.description).join(' ')}`);
  } else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    problems.push(`HTTP ${message.params.response.status}: ${message.params.response.url}`);
  } else if (message.method === 'Network.loadingFailed' && !message.params.canceled) {
    problems.push(`failed: ${message.params.errorText}`);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

// --- actions ---------------------------------------------------------------------
const where = () => evaluate(`(() => {
  const html = document.documentElement, portrait = document.querySelector('.stage--portrait');
  // The stage is at rest when the portrait is either fully hidden or unclipped.
  const resting = !portrait.classList.contains('is-shown') || !portrait.style.clipPath;
  return { path: location.pathname + location.search, view: resting ? html.dataset.stage : 'transit',
    passage: html.dataset.pagePassage ?? null };
})()`);
// A view counts as reached once its passage has finished and come to rest: a
// stage view with no page passage running, or a page view that has settled.
async function waitForView(path, view, timeout = 9000) {
  const start = Date.now();
  const passage = ['burn', 'portrait'].includes(view) ? null : 'settled';
  let last;
  while (Date.now() - start < timeout) {
    last = await where();
    if (last.path === path && last.view === view && last.passage === passage) return { ok: true, ...last };
    await sleep(100);
  }
  return { ok: false, ...last };
}
async function open(path) {
  await send('Page.navigate', { url: origin + path });
  await sleep(300);
  for (let i = 0; i < 600; i++) {
    if (await evaluate(`!!document.querySelector('.portrait.is-ready') && document.documentElement.dataset.stage === 'burn'`).catch(() => false)) break;
    await sleep(100);
  }
  // Let the portrait finish its first texture work before the first gesture.
  await sleep(1500);
}
async function center(selector) {
  return evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2]; })()`);
}
async function click(selector) {
  const [x, y] = await center(selector);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(250);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
}
async function wheel(deltaY, ticks = 5) {
  for (let i = 0; i < ticks; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 430, deltaX: 0, deltaY });
    await sleep(16);
  }
}
async function key(name) {
  const code = { ArrowUp: 38, ArrowDown: 40 }[name];
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code });
}
async function swipe(fromY, toY) {
  const point = y => [{ x: 720, y, id: 1 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(fromY) });
  for (let i = 1; i <= 12; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(fromY + (toY - fromY) * i / 12) });
    await sleep(16);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(selector) {
  const [x, y] = await center(selector);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(60);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// A swipe that must not change view: wait long enough for any passage to show.
const swipeStays = (fromY, toY) => async () => { await swipe(fromY, toY); await sleep(2500); };
const history = step => evaluate(`history.${step}()`);
const scene = () => evaluate(`document.querySelector('.portrait')?.dataset.scene`);
// The first switch to Dust also prepares its frames, which can take a while.
async function switchScene(to) {
  await click('.scene-switch');
  for (let i = 0; i < 150; i++) {
    if (await scene() === to && !await evaluate(`document.querySelector('.scene-switch').disabled`)) return;
    await sleep(100);
  }
  throw new Error(`scene did not switch to ${to === 'dust' ? 'Dust' : 'Space'}`);
}

// --- the walk -----------------------------------------------------------------------
const steps = [
  ['open /', () => open('/'), '/', 'burn'],
  ['wheel down: Home → Portfolio', () => wheel(60), '/portfolio', 'portrait'],
  ['wheel up: Portfolio → Home', () => wheel(-60), '/', 'burn'],
  ['click Portfolio', () => click('.burn-nav a[href="/portfolio"]'), '/portfolio', 'portrait'],
  ['Back', () => history('back'), '/', 'burn'],
  ['Forward', () => history('forward'), '/portfolio', 'portrait'],
  ['switch to Dust and back', async () => { await switchScene('dust'); await switchScene('space'); }, '/portfolio', 'portrait'],
  ['wheel down: Portfolio → About', () => wheel(60, 6), '/about', 'about'],
  ['Back: About → Portfolio', () => history('back'), '/portfolio', 'portrait'],
  ['click Elyxee (Portfolio → Home)', () => click('.portrait-home'), '/', 'burn'],
  ['click About', () => click('.burn-nav a[href="/about"]'), '/about', 'about'],
  ['wheel up at the top: About → Portfolio', () => wheel(-60, 6), '/portfolio', 'portrait'],
  ['ArrowUp: Portfolio → Home', () => key('ArrowUp'), '/', 'burn'],
  ['ArrowDown: Home → Portfolio', () => key('ArrowDown'), '/portfolio', 'portrait'],
  ['ArrowUp again', () => key('ArrowUp'), '/', 'burn'],
  ['click About from Home', () => click('.burn-nav a[href="/about"]'), '/about', 'about'],
  ['click Elyxee in About (About → Home)', () => click('.about-brand'), '/', 'burn'],
  ['open /about/ directly', () => open('/about/'), '/', 'burn'],
  ['open /portfolio?view=about directly', () => open('/portfolio?view=about'), '/', 'burn'],
  // Touch screens change view only by tapping links; swipes never do.
  ['touch emulation on', () => send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }), '/', 'burn'],
  ['touch: swipe up on Home stays on Home', swipeStays(700, 250), '/', 'burn'],
  ['touch: tap Portfolio', () => tap('.burn-nav a[href="/portfolio"]'), '/portfolio', 'portrait'],
  ['touch: swipe up on Portfolio stays', swipeStays(750, 250), '/portfolio', 'portrait'],
  ['touch: swipe down on Portfolio stays', swipeStays(250, 750), '/portfolio', 'portrait'],
  ['touch: tap Elyxee (Portfolio → Home)', () => tap('.portrait-home'), '/', 'burn'],
  ['touch: tap About', () => tap('.burn-nav a[href="/about"]'), '/about', 'about'],
  ['touch: pull down at the top of About stays', swipeStays(250, 750), '/about', 'about'],
  ['touch: tap Elyxee in About (About → Home)', () => tap('.about-brand'), '/', 'burn'],
];

let failures = 0;
if (shots) mkdirSync(shots, { recursive: true });
try {
  for (const [index, [name, action, path, view]] of steps.entries()) {
    const before = problems.length;
    let result;
    try {
      await action();
      result = await waitForView(path, view);
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    const fresh = problems.slice(before);
    const ok = result.ok && !fresh.length;
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(46)} ${result.path ?? ''} ${result.view ?? ''}${result.error ? `  ${result.error}` : ''}`);
    for (const problem of fresh) console.log(`    ${problem}`);
    if (shots) {
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
      writeFileSync(join(shots, `${String(index + 1).padStart(2, '0')}.jpg`), Buffer.from(data, 'base64'));
    }
  }
} finally {
  socket.close(); chrome.kill('SIGKILL'); server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files. */ }
}
console.log(failures ? `\n${failures} of ${steps.length} steps failed.` : `\nAll ${steps.length} steps passed.`);
process.exit(failures ? 1 : 0);
