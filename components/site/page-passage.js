import { createFireCurtain } from './fire-curtain.js?v=11';
import { FIRE_EDGE, portraitClip, portraitShare } from './transition-front.js?v=2';
import { createTransitionMotion } from './transition-motion.js?v=5';
import { mountAbout } from '../about/mount.js?v=2';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

// Live content replaces live content behind Portfolio's existing fire seam.
export function createAboutPassage({ link, prepareDestination, onOwnershipChange, canNavigate = () => true }) {
  const html = document.documentElement;
  const hostTitle = document.title;
  const layer = document.createElement('section');
  layer.className = 'page-passage__about';
  layer.setAttribute('aria-label', 'About Elyxee');
  layer.setAttribute('aria-hidden', 'true');
  layer.tabIndex = -1;
  layer.inert = true;
  document.body.append(layer);
  const controller = new AbortController(), { signal } = controller;
  let phase = 'closed', page, loading, fire, animation = 0, destroyed = false;
  let lastWheel = -Infinity, atTopGesture = false, tailUntil = 0, tailDirection = 0;
  let finger = null, cancelAnimation, gesture = null;
  const travel = 620;

  function setPhase(value) {
    phase = value;
    if (phase === 'closed') delete html.dataset.pagePassage;
    else html.dataset.pagePassage = phase;
  }
  function route(view, replace = false) {
    const url = new URL(location.href);
    if (view === 'home') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({ view }, '', url);
  }
  function prepare() {
    if (!loading) loading = (async () => {
      page = mountAbout({ root: layer, scrollRoot: layer, onNavigate({ event }) {
        if (!plainClick(event)) return;
        leave('home');
        return false;
      } });
      page.setActive(false);
      // Two separate tasks: each creates a WebGL context, which blocks.
      await new Promise(resolve => setTimeout(resolve));
      if (destroyed) return;
      try { fire = createFireCurtain({ opening: false }); fire.element.id = 'page-passage-fire'; } catch { /* Live-layer fade fallback. */ }
      await Promise.allSettled([
        document.fonts.ready,
        ...[...layer.querySelectorAll('.about-hero__photo img, .about-scene__texture')].map(image => image.decode()),
        fire?.ready,
      ]);
    })();
    return loading;
  }

  function draw(position, seconds, mode) {
    const edge = FIRE_EDGE.hidden + (FIRE_EDGE.full - FIRE_EDGE.hidden) * position;
    if (!fire?.supported || reduced()) {
      layer.style.clipPath = '';
      layer.style.opacity = position;
    } else {
      layer.style.opacity = '1';
      layer.style.clipPath = portraitClip(edge, seconds);
      fire.set({ edge, mode, life: 1 });
      fire.render(seconds);
    }
  }

  function finishAbout(historyChange) {
    layer.style.clipPath = '';
    layer.style.opacity = '';
    layer.inert = false;
    layer.setAttribute('aria-hidden', 'false');
    setPhase('about');
    document.title = 'About — Elyxee';
    lastWheel = -Infinity;
    layer.focus({ preventScroll: true });
    if (historyChange) route('about');
  }

  function finishHost(destination, historyChange) {
    layer.classList.remove('is-shown');
    layer.style.clipPath = '';
    layer.style.opacity = '';
    layer.inert = true;
    layer.setAttribute('aria-hidden', 'true');
    page?.setActive(false);
    setPhase('closed');
    onOwnershipChange(false);
    document.title = hostTitle;
    if (historyChange) route(destination);
  }

  // Wheel and touch use the very same spring, flick continuation, reversal and
  // visible-area settling as Home ↔ Portfolio. Clicks retain their own timeline.
  function beginGesture(from) {
    if (destroyed || gesture || (from === 0 ? phase !== 'closed' : phase !== 'about')) return;
    const motion = createTransitionMotion({ travel });
    motion.goTo(from);
    motion.update(performance.now(), 0, true);
    const current = gesture = { motion, from, position: from, seconds: 0,
      mode: from, modeTarget: from, lastAt: 0, lastDirection: 0, touch: null };
    setPhase('preparing');
    layer.inert = true;
    onOwnershipChange(true);
    (async () => {
      if (from === 0) {
        await prepare();
        if (destroyed || gesture !== current) return;
        layer.scrollTop = 0;
        page.setActive(true);
        draw(0, 0, 0);
        layer.classList.add('is-shown');
      } else {
        // Keep About fully painted while its destination is prepared below it.
        await prepareDestination('portfolio');
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
        if (endpoint && current.position === motion.input && !current.touch) {
          gesture = null;
          animation = 0;
          tailDirection = current.lastDirection;
          tailUntil = now + 220;
          const changed = current.position !== from;
          if (current.position === 1) finishAbout(changed);
          else finishHost('portfolio', changed);
        } else animation = requestAnimationFrame(frame);
      }
      animation = requestAnimationFrame(frame);
    })().catch(error => {
      if (destroyed || gesture !== current) return;
      console.error('About gesture:', error);
      gesture = null;
      draw(from, 0, from);
      if (from) finishAbout(false); else finishHost('portfolio', false);
    });
  }

  function scrollGesture(pixels, now) {
    if (!gesture) return;
    gesture.lastDirection = Math.sign(pixels);
    gesture.motion.scroll(pixels, now);
  }

  function dragGesture(y, now) {
    if (!gesture?.touch) return;
    const before = gesture.motion.input;
    gesture.motion.drag(gesture.touch.position + (gesture.touch.y - y) / (travel * .9), now);
    const direction = Math.sign(gesture.motion.input - before);
    if (direction) gesture.lastDirection = direction;
  }

  function animate(entering, instant) {
    const duration = instant ? 0 : reduced() ? 260 : 3200;
    const start = performance.now();
    return new Promise(resolve => {
      cancelAnimation = resolve;
      function frame(now) {
        const t = duration ? Math.min(1, (now - start) / duration) : 1;
        const progress = t * t * (3 - 2 * t), seconds = (now - start) / 1000;
        if (!fire?.supported || reduced()) {
          layer.style.clipPath = '';
          layer.style.opacity = entering ? progress : 1 - progress;
        } else {
          // Returning follows the existing Portrait → Home passage backwards:
          // the same lower sheet recedes, instead of a second upward wipe.
          const position = entering ? progress : 1 - progress;
          const edge = FIRE_EDGE.hidden + (FIRE_EDGE.full - FIRE_EDGE.hidden) * position;
          layer.style.clipPath = portraitClip(edge, seconds);
          fire.set({ edge, mode: entering ? 0 : 1, life: 1 });
          fire.render(seconds);
        }
        if (t < 1 && !destroyed) animation = requestAnimationFrame(frame);
        else {
          fire?.set({ edge: entering ? FIRE_EDGE.full : FIRE_EDGE.hidden, opening: 0 });
          fire?.render(seconds);
          animation = 0; cancelAnimation = null; resolve();
        }
      }
      animation = requestAnimationFrame(frame);
    });
  }

  async function open({ instant = false, historyChange = true } = {}) {
    if (phase !== 'closed' || destroyed || !canNavigate()) return;
    setPhase('preparing');
    onOwnershipChange(true);
    try {
      await prepare();
      if (destroyed) return;
      layer.scrollTop = 0;
      page.setActive(true);
      layer.style.clipPath = portraitClip(FIRE_EDGE.hidden, 0);
      layer.style.opacity = '1';
      layer.classList.add('is-shown');
      await nextPaint();
      setPhase('entering');
      await animate(true, instant);
      if (destroyed) return;
      finishAbout(historyChange);
    } catch (error) {
      console.error('About passage:', error);
      layer.classList.remove('is-shown');
      page?.setActive(false);
      setPhase('closed');
      onOwnershipChange(false);
    }
  }

  async function leave(destination = 'portfolio', { historyChange = true } = {}) {
    if (phase !== 'about' || destroyed) return;
    setPhase('leaving');
    layer.inert = true;
    try {
      // About stays opaque until the destination is fully ready underneath.
      await prepareDestination(destination);
      await nextPaint();
      await animate(false);
      if (destroyed) return;
      finishHost(destination, historyChange);
      tailUntil = performance.now() + 300;
      tailDirection = 0;
    } catch (error) {
      console.error('About return:', error);
      layer.inert = false;
      layer.style.clipPath = '';
      layer.style.opacity = '';
      setPhase('about');
    }
  }

  link?.addEventListener('pointerenter', () => { prepare().catch(() => {}); }, { signal });
  link?.addEventListener('focus', () => { prepare().catch(() => {}); }, { signal });
  link?.addEventListener('click', event => {
    if (!plainClick(event)) return;
    event.preventDefault(); open();
  }, { signal });

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
    if (phase !== 'about') { event.preventDefault(); return; }
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

  window.addEventListener('touchstart', event => {
    if (gesture && event.touches.length === 1) {
      gesture.touch = { y: event.touches[0].clientY, position: gesture.motion.hold() };
      return;
    }
    finger = phase === 'about' && layer.contains(event.target) && layer.scrollTop <= 1 && event.touches.length === 1
      ? event.touches[0].clientY : null;
  }, { signal, capture: true, passive: true });
  window.addEventListener('touchmove', event => {
    if (event.touches.length !== 1) return;
    if (gesture?.touch) {
      event.preventDefault(); event.stopImmediatePropagation();
      dragGesture(event.touches[0].clientY, performance.now());
      return;
    }
    if (finger === null || phase !== 'about' || layer.scrollTop > 1) return;
    const pull = event.touches[0].clientY - finger;
    if (pull <= 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    beginGesture(1);
    gesture.touch = { y: finger, position: gesture.motion.hold() };
    finger = null;
    dragGesture(event.touches[0].clientY, performance.now());
  }, { signal, capture: true, passive: false });
  for (const type of ['touchend', 'touchcancel']) window.addEventListener(type, () => {
    finger = null;
    if (gesture?.touch) { gesture.touch = null; gesture.motion.release(performance.now()); }
  }, { signal, capture: true, passive: true });
  layer.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, [contenteditable]') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (phase === 'about' && layer.scrollTop <= 1 && ['ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault(); leave('portfolio');
    }
  }, { signal });

  window.addEventListener('popstate', async () => {
    if (!canNavigate()) return;
    const view = new URL(location.href).searchParams.get('view');
    if (view === 'about') open({ historyChange: false });
    else if (phase === 'about') leave(view === 'portfolio' ? 'portfolio' : 'home', { historyChange: false });
    else if (phase === 'closed') await prepareDestination(view === 'portfolio' ? 'portfolio' : 'home');
  }, { signal });

  return {
    get active() { return phase !== 'closed'; },
    get settled() { return phase === 'about'; },
    preload() { prepare().catch(() => {}); },
    open,
    scrollFromPortrait(pixels, now) {
      if (phase === 'closed') beginGesture(0);
      scrollGesture(pixels, now);
    },
    dragFromPortrait(startY, y, now) {
      if (phase === 'closed') beginGesture(0);
      if (!gesture) return;
      gesture.touch = { y: startY, position: gesture.motion.hold() };
      dragGesture(y, now);
    },
    syncHomeRoute() {
      if (phase === 'closed' && new URL(location.href).searchParams.get('view') === 'portfolio') route('home', true);
    },
    destroy() {
      destroyed = true; gesture = null; controller.abort(); cancelAnimationFrame(animation); cancelAnimation?.();
      page?.destroy(); fire?.destroy(); layer.remove(); delete html.dataset.pagePassage;
    },
  };
}
