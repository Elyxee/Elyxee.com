// The Home ↔ Portfolio passage. One progress value (0 = Home, 1 = Portfolio)
// drives the rising fire seam, the portrait's clip and arrival, and the
// optical pull-back of both layers. Input moves the progress through one
// shared spring (transition-motion.js); the coordinator decides when, and who
// owns input. During the opening the coordinator sets the progress directly.

import { createTransitionMotion } from './transition-motion.js';
import { edgeHeightAt, FIRE_EDGE, portraitClip, portraitShare, seamRange } from './transition-front.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => ease(clamp((x - a) / (b - a), 0, 1));

export const STAGE = Object.freeze({
  // Slow scrubbing spans this distance; a purposeful flick carries onward.
  travel: 620,
  // Pull-back of the scene being left, and the arrival dolly of the next.
  // The pull-back leads: it is mostly done before the fire climbs into view.
  burnPullBack: 0.075,
  portraitPullBack: 0.05,
  pullBackSpan: 0.65,
});

export function createStagePassage({ burnLayer, portraitLayer, portraitRoot, curtain, depth, handoff, reduced }) {
  const html = document.documentElement;
  const motion = createTransitionMotion({ travel: STAGE.travel });
  let p = 0;          // where the input has put us
  let pv = 0.5;       // what is drawn; starts on the full blaze
  let time = 0;
  let mode = 0, modeTarget = 0, lastEdge = FIRE_EDGE.full;
  let insideFire = false;

  function visuals(progress) {
    const burnScale = 1 - STAGE.burnPullBack * ease(clamp(progress / STAGE.pullBackSpan, 0, 1));
    const portraitScale = 1 - STAGE.portraitPullBack * ease(clamp((1 - progress) / STAGE.pullBackSpan, 0, 1));
    // One ascending passage: the portrait is revealed in the fire's wake.
    const edge = lerp(FIRE_EDGE.hidden, FIRE_EDGE.full, progress);
    const dim = 0.025 * Math.pow(Math.sin(progress * Math.PI), 2);
    return { burnScale, portraitScale, edge, dim };
  }

  return {
    get position() { return pv; },
    get input() { return p; },

    tick(dt) { time += dt; },
    setPosition(value) { pv = value; },
    update(now, elapsed) {
      pv = motion.update(now, elapsed, reduced.matches, portraitShare(pv, time));
      p = motion.input;
    },
    /** Lands on a position at once, without a passage. */
    jump(position) {
      motion.goTo(position);
      pv = motion.update(performance.now(), 0, true);
      p = motion.input;
    },
    goTo(position, options) { motion.goTo(position, options); p = motion.input; },
    scroll(pixels, now) { motion.scroll(pixels, now); p = motion.input; },
    ownsTail: (pixels, now) => motion.ownsTail(pixels, now),

    /**
     * Draws one frame. `intro` is the opening state while it runs; a busy
     * curtain is being drawn by a page passage and is left alone; `cold`
     * picks the colour of the cursor grains that cross the seam.
     */
    render(dt, { intro = null, curtainBusy = false, cold = false } = {}) {
      const v = visuals(pv);
      if (!intro) {
        portraitLayer.classList.toggle('is-shown', pv > 0);
        burnLayer.classList.toggle('is-hidden', pv >= 1);
        portraitLayer.style.clipPath = pv > 0 && pv < 1 ? portraitClip(v.edge, time) : '';
        // The incoming scene rises gently into place with enough overscan to keep
        // its edges full-bleed. Its own layout and pointer coordinates resume at 1.
        const arrival = reduced.matches ? 0 : 1 - ease(pv);
        portraitRoot.style.transform = pv > 0 && pv < 1
          ? `translateY(${(arrival*3).toFixed(3)}vh) scale(${(1+arrival*.06).toFixed(5)})` : '';
        html.style.setProperty('--burn-pointer-opacity', 1-smoothstep(.12,.46,pv));
      }

      // The seam bounds what can be seen of each scene, and so its lens.
      depth.set(intro || reduced.matches ? 0 : 1 - v.burnScale,
        intro || reduced.matches ? 0 : 1 - v.portraitScale,
        !intro && pv > 0 && pv < 1 ? seamRange(v.edge, time) : null);

      // Climbing fire leads with flames; sinking fire leads with soot and ash.
      const edgeVelocity = dt > 0 ? (v.edge - lastEdge) / dt : 0;
      lastEdge = v.edge;
      if (Math.abs(edgeVelocity) > 0.03) modeTarget = edgeVelocity < 0 ? 1 : 0;
      mode += (modeTarget - mode) * (1 - Math.exp(-dt * 6));
      if (!curtainBusy) {
        curtain.set({ edge: v.edge, mode, dim: v.dim, life: intro ? intro.life : 1,
          opening: intro ? 1 : 0, reveal: intro ? intro.t : 1 });
        curtain.render(time);
      }
      // First fire frame is up; the burn scene may now sit beneath it.
      if (intro && intro.phase === 'hold' && burnLayer.classList.contains('is-hidden') && curtain.visible) {
        burnLayer.classList.remove('is-hidden');
      }

      // Cursor handoff: a few grains leave the real pointer as the smoke passes.
      if (handoff.pointer.seen && !intro) {
        const x = clamp(handoff.pointer.x / Math.max(window.innerWidth, 1), 0, 1);
        const yUp = 1 - clamp(handoff.pointer.y / Math.max(window.innerHeight, 1), 0, 1);
        const edgeHere = edgeHeightAt(x, v.edge, curtain.state.bias, time);
        const nowInside = insideFire ? edgeHere > yUp - 0.03 : edgeHere > yUp + 0.03;
        if (nowInside !== insideFire) {
          insideFire = nowInside;
          if (curtain.visible && !curtainBusy) handoff.burst({ cold });
        }
      } else if (intro) {
        insideFire = true;
      }
      handoff.update(dt);
      handoff.render();
    },
  };
}
