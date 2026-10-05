import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransitionMotion, idleDestination } from '../../components/site/transition-motion.js';
import { portraitShare, edgeHeightAt, FIRE_EDGE } from '../../components/site/transition-front.js';

function advance(motion, from, to, hz=60) {
  const dt=1000/hz;
  for(let now=from+dt;now<=to+.001;now+=dt) motion.update(now,dt/1000);
}

test('one normal wheel gesture carries into the next page without a second scroll', () => {
  const m=createTransitionMotion();
  m.scroll(100,0);
  advance(m,0,100);
  assert.equal(m.destination,null);
  advance(m,100,140);
  assert.equal(m.destination,1);
  advance(m,140,2200);
  assert.equal(m.position,1);
  m.scroll(-100,2400);
  advance(m,2400,4600);
  assert.equal(m.position,0);
});

test('a small tentative scroll waits one second and returns to the larger page', () => {
  const m=createTransitionMotion();
  m.scroll(20,0);
  advance(m,0,1000);
  assert.equal(m.destination,null);
  assert.ok(m.position>0 && m.position<.1);
  advance(m,1000,2400);
  assert.equal(m.position,0);
  assert.equal(idleDestination(.49,1001),0);
  assert.equal(idleDestination(.51,1001),1);
});

test('holding a drag between pages never snaps; release settles toward its visible majority', () => {
  for(const [position, destination] of [[.32,0],[.68,1]]) {
    const m=createTransitionMotion();
    m.hold();m.drag(position,0);
    advance(m,0,2000);
    assert.ok(Math.abs(m.position-position)<.001);
    assert.equal(m.destination,null);
    m.release(2000);
    advance(m,2000,3000);
    assert.equal(m.destination,null);
    advance(m,3000,4400);
    assert.equal(m.position,destination);
  }
});

test('deliberate slow wheel scrubbing is not mistaken for a flick', () => {
  const m=createTransitionMotion();
  for(let now=0;now<1200;now+=100) {
    m.scroll(15,now);
    advance(m,now,now+100);
    assert.equal(m.destination,null);
  }
  assert.ok(m.position>.25 && m.position<.32);
  advance(m,1200,3400);
  assert.equal(m.position,0);
});

test('reverse input interrupts continuation without resetting position or velocity', () => {
  const m=createTransitionMotion();
  m.scroll(100,0);advance(m,0,300);
  const position=m.position, velocity=m.velocity;
  m.scroll(-30,310);
  assert.equal(m.destination,null);
  assert.equal(m.position,position);
  assert.equal(m.velocity,velocity);
  advance(m,310,500);
  assert.ok(m.position<position);
});

test('momentum tail remains with the transition and a fresh gesture is released', () => {
  const m=createTransitionMotion();m.scroll(100,0);advance(m,0,150);
  assert.equal(m.ownsTail(4,160),true);
  m.scroll(4,160);
  assert.equal(m.destination,1);
  assert.equal(m.ownsTail(-4,170),false);
  assert.equal(m.ownsTail(4,400),false);
});

test('continuation reaches the same endpoint at different refresh rates', () => {
  for(const hz of [30,60,120]) {
    const m=createTransitionMotion();m.scroll(100,0);advance(m,0,2200,hz);
    assert.equal(m.position,1);
    assert.equal(m.velocity,0);
  }
});

test('one reveal front travels monotonically with no full-cover second phase', () => {
  assert.equal(portraitShare(0),0);
  assert.equal(portraitShare(1),1);
  assert.ok(portraitShare(.5)>.5);
  for(const time of [0,3,10,30]) for(let x=0;x<=1;x+=.05) {
    let previous=-Infinity;
    for(let i=0;i<=100;i++) {
      const edge=FIRE_EDGE.hidden+(FIRE_EDGE.full-FIRE_EDGE.hidden)*i/100;
      const height=edgeHeightAt(x,edge,1,time);
      assert.ok(height>=previous);
      previous=height;
    }
  }
});

test('idle settling follows the area on screen even when input progress is below halfway', () => {
  const m=createTransitionMotion();m.hold();m.drag(.49,0);advance(m,0,2000);m.release(2000);
  m.update(3001,1.001,false,portraitShare(m.position));
  assert.equal(m.destination,1);
});

test('fully exposed scenery still settles unfinished input to its true endpoint', () => {
  for (const [input, endpoint] of [[.1, 0], [.9, 1]]) {
    const m = createTransitionMotion();
    m.hold(); m.drag(input, 0); advance(m, 0, 2000); m.release(2000);
    const visible = portraitShare(m.position);
    assert.equal(visible, endpoint);
    m.update(3001, 1.001, false, visible);
    assert.equal(m.input, endpoint);
    advance(m, 3001, 4401);
    assert.equal(m.position, endpoint);
  }
});
