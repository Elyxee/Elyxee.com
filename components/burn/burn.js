import { QUAD_VS, NOISE_BAKE_FS, SIM_FS, COMPOSITE_FS } from "./shaders.js?v=77";

import { RECOVERY_COMPOSITE_FS, RECOVERY_SETTLE_FS } from "./recovery-visual.js?v=75";
import { LATER_COMPOSITE_FS } from "./later-visual.js?v=82";
import { loadImage } from "../shared/load-image.js";

// Every rate is per second so behaviour is frame-rate independent.
export const BURN_SETTINGS = {
  // Heat source
  radius: 0.082, // in screen-height units
  inject: 7.5, // heat added per second at the core of the source
  scorchRate: 3.2, // direct surface damage — makes a fast pass leave a mark

  // Combustion. First pass: full self-sustain on virgin sheet (unchanged feel).
  // After a full recovery uSpreadMode drops to 0 and only the pointer burns.
  burnRate: 2.7, // damage from accumulated heat
  // Heat released by the charring band. This is what makes the front self
  // sustaining, and it is the knob for how fast a fire travels: the hotter the
  // front, the further ahead of it the sheet is warm enough to catch. It has a
  // floor — below about 0.9 the coolest, least combustible material can no
  // longer hold a front and fires start guttering out and stranding char.
  combustion: 1.85,
  spreadRate: 8.9, // how quickly the front pulls neighbours along
  // Damage lost per texel of spread. It keeps the burn a cone rather than a
  // plateau, and since the cone has to descend from the depth cap to the
  // burn-through threshold, it is what sets how deep the burning band is.
  spreadDrop: 0.038,
  diffuse: 7.0,
  heatDecay: 6.5,

  // Recovery — the opening retreats from its rim, the carbon clears ahead of it.
  // Seconds from a fully developed burn back to an untouched sheet.
  recoverySeconds: 180,
  // First pass only: switch to the vortex at full burn-through, then hold the
  // open sheet for three seconds before its existing recovery starts.
  recoveryHoldSeconds: 3,
  // After the first recovery, movement keeps damage open. A parked pointer
  // stops heating and permits healing after 30 seconds; leaving does so now.
  pointerIdleSeconds: 30,
  // Char fades slower than the opening (ratio < 1) so the carbon rim outlasts
  // the hole briefly and ashes do not rush in while the ice is still visible.
  charHealRatio: 0.82,

  // Loose ash in an open hole metabolizes when healing runs (1/rate seconds).
  ashFade: 0.07,
  // Mid-recovery plateau: burn has sunk but char still blankets the sheet.
  // Extra fade here shortens the all-ash phase without touching the hold or tail.
  ashMidFade: 0.16,
  // Once the sheet has closed over a spot, the dark ash veil left on top clears
  // this much faster than the base heal rate (5.0 = six times as fast). Only
  // the all-ash "cloud" phase is affected: neither how the opening knits shut
  // nor how the paper finally grows back changes.
  veilHeal: 5.0,
  // Cursor-scale transitions: the flame guttering out into the cold presence,
  // and the cold presence bursting back into flame.
  quenchSeconds: 1.4,
  reigniteSeconds: 1.35,
  // Fraction of the entire sheet with negligible remaining damage.
  reigniteRecovery: 0.975,
  // Per-texel damage below which the sheet reads as restored to the eye; the
  // remaining tail keeps fading on its own after the flame returns.
  reigniteDamage: 0.12,

  // Once the first fire has taken the entire sheet, the source stops being a
  // flame and becomes a cold presence that parts the ash without touching the
  // state — so a cursor left on the page cannot re-burn what is growing back.
  // Require the first pass to cover the entire sheet before starting
  // the recovery hold. A cold patch or a stalled partial front is not done.
  recoverCoverageDone: 1.0,
  // Appearance
  edgeChaos: 0.86,
  flicker: 1.0,

  // Resources
  simLongSide: 512,
  noiseSize: 512,
  dprCap: 2,
};

const DEFAULT_FIRE = new URL("../../Assets/optimized/home-fire.webp", import.meta.url).href;
const DEFAULT_ICE = new URL("../../Assets/optimized/home-ice.webp", import.meta.url).href;
const FALLBACK_FIRE = new URL("../../Assets/background/Fire-clean.png", import.meta.url).href;
const FALLBACK_ICE = new URL("../../Assets/background/Ice.png", import.meta.url).href;
const STYLE_HREF = new URL("./burn.css?v=44", import.meta.url).href;

const QUAD = new Float32Array([-1, -1, 3, -1, -1, 3]);

function ensureStylesheet() {
  const existing = document.querySelector("link[data-burn-style]");
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  link.dataset.burnStyle = "";
  document.head.appendChild(link);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`burn: shader compile failed — ${log}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`burn: program link failed — ${log}`);
  }

  const cache = new Map();
  return {
    program,
    location(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name);
    },
  };
}

function createTarget(gl, width, height, format) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    format.internalFormat,
    width,
    height,
    0,
    gl.RGBA,
    format.type,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const complete =
    gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }
  return { texture, framebuffer, width, height };
}

// A minute-and-a-half recovery removes less than a thousandth of the damage per
// frame, which is below the resolution of a half float near the top of the
// range — the subtraction would round away and the burn would never close. So
// full float is preferred, and the lower-precision fallbacks carry the smallest
// heal rate they can actually represent along with the depth they can hold.
const BYTE_FORMAT = { precision: "byte", depthMax: 1.0, minHealRate: 0.5 };

function pickStateFormat(gl, isWebGL2) {
  const candidates = [];
  const colorFloat = isWebGL2 && gl.getExtension("EXT_color_buffer_float");
  if (colorFloat && gl.getExtension("OES_texture_float_linear")) {
    candidates.push({
      internalFormat: gl.RGBA32F,
      type: gl.FLOAT,
      precision: "float",
      depthMax: 2.2,
      minHealRate: 1e-4,
    });
  }
  const halfCandidate = { precision: "half", depthMax: 2.2, minHealRate: 0.2 };
  if (colorFloat) {
    candidates.push({
      ...halfCandidate,
      internalFormat: gl.RGBA16F,
      type: gl.HALF_FLOAT,
    });
  }
  const halfFloat = gl.getExtension("OES_texture_half_float");
  if (!isWebGL2 && halfFloat) {
    gl.getExtension("OES_texture_half_float_linear");
    candidates.push({
      ...halfCandidate,
      internalFormat: gl.RGBA,
      type: halfFloat.HALF_FLOAT_OES,
    });
  }
  candidates.push({
    ...BYTE_FORMAT,
    internalFormat: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  });

  for (const format of candidates) {
    const probe = createTarget(gl, 4, 4, format);
    if (probe) {
      gl.deleteFramebuffer(probe.framebuffer);
      gl.deleteTexture(probe.texture);
      return format;
    }
  }
  return { ...BYTE_FORMAT, internalFormat: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

function createImageTexture(gl, image) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Smoothstep on an already-normalised 0..1 value, for transition envelopes that
// have to leave and arrive at rest rather than at a constant rate.
function ease(t) {
  return t * t * (3 - 2 * t);
}

export function initBurn(options = {}) {
  const settings = { ...BURN_SETTINGS, ...(options.settings || {}) };
  const autoPointer = options.autoPointer !== false;

  ensureStylesheet();

  let canvas = options.canvas || document.querySelector("#burn-fx");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "burn-fx";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);
  }

  const contextAttributes = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  };

  let isWebGL2 = true;
  let gl = canvas.getContext("webgl2", contextAttributes);
  if (!gl) {
    isWebGL2 = false;
    gl = canvas.getContext("webgl", contextAttributes)
      || canvas.getContext("experimental-webgl", contextAttributes);
  }
  if (!gl) {
    console.warn("burn: WebGL unavailable, burn effect disabled");
    const ready = loadImage(options.fireSrc || DEFAULT_FIRE, {
      fallbackSrc: options.fireSrc ? undefined : FALLBACK_FIRE,
    }).then(image => {
      canvas.style.background = `center / cover no-repeat url("${image.src}")`;
      canvas.classList.add("is-ready");
    });
    return { canvas, ready, supported: false, destroy() {} };
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const simProgram = createProgram(gl, QUAD_VS, SIM_FS);
  const fireCompositeProgram = createProgram(gl, QUAD_VS, COMPOSITE_FS);
  const recoveryCompositeProgram = createProgram(gl, QUAD_VS, RECOVERY_COMPOSITE_FS);
  const recoverySettleProgram = createProgram(gl, QUAD_VS, RECOVERY_SETTLE_FS);
  const laterCompositeProgram = createProgram(gl, QUAD_VS, LATER_COMPOSITE_FS);
  const stateFormat = options.statePrecision === "byte"
    ? { ...BYTE_FORMAT, internalFormat: gl.RGBA, type: gl.UNSIGNED_BYTE }
    : pickStateFormat(gl, isWebGL2);
  // A byte copy makes full-sheet readback portable across float/half/byte GPUs.
  const metricsProgram = createProgram(gl, QUAD_VS, `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uState;
    void main() { gl_FragColor = clamp(texture2D(uState, vUv), 0.0, 1.0); }
  `);

  function drawQuad() {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // --- static tileable noise, baked once -----------------------------------
  const noiseTarget = createTarget(gl, settings.noiseSize, settings.noiseSize, {
    internalFormat: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
  });
  {
    const bake = createProgram(gl, QUAD_VS, NOISE_BAKE_FS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseTarget.framebuffer);
    gl.viewport(0, 0, settings.noiseSize, settings.noiseSize);
    gl.useProgram(bake.program);
    drawQuad();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteProgram(bake.program);

    gl.bindTexture(gl.TEXTURE_2D, noiseTarget.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  // --- burn state ping-pong ------------------------------------------------
  let stateA = null;
  let stateB = null;
  let metricsTarget = null;
  let metricsPixels = new Uint8Array(0);
  let simWidth = 1;
  let simHeight = 1;
  let viewWidth = 1;
  let viewHeight = 1;
  let pixelScale = 1;

  function releaseState() {
    for (const target of [stateA, stateB, metricsTarget]) {
      if (!target) continue;
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    stateA = null;
    stateB = null;
    metricsTarget = null;
  }

  function clearState() {
    // Alpha included: it carries the spent flag, and a sheet that starts out
    // marked as already burnt would never catch fire.
    gl.clearColor(0, 0, 0, 0);
    for (const target of [stateA, stateB]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resize() {
    const cssWidth = Math.max(1, window.innerWidth);
    const cssHeight = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, settings.dprCap);

    pixelScale = dpr;
    viewWidth = Math.round(cssWidth * dpr);
    viewHeight = Math.round(cssHeight * dpr);
    canvas.width = viewWidth;
    canvas.height = viewHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const long = settings.simLongSide;
    if (cssWidth >= cssHeight) {
      simWidth = long;
      simHeight = Math.max(2, Math.round((long * cssHeight) / cssWidth));
    } else {
      simHeight = long;
      simWidth = Math.max(2, Math.round((long * cssWidth) / cssHeight));
    }

    releaseState();
    stateA = createTarget(gl, simWidth, simHeight, stateFormat);
    stateB = createTarget(gl, simWidth, simHeight, stateFormat);
    metricsTarget = createTarget(gl, simWidth, simHeight, {
      internalFormat: gl.RGBA, type: gl.UNSIGNED_BYTE,
    });
    metricsPixels = new Uint8Array(simWidth * simHeight * 4);
    clearState();
  }

  resize();

  // --- pointer -------------------------------------------------------------
  const pointer = {
    x: 0.5,
    y: 0.5,
    previousX: 0.5,
    previousY: 0.5,
    active: 0,
    targetActive: 0,
    seen: false,
  };

  const content = document.querySelector(".burn-content");
  const markNode = content?.querySelector(".burn-mark");
  const socialFireNode = content?.querySelector(".burn-socials--fire");
  const socialIceNode = content?.querySelector(".burn-socials--ice");

  function setPointer(clientX, clientY) {
    pointer.x = clamp(clientX / Math.max(window.innerWidth, 1), -0.5, 1.5);
    pointer.y = 1 - clamp(clientY / Math.max(window.innerHeight, 1), -0.5, 1.5);
    if (!pointer.seen) {
      pointer.seen = true;
      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
    }
    lastPointerActivityAt = performance.now();
    if (phase === "pinpoint") {
      pinpointArmed = true;
      recoveryHoldRemaining = settings.pointerIdleSeconds;
    }
  }

  function setPointerActive(active) {
    if (active && !pointer.targetActive && phase === "pinpoint") {
      pinpointArmed = true;
      lastPointerActivityAt = performance.now();
      recoveryHoldRemaining = settings.pointerIdleSeconds;
    }
    if (!active && phase === "pinpoint") recoveryHoldRemaining = 0;
    pointer.targetActive = active ? 1 : 0;
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch") return;
    setPointer(event.clientX, event.clientY);
    setPointerActive(true);
  }

  function onPointerOut(event) {
    if (!event.relatedTarget) setPointerActive(false);
  }

  function onVisibility() {
    if (document.hidden) setPointerActive(false);
  }

  function onBlur() {
    setPointerActive(false);
  }

  if (autoPointer) {
    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
  }
  window.addEventListener("resize", resize, { passive: true });

  // --- textures ------------------------------------------------------------
  let fireTexture = null;
  let iceTexture = null;
  const fireSize = [1, 1];
  const iceSize = [1, 1];
  let ready = false;
  let resolveFirstFrame, rejectFirstFrame;
  const firstFrame = new Promise((resolve, reject) => {
    resolveFirstFrame = resolve;
    rejectFirstFrame = reject;
  });

  Promise.all([
    loadImage(options.fireSrc || DEFAULT_FIRE, { fallbackSrc: options.fireSrc ? undefined : FALLBACK_FIRE }),
    loadImage(options.iceSrc || DEFAULT_ICE, { fallbackSrc: options.iceSrc ? undefined : FALLBACK_ICE }),
  ])
    .then(([fire, ice]) => {
      fireTexture = createImageTexture(gl, fire);
      iceTexture = createImageTexture(gl, ice);
      fireSize[0] = fire.naturalWidth;
      fireSize[1] = fire.naturalHeight;
      iceSize[0] = ice.naturalWidth;
      iceSize[1] = ice.naturalHeight;
      ready = true;
    })
    .catch((error) => {
      console.warn(error.message);
      rejectFirstFrame(error);
    });

  // --- frame loop ----------------------------------------------------------
  let running = true;
  let frameHandle = 0;
  let previousFrameAt = performance.now();
  let elapsed = 0;
  // 1 until the sheet has mostly recovered from the first burn episode, then 0
  // forever (mouse-only). Sampled off the state texture so it tracks real heal,
  // not a wall-clock guess.
  let spreadMode = 1;
  let sawDamage = false;
  // Set once the first recovery has fully faded; later passes then draw with
  // the c90860d composite. Never switched while anything is still burnt.
  let laterVisual = false;
  // Cursor phase and background recovery finish independently. Retain the ash
  // renderer through its remaining tail instead of dropping it on reignition.
  let recoveryVisualMix = 0;
  let sampleAccum = 0;
  let lastDamageSample = null;
  let recoveryTailMean = 1;
  let recoveryHoldRemaining = 0;
  let lastPointerActivityAt = performance.now();
  let pinpointArmed = false;
  // "burning"    — first pass, the pointer is a flame and the fire spreads.
  // "recovering" — the sheet is mostly gone; the pointer is a cold presence
  //                that parts the ash but writes nothing to the state.
  // "pinpoint"   — mostly healed once; the pointer burns only where it is.
  let phase = "burning";
  // The information layer follows the visible material, which can become ice
  // before the recovery phase formally starts if a large front has crossed it.
  let sceneIce = false;
  // Smoothed 0..1 weight for the recovery-phase presence in the composite.
  let interact = 0;
  const probeW = 8;
  const probeH = 8;
  const sampleBuf = new Uint8Array(probeW * probeH * 4);

  // Phase-change transition at the cursor: 1 at the change, decays to 0. Kind
  // +1 = flame quenched into the cold presence, -1 = cold presence reignites.
  let pulse = 0;
  let pulseKind = 0;
  let thawTimer = 0;
  // The first fire has taken the sheet; the hold is running and the cold
  // presence follows during the three-second hold before healing starts.
  let sheetTaken = false;
  // Strength of the presence when the current transition began, so it can be
  // carried into or out of the transition instead of cutting.
  let coldFrom = 0;
  // Smoothed pointer velocity (uv per second) — rises quickly, decays slowly,
  // so the cloud keeps moving for a moment after the pointer stops.
  let velX = 0;
  let velY = 0;

  function settleConsumedSheet() {
    if (!stateA || !lastDamageSample || lastDamageSample.coverage < 1) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateB.framebuffer);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.useProgram(recoverySettleProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(recoverySettleProgram.location("uState"), 0);
    gl.uniform3f(recoverySettleProgram.location("uConsumedSheet"),
      lastDamageSample.burnMean, lastDamageSample.damageMean, lastDamageSample.spentMean);
    drawQuad();
    [stateA, stateB] = [stateB, stateA];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setPhase(next) {
    const prev = phase;
    phase = next;
    canvas.classList.toggle("is-recovering", next === "recovering");
    document.documentElement.dataset.burnPhase = next;
    if (next === "recovering") sceneIce = true;
    if (next === "pinpoint" && prev === "recovering") sceneIce = false;
    if (content) content.dataset.burnScene = sceneIce ? "ice" : "fire";
    if (prev !== next) {
      if (next === "recovering") {
        recoveryVisualMix = 1;
        recoveryTailMean = lastDamageSample?.damageMean ?? 1;
        settleConsumedSheet();
        // Cold takes the pointer completely — the flame canvas is hidden via CSS
        // on data-burn-phase — but it arrives along the transition rather than
        // in a single frame.
        pulse = 1;
        pulseKind = 1;
        coldFrom = interact;
      } else if (prev === "recovering") {
        // Reignite: the burst carries the cold off, and by the end of it nothing
        // of the presence is left. The first-fire latch is done here too — later
        // burns must be able to write heat.
        pulse = 1;
        pulseKind = -1;
        coldFrom = interact;
        // Cosmetic only: lets CSS slow the flame cursor's return for the thaw.
        document.documentElement.dataset.burnThaw = "";
        clearTimeout(thawTimer);
        thawTimer = setTimeout(() => {
          delete document.documentElement.dataset.burnThaw;
        }, settings.reigniteSeconds * 1000 + 600);
        sheetTaken = false;
        // A resting vortex must not immediately burn a fresh hole on handoff.
        // Finish the recovery tail until a new pointer movement lights it.
        pinpointArmed = false;
        recoveryHoldRemaining = 0;
      }
    }
  }
  setPhase(phase);

  function readProbe(ox, oy) {
    for (let y = 0; y < probeH; y++) {
      for (let x = 0; x < probeW; x++) {
        const offset = (Math.min(simHeight - 1, oy + y) * simWidth + Math.min(simWidth - 1, ox + x)) * 4;
        sampleBuf.set(metricsPixels.subarray(offset, offset + 4), (y * probeW + x) * 4);
      }
    }
    return true;
  }

  function sampleNodeState(node, scale) {
    if (!node) return { burn: 0, charred: 0, heat: 0 };
    const rect = node.getBoundingClientRect();
    const u = clamp((rect.left + rect.width * 0.5) / Math.max(window.innerWidth, 1), 0, 1);
    const v = clamp(1 - (rect.top + rect.height * 0.5) / Math.max(window.innerHeight, 1), 0, 1);
    const ox = clamp(Math.round(u * simWidth - probeW / 2), 0, Math.max(0, simWidth - probeW));
    const oy = clamp(Math.round(v * simHeight - probeH / 2), 0, Math.max(0, simHeight - probeH));
    if (!readProbe(ox, oy)) return { burn: 0, charred: 0, heat: 0 };
    let burn = 0;
    let charred = 0;
    let heat = 0;
    for (let i = 0; i < probeW * probeH; i++) {
      burn = Math.max(burn, sampleBuf[i * 4] * scale);
      heat = Math.max(heat, sampleBuf[i * 4 + 1] * scale);
      charred = Math.max(charred, sampleBuf[i * 4 + 2] * scale);
    }
    return { burn, charred, heat };
  }

  function sampleSheetDamage() {
    if (!stateA) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, metricsTarget.framebuffer);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.useProgram(metricsProgram.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(metricsProgram.location("uState"), 0);
    drawQuad();
    gl.readPixels(0, 0, simWidth, simHeight, gl.RGBA, gl.UNSIGNED_BYTE, metricsPixels);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return null;
    }
    let burn = 0, charred = 0, open = 0, restored = 0, heatMax = 0, damageSum = 0, spentSum = 0, burnSum = 0;
    const total = simWidth * simHeight;
    const scale = 1 / 255;
    // Every simulation pixel counts, including the last isolated islands.
    for (let i = 0; i < metricsPixels.length; i += 4) {
      const b = metricsPixels[i] * scale, c = metricsPixels[i + 2] * scale;
      burn = Math.max(burn, b);
      charred = Math.max(charred, c);
      heatMax = Math.max(heatMax, metricsPixels[i + 1] * scale);
      damageSum += Math.max(b, c);
      spentSum += metricsPixels[i + 3] * scale;
      burnSum += b;
      // A byte readback rounds: 143 can represent a value just below the
      // render threshold (0.56). Require 144 so no visible fragment is counted.
      if (metricsPixels[i] >= 144) open++;
      if (Math.max(b, c) <= settings.reigniteDamage) restored++;
    }

    // The information layer is sampled from the same state texture as the
    // composite. This lets the mark and icons pick up heat, ash and frost when
    // the cursor burns directly beneath them instead of floating above the
    // scene as unrelated HTML.
    const markState = sampleNodeState(markNode, scale);
    const socialState = sampleNodeState(
      sceneIce ? socialIceNode : socialFireNode,
      scale,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
      burn,
      charred,
      heatMax,
      coverage: open / Math.max(total, 1),
      damageMean: damageSum / Math.max(total, 1),
      spentMean: spentSum / Math.max(total, 1),
      burnMean: burnSum / Math.max(total, 1),
      recovery: restored / Math.max(total, 1),
      markState,
      socialState,
    };
  }

  function updateContentPointer() {
    if (!content) return;
    const seen = pointer.seen ? 1 : 0;
    const clientX = pointer.x * Math.max(window.innerWidth, 1);
    const clientY = (1 - pointer.y) * Math.max(window.innerHeight, 1);

    const proximity = (node, radius) => {
      if (!node || !seen) return 0;
      const rect = node.getBoundingClientRect();
      const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
      const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
      return clamp(1 - Math.hypot(dx, dy) / radius, 0, 1) * pointer.active;
    };

    content.style.setProperty("--burn-mark-heat", proximity(markNode, 230).toFixed(3));
    content.style.setProperty(
      "--burn-social-heat",
      proximity(sceneIce ? socialIceNode : socialFireNode, 190).toFixed(3),
    );
  }

  function simulate(deltaSeconds) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, stateB.framebuffer);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.useProgram(simProgram.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(simProgram.location("uState"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, noiseTarget.texture);
    gl.uniform1i(simProgram.location("uNoise"), 1);

    gl.uniform2f(simProgram.location("uTexel"), 1 / simWidth, 1 / simHeight);
    gl.uniform1f(simProgram.location("uAspect"), simWidth / simHeight);
    gl.uniform2f(simProgram.location("uPointerPrev"), pointer.previousX, pointer.previousY);
    gl.uniform2f(simProgram.location("uPointer"), pointer.x, pointer.y);
    // In the recovery phase the pointer is not a heat source at all.
    gl.uniform1f(
      simProgram.location("uPointerActive"),
      // Keep the flame usable through the first hold. Heating ends exactly
      // when the vortex/recovery starts, or after later pointer inactivity.
      phase === "recovering" || (phase === "pinpoint" && (!pinpointArmed || recoveryHoldRemaining <= 0))
        ? 0 : pointer.active,
    );
    gl.uniform1f(simProgram.location("uDt"), deltaSeconds);
    gl.uniform1f(simProgram.location("uRadius"), settings.radius);
    gl.uniform1f(simProgram.location("uInject"), settings.inject);
    gl.uniform1f(simProgram.location("uScorchRate"), settings.scorchRate);
    gl.uniform1f(simProgram.location("uBurnRate"), settings.burnRate);
    // No self-propagating front may survive into recovery. Otherwise the last
    // unburned islands can ignite while the rest of the sheet is growing back.
    const recovering = phase === "recovering";
    gl.uniform1f(simProgram.location("uSpreadRate"), recovering ? 0 : settings.spreadRate);
    gl.uniform1f(simProgram.location("uSpreadDrop"), settings.spreadDrop);
    gl.uniform1f(simProgram.location("uCombustion"), recovering ? 0 : settings.combustion);
    gl.uniform1f(simProgram.location("uDiffuse"), settings.diffuse);
    gl.uniform1f(simProgram.location("uHeatDecay"), settings.heatDecay);
    const recovery = Math.max(0.2, settings.recoverySeconds);
    gl.uniform1f(simProgram.location("uDepthMax"), stateFormat.depthMax);
    gl.uniform1f(
      simProgram.location("uHealBurn"),
      Math.max(2.3 / recovery, stateFormat.minHealRate),
    );
    gl.uniform1f(
      simProgram.location("uHealChar"),
      Math.max(2.3 * settings.charHealRatio / recovery, stateFormat.minHealRate * 0.93),
    );
    gl.uniform1f(simProgram.location("uAshFade"), settings.ashFade);
    gl.uniform1f(simProgram.location("uAshMidFade"), settings.ashMidFade);
    gl.uniform1f(simProgram.location("uVeilHeal"), settings.veilHeal);
    // The first burn must finish before ANY patch can heal. Later recovery is
    // locked by pointer activity; local heat only controls the cooling rate.
    gl.uniform1f(
      simProgram.location("uHealScale"),
      phase !== "burning" && recoveryHoldRemaining <= 0 ? 1 : 0,
    );
    gl.uniform1f(simProgram.location("uSpreadMode"), spreadMode);

    drawQuad();

    const swap = stateA;
    stateA = stateB;
    stateB = swap;
  }

  function drawComposite(compositeProgram) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewWidth, viewHeight);
    gl.useProgram(compositeProgram.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateA.texture);
    gl.uniform1i(compositeProgram.location("uState"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, noiseTarget.texture);
    gl.uniform1i(compositeProgram.location("uNoise"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, fireTexture);
    gl.uniform1i(compositeProgram.location("uFire"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, iceTexture);
    gl.uniform1i(compositeProgram.location("uIce"), 3);

    gl.uniform2f(compositeProgram.location("uResolution"), viewWidth, viewHeight);
    gl.uniform2f(compositeProgram.location("uSimSize"), simWidth, simHeight);
    gl.uniform1f(compositeProgram.location("uPixelScale"), pixelScale);
    gl.uniform2f(compositeProgram.location("uFireSize"), fireSize[0], fireSize[1]);
    gl.uniform2f(compositeProgram.location("uIceSize"), iceSize[0], iceSize[1]);
    gl.uniform1f(compositeProgram.location("uTime"), elapsed);
    // c90860d's recovery texture used 1.0; keep today's fire setting at 0.86.
    gl.uniform1f(compositeProgram.location("uEdgeChaos"),
      compositeProgram === recoveryCompositeProgram || compositeProgram === laterCompositeProgram
        ? 1.0 : settings.edgeChaos);
    gl.uniform1f(
      compositeProgram.location("uFlicker"),
      reducedMotion.matches ? 0 : settings.flicker,
    );
    gl.uniform1f(compositeProgram.location("uInteract"), interact);
    // Cosmetic late-veil cleanup only; never used by simulation or phase gates.
    gl.uniform1f(compositeProgram.location("uTailBlend"),
      1 - ease(clamp((recoveryTailMean - 0.10) / 0.08, 0, 1)));
    gl.uniform1f(compositeProgram.location("uTailCeiling"), recoveryTailMean + 0.012);
    gl.uniform2f(compositeProgram.location("uPointerUv"), pointer.x, pointer.y);
    // No ring if the pointer is not on the page: it would fire at a stale spot.
    gl.uniform1f(compositeProgram.location("uPulse"), pulse * pointer.active);
    gl.uniform1f(compositeProgram.location("uPulseKind"), pulseKind);
    gl.uniform2f(
      compositeProgram.location("uPointerVel"),
      velX * (viewWidth / Math.max(viewHeight, 1)),
      velY,
    );

    drawQuad();
  }

  function composite() {
    if (recoveryVisualMix >= 1) {
      drawComposite(recoveryCompositeProgram);
      return;
    }
    drawComposite(laterVisual ? laterCompositeProgram : fireCompositeProgram);
    if (recoveryVisualMix > 0) {
      // A fresh burn can begin before the old tail is gone. Blend the handoff
      // instead of snapping renderers or delaying the user's new heat source.
      gl.enable(gl.BLEND);
      gl.blendColor(0, 0, 0, ease(recoveryVisualMix));
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
      drawComposite(recoveryCompositeProgram);
      gl.disable(gl.BLEND);
    }
  }

  function frame(now) {
    frameHandle = requestAnimationFrame(frame);
    if (!running) return;

    const deltaSeconds = clamp((now - previousFrameAt) / 1000, 0.001, 1 / 30);
    previousFrameAt = now;
    elapsed += deltaSeconds;
    if (phase === "pinpoint" && (laterVisual || pinpointArmed)) {
      recoveryVisualMix = Math.max(0, recoveryVisualMix - deltaSeconds / 0.55);
    }
    recoveryTailMean += ((lastDamageSample?.damageMean ?? 1) - recoveryTailMean)
      * (1 - Math.exp(-deltaSeconds * 6));

    // Releases faster than it engages, so the sheet starts recovering promptly
    // once the source is gone.
    const ramp = pointer.targetActive > pointer.active ? 16 : 34;
    pointer.active += (pointer.targetActive - pointer.active)
      * clamp(deltaSeconds * ramp, 0, 1);
    if (pointer.active < 0.001) pointer.active = 0;

    if (phase === "pinpoint") {
      recoveryHoldRemaining = pinpointArmed && pointer.targetActive
        ? Math.max(0, settings.pointerIdleSeconds - (now - lastPointerActivityAt) / 1000)
        : 0;
    } else if (recoveryHoldRemaining > 0) {
      recoveryHoldRemaining = Math.max(0, recoveryHoldRemaining - deltaSeconds);
    }

    // The presence rides the transitions: it gathers as the flame gutters and is
    // blown away by the burst, on the same eased curves the shader draws, rather
    // than switching on and off in a single frame. Outside a transition it is
    // simply on during recovery and off everywhere else, so cold is never left
    // over a flame or flame over cold.
    const present = pointer.active > 0.03 ? 1 : 0;
    const transitionProgress = ease(1 - pulse);
    if (phase === "recovering") {
      if (pulseKind > 0 && pulse > 0) {
        // Lags the flame's dying: the frost has nothing to fill until it has.
        const gathered = ease(clamp((1 - pulse - 0.22) / 0.68, 0, 1));
        interact = Math.max(coldFrom * (1 - transitionProgress), present * gathered);
      } else {
        interact += (present - interact) * clamp(deltaSeconds * 8, 0, 1);
        if (interact < 0.001) interact = 0;
      }
    } else if (pulseKind < 0 && pulse > 0) {
      interact = coldFrom * (1 - ease(clamp((1 - pulse) / 0.55, 0, 1)));
    } else {
      interact = 0;
    }
    if (interact < 0.001) interact = 0;
    if (pulse > 0) {
      const seconds = pulseKind > 0 ? settings.quenchSeconds : settings.reigniteSeconds;
      pulse = Math.max(0, pulse - deltaSeconds / Math.max(0.2, seconds));
    }

    updateContentPointer();

    // Pointer velocity with momentum, for the wind field.
    const instVx = (pointer.x - pointer.previousX) / deltaSeconds;
    const instVy = (pointer.y - pointer.previousY) / deltaSeconds;
    const rising = Math.hypot(instVx, instVy) > Math.hypot(velX, velY);
    const velK = clamp(deltaSeconds * (rising ? 12 : 2.6), 0, 1);
    velX += (instVx - velX) * velK;
    velY += (instVy - velY) * velK;
    const velMag = Math.hypot(velX, velY);
    if (velMag > 3) {
      velX *= 3 / velMag;
      velY *= 3 / velMag;
    }

    simulate(deltaSeconds);

    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;

    sampleAccum += deltaSeconds;
    if (sampleAccum >= 0.45) {
      sampleAccum = 0;
      const sample = sampleSheetDamage();
      if (sample) {
        lastDamageSample = sample;
        if (phase === "recovering" || sample.coverage >= 0.30 || sample.markState.burn >= 0.45) {
          sceneIce = true;
        } else if (phase === "pinpoint" && sample.coverage <= 0.10) {
          sceneIce = false;
        }
        if (content) content.dataset.burnScene = sceneIce ? "ice" : "fire";
        if (content) {
          content.style.setProperty("--burn-mark-burn", sample.markState.burn.toFixed(3));
          content.style.setProperty("--burn-social-burn", sample.socialState.burn.toFixed(3));
          content.style.setProperty(
            "--burn-mark-heat",
            Math.max(Number(content.style.getPropertyValue("--burn-mark-heat")) || 0, sample.markState.heat * 0.75).toFixed(3),
          );
          content.style.setProperty(
            "--burn-social-heat",
            Math.max(Number(content.style.getPropertyValue("--burn-social-heat")) || 0, sample.socialState.heat * 0.75).toFixed(3),
          );
        }
        if (sample.burn > 0.12 || sample.charred > 0.12) sawDamage = true;
        if (
          !laterVisual
          && phase === "pinpoint"
          && pulse === 0
          && Math.max(sample.burn, sample.charred) <= 0.02
          && sample.spentMean <= 0.01
        ) {
          laterVisual = true;
        }

        if (
          phase === "burning"
          && spreadMode > 0
          && !sheetTaken
          && sample.coverage >= settings.recoverCoverageDone
        ) {
          // Every simulation texel is open: the vortex starts now. Freeze
          // healing for the hold, then use the unchanged recovery rates.
          sheetTaken = true;
          recoveryHoldRemaining = settings.recoveryHoldSeconds;
          setPhase("recovering");
        } else if (
          phase === "recovering"
          && sawDamage
          && sample.recovery >= settings.reigniteRecovery
        ) {
          // Mostly recovered: from now on the pointer burns only
          // where it is. The last traces of scorch fade on their own.
          spreadMode = 0;
          sheetTaken = false;
          setPhase("pinpoint");
        }
      }
    }

    if (ready) {
      composite();
      if (resolveFirstFrame) {
        canvas.classList.add("is-ready");
        resolveFirstFrame();
        resolveFirstFrame = null;
      }
    }
  }

  frameHandle = requestAnimationFrame(frame);

  return {
    canvas,
    gl,
    settings,
    supported: true,
    ready: firstFrame,

    /** Last sampled lifecycle state, without an additional GPU readback. */
    getState() {
      return {
        phase, sheetTaken, spreadMode, recoveryHoldRemaining, laterVisual, recoveryVisualMix,
        healing: phase !== "burning" && recoveryHoldRemaining <= 0,
        coverage: lastDamageSample?.coverage ?? 0,
        damageMean: lastDamageSample?.damageMean ?? 0,
        damageMax: Math.max(lastDamageSample?.burn ?? 0, lastDamageSample?.charred ?? 0),
        recovery: lastDamageSample?.recovery ?? 1,
        heatMax: lastDamageSample?.heatMax ?? 0,
        sourceEnabled: phase === "burning" || (phase === "pinpoint" && pinpointArmed && recoveryHoldRemaining > 0),
        precision: stateFormat.precision,
      };
    },

    /** Feed an external heat source, in client pixels (e.g. the cursor). */
    setPointer(clientX, clientY) {
      setPointer(clientX, clientY);
    },
    setPointerActive,
    reset() {
      clearState();
      spreadMode = 1;
      sawDamage = false;
      laterVisual = false;
      recoveryVisualMix = 0;
      sampleAccum = 0;
      lastDamageSample = null;
      recoveryHoldRemaining = 0;
      pinpointArmed = false;
      lastPointerActivityAt = performance.now();
      interact = 0;
      setPhase("burning");
      pulse = 0;
      sheetTaken = false;
      velX = 0;
      velY = 0;
    },
    pause() {
      running = false;
    },
    resume() {
      previousFrameAt = performance.now();
      running = true;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(frameHandle);
      clearTimeout(thawTimer);
      delete document.documentElement.dataset.burnThaw;
      if (autoPointer) {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerout", onPointerOut);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("blur", onBlur);
      }
      window.removeEventListener("resize", resize);
      releaseState();
      gl.deleteFramebuffer(noiseTarget.framebuffer);
      gl.deleteTexture(noiseTarget.texture);
      if (fireTexture) gl.deleteTexture(fireTexture);
      if (iceTexture) gl.deleteTexture(iceTexture);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(metricsProgram.program);
      gl.deleteProgram(simProgram.program);
      gl.deleteProgram(fireCompositeProgram.program);
      gl.deleteProgram(recoveryCompositeProgram.program);
      gl.deleteProgram(recoverySettleProgram.program);
      canvas.classList.remove("is-ready");
    },
  };
}
