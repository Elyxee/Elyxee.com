import test from 'node:test';
import assert from 'node:assert/strict';
import { isNearGalleryFrame, isNearGalleryTrack } from './gallery-region.js';
import { GALLERY_SEQUENCES, createGallerySequence } from './gallery-sequence.js';

const view = { width: 1376, height: 744, scale: 744/1024,
  originX: (1376-1536*744/1024)/2, originY: 0 };

test('Dust and Space reserve opposite empty corners for page navigation', () => {
  const corners = [[60,60], [1316,60], [60,680], [1316,680]];
  assert.deepEqual(corners.map(([x,y]) => isNearGalleryTrack(0,x,y,view)), [true,false,false,true]);
  assert.deepEqual(corners.map(([x,y]) => isNearGalleryTrack(1,x,y,view)), [false,true,true,false]);
});

for (const scene of [0,1]) {
  test(`${scene}: the track stays scrollable between frames and across repeated laps`, () => {
    const [dx,dy] = GALLERY_SEQUENCES[scene].step;
    const items = createGallerySequence(scene,[],123).update(0,view);
    for (const item of items) {
      for (const lap of [-2,-.5,0,.5,2]) {
        const x = view.originX + (item.center[0]+dx*lap)*view.scale;
        const y = view.originY + (item.center[1]+dy*lap)*view.scale;
        assert.equal(isNearGalleryTrack(scene,x,y,view),true);
      }
    }
  });
}

test('track coordinates follow the portrait scale and its centered origin', () => {
  for (const scale of [.35,.7,1,1.75]) {
    const transformed = {scale,originX:150,originY:40};
    for (const scene of [0,1]) {
      for (const [x,y] of [[0,0],[0,1024],[1536,0],[1536,1024],[300,800]]) {
        assert.equal(isNearGalleryTrack(scene,150+x*scale,40+y*scale,transformed,0),
          isNearGalleryTrack(scene,x,y,{scale:1,originX:0,originY:0},0));
      }
    }
  }
});

test('live frame hit area includes rotation and a 36px margin', () => {
  const angle = Math.PI/4, a = Math.cos(angle)*.7, b = Math.sin(angle)*.7;
  const frame = {size:[400,300],pose:{center:[500,400],axes:[a,b,-b,a]}};
  const point = (u,v) => [500+a*u-b*v,400+b*u+a*v];
  assert.equal(isNearGalleryFrame(frame,...point(0,0)),true);
  assert.equal(isNearGalleryFrame(frame,...point(200+35/.7,0)),true);
  assert.equal(isNearGalleryFrame(frame,...point(200+40/.7,0)),false);
  assert.equal(isNearGalleryFrame({...frame,pose:null},500,400),false);
});
