import test from 'node:test';
import assert from 'node:assert/strict';
import { depthChannel, depthOffset } from './depth-lens.js';

test('pull-back keeps its centre and mathematical perimeter anchored', () => {
  for (const position of [0,.5,1]) assert.equal(Math.abs(depthOffset(position)),0);
  for (let i=0;i<=1000;i++) {
    const p=i/1000;
    assert.ok(Math.abs(depthOffset(p)+depthOffset(1-p))<1e-12);
  }
});

test('quantized sampling never exposes the background or folds the image', () => {
  for (const [width,height] of [[1376,774],[1920,1080],[393,852],[3440,1440]]) {
    const longest=Math.max(width,height);
    for (const axis of [width,height]) for (const amount of [0,.025,.05,.075]) {
      let previous=-1;
      for (let i=0;i<=255;i++) {
        const p=i/255;
        const channel=depthChannel(p,axis/longest);
        assert.ok(channel>=0 && channel<=255);
        const sample=p*axis+longest*amount*(channel/255-.5);
        assert.ok(sample>=0 && sample<=axis, `${width}×${height}: edge ${i} escaped`);
        assert.ok(sample>previous, `${width}×${height}: image folded at ${i}`);
        previous=sample;
      }
    }
  }
});
