import { FIRE_EDGE, portraitClip, portraitShare } from './transition-front.js';
import { createTransitionMotion } from './transition-motion.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// A page view opens over the stage behind the shared fire seam: live content
// replaces live content. Clicks play a fixed, symmetric timeline; the wheel
// uses the same spring, flick continuation, reversal and visible-area settling
// as Home ↔ Portfolio. Touch never changes view: on touch screens pages are
// reached and left by tapping links. While it runs this passage owns the
// input, including the wheel exit at the top of the page.
//
// It does not touch the address bar, the title or the stage layers: it tells
// the coordinator through `onChange()` (any phase change) and
// `onSettle(viewId, record)` (arrived on the page, or back on the stage), and
// asks for a stage view to be put underneath with `showUnder(viewId)`.
export function createPagePassage({ view, scene, above, curtain, showUnder, canNavigate = () => true,
  onChange = () => {}, onSettle = () => {} }) {
  const html = document.documentElement;
  const layer = scene.layer;
  const controller = new AbortController(), { signal } = controller;
  let phase = 'closed', animation = 0, destroyed = false;
  let lastWheel = -Infinity, atTopGesture = false, tailUntil = 0, tailDirection = 0;
  let cancelAnimation, gesture = null;
  const travel = 620;

  function setPhase(value) {
    phase = value;
    if (phase === 'closed') delete html.dataset.pagePassage;
    else html.dataset.pagePassage = phase;
    onChange();
  }

  function render(edge, mode, seconds) {
    curtain.set({ edge, mode, life: 1, dim: 0, opening: 0 });
    curtain.render(seconds);
  }

  function draw(position, seconds, mode) {
    const edge = FIRE_EDGE.hidden + (FIRE_EDGE.full - FIRE_EDGE.hidden) * position;
    if (!curtain.supported || reduced()) {
      layer.style.clipPath = '';
      layer.style.opacity = position;
    } else {
      layer.style.opacity = '1';
      layer.style.clipPath = portraitClip(edge, seconds);
      render(edge, mode, seconds);
    }
  }

  function finishPage(record) {
    layer.style.clipPath = '';
    layer.style.opacity = '';
    setPhase('settled');
    lastWheel = -Infinity;
    layer.focus({ preventScroll: true });
    onSettle(view.id, record);
  }

  function finishHost(destination, record) {
    layer.classList.remove('is-shown');
    layer.style.clipPath = '';
    layer.style.opacity = '';
    scene.setVisible(false);
    setPhase('closed');
    onSettle(destination, record);
  }

  function beginGesture(from) {
    if (destroyed || gesture || (from === 0 ? phase !== 'closed' : phase !== 'settled')) return;
    const motion = createTransitionMotion({ travel });
    motion.goTo(from);
    motion.update(performance.now(), 0, true);
    const current = gesture = { motion, from, position: from, seconds: 0,
      mode: from, modeTarget: from, lastAt: 0, lastDirection: 0 };
    setPhase('preparing');
    (async () => {
      if (from === 0) {
        await scene.load();
        if (destroyed || gesture !== current) return;
        layer.scrollTop = 0;
        scene.setVisible(true);
        draw(0, 0, 0);
        layer.classList.add('is-shown');
      } else {
        // Keep the page fully painted while its destination is prepared below it.
        await showUnder(above);
      }
      await nextPaint();
      if (destroyed || gesture !== current) return;
      setPhase(from === 0 ? 'entering' : 'leaving');
      current.lastAt = performance.now();
      function frame(now) {
        if (destroyed || gesture !== current) return;
        const dt = Math.max(0, (now - current.lastAt) / 1000);
        current.lastAt = now;
        current.seconds += Math.min(dt, .05);
        const before = current.position;
        current.position = motion.update(now, dt, reduced(), portraitShare(before, current.seconds));
        if (Math.abs(current.position - before) > .00001) current.modeTarget = current.position < before ? 1 : 0;
        current.mode += (current.modeTarget - current.mode) * (1 - Math.exp(-dt * 6));
        draw(current.position, current.seconds, current.mode);
        const endpoint = current.position === 0 || current.position === 1;
        if (endpoint && current.position === motion.input) {
          gesture = null;
          animation = 0;
          tailDirection = current.lastDirection;
          tailUntil = now + 220;
          const changed = current.position !== from;
          if (current.position === 1) finishPage(changed);
          else finishHost(above, changed);
        } else animation = requestAnimationFrame(frame);
      }
      animation = requestAnimationFrame(frame);
    })().catch(error => {
      if (destroyed || gesture !== current) return;
      console.error(`${view.id} gesture:`, error);
      gesture = null;
      draw(from, 0, from);
      if (from) finishPage(false); else finishHost(above, false);
    });
  }

  function scrollGesture(pixels, now) {
    if (!gesture) return;
    gesture.lastDirection = Math.sign(pixels);
    gesture.motion.scroll(pixels, now);
  }

  function animate(entering, instant) {
    const duration = instant ? 0 : reduced() ? 260 : 3200;
    const start = performance.now();
    return new Promise(resolve => {
      cancelAnimation = resolve;
      function frame(now) {
        const t = duration ? Math.min(1, (now - start) / duration) : 1;
        const progress = t * t * (3 - 2 * t), seconds = (now - start) / 1000;
        if (!curtain.supported || reduced()) {
          layer.style.clipPath = '';
          layer.style.opacity = entering ? progress : 1 - progress;
        } else {
          // Returning follows the existing Portrait → Home passage backwards:
          // the same lower sheet recedes, instead of a second upward wipe.
          const position = entering ? progress : 1 - progress;
          const edge = FIRE_EDGE.hidden + (FIRE_EDGE.full - FIRE_EDGE.hidden) * position;
          layer.style.clipPath = portraitClip(edge, seconds);
          render(edge, entering ? 0 : 1, seconds);
        }
        if (t < 1 && !destroyed) animation = requestAnimationFrame(frame);
        else {
          if (curtain.supported) render(entering ? FIRE_EDGE.full : FIRE_EDGE.hidden, entering ? 0 : 1, seconds);
          animation = 0; cancelAnimation = null; resolve();
        }
      }
      animation = requestAnimationFrame(frame);
    });
  }

  async function open({ instant = false, record = true } = {}) {
    if (phase !== 'closed' || destroyed || !canNavigate()) return;
    setPhase('preparing');
    try {
      await scene.load();
      if (destroyed) return;
      layer.scrollTop = 0;
      scene.setVisible(true);
      layer.style.clipPath = portraitClip(FIRE_EDGE.hidden, 0);
      layer.style.opacity = '1';
      layer.classList.add('is-shown');
      await nextPaint();
      setPhase('entering');
      await animate(true, instant);
      if (destroyed) return;
      finishPage(record);
    } catch (error) {
      console.error(`${view.id} passage:`, error);
      layer.classList.remove('is-shown');
      scene.setVisible(false);
      setPhase('closed');
    }
  }

  async function leave(destination = above, { record = true } = {}) {
    if (phase !== 'settled' || destroyed) return;
    setPhase('leaving');
    try {
      // The page stays opaque until the destination is fully ready underneath.
      await showUnder(destination);
      await nextPaint();
      await animate(false);
      if (destroyed) return;
      finishHost(destination, record);
      tailUntil = performance.now() + 300;
      tailDirection = 0;
    } catch (error) {
      console.error(`${view.id} return:`, error);
      layer.style.clipPath = '';
      layer.style.opacity = '';
      setPhase('settled');
    }
  }

  window.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || !event.deltaY) return;
    const now = performance.now();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? layer.clientHeight : 1;
    const pixels = Math.max(-160, Math.min(160, event.deltaY * unit));
    if (gesture) {
      event.preventDefault(); event.stopImmediatePropagation();
      scrollGesture(pixels, now);
      return;
    }
    if (now < tailUntil && (!tailDirection || Math.sign(pixels) === tailDirection)) {
      event.preventDefault(); event.stopImmediatePropagation(); tailUntil = now + 220;
      return;
    }
    if (phase === 'closed') return;
    if (phase !== 'settled') { event.preventDefault(); return; }
    if (now - lastWheel > 220) atTopGesture = layer.scrollTop <= 1;
    lastWheel = now;
    if (layer.scrollTop > 1 || pixels > 0) return;
    event.preventDefault();
    if (atTopGesture) {
      event.stopImmediatePropagation();
      beginGesture(1);
      scrollGesture(pixels, now);
    }
  }, { signal, capture: true, passive: false });

  layer.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (phase === 'settled' && layer.scrollTop <= 1 && ['ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault(); leave(above);
    }
  }, { signal });

  return {
    view,
    get active() { return phase !== 'closed'; },
    get settled() { return phase === 'settled'; },
    preload() { scene.load().catch(() => {}); },
    open,
    leave,
    /** Wheel past the end of the stage: begins (or continues) the gesture in. */
    scrollFrom(pixels, now) {
      if (phase === 'closed') beginGesture(0);
      scrollGesture(pixels, now);
    },
    destroy() {
      destroyed = true; gesture = null; controller.abort(); cancelAnimationFrame(animation); cancelAnimation?.();
      scene.destroy(); delete html.dataset.pagePassage;
    },
  };
}
