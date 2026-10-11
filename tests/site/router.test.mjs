import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, pathFor, viewFromPath } from '../../components/site/router.js';

function fakeWindow(href) {
  const listeners = new Map();
  const entries = [];
  const win = {
    location: { href, get pathname() { return new URL(this.href).pathname; } },
    history: {
      pushState(state, _, url) { entries.push(['push', String(url)]); win.location.href = String(url); },
      replaceState(state, _, url) { entries.push(['replace', String(url)]); win.location.href = String(url); },
    },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
    go(url) { win.location.href = url; listeners.get('popstate')?.(); },
  };
  return { win, entries, listeners };
}

test('every view has one path, and Home is the site root', () => {
  assert.equal(pathFor('home'), '/');
  assert.equal(pathFor('portfolio'), '/portfolio');
  assert.equal(pathFor('about'), '/about');
  assert.equal(viewFromPath('/'), 'home');
  assert.equal(viewFromPath('/portfolio'), 'portfolio');
  assert.equal(viewFromPath('/portfolio/'), 'portfolio');
  assert.equal(viewFromPath('/about'), 'about');
  assert.equal(viewFromPath('/no-such-view'), 'home');
});

test('a fresh load on any view, or an old ?view= link, starts at the root', () => {
  for (const href of ['https://elyxee.com/about', 'https://elyxee.com/portfolio/', 'https://elyxee.com/?view=about']) {
    const { win, entries } = fakeWindow(href);
    createRouter({ win, onNavigate() {} });
    assert.deepEqual(entries, [['replace', 'https://elyxee.com/']], href);
  }
  const { win, entries } = fakeWindow('https://elyxee.com/?preview=latest');
  createRouter({ win, onNavigate() {} });
  assert.deepEqual(entries, [], 'other query parameters stay on the root');
});

test('recording a view adds one history entry, and none for the current one', () => {
  const { win, entries } = fakeWindow('https://elyxee.com/');
  const router = createRouter({ win, onNavigate() {} });
  router.record('home');
  router.record('portfolio');
  router.record('portfolio');
  router.record('about');
  assert.deepEqual(entries, [['push', 'https://elyxee.com/portfolio'], ['push', 'https://elyxee.com/about']]);
});

test('Back and Forward report the view of the new address', () => {
  const seen = [];
  const { win } = fakeWindow('https://elyxee.com/');
  const router = createRouter({ win, onNavigate: id => seen.push(id) });
  win.go('https://elyxee.com/portfolio');
  win.go('https://elyxee.com/about');
  win.go('https://elyxee.com/');
  assert.deepEqual(seen, ['portfolio', 'about', 'home']);
  router.destroy();
  win.go('https://elyxee.com/about');
  assert.equal(seen.length, 3);
});
