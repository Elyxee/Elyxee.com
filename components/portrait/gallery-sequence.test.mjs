import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_ITEMS } from './gallery-items.js';
import { createGallerySequence, GALLERY_SEQUENCES, GALLERY_SPEED_FACTOR } from './gallery-sequence.js';

const desktop = { width:1536, height:1024, scale:1, originX:0, originY:0 };
const snapshot = items => structuredClone(items);
function intersectsView(item, view) {
  const [a,b,c,d] = item.matrix, [w,h] = item.size;
  const cos=Math.cos(item.rotation), sin=Math.sin(item.rotation);
  const bx=(Math.abs(cos*a-sin*b)*w+Math.abs(cos*c-sin*d)*h)*view.scale/2;
  const by=(Math.abs(sin*a+cos*b)*w+Math.abs(sin*c+cos*d)*h)*view.scale/2;
  const x=item.center[0]*view.scale+view.originX, y=item.center[1]*view.scale+view.originY;
  return x+bx>0 && x-bx<view.width && y+by>0 && y-by<view.height;
}

for (const scene of [0,1]) {
  test(`${scene}: starts with the four registered placements`, () => {
    const items=createGallerySequence(scene,[],123).update(0,desktop).filter(item=>intersectsView(item,desktop));
    assert.equal(items.length,4);
    for(const item of items) {
      const frame=FRAME_ITEMS.find(frame=>frame.id===item.frameId);
      const [a,b,c,d,x,y]=frame.matrix, [w,h]=frame.size;
      assert.deepEqual(item.center,[x+a*w/2+c*h/2,y+b*w/2+d*h/2]);
      assert.equal(item.rotation,0);
    }
  });

  test(`${scene}: next pass has new entries and independent content`, () => {
    const content=Array.from({length:40},(_,index)=>({id:`article-${index}`}));
    const sequence=createGallerySequence(scene,content,123), count=GALLERY_SEQUENCES[scene].frames.length;
    const first=snapshot(sequence.update(0,desktop)).filter(item=>item.cycle===0);
    const next=sequence.update(GALLERY_SEQUENCES[scene].seconds,desktop);
    for(const before of first) {
      const after=next.find(item=>item.frameId===before.frameId && item.cycle===1);
      assert(after);
      assert.notEqual(after.id,before.id);
      assert.equal(after.contentIndex,before.contentIndex+count);
      assert.notEqual(after.content.id,before.content.id);
      assert(Math.hypot(after.center[0]-before.center[0],after.center[1]-before.center[1])<5);
    }
  });

  test(`${scene}: mean drift stays just above the original slow speed`, () => {
    const view={...desktop,width:10000,height:10000,originX:5000,originY:5000};
    const sequence=createGallerySequence(scene,[],123);
    const first=snapshot(sequence.update(0,view)).find(item=>item.cycle===0);
    const seconds=GALLERY_SEQUENCES[scene].seconds;
    const next=sequence.update(seconds,view).find(item=>item.id===first.id);
    const speed=Math.hypot(next.center[0]-first.center[0],next.center[1]-first.center[1])/seconds;
    const original=scene===0 ? Math.hypot(17,12) : Math.hypot(11,12);
    assert(Math.abs(speed/original-GALLERY_SPEED_FACTOR)<.005);
  });

  test(`${scene}: each pass varies its angle without changing spacing or jumping on re-entry`, () => {
    const sequence=createGallerySequence(scene,[],123), duration=GALLERY_SEQUENCES[scene].seconds;
    let previous;
    for(let cycle=1;cycle<=8;cycle++) {
      const items=snapshot(sequence.update(duration,desktop)).filter(item=>item.cycle===cycle);
      for(const item of items) {
        assert(Math.abs(item.rotationOffset)>=2*Math.PI/180 && Math.abs(item.rotationOffset)<=6*Math.PI/180);
        const old=previous?.find(other=>other.frameId===item.frameId);
        if(old) {
          assert(old.rotationOffset*item.rotationOffset<0,'consecutive passes should lean different ways');
          assert(Math.hypot(item.center[0]-old.center[0],item.center[1]-old.center[1])<8);
        }
      }
      sequence.update(0,{...desktop,originX:-100000});
      const restored=sequence.update(0,desktop);
      for(const item of items) assert.equal(restored.find(other=>other.id===item.id).rotationOffset,item.rotationOffset);
      previous=items;
    }
    const other=createGallerySequence(scene,[],987).update(duration*8,desktop);
    assert(previous.some(item=>other.find(candidate=>candidate.id===item.id)?.rotationOffset!==item.rotationOffset));
  });

  test(`${scene}: ten minutes without bunching, empty runs or frame teleporting`, () => {
    const sequence=createGallerySequence(scene,[],123);
    const [sx,sy]=GALLERY_SEQUENCES[scene].step, length=Math.hypot(sx,sy);
    let previous=new Map();
    for(let frame=0;frame<12000;frame++) {
      const items=sequence.update(.05,desktop);
      assert(items.filter(item=>intersectsView(item,desktop)).length>=3,'gallery has become sparse');
      const sorted=items.map(item=>(item.center[0]*sx+item.center[1]*sy)/length).sort((a,b)=>a-b);
      for(let i=1;i<sorted.length;i++) {
        const gap=sorted[i]-sorted[i-1];
        assert(gap>400 && gap<680,`spacing drift: ${gap}`);
      }
      for(const item of items) {
        const before=previous.get(item.id);
        if(before) assert(Math.hypot(item.center[0]-before[0],item.center[1]-before[1])<16,'visible entry jumped');
        // Hover must not change the travel clock or accumulate a following gap.
        item.hover=frame%80<40 ? 1 : 0;
      }
      previous=new Map(items.map(item=>[item.id,[...item.center]]));
    }
  });

  test(`${scene}: resizing and reduced motion preserve entry identity and position`, () => {
    const sequence=createGallerySequence(scene,[],123);
    const before=snapshot(sequence.update(6,desktop));
    const scale=390/1040;
    const mobile={width:390,height:844,scale,originX:(390-1536*scale)/2,originY:(844-1024*scale)/2};
    const after=sequence.update(30,mobile,true);
    assert(after.filter(item=>intersectsView(item,mobile)).length>=2);
    for(const item of after) {
      const old=before.find(previous=>previous.id===item.id);
      if(old) assert.deepEqual(item.center,old.center);
    }
    const frozen=snapshot(after);
    assert.deepEqual(sequence.update(30,mobile,true),frozen);
  });
}

test('Dust: wood has balanced clearances to fire and Chinese frame', () => {
  const view={...desktop,width:4000,height:3000,originX:1000,originY:1000};
  const items=createGallerySequence(0,[],123).update(0,view).filter(item=>item.cycle===0);
  const [sx,sy]=GALLERY_SEQUENCES[0].step, length=Math.hypot(sx,sy), ux=sx/length, uy=sy/length;
  const interval=id=>{
    const item=items.find(item=>item.frameId===id), [a,b,c,d]=item.matrix, [w,h]=item.size;
    const cos=Math.cos(item.rotation),sin=Math.sin(item.rotation);
    const radius=(Math.abs((cos*a-sin*b)*ux+(sin*a+cos*b)*uy)*w
      +Math.abs((cos*c-sin*d)*ux+(sin*c+cos*d)*uy)*h)/2;
    const center=item.center[0]*ux+item.center[1]*uy;
    return [center-radius,center+radius];
  };
  const fire=interval('dust-fire'),wood=interval('24:588'),chinese=interval('24:598');
  const leftGap=wood[0]-fire[1],rightGap=chinese[0]-wood[1];
  assert(leftGap>30 && rightGap>30);
  assert(Math.abs(leftGap-rightGap)<25,`unbalanced gaps: ${leftGap} / ${rightGap}`);
});
