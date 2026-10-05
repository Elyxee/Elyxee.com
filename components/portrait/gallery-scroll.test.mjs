import test from 'node:test';
import assert from 'node:assert/strict';
import { createGalleryScroll, galleryWheelDelta } from './gallery-scroll.js';
import { createGallerySequence, GALLERY_SEQUENCES } from './gallery-sequence.js';
import { artworkFor } from './artworks.js';

const view = { width: 1536, height: 1024, scale: 1, originX: 0, originY: 0 };
const snapshot = items => structuredClone(items);

test('pixel, line and page wheel input have consistent bounded units', () => {
  assert.equal(galleryWheelDelta({ deltaY: 48, deltaMode: 0 }, 800), 48);
  assert.equal(galleryWheelDelta({ deltaY: 3, deltaMode: 1 }, 800), 48);
  assert.equal(galleryWheelDelta({ deltaY: -1, deltaMode: 2 }, 800), -180);
  assert.equal(galleryWheelDelta({ deltaY: NaN }, 800), 0);
});

test('scroll eases in, caps speed, and settles back to zero added speed', () => {
  const motion = createGalleryScroll();
  motion.input(100000);
  const first = motion.update(1 / 120) * 120;
  assert(first > 0 && first < 10, 'first frame must ease in');
  let peak = first;
  for (let i = 0; i < 240; i++) {
    motion.input(180);
    peak = Math.max(peak, motion.update(1 / 120) * 120);
  }
  assert(peak > 50 && peak < 118.75);
  for (let i = 0; i < 480; i++) motion.update(1 / 120);
  assert(Math.abs(motion.update(1 / 120) * 120) < .001);
});

test('same gesture travels the same distance at 30, 60 and 120 Hz', () => {
  const distances = [30, 60, 120].map(fps => {
    const motion = createGalleryScroll();
    motion.input(-120);
    let distance = 0;
    for (let i = 0; i < fps * 3; i++) distance += motion.update(1 / fps);
    return distance;
  });
  assert(distances.every(distance => distance < -30 && distance > -40));
  assert(Math.max(...distances) - Math.min(...distances) < 1e-10);
});

test('reduced motion permits explicit movement without residual inertia', () => {
  const motion = createGalleryScroll();
  motion.input(-100, true);
  assert(Math.abs(motion.update(1 / 60, true) + 28) < 1e-10);
  assert.equal(motion.update(1, true), 0);
  motion.input(180);
  motion.reset();
  assert.equal(motion.update(1), 0);
});

test('Matrix and Equality exchange the initial liquid and ice slots', () => {
  const items = createGallerySequence(1, [], 123).update(0, view);
  assert.equal(artworkFor(items.find(item => item.frameId === '24:592' && item.cycle === 0)).id, '50:1718');
  assert.equal(artworkFor(items.find(item => item.frameId === '24:594' && item.cycle === 0)).id, '47:1691');
});

for (const scene of [0, 1]) {
  test(`${scene}: up truly reverses the trail, down advances it, without reversing age`, () => {
    const sequence = createGallerySequence(scene, [], 123);
    const initial = snapshot(sequence.update(0, view));
    const [sx, sy] = GALLERY_SEQUENCES[scene].step;
    const length = Math.hypot(sx, sy);
    for (let i = 0; i < 120; i++) {
      sequence.scroll(-24);
      sequence.update(1 / 60, view);
    }
    const reversed = snapshot(sequence.update(0, view));
    const item = reversed.find(item => initial.some(old => old.id === item.id));
    const before = initial.find(old => old.id === item.id);
    const travel = ((item.center[0] - before.center[0]) * sx + (item.center[1] - before.center[1]) * sy) / length;
    assert(travel < -50, 'up must reverse, not merely slow forward travel');
    assert(item.age > 1.9 && Number.isFinite(item.rotation));
    for (let i = 0; i < 180; i++) {
      sequence.scroll(24);
      sequence.update(1 / 60, view);
    }
    const after = sequence.update(0, view).find(candidate => candidate.id === item.id);
    assert(after);
    assert(((after.center[0] - item.center[0]) * sx + (after.center[1] - item.center[1]) * sy) / length > 100);
    assert(after.age > item.age);
  });

  test(`${scene}: repeated forward/reverse laps retain spacing and stable entry identity`, () => {
    const sequence = createGallerySequence(scene, [], 123);
    const [sx, sy] = GALLERY_SEQUENCES[scene].step, length = Math.hypot(sx, sy);
    const known = new Map();
    let minimumIndex = 0;
    for (let tick = 0; tick < 7200; tick++) {
      sequence.scroll(tick < 3600 ? -30 : 30);
      const items = sequence.update(1 / 60, view);
      const projected = items.map(item => (item.center[0] * sx + item.center[1] * sy) / length).sort((a, b) => a - b);
      for (let i = 1; i < projected.length; i++) assert(projected[i] - projected[i - 1] > 400);
      assert(items.length >= 3);
      for (const item of items) {
        minimumIndex = Math.min(minimumIndex, item.contentIndex);
        const identity = [item.frameId, item.rotationOffset, artworkFor(item)?.id];
        if (known.has(item.id)) assert.deepEqual(identity, known.get(item.id));
        known.set(item.id, identity);
        assert(item.age >= 0 && Number.isFinite(item.rotation));
      }
    }
    assert(minimumIndex < -GALLERY_SEQUENCES[scene].frames.length);
  });
}
