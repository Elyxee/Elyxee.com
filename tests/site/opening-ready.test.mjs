import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForOpening } from '../../components/site/opening-ready.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

test('a slow scene stays covered beyond the former seven-second deadline', async () => {
  let clock = 0, revealed = false;
  const scene = deferred(), curtain = deferred();
  const waits = [];
  const opening = waitForOpening({ scene: scene.promise, curtain: curtain.promise,
    now: () => clock, sleep: async ms => { waits.push(ms); },
  }).then(() => { revealed = true; });
  curtain.resolve();
  clock = 30000;
  await flush();
  assert.equal(revealed, false);
  assert.deepEqual(waits, []);
  scene.resolve();
  await opening;
  assert.equal(revealed, true);
  assert.deepEqual(waits, [0]);
});

test('fast cached loads retain the existing minimum opening duration', async () => {
  let clock = 100;
  const scene = deferred(), waits = [];
  const opening = waitForOpening({ scene: scene.promise, curtain: Promise.resolve(),
    now: () => clock, sleep: async ms => { waits.push(ms); }, minimumMs: 1500,
  });
  clock = 400;
  scene.resolve();
  await opening;
  assert.deepEqual(waits, [1200]);
});

test('full curtain texture and fonts finish before reveal; optional decoration can fall back', async () => {
  const curtain = deferred(), fonts = deferred();
  let revealed = false;
  const opening = waitForOpening({ scene: Promise.resolve(), curtain: curtain.promise,
    fonts: fonts.promise, decorations: [Promise.reject(new Error('No text WebGL'))],
    sleep: async () => {},
  }).then(() => { revealed = true; });
  await flush();
  assert.equal(revealed, false);
  curtain.resolve();
  await flush();
  assert.equal(revealed, false);
  fonts.resolve();
  await opening;
  assert.equal(revealed, true);
});

test('critical failures reach recovery rather than revealing an incomplete Home', async () => {
  await assert.rejects(waitForOpening({ scene: Promise.reject(new Error('Offline')),
    curtain: Promise.resolve(), sleep: async () => assert.fail('must not reveal'),
  }), /Offline/);
});
