// Site coordinator: the opening, which view is current, which view receives
// input, the address bar, and the passages between views.
//
//   views.js          what the views are: paths, titles, how each is reached
//   scenes.js         one small contract for every scene (load / setVisible /
//                     setActive / destroy), adapting each module's own API
//   stage-passage.js  Home ↔ Portfolio: one progress value, one fire seam
//   page-passage.js   page views (About) opening over the stage
//   router.js         the address bar
//
// The effects live in their own modules and are never reached into from here.

import { initBurn } from "../burn/index.js";
import { initCursor } from "../cursor/index.js";
import { initBurnTypography } from "../burn/type/typography.js";
import { initBurnSocials } from "../burn/socials.js";
import { mountPortrait } from "../portrait/mount.js";
import { createFireCurtain } from "./fire-curtain.js";
import { waitForOpening } from "./opening-ready.js";
import { createCursorHandoff } from "./cursor-handoff.js";
import { createDepthLens } from "./depth-lens.js";
import { createHomeScene, createPortfolioScene, createPageScene } from "./scenes.js";
import { createStagePassage } from "./stage-passage.js";
import { createPagePassage } from "./page-passage.js";
import { createRouter, viewFromPath } from "./router.js";
import { VIEWS, viewById, viewAbove, planNavigation } from "./views.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const OPENING = Object.freeze({
  // Apparition, minimum hold, then the source-aligned landscape reveal.
  igniteSeconds: 0.7,
  minIntroMs: 1500,
  recedeSeconds: 2.4,
});

const html = document.documentElement;
const hostTitle = document.title;
const burnLayer = document.querySelector(".stage--burn");
const portraitLayer = document.querySelector(".stage--portrait");
const portraitRoot = portraitLayer.querySelector(".portrait");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const router = createRouter({ onNavigate: id => onHistory(id) });

// --- state -------------------------------------------------------------------
let intro = { phase: "hold", t: 0, life: 0 };
let inputEnabled = false;
let current = "home";   // the view the site last settled on
let owner = "home";     // the view receiving input; null while a page passage runs
let loadingWheelUntil = 0;
let previousFrameAt = performance.now();
const preloadQueued = new Set();

// --- pointer gate ------------------------------------------------------------
// Registered before any scene so it runs first on document. Home's pointer
// listeners (burn, flame cursor, inscription) only hear the pointer while Home
// owns input: the sheet must not keep burning under a view nobody can see, and
// it must come back exactly as it was left. A slow opening must not accumulate
// invisible burns before Home is ready.
const handoff = createCursorHandoff();
let pointerType = "mouse";
document.addEventListener("pointermove", event => {
  if (event.pointerType !== "touch") {
    handoff.setPointer(event.clientX, event.clientY);
    pointerType = event.pointerType;
  }
  if (intro || owner !== "home") event.stopImmediatePropagation();
});

// --- curtain and opening -------------------------------------------------------
const curtain = createFireCurtain();
curtain.set({ opening: 1, reveal: 0, life: 0 });
const depth = createDepthLens(burnLayer, portraitLayer);
html.dataset.stage = "intro";

// --- Home, mounted with the opening --------------------------------------------
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
  minimumMs: OPENING.minIntroMs,
});

// --- scenes and passages -------------------------------------------------------
const scenes = {
  home: createHomeScene({ layer: burnLayer, burn }),
  portfolio: createPortfolioScene({
    layer: portraitLayer,
    root: portraitRoot,
    pointer: () => ({ ...handoff.pointer, type: pointerType }),
    mount: () => mountPortrait({ root: portraitRoot, scene: 1, onHome: () => navigate("home") }),
  }),
};
const stage = createStagePassage({ burnLayer, portraitLayer, portraitRoot, curtain, depth, handoff, reduced });
const STAGE_END = VIEWS.find(view => view.passage === "stage" && view.position === 1);

// Page passages register their own input listeners first, so that while one
// runs it hears the wheel before the stage does.
const pages = {};
for (const view of VIEWS.filter(view => view.passage === "page")) {
  scenes[view.id] = createPageScene({
    view,
    onNavigate({ destination, event }) {
      if (!plainClick(event)) return;
      navigate(destination);
      return false;
    },
  });
  pages[view.id] = createPagePassage({
    view,
    scene: scenes[view.id],
    above: viewAbove(view.id),
    curtain,
    showUnder,
    canNavigate: () => inputEnabled,
    onChange: syncOwner,
    onSettle: (id, record) => settle(id, { record }),
  });
}
const activePage = () => Object.values(pages).find(page => page.active) ?? null;

// --- views, input ownership and the address bar ----------------------------------
function desiredOwner() {
  const page = activePage();
  if (page) return page.settled ? page.view.id : null;
  if (intro) return "home";
  return stage.position >= 0.5 ? "portfolio" : "home";
}

// Input changes owner as the seam passes the middle, while both views can
// still be visible; a page passage holds it until it settles.
function syncOwner() {
  const next = desiredOwner();
  if (next === owner) return;
  owner = next;
  for (const [id, scene] of Object.entries(scenes)) scene.setActive(id === owner);
}

function settle(id, { record = true } = {}) {
  current = id;
  document.title = viewById(id)?.title ?? hostTitle;
  if (record) router.record(id);
}

/** Puts a stage view underneath, at once, before a page passage reveals it. */
async function showUnder(id) {
  await scenes[id].load();
  stage.jump(viewById(id).position);
  apply(0);
}

function goTo(position, options) {
  if (!inputEnabled || activePage() || stage.input === position) return false;
  stage.goTo(position, options);
  return true;
}

/** Every click, key and link navigation goes through here. */
function navigate(id, { via = "click" } = {}) {
  const page = activePage();
  const plan = planNavigation(id, { page: page && { id: page.view.id, settled: page.settled }, via });
  if (plan.action === "open") { pages[plan.page].open(); return true; }
  if (plan.action === "leave") { pages[plan.page].leave(plan.to); return true; }
  if (plan.action === "goto") return goTo(plan.position, plan.timing);
  return false;
}

/** Back and Forward. */
function onHistory(id) {
  if (!inputEnabled) return;
  const page = activePage();
  const plan = planNavigation(id, { page: page && { id: page.view.id, settled: page.settled }, via: "history" });
  if (plan.action === "open") pages[plan.page].open({ record: false });
  else if (plan.action === "leave") pages[plan.page].leave(plan.to, { record: false });
  else if (plan.action === "jump") showUnder(id).catch(error => console.error("History:", error));
}

function preload(id) {
  if (!id || preloadQueued.has(id)) return;
  preloadQueued.add(id);
  // Prepared once the stage has arrived, so its setup never lands in the
  // middle of the passage.
  const run = () => pages[id].preload();
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 600 });
  else setTimeout(run, 200);
}

// --- frame -------------------------------------------------------------------
function apply(dt) {
  const page = activePage();
  syncOwner();
  stage.render(dt, { intro, curtainBusy: Boolean(page), cold: owner === "portfolio" && scenes.portfolio.coldPointer });

  const pv = stage.position;
  if (!intro) {
    // A scene that is fully covered keeps its state but stops drawing.
    scenes.home.setVisible(!(pv >= 1 || page?.settled));
    scenes.portfolio.setVisible(pv > 0 && !page?.settled);
  }

  const view = page?.settled ? page.view.id : intro ? "intro" : pv <= 0.02 ? "burn" : pv >= 0.98 ? "portrait" : "transit";
  if (html.dataset.stage !== view) html.dataset.stage = view;
  if (view === "portrait") preload(STAGE_END.below);
  // Whichever way a stage view is reached (click, wheel, keys), the
  // address follows once the passage settles, so Back returns to the last one.
  if (!page && (view === "burn" || view === "portrait")) {
    const id = view === "portrait" ? "portfolio" : "home";
    if (id !== current) settle(id);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, (now - previousFrameAt) / 1000);
  const dt = Math.min(elapsed, 0.05);
  previousFrameAt = now;
  stage.tick(dt);

  if (intro) {
    intro.life = Math.min(1, intro.life + dt / OPENING.igniteSeconds);
    if (intro.phase === "recede") {
      const seconds = reduced.matches ? 0.8 : OPENING.recedeSeconds;
      intro.t = Math.min(1, intro.t + dt / seconds);
      stage.setPosition(0.5 * (1 - easeInOut(intro.t)));
      if (intro.t >= 1) finishIntro();
    }
  } else if (!activePage()) {
    stage.update(now, elapsed);
  }

  apply(dt);
}

function finishIntro() {
  intro = null;
  stage.jump(0);
  inputEnabled = true;
  // The portrait mounts once the opening is over so its texture work never
  // competes with the receding fire.
  setTimeout(() => {
    scenes.portfolio.load().catch(error => console.error("Portrait mount:", error));
  }, 350);
}

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

const atStageEnd = () => stage.input >= 1 && stage.position >= 0.98;

// Keep one trackpad gesture with its initial owner, even as frames drift under
// the pointer. A fresh gesture rechecks the active scene's frame/track geometry.
let wheelOwner = null, lastWheelAt = -Infinity;
window.addEventListener("wheel", event => {
  if (activePage()) return;
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
  if (stage.ownsTail(dy, now)) {
    event.preventDefault(); event.stopPropagation();
    stage.scroll(dy, now); return;
  }
  if (atStageEnd()) {
    if (event.target.closest?.(".scene-switch, .portrait-home")) return;
    if (!wheelOwner || now - lastWheelAt > 200) {
      wheelOwner = scenes.portfolio.isScrollRegion(event.clientX, event.clientY) ? "gallery" : "stage";
    }
    lastWheelAt = now;
    // Both directions reach the existing gallery handler near its frames or
    // track. Empty space navigates up to Home or down to the page below.
    if (wheelOwner === "gallery") return;
    if (dy > 0) {
      event.preventDefault(); event.stopPropagation();
      pages[STAGE_END.below].scrollFrom(dy, now);
      return;
    }
  } else {
    wheelOwner = null;
  }
  if (stage.input <= 0 && dy < 0) { event.preventDefault(); return; }
  event.preventDefault();
  event.stopPropagation();
  stage.scroll(dy, now);
}, { capture: true, passive: false });

// Navigation links reuse the existing passages without reloading any state.
// Modified clicks keep their native behavior (a new tab opens at that path).
const nav = document.querySelector('.burn-nav');
nav?.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || !plainClick(event)) return;
  event.preventDefault();
  navigate(viewFromPath(new URL(link.href).pathname));
});
for (const link of nav?.querySelectorAll('a[href]') ?? []) {
  const id = viewFromPath(new URL(link.href).pathname);
  if (viewById(id)?.passage !== "page") continue;
  link.addEventListener('pointerenter', () => pages[id].preload());
  link.addEventListener('focus', () => pages[id].preload());
}

window.addEventListener("keydown", event => {
  if (activePage()) return;
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.target?.isContentEditable) return;
  let handled = false;
  switch (event.key) {
    case "ArrowDown": case "PageDown": case "End":
      handled = navigate("portfolio", { via: "key" }); break;
    case "ArrowUp": case "PageUp": case "Home":
      handled = navigate("home", { via: "key" }); break;
    case " ":
      handled = navigate(event.shiftKey ? "home" : "portfolio", { via: "key" }); break;
  }
  if (handled) event.preventDefault();
});

// On touch screens views change only by tapping links: a vertical swipe would
// be ambiguous between a scene's own drag and a page change. The coordinator
// therefore never handles touch; each scene receives the finger as it would a
// mouse (the black hole in Space, the liquid in Dust).

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});
window.addEventListener("pagehide", () => {
  Object.values(pages).forEach(page => page.destroy());
  scenes.portfolio.destroy();
  router.destroy();
}, { once: true });

requestAnimationFrame(frame);
