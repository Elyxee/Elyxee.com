import test from 'node:test';
import assert from 'node:assert/strict';
import { planNavigation, VIEWS, viewAbove, viewById } from '../../components/site/views.js';

test('the view table is consistent', () => {
  const ids = VIEWS.map(view => view.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.equal(new Set(VIEWS.map(view => view.path)).size, VIEWS.length, 'unique paths');
  for (const view of VIEWS) {
    assert.ok(view.path.startsWith('/'), `${view.id} path`);
    assert.ok(['stage', 'page'].includes(view.passage), `${view.id} passage`);
    if (view.passage === 'stage') assert.ok([0, 1].includes(view.position), `${view.id} position`);
    if (view.passage === 'page') assert.equal(typeof view.load, 'function', `${view.id} loads on demand`);
    if (view.below) assert.equal(viewById(view.below)?.passage, 'page', `${view.id}.below is a page view`);
  }
  assert.deepEqual(VIEWS.filter(view => view.passage === 'stage').map(view => view.position).sort(), [0, 1]);
  assert.equal(viewById('home').path, '/');
  assert.equal(viewAbove('about'), 'portfolio');
});

test('the About page view loads its own module', async () => {
  const mount = await viewById('about').load();
  assert.equal(typeof mount, 'function');
});

test('clicks and keys move along the stage; clicks use each view\'s timing', () => {
  assert.deepEqual(planNavigation('portfolio'), { action: 'goto', position: 1, timing: { durationMs: 3200 } });
  assert.deepEqual(planNavigation('home'), { action: 'goto', position: 0, timing: { omega: 2.7 } });
  assert.deepEqual(planNavigation('portfolio', { via: 'key' }), { action: 'goto', position: 1, timing: undefined });
  assert.deepEqual(planNavigation('home', { via: 'key' }), { action: 'goto', position: 0, timing: undefined });
});

test('a page view opens from anywhere and records its address', () => {
  assert.deepEqual(planNavigation('about'), { action: 'open', page: 'about', record: true });
  assert.deepEqual(planNavigation('about', { via: 'history' }), { action: 'open', page: 'about', record: false });
});

test('leaving a page waits until it has settled', () => {
  const settled = { id: 'about', settled: true }, moving = { id: 'about', settled: false };
  assert.deepEqual(planNavigation('home', { page: settled }), { action: 'leave', page: 'about', to: 'home', record: true });
  assert.deepEqual(planNavigation('portfolio', { page: settled, via: 'history' }),
    { action: 'leave', page: 'about', to: 'portfolio', record: false });
  assert.deepEqual(planNavigation('home', { page: moving }), { action: 'none' });
});

test('Back and Forward land on stage views without a passage', () => {
  assert.deepEqual(planNavigation('home', { via: 'history' }), { action: 'jump', position: 0 });
  assert.deepEqual(planNavigation('portfolio', { via: 'history' }), { action: 'jump', position: 1 });
  assert.deepEqual(planNavigation('nowhere'), { action: 'none' });
});
