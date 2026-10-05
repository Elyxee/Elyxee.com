import { FRAME_ITEMS } from './gallery-items.js';
import { createGalleryScroll } from './gallery-scroll.js';

// The earlier 10-second loop made the gallery feel rushed. Keep the original
// art-direction drift and add only a small lift so a complete pass still feels
// alive without overtaking the portraits.
export const GALLERY_SPEED_FACTOR = 1.05;

// A repeated spatial arrangement, not independently wrapped frame paths.
// One shared translation keeps the tuned gaps throughout every lap.
// Match the original slow drift's nominal speed, with the small lift above.
function sequence(step, originalVelocity, frames) {
  return { seconds: Math.hypot(...step)/(Math.hypot(...originalVelocity)*GALLERY_SPEED_FACTOR), step, frames };
}
export const GALLERY_SEQUENCES = [
  sequence([2260,1240], [17,12], ['24:591','24:590','24:598','24:588','dust-fire']),
  sequence([1850,-1080], [11,-12], ['24:592','24:597','24:594','24:596']),
];

function randomFor(index, seed) {
  let value = (seed ^ Math.imul(index+1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value>>>16), 0x21f0aaad);
  value = Math.imul(value ^ (value>>>15), 0x735a2d97);
  return ((value ^ (value>>>15)) >>> 0) / 4294967296;
}

export function createGallerySequence(scene, contentItems = [], seed = Math.floor(Math.random()*4294967296)) {
  const config = GALLERY_SEQUENCES[scene];
  const definitions = config.frames.map(id => {
    const frame = FRAME_ITEMS.find(item => item.id === id);
    const [a,b,c,d,x,y] = frame.matrix, [w,h] = frame.size;
    return { frame, center: [x + a*w/2 + c*h/2, y + b*w/2 + d*h/2],
      // Includes shadow, hover lift and the bounded rotation around the source.
      bounds: [(Math.abs(a)*w + Math.abs(c)*h)/2 + 80, (Math.abs(b)*w + Math.abs(d)*h)/2 + 80] };
  });
  const instances = new Map();
  const scroll = createGalleryScroll();
  const speed = Math.hypot(...config.step) / config.seconds;
  let elapsed = 0, travelTime = 0;

  function update(dt, view, reduced = false) {
    if (!reduced) { elapsed += dt; travelTime += dt; }
    // Travel can run backwards; material animation and entry age never do.
    travelTime += scroll.update(dt, reduced) / speed;
    const cycleTime = travelTime / config.seconds;
    // +/- 7% shared speed variation, without changing relative entry spacing.
    const progress = cycleTime + .07 / (Math.PI*2) * Math.sin(cycleTime*Math.PI*2);
    const min = [-view.originX/view.scale, -view.originY/view.scale];
    const max = [(view.width-view.originX)/view.scale, (view.height-view.originY)/view.scale];
    const active = [], keep = new Set();

    definitions.forEach(({ frame, center, bounds }, slot) => {
      let first = -Infinity, last = Infinity;
      for (let axis=0; axis<2; axis++) {
        const position = center[axis] + config.step[axis]*progress;
        const a = (position - max[axis] - bounds[axis]) / config.step[axis];
        const b = (position - min[axis] + bounds[axis]) / config.step[axis];
        first = Math.max(first, Math.ceil(Math.min(a,b)));
        last = Math.min(last, Math.floor(Math.max(a,b)));
      }
      for (let cycle=first; cycle<=last; cycle++) {
        const contentIndex = cycle*definitions.length + slot;
        const id = `${scene}:${contentIndex}`;
        let item = instances.get(id);
        if (!item) {
          // Textures/frame styles are reusable; entries and their content are not.
          // Future article/video data is assigned in reading order, independently
          // of the repeated frame style. Never modulo the content index.
          // Keep the opening composition; later appearances lean 2–6 degrees
          // either way. Each style alternates sides, with a random amplitude
          // and starting side, so consecutive passes don't look identical.
          const side = (cycle + (randomFor(slot,seed) < .5 ? 0 : 1)) % 2 === 0 ? -1 : 1;
          const rotationOffset = cycle === 0 && frame.initial !== false ? 0
            : side*(2+4*randomFor(contentIndex,seed^0x68bc21eb))*Math.PI/180;
          item = { ...frame, id, frameId: frame.id, cycle, contentIndex, rotationOffset,
            content: contentItems[contentIndex] ?? null, hover: 0,
            phase: slot*1.73 + cycle*.47, center: [0,0], pose: null };
          instances.set(id,item);
        }
        const ramp = Math.min(elapsed/1.2,1);
        const frequency = frame.material === 'flower' ? .85 : .55;
        const sway = Math.sin(elapsed*frequency+item.phase)-Math.sin(item.phase);
        // Local motion is bounded; it can never accumulate into a spacing drift.
        item.center[0] = center[0] + config.step[0]*(progress-cycle) + sway*2*ramp;
        item.center[1] = center[1] + config.step[1]*(progress-cycle);
        item.rotation = item.rotationOffset + sway*(frame.material === 'flower' ? .018 : .009)*ramp;
        item.age = elapsed;
        keep.add(id); active.push(item);
      }
    });
    for (const id of instances.keys()) if (!keep.has(id)) instances.delete(id);
    return active.sort((a,b)=>(a.order??24)-(b.order??24) || a.contentIndex-b.contentIndex);
  }

  return { update, scroll: scroll.input, resetScroll: scroll.reset };
}
