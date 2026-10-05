import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkFor, DUST_ARTWORKS, SPACE_ARTWORKS } from '../../components/portrait/artworks.js';
import { createGallerySelection, createGalleryTap } from '../../components/portrait/gallery-interaction.js';
import { createGallerySequence } from '../../components/portrait/gallery-sequence.js';

test('each English cover retains its Figma video link across repeated frame slots', () => {
  const expected = {
    '50:1716': 'BV1URQ7BFE1e', '50:1715': 'BV191Q7BKE8P',
    '50:1718': 'BV1gfiqYREst', '50:1722': 'BV1atHjeLEM3',
    '47:1691': 'BV1UP2mYBEi8', '47:1694': 'BV1FK42187k7', '47:1697': 'BV116DoYzEz6',
  };
  for (const art of [...DUST_ARTWORKS,...SPACE_ARTWORKS])
    assert.equal(art.url, `https://www.bilibili.com/video/${expected[art.id]}/`);
  for (let contentIndex=-10; contentIndex<20; contentIndex++) {
    const art = artworkFor({scene:1,contentIndex,frameId:'24:592'});
    assert.equal(art.url, `https://www.bilibili.com/video/${expected[art.id]}/`);
  }
  assert.equal(artworkFor({scene:0,frameId:'24:588'}),DUST_ARTWORKS[0]);
  assert.equal(artworkFor({scene:0,frameId:'24:598'}),DUST_ARTWORKS[1]);
  assert.equal(artworkFor({scene:0,frameId:'dust-fire'}),null);
});

test('first click selects, another entry reselects, only the same entry opens', () => {
  const selection=createGallerySelection(), art=SPACE_ARTWORKS[0];
  const first={id:'1:0',scene:1}, repeat={id:'1:5',scene:1};
  assert.equal(selection.activate(first,art),null);
  assert.equal(selection.selected.id,first.id);
  assert.equal(selection.activate(repeat,art),null);
  assert.equal(selection.activate(repeat,art),art.url);
  selection.activate(null,null);
  assert.equal(selection.selected,null);
  assert.equal(selection.activate(repeat,art),null);
  selection.clear();
  assert.equal(selection.selected,null);
});

test('drag, cancelled gesture and a different release target cannot activate a link', () => {
  const tap=createGalleryTap();
  tap.start(1,10,10,'frame'); tap.move(1,30,10); tap.move(1,10,10);
  assert.equal(tap.finish('frame'),false);
  tap.start(1,10,10,'frame'); tap.cancel(); assert.equal(tap.finish('frame'),false);
  tap.start(1,10,10,'frame'); assert.equal(tap.finish('other'),false);
  tap.start(1,10,10,'frame'); tap.move(1,13,12); assert.equal(tap.finish('frame'),true);
  assert.equal(tap.finish('frame'),false);
});

for (const scene of [0,1]) test(`${scene}: paused sequence freezes all entries and resumes without a jump`, () => {
  const sequence=createGallerySequence(scene,[],123);
  const view={width:1536,height:1024,scale:1,originX:0,originY:0};
  sequence.update(2,view);
  sequence.scroll(140); sequence.update(.03,view); sequence.resetScroll();
  const before=structuredClone(sequence.update(0,view));
  for(let i=0;i<100;i++) assert.deepEqual(sequence.update(0,view),before);
  const after=sequence.update(1/60,view);
  for(const item of after) {
    const old=before.find(candidate=>candidate.id===item.id);
    if(old) assert(Math.hypot(item.center[0]-old.center[0],item.center[1]-old.center[1])<1);
  }
});
