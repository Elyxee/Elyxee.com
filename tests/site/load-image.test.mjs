import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '../../components/shared/load-image.js';

test('delivery images wait for decoding; a failed optimized asset uses its original', async t => {
  const requests = [];
  let finishDecode;
  const previousImage = globalThis.Image;
  t.after(() => {
    if (previousImage === undefined) delete globalThis.Image;
    else globalThis.Image = previousImage;
  });
  globalThis.Image = class {
    set src(value) {
      this.url = value;
      requests.push(value);
      queueMicrotask(() => value === 'missing.webp' ? this.onerror() : this.onload());
    }
    decode() { return new Promise(resolve => { finishDecode = resolve; }); }
  };
  let loaded = false;
  const promise = loadImage('missing.webp', { fallbackSrc: 'original.png', fetchPriority: 'high' })
    .then(image => { loaded = true; return image; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['missing.webp', 'original.png']);
  assert.equal(loaded, false);
  finishDecode();
  const image = await promise;
  assert.equal(image.decoding, 'async');
  assert.equal(image.fetchPriority, 'high');
});
