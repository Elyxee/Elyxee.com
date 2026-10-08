// Site orchestration: opening fire, the scroll-driven passage between the burn
// scene and the Dust & Space portrait, and the cursor handoff between them.
//
// Both scenes are mounted exactly as their own pages mount them. This file
// never reaches into either simulation; it stacks the two as layers, drives a
// single stage progress value (0 = burn, 1 = portrait) from scroll input, and
// reveals the arriving layer behind one continuous, rising fire front.

import { createAboutPassage } from "./page-passage.js?v=5";
import { initBurn } from "../burn/index.js?v=84";
import { initCursor } from "../cursor/index.js?v=42";
import { initBurnTypography } from "../burn/type/typography.js?v=80";
import { initBurnSocials } from "../burn/socials.js?v=83";
import { mountPortrait } from "../portrait/mount.js?v=8";
import { createFireCurtain, edgeHeightAt, FIRE_EDGE } from "./fire-curtain.js?v=10";
import { waitForOpening } from "./opening-ready.js";
import { createCursorHandoff } from "./cursor-handoff.js?v=4";
import { createDepthLens } from "./depth-lens.js?v=3";
import { createTransitionMotion } from "./transition-motion.js?v=4";
import { portraitClip, portraitShare } from "./transition-front.js?v=2";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smoothstep = (a, b, x) => ease(clamp((x - a) / (b - a), 0, 1));

const STAGE = Object.freeze({
  // Slow scrubbing spans this distance; a purposeful flick carries onward.
  travel: 620,
  // Pull-back of the scene being left, and the arrival dolly of the next.
  // The pull-back leads: it is mostly done before the fire climbs into view.
  burnPullBack: 0.075,
  portraitPullBack: 0.05,
  pullBackSpan: 0.65,
  // Opening: apparition, minimum hold, then the source-aligned landscape reveal.
  igniteSeconds: 0.7,
  minIntroMs: 1500,
  recedeSeconds: 2.4,
});

const html = document.documentElement;
const burnLayer = document.querySelector(".stage--burn");
const portraitLayer = document.querySelector(".stage--portrait");
const portraitRoot = portraitLayer.querySelector(".portrait");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
// A fresh load always completes the opening on Home. In-document history can
// still revisit scenes; a previous preview/scene URL must not skip the opening.
const entryUrl = new URL(location.href);
if (entryUrl.searchParams.has('view')) {
  entryUrl.searchParams.delete('view');
  history.replaceState({ view: 'home' }, '', entryUrl);
}
let aboutPassage;

// --- pointer gate ----------------------------------------------------------
// Registered before any module so it runs first on document. While the
// portrait layer is on screen the burn scene's pointer listeners (burn, flame
// cursor, inscription) are held back: the sheet must not keep burning under a
// page nobody can see, and it must come back exactly as it was left.
const handoff = createCursorHandoff();
let portraitShown = false;
let pointerType = "mouse";
document.addEventListener("pointermove", event => {
  if (event.pointerType !== "touch") {
    handoff.setPointer(event.clientX, event.clientY);
    pointerType = event.pointerType;
  }
  // A slow opening must not accumulate invisible burns before Home is ready.
  if (html.dataset.stage === 'intro' || portraitShown || aboutPassage?.active) event.stopImmediatePropagation();
});

// --- fire curtain and opening ----------------------------------------------
const curtain = createFireCurtain();
curtain.set({ opening: 1, reveal: 0, life: 0 });
const depth = createDepthLens(burnLayer, portraitLayer);
html.dataset.stage = "intro";

// --- burn scene, exactly as index.html mounted it --------------------------
initBurnSocials();
const burn = initBurn();
// Material layout remains in viewport coordinates. The full-screen material
// wrapper receives the same optical displacement as the scene, exactly once.
function burnLayoutRect(element) {
  const stageRect = burnLayer.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const sx = stageRect.width / burnLayer.offsetWidth || 1;
  const sy = stageRect.height / burnLayer.offsetHeight || 1;
  return new DOMRect((rect.left - stageRect.left) / sx, (rect.top - stageRect.top) / sy,
    rect.width / sx, rect.height / sy);
}
const inscriptions = [
  initBurnTypography({ settings: burn.settings, measureRect: burnLayoutRect }),
  initBurnTypography({ settings: burn.settings, selector: ".burn-nav", tinted: true, measureRect: burnLayoutRect }),
  initBurnTypography({ settings: burn.settings, selector: ".burn-socials", artwork: true, measureRect: burnLayoutRect }),
];
Promise.allSettled(inscriptions).then(() => depth.mountInscriptions());
initCursor();

const everythingReady = waitForOpening({
  scene: burn.ready,
  curtain: curtain.ready,
  decorations: inscriptions,
  fonts: document.fonts.ready,
  minimumMs: STAGE.minIntroMs,
});

// --- stage state -------------------------------------------------------------
let p = 0;          // where the input has put us
let pv = 0.5;       // what is drawn; starts on the full blaze
const motion = createTransitionMotion({ travel: STAGE.travel });
let inputEnabled = false;
let loadingWheelUntil = 0;
let intro = { phase: "hold", t: 0, life: 0 };
let mode = 0, modeTarget = 0, lastEdge = FIRE_EDGE.full;
let insideFire = false;
let burnPaused = false;
let portrait = null;
let portraitView = null;
let touch = null;   // active touch pull, see input below
let time = 0;
let previousFrameAt = performance.now();

function visuals(progress) {
  const burnScale = 1 - STAGE.burnPullBack * ease(clamp(progress / STAGE.pullBackSpan, 0, 1));
  const portraitScale = 1 - STAGE.portraitPullBack * ease(clamp((1 - progress) / STAGE.pullBackSpan, 0, 1));
  // One ascending passage: the portrait is revealed in the fire's wake.
  const edge = lerp(FIRE_EDGE.hidden, FIRE_EDGE.full, progress);
  const dim = 0.025 * Math.pow(Math.sin(progress * Math.PI), 2);
  return { burnScale, portraitScale, edge, dim };
}

function syntheticPointer(type) {
  if (!handoff.pointer.seen) return;
  const init = {
    bubbles: type !== "pointerleave",
    clientX: handoff.pointer.x,
    clientY: handoff.pointer.y,
    pointerType,
    isPrimary: true,
  };
  try {
    portraitRoot.dispatchEvent(new PointerEvent(type, init));
  } catch {
    // PointerEvent construction can fail on very old engines; the portrait
    // then simply waits for the next real movement.
  }
}

function swapLayers(toPortrait) {
  portraitShown = toPortrait;
  portraitLayer.inert = !toPortrait;
  portraitLayer.setAttribute("aria-hidden", String(!toPortrait));
  burnLayer.inert = toPortrait;
  burnLayer.setAttribute("aria-hidden", String(toPortrait));
  if (toPortrait) {
    aboutPassage?.preload();
    // Input changes owner while both pages can still be visible.
    burn.setPointerActive?.(false);
    // The portrait's own presence starts from the pointer's current place.
    syntheticPointer("pointermove");
  } else {
    syntheticPointer("pointerleave");
  }
}

function apply(dt) {
  const v = visuals(pv);
  const wantPortrait = !intro && pv >= 0.5;
  if (wantPortrait !== portraitShown) swapLayers(wantPortrait);

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
    const shouldPause = pv >= 1 || aboutPassage?.settled;
    if (shouldPause !== burnPaused) {
      burnPaused = shouldPause;
      if (shouldPause) burn.pause?.(); else burn.resume?.();
    }
  }

  depth.set(intro || reduced.matches ? 0 : 1 - v.burnScale,
    intro || reduced.matches ? 0 : 1 - v.portraitScale);

  // Climbing fire leads with flames; sinking fire leads with soot and ash.
  const edgeVelocity = dt > 0 ? (v.edge - lastEdge) / dt : 0;
  lastEdge = v.edge;
  if (Math.abs(edgeVelocity) > 0.03) modeTarget = edgeVelocity < 0 ? 1 : 0;
  mode += (modeTarget - mode) * (1 - Math.exp(-dt * 6));
  curtain.set({ edge: v.edge, mode, dim: v.dim, life: intro ? intro.life : 1,
    opening: intro ? 1 : 0, reveal: intro ? intro.t : 1 });
  curtain.render(time);
  // First fire frame is up; the burn scene may now sit beneath it.
  if (intro && intro.phase === "hold" && burnLayer.classList.contains("is-hidden") && curtain.visible) {
    burnLayer.classList.remove("is-hidden");
  }

  const stage = aboutPassage?.settled ? "about" : intro ? "intro" : pv <= 0.02 ? "burn" : pv >= 0.98 ? "portrait" : "transit";
  if (html.dataset.stage !== stage) html.dataset.stage = stage;
  if (!intro && pv === 0 && !aboutPassage?.active) aboutPassage?.syncHomeRoute();

  // Cursor handoff: a few grains leave the real pointer as the smoke passes.
  if (handoff.pointer.seen && !intro) {
    const x = clamp(handoff.pointer.x / Math.max(window.innerWidth, 1), 0, 1);
    const yUp = 1 - clamp(handoff.pointer.y / Math.max(window.innerHeight, 1), 0, 1);
    const edgeHere = edgeHeightAt(x, v.edge, curtain.state.bias, time);
    const nowInside = insideFire ? edgeHere > yUp - 0.03 : edgeHere > yUp + 0.03;
    if (nowInside !== insideFire) {
      insideFire = nowInside;
      if (curtain.visible) handoff.burst({ cold: portraitShown && portraitRoot.dataset.scene === "space" });
    }
  } else if (intro) {
    insideFire = true;
  }
  handoff.update(dt);
  handoff.render();
}

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, (now - previousFrameAt) / 1000);
  const dt = Math.min(elapsed, 0.05);
  previousFrameAt = now;
  time += dt;

  if (intro) {
    intro.life = Math.min(1, intro.life + dt / STAGE.igniteSeconds);
    if (intro.phase === "recede") {
      const seconds = reduced.matches ? 0.8 : STAGE.recedeSeconds;
      intro.t = Math.min(1, intro.t + dt / seconds);
      pv = 0.5 * (1 - easeInOut(intro.t));
      if (intro.t >= 1) finishIntro();
    }
  } else if (!aboutPassage?.active) {
    pv = motion.update(now, elapsed, reduced.matches, portraitShare(pv,time));
    p = motion.input;
  }

  apply(dt);
}

function finishIntro() {
  intro = null;
  motion.goTo(0);
  pv = motion.update(performance.now(), 0, true);
  p = motion.input;
  inputEnabled = true;
  // The portrait mounts once the opening is over so its texture work never
  // competes with the receding fire.
  setTimeout(() => {
    ensurePortrait().catch(error => console.error("Portrait mount:", error));
  }, 350);
}

function ensurePortrait() {
  if (!portrait) portrait = mountPortrait({ root: portraitRoot, scene: 1,
    onHome: () => goTo(0, { omega: 2.7 }),
  }).then(mounted => {
    portraitView = mounted;
    return mounted;
  });
  return portrait;
}

async function prepareDestination(destination) {
  if (destination === 'portfolio') await ensurePortrait();
  const target = destination === 'portfolio' ? 1 : 0;
  motion.goTo(target);
  pv = motion.update(performance.now(), 0, true);
  p = motion.input;
  apply(0);
  // Both host layers stay noninteractive until the outgoing About seam clears.
  if (aboutPassage.active) { burnLayer.inert = true; portraitLayer.inert = true; }
}

aboutPassage = createAboutPassage({
  link: document.querySelector('.burn-nav a[href="#about"]'),
  prepareDestination,
  canNavigate: () => inputEnabled,
  onOwnershipChange(active) {
    touch = null;
    if (active) {
      burn.setPointerActive?.(false);
      syntheticPointer('pointerleave');
      burnLayer.inert = true; portraitLayer.inert = true;
    } else {
      swapLayers(pv >= .5);
    }
  },
});

everythingReady.then(() => {
  if (intro) intro.phase = "recede";
}).catch(error => {
  // A failed request is not a ready scene. Keep the opening covering Home and
  // offer recovery only on an actual load error, never on a slow connection.
  console.error('Opening assets:', error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'site-load-retry';
  retry.textContent = 'Loading interrupted · Retry';
  retry.addEventListener('click', () => location.reload());
  document.body.append(retry);
});

// --- input -------------------------------------------------------------------
function wheelDelta(event) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  return Number.isFinite(event.deltaY) ? clamp(event.deltaY * unit, -160, 160) : 0;
}

function nudge(pixels, now) {
  motion.scroll(pixels, now);
  p = motion.input;
}

function overGallery(event) {
  return portraitView?.effect?.isGalleryScrollRegion(event.clientX, event.clientY) ?? false;
}

// Keep one trackpad gesture with its initial owner, even as frames drift under
// the pointer. A fresh gesture rechecks the active scene's frame/track geometry.
let wheelOwner = null, lastWheelAt = -Infinity;
window.addEventListener("wheel", event => {
  if (aboutPassage.active) return;
  // Leave browser zoom and purely horizontal gestures alone.
  if (event.ctrlKey || event.metaKey) return;
  const dy = wheelDelta(event);
  if (!dy) return;
  const now = performance.now();
  // A scroll begun over the loading animation ends there, rather than carrying
  // straight past Home on the first ready frame.
  if (!inputEnabled || now < loadingWheelUntil) {
    event.preventDefault(); event.stopPropagation();
    loadingWheelUntil = now + 200;
    return;
  }
  if (motion.ownsTail(dy, now)) {
    event.preventDefault(); event.stopPropagation();
    nudge(dy, now); return;
  }
  if (p >= 1 && pv >= 0.98) {
    if (event.target.closest?.(".scene-switch, .portrait-home")) return;
    if (!wheelOwner || now - lastWheelAt > 200) {
      wheelOwner = overGallery(event) ? "gallery" : "stage";
    }
    lastWheelAt = now;
    // Both directions reach the existing gallery handler near its frames or
    // track. Empty space navigates up to Home or down to About.
    if (wheelOwner === "gallery") return;
    if (dy > 0) {
      event.preventDefault(); event.stopPropagation();
      aboutPassage.scrollFromPortrait(dy, now);
      return;
    }
  } else {
    wheelOwner = null;
  }
  if (p <= 0 && dy < 0) { event.preventDefault(); return; }
  event.preventDefault();
  event.stopPropagation();
  nudge(dy, now);
}, { capture: true, passive: false });

function goTo(destination, options) {
  if (!inputEnabled || aboutPassage.active || p === destination) return false;
  motion.goTo(destination, options);
  p = motion.input;
  return true;
}

// Navigation reuses the existing scene passage without reloading its state.
document.querySelector('.burn-nav')?.addEventListener('click', event => {
  const link = event.target.closest('[data-burn-destination]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  goTo(Number(link.dataset.burnDestination), { omega: 2.7 });
});

window.addEventListener("keydown", event => {
  if (aboutPassage.active) return;
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  let handled = false;
  switch (event.key) {
    case "ArrowDown": case "PageDown": case "End":
      handled = goTo(1); break;
    case "ArrowUp": case "PageUp": case "Home":
      handled = goTo(0); break;
    case " ":
      handled = goTo(event.shiftKey ? 0 : 1); break;
  }
  if (handled) event.preventDefault();
});

// Touch uses the same regions, with ownership fixed at the start of the swipe.
document.addEventListener("pointerdown", event => {
  if (aboutPassage.active) return;
  if (!inputEnabled || event.pointerType !== "touch" || !event.isPrimary) return;
  if (event.target.closest?.(".scene-switch, .portrait-home")) return;
  if (p >= 1 && pv >= 0.98 && overGallery(event)) return;
  p = motion.hold();
  touch = { id: event.pointerId, y: event.clientY, p0: p };
  event.stopPropagation();
}, { capture: true, passive: true });
document.addEventListener("pointermove", event => {
  if (!touch || event.pointerId !== touch.id) return;
  const pulled = touch.y - event.clientY; // finger up = positive
  event.stopPropagation();
  if (touch.p0 >= 1 && pulled > 0) {
    const startY = touch.y, now = performance.now();
    motion.release(now);
    aboutPassage.dragFromPortrait(startY, event.clientY, now);
    return;
  }
  motion.drag(touch.p0 + pulled / (STAGE.travel * 0.9), performance.now());
  p = motion.input;
}, { capture: true, passive: true });
for (const name of ["pointerup", "pointercancel"]) {
  document.addEventListener(name, event => {
    if (touch && event.pointerId === touch.id) { touch = null; motion.release(performance.now()); }
  }, { capture: true, passive: true });
}

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
window.addEventListener("pagehide", () => {
  aboutPassage.destroy();
  portrait?.then(mounted => mounted.destroy()).catch(() => {});
}, { once: true });

requestAnimationFrame(frame);
